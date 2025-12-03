import { OAuthCredentialsStorage } from "../services/storage/oauth-credentials-storage";

/**
 * Gets YouTube OAuth credentials from secure storage.
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

  return null;
}

/**
 * Gets GitHub MCP OAuth credentials from secure storage.
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

  return null;
}
