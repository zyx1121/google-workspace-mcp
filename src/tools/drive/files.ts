import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDrive, formatFile } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";
import { Readable } from "node:stream";

const FILE_FIELDS = "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink";

const EXPORT_MAP: Record<string, { mimeType: string; ext: string }> = {
  "application/vnd.google-apps.document": { mimeType: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "text/csv", ext: "csv" },
  "application/vnd.google-apps.presentation": { mimeType: "text/plain", ext: "txt" },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", ext: "png" },
};

export function registerFileTools(server: McpServer) {
  server.tool(
    "drive_list_files",
    "List files in a folder (default: root)",
    {
      folder_id: z.string().default("root").describe("Folder ID to list (default: root)"),
      page_size: z.number().int().positive().max(100).default(20).describe("Number of files to return"),
      page_token: z.string().optional().describe("Token for next page of results"),
    },
    withErrorHandling(async ({ folder_id, page_size, page_token }) => {
      const drive = getDrive();
      const res = await drive.files.list({
        q: `'${folder_id}' in parents and trashed = false`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: page_size,
        pageToken: page_token,
        orderBy: "folder, name",
      });
      return success({
        files: (res.data.files || []).map(formatFile),
        nextPageToken: res.data.nextPageToken,
      });
    }),
  );

  server.tool(
    "drive_get_file",
    "Get file metadata by ID",
    {
      file_id: z.string().min(1).describe("File ID"),
    },
    withErrorHandling(async ({ file_id }) => {
      const drive = getDrive();
      const res = await drive.files.get({
        fileId: file_id,
        fields: `${FILE_FIELDS}, description, shared, owners, permissions`,
      });
      return success(formatFile(res.data));
    }),
  );

  server.tool(
    "drive_read_file",
    "Read file content (text files, Google Docs/Sheets/Slides exported as text/csv)",
    {
      file_id: z.string().min(1).describe("File ID"),
    },
    withErrorHandling(async ({ file_id }) => {
      const drive = getDrive();
      const meta = await drive.files.get({
        fileId: file_id,
        fields: "id, name, mimeType, size",
      });

      const mimeType = meta.data.mimeType || "";
      const exportInfo = EXPORT_MAP[mimeType];

      let content: string;

      if (exportInfo) {
        const res = await drive.files.export({
          fileId: file_id,
          mimeType: exportInfo.mimeType,
        });
        content = String(res.data);
      } else {
        const res = await drive.files.get(
          { fileId: file_id, alt: "media" },
          { responseType: "text" },
        );
        content = String(res.data);
      }

      return success({
        id: meta.data.id,
        name: meta.data.name,
        mimeType,
        content,
      });
    }),
  );

  server.tool(
    "drive_upload_file",
    "Upload a text file to Google Drive",
    {
      name: z.string().min(1).describe("File name"),
      content: z.string().describe("File content"),
      mime_type: z.string().default("text/plain").describe("MIME type of the file"),
      parent_id: z.string().optional().describe("Parent folder ID (default: root)"),
    },
    withErrorHandling(async ({ name, content, mime_type, parent_id }) => {
      const drive = getDrive();
      const res = await drive.files.create({
        requestBody: {
          name,
          parents: parent_id ? [parent_id] : undefined,
        },
        media: {
          mimeType: mime_type,
          body: Readable.from([content]),
        },
        fields: FILE_FIELDS,
      });
      return success(formatFile(res.data));
    }),
  );

  server.tool(
    "drive_delete_file",
    "Move a file to trash",
    {
      file_id: z.string().min(1).describe("File ID to trash"),
    },
    withErrorHandling(async ({ file_id }) => {
      const drive = getDrive();
      await drive.files.update({
        fileId: file_id,
        requestBody: { trashed: true },
      });
      return success({ trashed: true, file_id });
    }),
  );

  server.tool(
    "drive_move_file",
    "Move a file to a different folder",
    {
      file_id: z.string().min(1).describe("File ID to move"),
      new_parent_id: z.string().min(1).describe("Destination folder ID"),
    },
    withErrorHandling(async ({ file_id, new_parent_id }) => {
      const drive = getDrive();
      const file = await drive.files.get({ fileId: file_id, fields: "parents" });
      const previousParents = (file.data.parents || []).join(",");

      const res = await drive.files.update({
        fileId: file_id,
        addParents: new_parent_id,
        removeParents: previousParents,
        fields: FILE_FIELDS,
      });
      return success(formatFile(res.data));
    }),
  );

  server.tool(
    "drive_rename_file",
    "Rename a file",
    {
      file_id: z.string().min(1).describe("File ID to rename"),
      new_name: z.string().min(1).describe("New file name"),
    },
    withErrorHandling(async ({ file_id, new_name }) => {
      const drive = getDrive();
      const res = await drive.files.update({
        fileId: file_id,
        requestBody: { name: new_name },
        fields: FILE_FIELDS,
      });
      return success(formatFile(res.data));
    }),
  );
}
