import { OAuthCredentialsStorage } from "../services/storage/oauth-credentials-storage";

/**
 * @deprecated Use OAuthCredentialsStorage.getInstance().getYouTubeCredentials() instead.
 * This synchronous function is kept for backward compatibility but will return null
 * if credentials haven't been loaded yet.
 */
const getYouTubeLegacy = () => {
  const { env } = process;
  const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = env;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
};

/**
 * Gets YouTube OAuth credentials from secure storage.
 * Falls back to environment variables for backward compatibility.
 */
export async function getYouTubeCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const storage = OAuthCredentialsStorage.getInstance();
  const credentials = await storage.getYouTubeCredentials();

  if (credentials) {
    return credentials;
  }

  // Fallback to env vars for backward compatibility
  return getYouTubeLegacy();
}

/**
 * Gets GitHub MCP OAuth credentials from secure storage.
 * Falls back to environment variables for backward compatibility.
 */
export async function getGitHubMcpCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const storage = OAuthCredentialsStorage.getInstance();
  const credentials = await storage.getGitHubCredentials();

  if (credentials) {
    return credentials;
  }

  // Fallback to env vars for backward compatibility
  const { env } = process;
  const { MCP_GITHUB_CLIENT_ID: id, MCP_GITHUB_CLIENT_SECRET: secret } = env;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

/**
 * @deprecated Legacy config object. Use the async functions directly.
 */
export const config = {
  youtube: getYouTubeLegacy,
};
