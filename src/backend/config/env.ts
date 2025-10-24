const { env } = process;

const getYouTube = () => {
  const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = env;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
};

export const config = {
  youtube: getYouTube,
};
