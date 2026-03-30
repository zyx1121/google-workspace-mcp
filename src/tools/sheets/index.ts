import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSheets, parseFileId } from "../../auth.js";
import { success, withErrorHandling } from "../../helpers.js";

export function registerSheetsTools(server: McpServer) {
  server.tool(
    "sheets_get_info",
    "Get spreadsheet metadata (title, sheets, named ranges). Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Spreadsheet file ID or URL"),
    },
    withErrorHandling(async ({ file_id }) => {
      const sheets = getSheets();
      const id = parseFileId(file_id);
      const res = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: "spreadsheetId, properties.title, sheets.properties, namedRanges",
      });
      return success({
        id: res.data.spreadsheetId,
        title: res.data.properties?.title,
        sheets: (res.data.sheets || []).map((s) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount,
        })),
        namedRanges: res.data.namedRanges || [],
      });
    }),
  );

  server.tool(
    "sheets_read",
    "Read cell values from a spreadsheet range (e.g. 'Sheet1!A1:D10'). Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Spreadsheet file ID or URL"),
      range: z.string().min(1).describe("A1 notation range (e.g. 'Sheet1!A1:D10')"),
    },
    withErrorHandling(async ({ file_id, range }) => {
      const sheets = getSheets();
      const id = parseFileId(file_id);
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range,
        valueRenderOption: "FORMATTED_VALUE",
      });
      return success({
        range: res.data.range,
        values: res.data.values || [],
      });
    }),
  );

  server.tool(
    "sheets_write",
    "Write values to a spreadsheet range. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Spreadsheet file ID or URL"),
      range: z.string().min(1).describe("A1 notation range (e.g. 'Sheet1!A1')"),
      values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).describe("2D array of values to write"),
    },
    withErrorHandling(async ({ file_id, range, values }) => {
      const sheets = getSheets();
      const id = parseFileId(file_id);
      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      return success({
        updatedRange: res.data.updatedRange,
        updatedRows: res.data.updatedRows,
        updatedColumns: res.data.updatedColumns,
        updatedCells: res.data.updatedCells,
      });
    }),
  );

  server.tool(
    "sheets_append",
    "Append rows to the end of a spreadsheet range. Accepts a file ID or URL.",
    {
      file_id: z.string().min(1).describe("Spreadsheet file ID or URL"),
      range: z.string().min(1).describe("A1 notation range (e.g. 'Sheet1!A:D')"),
      values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).describe("2D array of rows to append"),
    },
    withErrorHandling(async ({ file_id, range, values }) => {
      const sheets = getSheets();
      const id = parseFileId(file_id);
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      return success({
        updatedRange: res.data.updates?.updatedRange,
        updatedRows: res.data.updates?.updatedRows,
        updatedCells: res.data.updates?.updatedCells,
      });
    }),
  );
}
