import type { OAuthTokens } from "@ai-sdk/mcp";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";
import type { TokenData } from "../services/auth/types";
import { MCPServerManager } from "../services/mcp/mcp-server-manager";
import { McpOAuthTokenStorage } from "../services/storage/mcp-oauth-token-storage";
import { YoutubeStorage } from "../services/storage/youtube-storage";

export type ProtocolRouteHandler = (
  url: URL,
  window?: BrowserWindow | null,
) => void | Promise<void>;

// Normalizes host+path so both of these map to the same route:
// - yakshaver-desktop://oauth/callback  -> /oauth/callback
// - yakshaver-desktop:///oauth/callback -> /oauth/callback
const normalizeProtocolPath = (url: URL) => {
  const pathname = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
  const hostSegment = url.host ? `/${url.host}` : "";
  const combined = `${hostSegment}${pathname}`;
  if (combined === "/") {
    return pathname;
  }
  return combined.length > 1 ? combined.replace(/\/+$/u, "") : combined;
};

const routeHandlers: Record<string, ProtocolRouteHandler> = {
  // MCP OAuth callback handler
  "/oauth/callback": async (url, window) => {
    const params = new URLSearchParams(url.search);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const serverId = params.get("serverId");

    console.log("[ProtocolRouter] Handling MCP OAuth callback", {
      serverId,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
    });

    if (!accessToken || !refreshToken || !serverId) {
      const missing = [
        !accessToken ? "access_token" : null,
        !refreshToken ? "refresh_token" : null,
        !serverId ? "serverId" : null,
      ].filter(Boolean);
      console.warn("[ProtocolRouter] MCP OAuth callback missing required parameters", {
        missing,
        url: url.toString(),
      });
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(
          IPC_CHANNELS.PROTOCOL_ERROR,
          `OAuth callback missing required parameters: ${missing.join(", ")}`,
        );
      }
      return;
    }

    const serverConfig = await MCPServerManager.getServerConfigByIdAsync(serverId);
    if (!serverConfig) {
      console.warn("MCP OAuth callback server id not found", {
        url: url.toString(),
        serverId,
      });
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(
          IPC_CHANNELS.PROTOCOL_ERROR,
          `OAuth callback server id not found: ${serverId}`,
        );
      }
      return;
    }

    const tokens: OAuthTokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get("token_type") ?? "bearer",
      expires_in: params.get("expires_in") ? Number(params.get("expires_in")) : undefined,
      scope: params.get("scope") ?? undefined,
    };

    await McpOAuthTokenStorage.getInstance().saveTokensAsync(serverId, tokens);
  },

  // YouTube OAuth callback handler
  "/youtube/oauth/callback": async (url, window) => {
    const params = new URLSearchParams(url.search);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");
    const scope = params.get("scope");

    console.log("[ProtocolRouter] Handling YouTube OAuth callback", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
    });

    if (!accessToken || !refreshToken) {
      const missing = [
        !accessToken ? "access_token" : null,
        !refreshToken ? "refresh_token" : null,
      ].filter(Boolean);
      console.warn("[ProtocolRouter] YouTube OAuth callback missing required parameters", {
        missing,
        url: url.toString(),
      });
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(
          IPC_CHANNELS.PROTOCOL_ERROR,
          `YouTube OAuth callback missing required parameters: ${missing.join(", ")}`,
        );
      }
      return;
    }

    // Convert to TokenData format used by YouTube storage
    const expiresInSeconds = expiresIn ? Number(expiresIn) : 3600;
    const tokenData: TokenData = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      scope: scope?.split(" ") ?? [],
    };

    console.log("[ProtocolRouter] Storing YouTube tokens...");
    await YoutubeStorage.getInstance().storeYouTubeTokens(tokenData);
    console.log("[ProtocolRouter] YouTube tokens stored successfully");
  },
};

export const handleProtocolUrl = async (
  rawUrl: string,
  window?: BrowserWindow | null,
): Promise<boolean> => {
  const parsed = new URL(rawUrl);
  const routePath = normalizeProtocolPath(parsed);
  const handler = routeHandlers[routePath];
  if (handler) {
    await handler(parsed, window);
    return true;
  }
  console.warn("Unhandled protocol route", {
    routePath,
    url: parsed.toString(),
  });
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.PROTOCOL_ERROR, `Unhandled protocol route: ${routePath}`);
  }
  return false;
};
