import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    // Renderer (src/ui) tests run under src/ui/vitest.config.mts (jsdom + the
    // @/@shared aliases). Exclude them here so a root `npm test` / the root CI
    // job doesn't sweep them up and fail to resolve the UI aliases.
    exclude: [...configDefaults.exclude, "src/ui/**"],
    setupFiles: ["src/backend/db/setup-tests.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.d.ts"],
    },
  },
});
