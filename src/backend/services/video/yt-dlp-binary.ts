import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export type YtDlpBinaryResolutionSource = "packaged" | "userData" | "nodeModules" | "system";

export interface ResolveYtDlpBinaryResult {
  binaryPath: string;
  source: YtDlpBinaryResolutionSource;
}

function getPackagedYtDlpPath(): string {
  return path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "youtube-dl-exec",
    "bin",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
}

function getUserDataYtDlpPath(): string {
  return path.join(
    app.getPath("userData"),
    "bin",
    "yt-dlp",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
}

async function isUsableYtDlpExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    if (process.platform === "win32") return true;

    if ((stats.mode & 0o111) === 0) return false;

    const header = (await readFile(filePath)).subarray(0, 128).toString("utf8");
    if (header.startsWith("#!") && header.toLowerCase().includes("python")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function findYtDlpOnPath(pathEnv: string | undefined): Promise<string | undefined> {
  if (!pathEnv) return undefined;
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await isUsableYtDlpExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getLatestDownloadUrl(): string {
  switch (process.platform) {
    case "win32":
      return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    case "darwin":
      return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
    default:
      return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  }
}

async function downloadYtDlpBinary(destinationPath: string): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });

  const url = getLatestDownloadUrl();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp (HTTP ${response.status})`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const tmpPath = `${destinationPath}.download`;

  try {
    await writeFile(tmpPath, data);
    if (process.platform !== "win32") {
      await chmod(tmpPath, 0o755);
    }
    try {
      await unlink(destinationPath);
    } catch {
    }
    await rename(tmpPath, destinationPath);
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
    }
    throw error;
  }
}

export async function resolveYtDlpBinaryPath(
  nodeModulesPath?: string,
): Promise<ResolveYtDlpBinaryResult> {
  if (app.isPackaged) {
    const packagedPath = getPackagedYtDlpPath();
    if (await isUsableYtDlpExecutable(packagedPath)) {
      return { binaryPath: packagedPath, source: "packaged" };
    }
  }

  const userDataPath = getUserDataYtDlpPath();
  if (await isUsableYtDlpExecutable(userDataPath)) {
    return { binaryPath: userDataPath, source: "userData" };
  }

  if (nodeModulesPath && (await isUsableYtDlpExecutable(nodeModulesPath))) {
    return { binaryPath: nodeModulesPath, source: "nodeModules" };
  }

  const systemPath = await findYtDlpOnPath(process.env.PATH);
  if (systemPath) {
    return { binaryPath: systemPath, source: "system" };
  }

  await downloadYtDlpBinary(userDataPath);
  return { binaryPath: userDataPath, source: "userData" };
}
