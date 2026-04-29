// Side-effect module: loads .env BEFORE any other backend module evaluates.
// Imported as the very first statement in src/backend/index.ts so process.env is
// populated by the time region.ts, endpoints.ts, llm-providers.ts, etc. read it.
//
// Layering:
//   1. .env (per-environment secrets, gitignored locally) — first.
//   2. .env.<region> (committed URL constants) — second, override:true so the
//      region file is authoritative for any URL keys it defines.
//      In packaged builds, electron-builder renames .env.<region> to .env.region.

import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { app } from "electron";

const envDir = app.isPackaged ? process.resourcesPath : process.cwd();
dotenvConfig({ path: join(envDir, ".env") });

const regionFileName = app.isPackaged
  ? ".env.region"
  : `.env.${process.env.BUILD_REGION === "china" ? "china" : "global"}`;
dotenvConfig({ path: join(envDir, regionFileName), override: true });
