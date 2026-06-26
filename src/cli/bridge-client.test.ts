import { describe, expect, it, vi } from "vitest";
import type { CliBridgeTokenFile } from "../shared/cli-bridge/protocol";
import { BridgeClient, BridgeUnavailableError } from "./bridge-client";

const token: CliBridgeTokenFile = {
  port: 8765,
  token: "test-token-abc",
  startedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BridgeClient", () => {
  it("builds an authorized request against the token's port", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [{ id: "a" }] }));
    const client = new BridgeClient({ fetchFn, tokenLoader: async () => token });

    const data = await client.get("/mcp/servers");

    expect(data).toEqual([{ id: "a" }]);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/mcp/servers");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer test-token-abc");
  });

  it("serializes the body and sets content-type for writes", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { id: "x" } }));
    const client = new BridgeClient({ fetchFn, tokenLoader: async () => token });

    await client.post("/mcp/servers", { name: "X", transport: "stdio", command: "node" });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "X", transport: "stdio", command: "node" });
  });

  it("caches the token across requests (loads it once)", async () => {
    const tokenLoader = vi.fn().mockResolvedValue(token);
    // Fresh Response per call — a Response body stream can only be read once.
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse({ ok: true, data: null }));
    const client = new BridgeClient({ fetchFn, tokenLoader });

    await client.get("/settings");
    await client.get("/settings");

    expect(tokenLoader).toHaveBeenCalledOnce();
  });

  it("throws the bridge error message on { ok: false }", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ ok: false, error: "Server with id 'a' already exists" }, 400),
      );
    const client = new BridgeClient({ fetchFn, tokenLoader: async () => token });

    await expect(client.post("/mcp/servers", {})).rejects.toThrow(
      "Server with id 'a' already exists",
    );
  });

  it("maps a connection failure to BridgeUnavailableError", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new BridgeClient({ fetchFn, tokenLoader: async () => token });

    await expect(client.get("/mcp/servers")).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it("surfaces a token-loader failure (app not running)", async () => {
    const client = new BridgeClient({
      fetchFn: vi.fn(),
      tokenLoader: async () => {
        throw new BridgeUnavailableError("not running");
      },
    });
    await expect(client.get("/mcp/servers")).rejects.toBeInstanceOf(BridgeUnavailableError);
  });
});
