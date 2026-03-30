import { google, type drive_v3, type docs_v1, type sheets_v4, type slides_v1 } from "googleapis";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

function getKeyFilePath(): string {
  const envPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (envPath && existsSync(envPath)) return envPath;

  const defaultPath = join(homedir(), ".config", "google-sa.json");
  if (existsSync(defaultPath)) return defaultPath;

  throw new WorkspaceError(
    "Service account key not found. Set GOOGLE_SERVICE_ACCOUNT_KEY env var or place key at ~/.config/google-sa.json",
  );
}

const auth = new google.auth.GoogleAuth({
  keyFile: getKeyFilePath(),
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
  ],
});

let _drive: drive_v3.Drive | null = null;
let _docs: docs_v1.Docs | null = null;
let _sheets: sheets_v4.Sheets | null = null;
let _slides: slides_v1.Slides | null = null;

export function getDrive(): drive_v3.Drive {
  if (!_drive) _drive = google.drive({ version: "v3", auth });
  return _drive;
}

export function getDocs(): docs_v1.Docs {
  if (!_docs) _docs = google.docs({ version: "v1", auth });
  return _docs;
}

export function getSheets(): sheets_v4.Sheets {
  if (!_sheets) _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export function getSlides(): slides_v1.Slides {
  if (!_slides) _slides = google.slides({ version: "v1", auth });
  return _slides;
}

export function getAuth() {
  return auth;
}

export function formatFile(file: drive_v3.Schema$File) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    parents: file.parents,
    webViewLink: file.webViewLink,
  };
}

/** Extract a Google file ID from a URL or return the string as-is */
export function parseFileId(input: string): string {
  // https://docs.google.com/document/d/FILE_ID/edit
  // https://docs.google.com/spreadsheets/d/FILE_ID/edit
  // https://docs.google.com/presentation/d/FILE_ID/edit
  // https://drive.google.com/file/d/FILE_ID/view
  // https://drive.google.com/open?id=FILE_ID
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return input;
}
