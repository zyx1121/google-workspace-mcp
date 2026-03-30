import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDrive, formatFile } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";

const FILE_FIELDS = "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink";

export function registerFolderTools(server: McpServer) {
  server.tool(
    "drive_create_folder",
    "Create a new folder",
    {
      name: z.string().min(1).describe("Folder name"),
      parent_id: z.string().optional().describe("Parent folder ID (default: root)"),
    },
    withErrorHandling(async ({ name, parent_id }) => {
      const drive = getDrive();
      const res = await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parent_id ? [parent_id] : undefined,
        },
        fields: FILE_FIELDS,
      });
      return success(formatFile(res.data));
    }),
  );

  server.tool(
    "drive_list_folders",
    "List only folders in a parent folder",
    {
      parent_id: z.string().default("root").describe("Parent folder ID (default: root)"),
      page_size: z.number().int().positive().max(100).default(20).describe("Number of folders to return"),
    },
    withErrorHandling(async ({ parent_id, page_size }) => {
      const drive = getDrive();
      const res = await drive.files.list({
        q: `'${parent_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: `files(${FILE_FIELDS})`,
        pageSize: page_size,
        orderBy: "name",
      });
      return success({ folders: (res.data.files || []).map(formatFile) });
    }),
  );
}
