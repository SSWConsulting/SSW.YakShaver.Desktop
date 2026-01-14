import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// Disable minification for PR preview builds to get full React error messages.
// This is controlled via the VITE_DEBUG_BUILD env var (set to the string "true").
// In CI this is set by the GitHub workflow; for local debugging you can enable it by:
//   - Adding `VITE_DEBUG_BUILD=true` to .env.local in this directory, or
//   - Running `VITE_DEBUG_BUILD=true npm run build`
const isDebugBuild = process.env.VITE_DEBUG_BUILD === "true";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
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
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
