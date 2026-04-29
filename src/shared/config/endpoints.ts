// Single source of truth for external URLs/hosts the app talks to.
//
// Why getters: the backend dotenv load happens at the top of src/backend/index.ts,
// AFTER module imports finish initializing. A const initialized at module-load time
// would read empty strings. Getters defer the read until first access — by then
// dotenv has populated process.env. Cheap and correct.
//
// Why process.env.X (static) and not process.env[key] (dynamic): Vite's `define`
// only substitutes static dotted accesses at renderer build time. Dynamic key access
// would not get substituted and would fail in the browser (no process global).
//
// Audit invariant: this file must contain ZERO literal URLs. URL strings live only
// in .env.global / .env.china. The shipped .env matches the build region.

import { IS_GLOBAL } from "./region";

export const ENDPOINTS = {
  get githubApi(): string {
    return process.env.GITHUB_API_URL ?? "";
  },
  get githubReleasesDownloadBase(): string {
    return process.env.GITHUB_RELEASES_DOWNLOAD_BASE ?? "";
  },
  get azureLoginUrl(): string {
    return process.env.AZURE_LOGIN_URL ?? "";
  },
  get youtubeWatchUrlBase(): string {
    return process.env.YOUTUBE_WATCH_URL_BASE ?? "";
  },
  get youtubeThumbnailUrlBase(): string {
    return process.env.YOUTUBE_THUMBNAIL_URL_BASE ?? "";
  },
  get mcpGithubCopilotUrl(): string {
    return process.env.MCP_GITHUB_COPILOT_URL ?? "";
  },
  get mcpAtlassianUrl(): string {
    return process.env.MCP_ATLASSIAN_URL ?? "";
  },
  get youtubeValidDomains(): string[] {
    return (process.env.YOUTUBE_VALID_DOMAINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get youtubeShortHostname(): string {
    return process.env.YOUTUBE_SHORT_HOSTNAME ?? "";
  },
};

// Boolean flags can use IS_GLOBAL/IS_CHINA ternaries — boolean literals (true/false)
// don't fail an audit grep, only URL strings do.
export const featureFlags = {
  appInsights: IS_GLOBAL,
  githubAutoUpdate: IS_GLOBAL,
  microsoftAuth: IS_GLOBAL,
  githubTokenAuth: IS_GLOBAL,
  youtubeUpload: IS_GLOBAL,
  mcpGithubCopilotPreset: IS_GLOBAL,
  mcpAzureDevopsPreset: IS_GLOBAL,
  mcpJiraPreset: IS_GLOBAL,
  llmProviderOpenai: IS_GLOBAL,
  llmProviderAzureOpenai: IS_GLOBAL,
  llmProviderDeepseek: true,
} as const;
