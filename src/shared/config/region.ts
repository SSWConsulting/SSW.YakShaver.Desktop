// Build region constant. Drives feature gates and endpoint selection.
//
// Backend: read at runtime from process.env.BUILD_REGION (loaded by dotenv from
// the bundled .env, which the build script copies from .env.<region>).
// Renderer: process.env.BUILD_REGION is statically substituted by Vite's `define`
// at build time, so the bundle contains a literal "global" or "china" and esbuild
// dead-code-eliminates branches gated on IS_GLOBAL / IS_CHINA.

const region: "global" | "china" =
  process.env.BUILD_REGION === "china" ? "china" : "global";

export const BUILD_REGION = region;
export const IS_GLOBAL = region === "global";
export const IS_CHINA = region === "china";
