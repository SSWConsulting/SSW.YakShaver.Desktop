import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

// Disable minification for PR preview builds to get full React error messages.
// This is controlled via the VITE_DEBUG_BUILD env var (set to the string "true").
// In CI this is set by the GitHub workflow; for local debugging you can enable it by:
//   - Adding `VITE_DEBUG_BUILD=true` to .env.local in this directory, or
//   - Running `VITE_DEBUG_BUILD=true npm run build`
const isDebugBuild = process.env.VITE_DEBUG_BUILD === "true";

export default defineConfig(() => {
  // Project root holds .env (secrets) and .env.global / .env.china (committed URL constants).
  const projectRoot = path.resolve(__dirname, "../..");

  // Build region drives which .env.<region> Vite loads as the second layer.
  const region = process.env.BUILD_REGION === "china" ? "china" : "global";

  // loadEnv with mode=region loads .env, .env.local, .env.<region>, .env.<region>.local
  // in order; later files win. So .env.<region> URLs override any matching keys in .env.
  // The "" prefix loads ALL keys (Vite default would only expose VITE_*).
  const envFile = loadEnv(region, projectRoot, "");

  // Substitute process.env.<KEY> with the loaded literal at renderer build time.
  // This is what guarantees the china bundle contains ONLY china URL literals —
  // the audit grep over build/china/.../assets/*.js will pass.
  const substitute = (key: string): [string, string] => [
    `process.env.${key}`,
    JSON.stringify(envFile[key] ?? ""),
  ];

  const define: Record<string, string> = Object.fromEntries([
    ["process.env.BUILD_REGION", JSON.stringify(region)],
    substitute("GITHUB_API_URL"),
    substitute("GITHUB_RELEASES_DOWNLOAD_BASE"),
    substitute("AZURE_LOGIN_URL"),
    substitute("YOUTUBE_WATCH_URL_BASE"),
    substitute("YOUTUBE_THUMBNAIL_URL_BASE"),
    substitute("MCP_GITHUB_COPILOT_URL"),
    substitute("MCP_ATLASSIAN_URL"),
    substitute("YOUTUBE_VALID_DOMAINS"),
    substitute("YOUTUBE_SHORT_HOSTNAME"),
  ]);

  return {
    plugins: [react(), tailwindcss()],
    base: "./",
    define,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared": path.resolve(__dirname, "../shared"),
      },
    },
    build: {
      outDir: "dist",
      assetsDir: "assets",
      emptyOutDir: true,
      minify: isDebugBuild ? false : "esbuild",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          "control-bar": path.resolve(__dirname, "control-bar.html"),
          camera: path.resolve(__dirname, "camera.html"),
          countdown: path.resolve(__dirname, "countdown.html"),
          frameoverlay: path.resolve(__dirname, "frame-overlay.html"),
        },
      },
    },
    server: {
      port: Number(process.env.DEV_SERVER_PORT ?? 3000),
      strictPort: true,
    },
  };
});
