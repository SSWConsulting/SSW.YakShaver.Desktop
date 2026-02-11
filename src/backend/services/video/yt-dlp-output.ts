import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function resolveDownloadedFilePath(basePath: string): Promise<string> {
  const dir = path.dirname(basePath);
  const baseName = path.basename(basePath);
  const entries = await readdir(dir);
  const matches = entries
    .filter((name) => name.startsWith(`${baseName}.`))
    .filter((name) => !name.endsWith(".download"));

  if (!matches.length) {
    throw new Error("youtube-download-service: download completed but output file was not found");
  }

  let bestPath = path.join(dir, matches[0]);
  let bestMtime = 0;
  for (const match of matches) {
    const filePath = path.join(dir, match);
    const stats = await stat(filePath);
    if (stats.mtimeMs >= bestMtime) {
      bestMtime = stats.mtimeMs;
      bestPath = filePath;
    }
  }
  return bestPath;
}

