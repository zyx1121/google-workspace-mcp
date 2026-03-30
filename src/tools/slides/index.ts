import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { slides_v1 } from "googleapis";
import { z } from "zod";
import { getSlides, parseFileId } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";

/** Extract text from a page's shape elements */
function extractSlideText(page: slides_v1.Schema$Page): string {
  const parts: string[] = [];
  for (const el of page.pageElements || []) {
    const shape = el.shape;
    if (!shape?.text?.textElements) continue;
    for (const te of shape.text.textElements) {
      if (te.textRun?.content) {
        parts.push(te.textRun.content);
      }
    }
  }
  return parts.join("").trim();
}

export function registerSlidesTools(server: McpServer) {
  server.tool(
    "slides_get_info",
    "Get presentation metadata (title, slide count, dimensions). Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Presentation file ID or URL"),
    },
    withErrorHandling(async ({ file_id }) => {
      const slides = getSlides();
      const id = parseFileId(file_id);
      const res = await slides.presentations.get({ presentationId: id });
      return success({
        id: res.data.presentationId,
        title: res.data.title,
        slideCount: res.data.slides?.length || 0,
        pageSize: res.data.pageSize,
        locale: res.data.locale,
      });
    }),
  );

  server.tool(
    "slides_read",
    "Read all slides' text content from a presentation. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Presentation file ID or URL"),
    },
    withErrorHandling(async ({ file_id }) => {
      const slides = getSlides();
      const id = parseFileId(file_id);
      const res = await slides.presentations.get({ presentationId: id });

      const slideData = (res.data.slides || []).map((slide, i) => ({
        slideNumber: i + 1,
        objectId: slide.objectId,
        text: extractSlideText(slide),
      }));

      return success({
        id: res.data.presentationId,
        title: res.data.title,
        slides: slideData,
      });
    }),
  );

  server.tool(
    "slides_get_slide",
    "Read a single slide's content by index (1-based). Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Presentation file ID or URL"),
      slide_number: z.number().int().positive().describe("Slide number (1-based)"),
    },
    withErrorHandling(async ({ file_id, slide_number }) => {
      const slides = getSlides();
      const id = parseFileId(file_id);
      const res = await slides.presentations.get({ presentationId: id });

      const allSlides = res.data.slides || [];
      if (slide_number > allSlides.length) {
        return success({ error: `Slide ${slide_number} not found. Total slides: ${allSlides.length}` });
      }

      const slide = allSlides[slide_number - 1];
      return success({
        slideNumber: slide_number,
        objectId: slide.objectId,
        text: extractSlideText(slide),
        elements: (slide.pageElements || []).map((el) => ({
          objectId: el.objectId,
          type: el.shape ? "shape" : el.image ? "image" : el.table ? "table" : "other",
          size: el.size,
          transform: el.transform,
        })),
      });
    }),
  );
}
