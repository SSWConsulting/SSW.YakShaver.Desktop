import type { OAuthTokens } from "@ai-sdk/mcp";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../ipc/channels";
import { MCPServerManager } from "../services/mcp/mcp-server-manager";
import { McpOAuthTokenStorage } from "../services/storage/mcp-oauth-token-storage";

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
  "/oauth/callback": async (url, window) => {
    const params = Object.fromEntries(url.searchParams.entries());
    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const serverId = params.serverId;

    if (!accessToken || !refreshToken || !serverId) {
      const missing = [
        !accessToken ? "access_token" : null,
        !refreshToken ? "refresh_token" : null,
        !serverId ? "serverId" : null,
      ].filter(Boolean);
      console.warn("OAuth callback missing required parameters", {
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
      console.warn("OAuth callback server id not found", {
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
      token_type: params.token_type ?? "bearer",
      expires_in: params.expires_in ? Number(params.expires_in) : undefined,
      scope: params.scope,
    };

    await McpOAuthTokenStorage.getInstance().saveTokensAsync(serverId, tokens);
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
