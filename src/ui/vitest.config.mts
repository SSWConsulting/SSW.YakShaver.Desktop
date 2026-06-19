/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Renderer (src/ui) component-test harness.
 *
 * Runs React component tests (`*.test.tsx`) in a jsdom environment with React
 * Testing Library — the harness that #803/#869/#821/#879 reviews flagged as
 * missing (the UI wiring could only be inspection-tested before). It lives in
 * src/ui (not the repo root) so it resolves the same single `react` copy the app
 * uses, avoiding a dual-React "invalid hook call" bug.
 *
 * This config owns ALL src/ui renderer tests — both `*.test.tsx` and `*.test.ts`
 * — so they resolve the UI `@`/`@shared` aliases. The root `vitest.config.ts`
 * runs the node-environment backend + shared `*.test.ts` and EXCLUDES src/ui.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
