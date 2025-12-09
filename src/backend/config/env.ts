const { env } = process;

const getYouTube = () => {
  const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = env;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
};

const getAzure = () => {
  const { AZURE_CLIENT_ID: clientId, AZURE_TENANT_ID: tenantId, GRAPH_SCOPES, AZURE_CUSTOM_PROTOCOL } = env;
  const scopes = (GRAPH_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return clientId && tenantId
    ? { clientId, tenantId, scopes, customProtocol: AZURE_CUSTOM_PROTOCOL || null }
    : null;
};

export const config = {
  youtube: getYouTube,
  azure: getAzure,
};
