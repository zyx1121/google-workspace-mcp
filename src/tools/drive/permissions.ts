import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDrive } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";

export function registerPermissionTools(server: McpServer) {
  server.tool(
    "drive_list_permissions",
    "List permissions for a file or folder",
    {
      file_id: z.string().min(1).describe("File or folder ID"),
    },
    withErrorHandling(async ({ file_id }) => {
      const drive = getDrive();
      const res = await drive.permissions.list({
        fileId: file_id,
        fields: "permissions(id, type, role, emailAddress, displayName)",
      });
      return success({ permissions: res.data.permissions || [] });
    }),
  );

  server.tool(
    "drive_share",
    "Share a file or folder with a user",
    {
      file_id: z.string().min(1).describe("File or folder ID"),
      email: z.string().email().describe("Email address to share with"),
      role: z.enum(["reader", "commenter", "writer"]).default("reader").describe("Permission role"),
    },
    withErrorHandling(async ({ file_id, email, role }) => {
      const drive = getDrive();
      const res = await drive.permissions.create({
        fileId: file_id,
        requestBody: {
          type: "user",
          role,
          emailAddress: email,
        },
        sendNotificationEmail: false,
      });
      return success(res.data);
    }),
  );

  server.tool(
    "drive_remove_permission",
    "Remove a permission from a file or folder",
    {
      file_id: z.string().min(1).describe("File or folder ID"),
      permission_id: z.string().min(1).describe("Permission ID to remove"),
    },
    withErrorHandling(async ({ file_id, permission_id }) => {
      const drive = getDrive();
      await drive.permissions.delete({
        fileId: file_id,
        permissionId: permission_id,
      });
      return success({ removed: true, permission_id });
    }),
  );
}
