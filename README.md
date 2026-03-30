# @zyx1121/google-workspace-mcp

MCP server for Google Workspace — Drive, Docs, Sheets, Slides via Claude Code.

## Features

### Drive
- `drive_list_files` / `drive_list_folders` — Browse files and folders
- `drive_get_file` — Get file metadata
- `drive_read_file` — Read file content (auto-exports Google Docs/Sheets/Slides)
- `drive_upload_file` — Upload text files
- `drive_search` / `drive_query` — Search by name, content, or custom query
- `drive_create_folder` / `drive_move_file` / `drive_rename_file` / `drive_delete_file`
- `drive_list_permissions` / `drive_share` / `drive_remove_permission`

### Docs
- `docs_read` — Read Google Doc or .docx as structured text (accepts file ID or URL)
- `docs_read_images` — Extract all embedded images as base64 (accepts file ID or URL)
- `docs_export` — Export as HTML, plain text, or PDF

### Sheets
- `sheets_get_info` — Get spreadsheet metadata
- `sheets_read` — Read cell range (A1 notation)
- `sheets_write` — Write to cell range
- `sheets_append` — Append rows

### Slides
- `slides_get_info` — Get presentation metadata
- `slides_read` — Read all slides' text
- `slides_get_slide` — Read a single slide with element details

## Setup

### 1. Service Account

Create a Google Cloud service account with the following APIs enabled:
- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API

Download the JSON key and place it at `~/.config/google-sa.json`, or set `GOOGLE_SERVICE_ACCOUNT_KEY` env var.

### 2. Install

```bash
npm install -g @zyx1121/google-workspace-mcp
```

### 3. Configure Claude Code

```bash
claude mcp add google-workspace -- google-workspace-mcp
```

Or in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "google-workspace-mcp"
    }
  }
}
```

## URL Support

All Docs/Sheets/Slides tools accept either a file ID or a full Google URL:

```
# These all work:
docs_read("11vEehB23GaKN85zr5R4bF1cNF_dUBvBb")
docs_read("https://docs.google.com/document/d/11vEehB23GaKN85zr5R4bF1cNF_dUBvBb/edit")
```

## License

MIT
