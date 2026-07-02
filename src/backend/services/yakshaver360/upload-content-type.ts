import path from "node:path";

// The content types 360's upload route accepts (SSW.YakShaver upload/route.ts ALLOWED_UPLOAD_CONTENT_TYPES).
const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".qt": "video/quicktime",
  ".mkv": "video/x-matroska",
};

const CONTENT_TYPE_TO_EXTENSION: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
};

/** Content type for a local video path, or null if the extension isn't one 360 accepts. */
export function contentTypeForFile(filePath: string): string | null {
  return EXTENSION_TO_CONTENT_TYPE[path.extname(filePath).toLowerCase()] ?? null;
}

/** File extension (no dot) 360 expects for a given content type. */
export function extensionForContentType(contentType: string): string | null {
  return CONTENT_TYPE_TO_EXTENSION[contentType] ?? null;
}
