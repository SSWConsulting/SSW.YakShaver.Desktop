import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { formatAndReportError } from "../../utils/error-utils";

const LEGACY_GITHUB_TOKEN_PATH = ["yakshaver-tokens", "github-token.enc"] as const;

export async function removeLegacyGitHubToken(): Promise<void> {
  const tokenPath = join(app.getPath("userData"), ...LEGACY_GITHUB_TOKEN_PATH);

  try {
    await fs.unlink(tokenPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    const message = formatAndReportError(error, "remove_legacy_github_token");
    console.warn(`Failed to remove the legacy GitHub token: ${message}`);
  }
}
