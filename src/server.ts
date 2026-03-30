import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFileTools } from "./tools/drive/files.js";
import { registerFolderTools } from "./tools/drive/folders.js";
import { registerSearchTools } from "./tools/drive/search.js";
import { registerPermissionTools } from "./tools/drive/permissions.js";
import { registerDocsTools } from "./tools/docs/index.js";
import { registerSheetsTools } from "./tools/sheets/index.js";
import { registerSlidesTools } from "./tools/slides/index.js";
import { registerImageTools } from "./tools/image/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "google-workspace",
    version: "0.2.0",
  });

  registerFileTools(server);
  registerFolderTools(server);
  registerSearchTools(server);
  registerPermissionTools(server);
  registerDocsTools(server);
  registerSheetsTools(server);
  registerSlidesTools(server);
  registerImageTools(server);

  return server;
}
