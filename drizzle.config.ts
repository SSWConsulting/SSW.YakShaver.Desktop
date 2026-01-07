import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/backend/db/schema.ts",
  out: "./src/backend/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/database-test.sqlite",
  },
  verbose: true,
});
