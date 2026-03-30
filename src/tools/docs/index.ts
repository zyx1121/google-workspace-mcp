import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { docs_v1 } from "googleapis";
import { z } from "zod";
import { getDocs, getDrive, getAuth, parseFileId } from "../../auth.js";
import { success, error, withErrorHandling } from "../../helpers.js";

/** Walk document body and extract plain text */
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
        const cells = (row.tableCells || []).map((cell) => {
          return (cell.content || [])
            .flatMap((c) =>
              (c.paragraph?.elements || []).map((e) => e.textRun?.content || ""),
            )
            .join("")
            .trim();
        });
        parts.push("| " + cells.join(" | ") + " |");
      }
      parts.push("");
    }
  }

  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** Collect all inline object IDs from the document body */
function collectImageIds(body: docs_v1.Schema$Body): string[] {
  const ids: string[] = [];
  for (const el of body.content || []) {
    if (el.paragraph) {
      for (const e of el.paragraph.elements || []) {
        if (e.inlineObjectElement?.inlineObjectId) {
          ids.push(e.inlineObjectElement.inlineObjectId);
        }
      }
    }
    if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          for (const c of cell.content || []) {
            for (const e of c.paragraph?.elements || []) {
              if (e.inlineObjectElement?.inlineObjectId) {
                ids.push(e.inlineObjectElement.inlineObjectId);
              }
            }
          }
        }
      }
    }
  }
  return ids;
}

const OFFICE_DOC_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
];

/**
 * Ensure we have a native Google Doc ID.
 * If the file is a .docx/.doc, copy-convert it to Google Docs format first.
 * Returns { docId, tempCopyId } — caller must delete tempCopyId when done.
 */
async function ensureGoogleDoc(fileId: string): Promise<{ docId: string; tempCopyId: string | null }> {
  const drive = getDrive();
  const meta = await drive.files.get({ fileId, fields: "id, mimeType" });
  const mime = meta.data.mimeType || "";

  if (!OFFICE_DOC_TYPES.includes(mime)) {
    return { docId: fileId, tempCopyId: null };
  }

  // Copy-convert to Google Docs
  const copy = await drive.files.copy({
    fileId,
    requestBody: {
      name: `_temp_conversion_${Date.now()}`,
      mimeType: "application/vnd.google-apps.document",
    },
    fields: "id",
  });

  const copyId = copy.data.id!;
  return { docId: copyId, tempCopyId: copyId };
}

/** Delete a temporary file, silently ignoring errors */
async function cleanupTemp(tempId: string | null) {
  if (!tempId) return;
  try {
    const drive = getDrive();
    await drive.files.delete({ fileId: tempId });
  } catch {
    // best-effort cleanup
  }
}

export function registerDocsTools(server: McpServer) {
  server.tool(
    "docs_read",
    "Read a Google Doc or .docx file as structured text. Accepts a file ID or Google Docs URL. Office files (.docx) are auto-converted.",
    {
      file_id: z.string().min(1).describe("Google Docs file ID or URL"),
    },
    withErrorHandling(async ({ file_id }) => {
      const docs = getDocs();
      const id = parseFileId(file_id);
      const { docId, tempCopyId } = await ensureGoogleDoc(id);

      try {
        const res = await docs.documents.get({ documentId: docId });

        const title = res.data.title || "";
        const text = res.data.body ? extractText(res.data.body) : "";

        const imageIds = res.data.body ? collectImageIds(res.data.body) : [];
        const imageCount = imageIds.length;

        return success({
          id,
          title,
          text,
          imageCount,
          hint: imageCount > 0
            ? `This document contains ${imageCount} image(s). Use docs_read_images to extract them.`
            : undefined,
        });
      } finally {
        await cleanupTemp(tempCopyId);
      }
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
        const docs = getDocs();
        const id = parseFileId(file_id);
        const { docId, tempCopyId } = await ensureGoogleDoc(id);

        try {
        const res = await docs.documents.get({ documentId: docId });

        const inlineObjects = res.data.inlineObjects || {};
        const imageIds = res.data.body ? collectImageIds(res.data.body) : [];

        const client = await getAuth().getClient();

        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
        let extracted = 0;

        for (const [i, objId] of imageIds.entries()) {
          if (i >= max_images) break;

          const obj = inlineObjects[objId];
          const props = obj?.inlineObjectProperties?.embeddedObject;
          if (!props) continue;

          const contentUri = props.imageProperties?.contentUri;
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
          text: JSON.stringify({
            documentId: id,
            title: res.data.title,
            totalImages: imageIds.length,
            extracted,
          }, null, 2),
        });

        return { content };
        } finally {
          await cleanupTemp(tempCopyId);
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "docs_export",
    "Export a Google Doc as HTML, plain text, or PDF. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Google Docs file ID or URL"),
      format: z.enum(["html", "text", "pdf"]).default("html").describe("Export format"),
    },
    withErrorHandling(async ({ file_id, format }) => {
      const drive = getDrive();
      const id = parseFileId(file_id);
      const { docId, tempCopyId } = await ensureGoogleDoc(id);

      try {
        const mimeMap = {
          html: "text/html",
          text: "text/plain",
          pdf: "application/pdf",
        };

        const res = await drive.files.export({
          fileId: docId,
          mimeType: mimeMap[format],
        });

        if (format === "pdf") {
          const buf = Buffer.from(res.data as string, "binary");
          return success({
            id,
            format,
            base64: buf.toString("base64"),
            size: buf.length,
          });
        }

        return success({
          id,
          format,
          content: String(res.data),
        });
      } finally {
        await cleanupTemp(tempCopyId);
      }
    }),
  );
}
