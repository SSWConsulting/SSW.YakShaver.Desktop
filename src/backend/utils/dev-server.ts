// Dev server origin used by the main process to load renderer URLs in dev mode.
// Port is configurable so multiple regions can run side-by-side (e.g. global on 3000, china on 3001).
// Defaults to 3000 to preserve existing behavior for `npm run dev`.

export const devServerPort = (): string => process.env.DEV_SERVER_PORT || "3000";
export const devServerOrigin = (): string => `http://localhost:${devServerPort()}`;
