const { env } = process;

const getAzure = () => {
  const {
    AZURE_ENTRA_APP_CLIENT_ID: clientId,
    AZURE_TENANT_ID: tenantId,
    AZURE_AUTH_SCOPE,
    AZURE_AUTH_CUSTOM_PROTOCOL,
  } = env;
  const scopes = (AZURE_AUTH_SCOPE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return clientId && tenantId
    ? { clientId, tenantId, scopes, customProtocol: AZURE_AUTH_CUSTOM_PROTOCOL || null }
    : null;
};

const getPortalApiUrl = () => {
  const { PORTAL_API_URL: url } = env;
  const baseUrl = url || "https://localhost:7009/api";
  // Remove trailing slashes for consistent URL building
  return baseUrl.replace(/\/+$/, "");
};

const getCommitHash: () => string | null = () => env.COMMIT_HASH || null;

const getIsDev = () => env.NODE_ENV === "development";

export const config = {
  azure: getAzure,
  portalApiUrl: getPortalApiUrl,
  commitHash: getCommitHash,
  isDev: getIsDev,
};
