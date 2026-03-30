import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { docs_v1 } from "googleapis";
import { z } from "zod";
import mammoth from "mammoth";
import { getDocs, getDrive, getAuth, parseFileId } from "../../auth.js";
import { success, error, withErrorHandling } from "../../helpers.js";

const OFFICE_DOC_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
];

// ── Google Docs API helpers ──────────────────────────────────────────

function extractText(body: docs_v1.Schema$Body): string {
  const parts: string[] = [];
  for (const el of body.content || []) {
    if (el.paragraph) {
      const line = (el.paragraph.elements || [])
        .map((e) => e.textRun?.content || "")
        .join("");
      parts.push(line);
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        const cells = (row.tableCells || []).map((cell) =>
          (cell.content || [])
            .flatMap((c) => (c.paragraph?.elements || []).map((e) => e.textRun?.content || ""))
            .join("")
            .trim(),
        );
        parts.push("| " + cells.join(" | ") + " |");
      }
      parts.push("");
    }
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function collectImageIds(body: docs_v1.Schema$Body): string[] {
  const ids: string[] = [];
  for (const el of body.content || []) {
    if (el.paragraph) {
      for (const e of el.paragraph.elements || []) {
        if (e.inlineObjectElement?.inlineObjectId) ids.push(e.inlineObjectElement.inlineObjectId);
      }
    }
    if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          for (const c of cell.content || []) {
            for (const e of c.paragraph?.elements || []) {
              if (e.inlineObjectElement?.inlineObjectId) ids.push(e.inlineObjectElement.inlineObjectId);
            }
          }
        }
      }
    }
  }
  return ids;
}

// ── .docx binary download helper ─────────────────────────────────────

async function downloadAsBuffer(fileId: string): Promise<Buffer> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Detect if a file is an Office document */
async function getFileMeta(fileId: string) {
  const drive = getDrive();
  const res = await drive.files.get({ fileId, fields: "id, name, mimeType" });
  return { id: res.data.id!, name: res.data.name || "", mimeType: res.data.mimeType || "" };
}

// ── mammoth-based .docx parsing ──────────────────────────────────────

interface DocxImage {
  base64: string;
  mimeType: string;
}

async function parseDocx(buf: Buffer): Promise<{ text: string; html: string; images: DocxImage[] }> {
  const images: DocxImage[] = [];

  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement((image) => {
        return image.read("base64").then((base64) => {
          const mime = image.contentType || "image/png";
          images.push({ base64, mimeType: mime });
          return { src: `data:${mime};base64,${base64}` };
        });
      }),
    },
  );

  // Also get plain text
  const textResult = await mammoth.extractRawText({ buffer: buf });

  return {
    text: textResult.value,
    html: result.value,
    images,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export function registerDocsTools(server: McpServer) {
  server.tool(
    "docs_read",
    "Read a Google Doc or .docx file as structured text. Accepts a file ID or Google Docs URL. Office files (.docx) are parsed locally via mammoth.",
    {
      file_id: z.string().min(1).describe("Google Docs file ID or URL"),
    },
    withErrorHandling(async ({ file_id }) => {
      const id = parseFileId(file_id);
      const meta = await getFileMeta(id);

      if (OFFICE_DOC_TYPES.includes(meta.mimeType)) {
        // .docx → download and parse with mammoth
        const buf = await downloadAsBuffer(id);
        const { text, images } = await parseDocx(buf);
        return success({
          id,
          title: meta.name,
          text,
          imageCount: images.length,
          hint: images.length > 0
            ? `This document contains ${images.length} image(s). Use docs_read_images to extract them.`
            : undefined,
        });
      }

      // Native Google Doc → use Docs API
      const docs = getDocs();
      const res = await docs.documents.get({ documentId: id });
      const title = res.data.title || "";
      const text = res.data.body ? extractText(res.data.body) : "";
      const imageIds = res.data.body ? collectImageIds(res.data.body) : [];

      return success({
        id,
        title,
        text,
        imageCount: imageIds.length,
        hint: imageIds.length > 0
          ? `This document contains ${imageIds.length} image(s). Use docs_read_images to extract them.`
          : undefined,
      });
    }),
  );

  server.tool(
    "docs_read_images",
    "Extract all embedded images from a Google Doc or .docx as base64. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Google Docs file ID or URL"),
      max_images: z.number().int().positive().max(50).default(10).describe("Maximum number of images to extract"),
    },
    async ({ file_id, max_images }) => {
      try {
        const id = parseFileId(file_id);
        const meta = await getFileMeta(id);

        if (OFFICE_DOC_TYPES.includes(meta.mimeType)) {
          // .docx → download and extract images with mammoth
          const buf = await downloadAsBuffer(id);
          const { images } = await parseDocx(buf);

          const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
          const extracted = Math.min(images.length, max_images);

          content.push({
            type: "text",
            text: JSON.stringify({ documentId: id, title: meta.name, totalImages: images.length, extracted }, null, 2),
          });

          for (let i = 0; i < extracted; i++) {
            content.push({ type: "image", data: images[i].base64, mimeType: images[i].mimeType });
          }

          return { content };
        }

        // Native Google Doc → use Docs API
        const docs = getDocs();
        const res = await docs.documents.get({ documentId: id });
        const inlineObjects = res.data.inlineObjects || {};
        const imageIds = res.data.body ? collectImageIds(res.data.body) : [];
        const client = await getAuth().getClient();

        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        let extracted = 0;

        for (const [i, objId] of imageIds.entries()) {
          if (i >= max_images) break;
          const obj = inlineObjects[objId];
          const contentUri = obj?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
          if (!contentUri) continue;

          try {
            const resp = await (client as any).request({ url: contentUri, responseType: "arraybuffer" });
            const buf = Buffer.from(resp.data);
            const mime: string = resp.headers?.["content-type"] || "image/png";
            content.push({ type: "image", data: buf.toString("base64"), mimeType: mime });
            extracted++;
          } catch {
            // contentUri may have expired, skip
          }
        }

        content.unshift({
          type: "text",
          text: JSON.stringify({ documentId: id, title: res.data.title, totalImages: imageIds.length, extracted }, null, 2),
        });

        return { content };
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "docs_export",
    "Export a Google Doc or .docx as HTML, plain text, or PDF. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Google Docs file ID or URL"),
      format: z.enum(["html", "text", "pdf"]).default("html").describe("Export format"),
    },
    withErrorHandling(async ({ file_id, format }) => {
      const id = parseFileId(file_id);
      const meta = await getFileMeta(id);

      if (OFFICE_DOC_TYPES.includes(meta.mimeType)) {
        // .docx → download and convert with mammoth
        const buf = await downloadAsBuffer(id);

        if (format === "pdf") {
          return success({
            id,
            format,
            error: "PDF export from .docx is not supported. Use 'html' or 'text' format.",
          });
        }

        if (format === "html") {
          const result = await mammoth.convertToHtml({ buffer: buf });
          return success({ id, format, content: result.value });
        }

        const result = await mammoth.extractRawText({ buffer: buf });
        return success({ id, format, content: result.value });
      }

      // Native Google Doc → use Drive export API
      const drive = getDrive();
      const mimeMap = {
        html: "text/html",
        text: "text/plain",
        pdf: "application/pdf",
      };

      const res = await drive.files.export({ fileId: id, mimeType: mimeMap[format] });

      if (format === "pdf") {
        const pdfBuf = Buffer.from(res.data as string, "binary");
        return success({ id, format, base64: pdfBuf.toString("base64"), size: pdfBuf.length });
      }

      return success({ id, format, content: String(res.data) });
    }),
  );
}
