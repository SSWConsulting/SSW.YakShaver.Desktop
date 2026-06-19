import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliBridgeTokenFileSchema } from "../../../shared/cli-bridge/protocol";
import type { BridgeServices } from "./bridge-router";

// A throwaway userData dir so the token file lands somewhere harmless.
// vi.mock factories are hoisted above imports, so compute the path via
// vi.hoisted so the electron mock can reference it.
const { TEST_USER_DATA } = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  return { TEST_USER_DATA: path.join(os.tmpdir(), `yakshaver-bridge-test-${process.pid}`) };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue(TEST_USER_DATA),
    getVersion: vi.fn().mockReturnValue("0.0.0-test"),
  },
}));

// Stub the storage singletons the default services would reach for. We pass
// explicit services into getInstance() so these are only a safety net.
vi.mock("../storage/llm-storage", () => ({ LlmStorage: { getInstance: () => ({}) } }));
vi.mock("../storage/user-settings-storage", () => ({
  UserSettingsStorage: { getInstance: () => ({}) },
}));
vi.mock("../mcp/mcp-server-manager", () => ({ MCPServerManager: {} }));

import { CliBridgeServer } from "./cli-bridge-server";

function makeServices(): BridgeServices {
  return {
    mcp: {
      listAvailableServers: vi.fn().mockResolvedValue([{ id: "a", name: "A", transport: "stdio" }]),
      addServerAsync: vi.fn(),
      updateServerAsync: vi.fn(),
      removeServerAsync: vi.fn(),
      getServerByIdAsync: vi.fn(),
    },
    llm: { getLLMConfig: vi.fn().mockResolvedValue(null), storeLLMConfig: vi.fn() },
    settings: {
      getSettingsAsync: vi.fn().mockResolvedValue({ toolApprovalMode: "ask" }),
      updateSettingsAsync: vi.fn(),
    },
  };
}

async function readToken(): Promise<{ port: number; token: string }> {
  const filePath = join(TEST_USER_DATA, "yakshaver-tokens", "cli-bridge.json");
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return CliBridgeTokenFileSchema.parse(raw);
}

describe("CliBridgeServer", () => {
  let server: CliBridgeServer;

  beforeEach(() => {
    // Force a fresh singleton each test.
    // @ts-expect-error reset private static for isolation
    CliBridgeServer.instance = null;
    server = CliBridgeServer.getInstance(makeServices());
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(TEST_USER_DATA, { recursive: true, force: true });
  });

  it("binds to 127.0.0.1 and writes a token file with port + token", async () => {
    const started = await server.start();
    expect(started).toBe(true);

    const { port, token } = await readToken();
    expect(port).toBeGreaterThan(0);
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex
    expect(server.getPort()).toBe(port);
  });

  it("rejects requests without a bearer token (401)", async () => {
    await server.start();
    const { port } = await readToken();
    const res = await fetch(`http://127.0.0.1:${port}/mcp/servers`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects requests with the wrong token (401)", async () => {
    await server.start();
    const { port } = await readToken();
    const res = await fetch(`http://127.0.0.1:${port}/mcp/servers`, {
      headers: { Authorization: "Bearer not-the-real-token" },
    });
    expect(res.status).toBe(401);
  });

  it("serves authorized requests through the router", async () => {
    await server.start();
    const { port, token } = await readToken();
    const res = await fetch(`http://127.0.0.1:${port}/mcp/servers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("rejects an oversized body", async () => {
    await server.start();
    const { port, token } = await readToken();
    const big = "x".repeat(300 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/mcp/servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: big }),
    });
    expect(res.status).toBe(400);
  });

  it("does not start when disabled via env", async () => {
    process.env.YAKSHAVER_DISABLE_CLI_BRIDGE = "1";
    try {
      const started = await server.start();
      expect(started).toBe(false);
      expect(server.getPort()).toBeNull();
    } finally {
      delete process.env.YAKSHAVER_DISABLE_CLI_BRIDGE;
    }
  });

  it("removes the token file on stop", async () => {
    await server.start();
    const filePath = join(TEST_USER_DATA, "yakshaver-tokens", "cli-bridge.json");
    await server.stop();
    await expect(fs.access(filePath)).rejects.toThrow();
  });
});
