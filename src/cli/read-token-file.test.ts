import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLI_BRIDGE_TOKEN_DIR,
  CLI_BRIDGE_TOKEN_FILE,
  type CliBridgeTokenFile,
} from "../shared/cli-bridge/protocol";

/**
 * Exercises readTokenFile's dual-location fallback. The app and CLI detect "dev"
 * differently, so when the caller does NOT pin a build (dev unspecified) the CLI
 * must locate the token whether the app wrote it to the prod or the dev folder.
 *
 * We point getUserDataDir at a throwaway temp root by mocking user-data-path,
 * then place the token in one build's folder and assert it is found without
 * specifying `dev`.
 */

const root = join(tmpdir(), `yakshaver-token-fallback-${process.pid}`);

vi.mock("./user-data-path", () => ({
  getUserDataDir: (dev = false) => join(root, dev ? "YakShaverDev" : "YakShaver"),
}));

import { BridgeUnavailableError, readTokenFile } from "./bridge-client";

const tokenFor = (port: number): CliBridgeTokenFile => ({
  port,
  token: "a".repeat(64),
  startedAt: new Date().toISOString(),
});

async function writeToken(appName: "YakShaver" | "YakShaverDev", port: number): Promise<void> {
  const dir = join(root, appName, CLI_BRIDGE_TOKEN_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, CLI_BRIDGE_TOKEN_FILE), JSON.stringify(tokenFor(port)));
}

describe("readTokenFile dual-location fallback", () => {
  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("finds a prod token when dev is unspecified", async () => {
    await writeToken("YakShaver", 1111);
    const t = await readTokenFile();
    expect(t.port).toBe(1111);
  });

  it("falls back to the dev token when only the dev app is running", async () => {
    await writeToken("YakShaverDev", 2222);
    const t = await readTokenFile(); // no --dev, but the dev app wrote the token
    expect(t.port).toBe(2222);
  });

  it("prefers prod when both exist and dev is unspecified", async () => {
    await writeToken("YakShaver", 1111);
    await writeToken("YakShaverDev", 2222);
    const t = await readTokenFile();
    expect(t.port).toBe(1111);
  });

  it("pins to the dev location when dev:true is explicit", async () => {
    await writeToken("YakShaver", 1111);
    await writeToken("YakShaverDev", 2222);
    const t = await readTokenFile(true);
    expect(t.port).toBe(2222);
  });

  it("throws BridgeUnavailableError when neither location has a token", async () => {
    await expect(readTokenFile()).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("does not silently fall back past a corrupt prod token file", async () => {
    const dir = join(root, "YakShaver", CLI_BRIDGE_TOKEN_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, CLI_BRIDGE_TOKEN_FILE), "{ not json");
    await writeToken("YakShaverDev", 2222);
    // A present-but-corrupt prod file is a real signal, not "absent" — surface it.
    await expect(readTokenFile()).rejects.toThrow(/corrupt/);
  });
});
