import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import sharp from "sharp";
import { getDrive, parseFileId } from "../../auth.js";
import { success, error, withErrorHandling } from "../../helpers.js";

/** Download a Drive file as Buffer */
async function downloadBuffer(fileId: string): Promise<{ buf: Buffer; name: string; mimeType: string }> {
  const drive = getDrive();
  const meta = await drive.files.get({ fileId, fields: "id, name, mimeType" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return {
    buf: Buffer.from(res.data as ArrayBuffer),
    name: meta.data.name || "image",
    mimeType: meta.data.mimeType || "image/png",
  };
}

export function registerImageTools(server: McpServer) {
  server.tool(
    "image_info",
    "Get image dimensions and metadata from a Drive file. Accepts file ID or URL.",
    {
      file_id: z.string().min(1).describe("Image file ID or URL on Google Drive"),
    },
    withErrorHandling(async ({ file_id }) => {
      const id = parseFileId(file_id);
      const { buf, name, mimeType } = await downloadBuffer(id);
      const metadata = await sharp(buf).metadata();

      const w = metadata.width || 0;
      const h = metadata.height || 0;
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const d = gcd(w, h);
      const ratio = d > 0 ? `${w / d}:${h / d}` : "unknown";

      const is16by9 = Math.abs(w / h - 16 / 9) < 0.02;

      return success({
        id,
        name,
        mimeType,
        width: w,
        height: h,
        aspectRatio: ratio,
        is16by9,
        format: metadata.format,
        size: buf.length,
      });
    }),
  );

  server.tool(
    "image_resize",
    "Resize/crop an image from Drive to target dimensions or aspect ratio, then upload back. Accepts file ID or URL.",
    {
      file_id: z.string().min(1).describe("Source image file ID or URL"),
      width: z.number().int().positive().optional().describe("Target width in pixels"),
      height: z.number().int().positive().optional().describe("Target height in pixels"),
      aspect_ratio: z.string().optional().describe("Target aspect ratio (e.g. '16:9', '4:3', '1:1'). Crops from center to fit."),
      format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output format (default: keep original)"),
      quality: z.number().int().min(1).max(100).default(90).describe("Output quality for jpeg/webp"),
      upload: z.boolean().default(true).describe("Upload result back to Drive in same folder"),
    },
    async ({ file_id, width, height, aspect_ratio, format, quality, upload }) => {
      try {
        const id = parseFileId(file_id);
        const { buf, name, mimeType } = await downloadBuffer(id);
        const meta = await sharp(buf).metadata();
        const origW = meta.width || 0;
        const origH = meta.height || 0;

        let pipeline = sharp(buf);

        // If aspect_ratio is specified, crop from center
        if (aspect_ratio) {
          const [rw, rh] = aspect_ratio.split(":").map(Number);
          if (!rw || !rh) return error(`Invalid aspect ratio: ${aspect_ratio}`);

          const targetRatio = rw / rh;
          let cropW = origW;
          let cropH = origH;

          if (origW / origH > targetRatio) {
            // Too wide, crop width
            cropW = Math.round(origH * targetRatio);
          } else {
            // Too tall, crop height
            cropH = Math.round(origW / targetRatio);
          }

          const left = Math.round((origW - cropW) / 2);
          const top = Math.round((origH - cropH) / 2);
          pipeline = pipeline.extract({ left, top, width: cropW, height: cropH });
        }

        // If explicit dimensions, resize
        if (width || height) {
          pipeline = pipeline.resize(width, height, { fit: "fill" });
        }

        // Format
        const outFormat = format || (meta.format as "png" | "jpeg" | "webp") || "png";
        if (outFormat === "jpeg") pipeline = pipeline.jpeg({ quality });
        else if (outFormat === "webp") pipeline = pipeline.webp({ quality });
        else pipeline = pipeline.png();

        const outBuf = await pipeline.toBuffer();
        const outMeta = await sharp(outBuf).metadata();

        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];

        let uploadResult = null;

        if (upload) {
          // Get parent folder of original file
          const drive = getDrive();
          const orig = await drive.files.get({ fileId: id, fields: "parents" });
          const parents = orig.data.parents || [];

          const ext = outFormat === "jpeg" ? "jpg" : outFormat;
          const baseName = name.replace(/\.[^.]+$/, "");
          const newName = `${baseName}_${outMeta.width}x${outMeta.height}.${ext}`;

          const { Readable } = await import("node:stream");
          const uploaded = await drive.files.create({
            requestBody: {
              name: newName,
              parents: parents.length > 0 ? parents : undefined,
            },
            media: {
              mimeType: `image/${outFormat}`,
              body: Readable.from([outBuf]),
            },
            fields: "id, name, webViewLink",
          });

          uploadResult = {
            id: uploaded.data.id,
            name: uploaded.data.name,
            webViewLink: uploaded.data.webViewLink,
          };
        }

        content.push({
          type: "text",
          text: JSON.stringify({
            original: { width: origW, height: origH, size: buf.length },
            result: { width: outMeta.width, height: outMeta.height, format: outFormat, size: outBuf.length },
            uploaded: uploadResult,
          }, null, 2),
        });

        // Return preview image
        content.push({
          type: "image",
          data: outBuf.toString("base64"),
          mimeType: `image/${outFormat}`,
        });

        return { content };
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "image_preview",
    "Download and preview an image from Drive. Accepts file ID or URL.",
    {
      file_id: z.string().min(1).describe("Image file ID or URL on Google Drive"),
    },
    async ({ file_id }) => {
      try {
        const id = parseFileId(file_id);
        const { buf, name, mimeType } = await downloadBuffer(id);
        const metadata = await sharp(buf).metadata();

        // Resize for preview if too large (max 1920px wide)
        let previewBuf = buf;
        if (metadata.width && metadata.width > 1920) {
          previewBuf = await sharp(buf).resize(1920).toBuffer();
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id,
                name,
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                size: buf.length,
              }, null, 2),
            },
            {
              type: "image" as const,
              data: previewBuf.toString("base64"),
              mimeType: mimeType.startsWith("image/") ? mimeType : "image/png",
            },
          ],
        };
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
