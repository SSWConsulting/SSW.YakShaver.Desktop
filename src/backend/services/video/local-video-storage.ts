import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";

const LOCAL_VIDEO_ROOT_FOLDER = "YakShaver";
const RECORDING_FILE_BASENAME = "recording";
const TRANSCRIPT_FILE_NAME = "transcript.txt";
const MAX_TITLE_LENGTH = 80;
// Characters Windows rejects in file names (the strictest of the supported platforms) plus
// ASCII control characters, so a work item title can always become part of a folder name.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we strip
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
// The "YYYY-MM-DD HHmm" stamp (plus an optional " (n)" collision suffix) every folder starts with.
const FOLDER_STAMP_PREFIX = /^\d{4}-\d{2}-\d{2} \d{4}(?: \(\d+\))?/;

const pad = (value: number) => String(value).padStart(2, "0");

/** "YYYY-MM-DD HHmm" in local time — sorts chronologically and is readable in a file browser. */
export function formatFolderStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Makes a work item title safe to use in a folder name, or returns "" when nothing usable is left. */
export function sanitizeFolderTitle(title: string): string {
  return title
    .replace(INVALID_FILE_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .replace(/[\s.]+$/, "");
}

/**
 * The folder name once the work item title is known: the original stamp followed by the title.
 * Rebuilt from the stamp rather than appended, so retrying a run never stacks titles.
 */
export function buildTitledFolderName(currentName: string, title: string): string {
  const stamp = currentName.match(FOLDER_STAMP_PREFIX)?.[0] ?? currentName;
  const safeTitle = sanitizeFolderTitle(title);
  return safeTitle ? `${stamp} - ${safeTitle}` : stamp;
}

async function pathExistsAsync(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Returns `desired`, or `desired (2)`, `desired (3)`… — the first path not already taken. */
async function findAvailablePathAsync(desired: string): Promise<string> {
  let candidate = desired;
  for (let suffix = 2; await pathExistsAsync(candidate); suffix++) {
    candidate = `${desired} (${suffix})`;
  }
  return candidate;
}

/**
 * The default video host: when no video platform is connected, recordings (and their transcripts)
 * are kept in a per-recording folder under the user's Videos folder instead of being uploaded.
 */
export class LocalVideoStorageService {
  private static instance: LocalVideoStorageService;

  // Resolved lazily: the singleton is created while IPC handlers are wired up, and resolving
  // `app.getPath` there would make every handler test stub it.
  constructor(private readonly rootDirOverride?: string) {}

  static getInstance(): LocalVideoStorageService {
    LocalVideoStorageService.instance ??= new LocalVideoStorageService();
    return LocalVideoStorageService.instance;
  }

  getRootDir(): string {
    return this.rootDirOverride ?? path.join(app.getPath("videos"), LOCAL_VIDEO_ROOT_FOLDER);
  }

  /** True when `target` is the root folder or inside it — the only paths we let the UI open. */
  isWithinRootDir(target: string): boolean {
    const relative = path.relative(this.getRootDir(), path.resolve(target));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  /**
   * Copies (not moves) the recording into a new folder — the original is a temp file the
   * workflow still reads from and cleans up itself. Returns the new folder's path.
   */
  async saveRecordingAsync(videoFilePath: string, recordedAt: Date = new Date()): Promise<string> {
    const folder = await findAvailablePathAsync(
      path.join(this.getRootDir(), formatFolderStamp(recordedAt)),
    );
    await fs.mkdir(folder, { recursive: true });
    await fs.copyFile(
      videoFilePath,
      path.join(folder, `${RECORDING_FILE_BASENAME}${path.extname(videoFilePath)}`),
    );
    return folder;
  }

  async saveTranscriptAsync(folder: string, transcriptText: string): Promise<void> {
    await fs.writeFile(path.join(folder, TRANSCRIPT_FILE_NAME), transcriptText, "utf8");
  }

  /** Renames the folder to include the work item title. Returns the (possibly unchanged) path. */
  async renameWithTitleAsync(folder: string, title: string): Promise<string> {
    const desired = path.join(
      path.dirname(folder),
      buildTitledFolderName(path.basename(folder), title),
    );
    if (desired === folder) {
      return folder;
    }
    const target = await findAvailablePathAsync(desired);
    await fs.rename(folder, target);
    return target;
  }
}
