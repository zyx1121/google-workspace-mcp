import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDrive, formatFile } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";

const FILE_FIELDS = "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink";

export function registerSearchTools(server: McpServer) {
  server.tool(
    "drive_search",
    "Search files by name or full-text content",
    {
      query: z.string().min(1).describe("Search query (searches file names and content)"),
      page_size: z.number().int().positive().max(100).default(20).describe("Number of results to return"),
      page_token: z.string().optional().describe("Token for next page of results"),
    },
    withErrorHandling(async ({ query, page_size, page_token }) => {
      const drive = getDrive();
      const res = await drive.files.list({
        q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: page_size,
        pageToken: page_token,
        orderBy: "modifiedTime desc",
      });
      return success({
        files: (res.data.files || []).map(formatFile),
        nextPageToken: res.data.nextPageToken,
      });
    }),
  );

  server.tool(
    "drive_query",
    "Run a custom Drive API query (advanced)",
    {
      q: z.string().min(1).describe("Drive API query string (e.g. \"mimeType='image/png' and '123' in parents\")"),
      page_size: z.number().int().positive().max(100).default(20).describe("Number of results"),
      page_token: z.string().optional().describe("Token for next page"),
    },
    withErrorHandling(async ({ q, page_size, page_token }) => {
      const drive = getDrive();
      const res = await drive.files.list({
        q,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: page_size,
        pageToken: page_token,
      });
      return success({
        files: (res.data.files || []).map(formatFile),
        nextPageToken: res.data.nextPageToken,
      });
    }),
  );
}
