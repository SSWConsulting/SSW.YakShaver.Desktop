const { env } = process;

const getYouTube = () => {
  const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = env;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
};

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

const getPortalApi = () => {
  const { PORTAL_API_URL: url } = env;
  return url || "http://localhost:7009/api";
};

const getCommitHash = () => {
  return env.COMMIT_HASH || "";
};

export const config = {
  youtube: getYouTube,
  azure: getAzure,
  portalApi: getPortalApi,
  commitHash: getCommitHash,
};
