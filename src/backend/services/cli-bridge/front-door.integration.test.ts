import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolSet } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { BridgeClient } from "../../../cli/bridge-client";
import { callToolViaBridge, listToolsViaBridge } from "../../../cli/mcp-serve";
import { McpToolBridge, type ToolBridgeManager } from "../mcp/mcp-tool-bridge";
import { type BridgeServices, routeRequest } from "./bridge-router";

/**
 * CONNECTED-PATH integration test for the single `yakshaver` MCP front-door (#915).
 *
 * The unit suites each mock ONE side of a boundary. This one wires the WHOLE
 * server-side chain end-to-end with NO mocks on the path under test, and drives it
 * through the REAL `mcp-serve` proxy + REAL `BridgeClient` over a REAL localhost
 * HTTP socket — exactly the bytes the spawned front-door exchanges with the app:
 *
 *   mcp-serve (listToolsViaBridge / callToolViaBridge)
 *     → real BridgeClient (real fetch, real Bearer auth)
 *       → real node:http server (real token check)
 *         → real routeRequest (real Zod validation + envelope)
 *           → real McpToolBridge (real flatten + approval policy + execute)
 *             → in-memory ToolSet (a real internal/in-memory tool — the #915 win)
 *
 * The ONLY fake is the leaf `ToolBridgeManager`, standing in for the live
 * `MCPServerManager` so the test needs neither Electron nor a real provider. It
 * returns genuine AI-SDK-shaped tools (description + Zod inputSchema + execute),
 * including an `Internal__*` in-memory tool and a tool that resolves to a native
 * MCP `CallToolResult` with `isError:true` (an auth-denied call that does NOT
 * throw) — the failure class that must not reach Claude as a success.
 *
 * No Claude/LLM is involved: this proves spawn→bridge→execute, the part the PR's
 * deferred live e2e leaves unverified.
 */

const TOKEN = "integration-test-token";

/** A real ToolSet: a GitHub tool, an INTERNAL in-memory tool, and a failing tool. */
function makeToolSet(): ToolSet {
  return {
    GitHub__create_issue: {
      description: "Create a GitHub issue",
      inputSchema: z.object({ title: z.string() }),
      execute: async (input: unknown) => {
        const { title } = input as { title: string };
        return { content: [{ type: "text", text: `Created issue: ${title}` }] };
      },
    },
    // The #915 win: an internal/in-memory server tool, reachable here even though
    // Claude Code can't reach it over its own transports.
    Internal__fill_template: {
      description: "Fill the internal template",
      inputSchema: z.object({ name: z.string() }),
      execute: async (input: unknown) => {
        const { name } = input as { name: string };
        return `Hello ${name}`;
      },
    },
    // A tool whose underlying MCP call FAILS without throwing (auth-denied):
    // resolves to a CallToolResult with isError:true.
    GitHub__delete_repo: {
      description: "Delete a repo (will be denied)",
      inputSchema: z.object({ repo: z.string() }),
      execute: async () => ({
        isError: true,
        content: [{ type: "text", text: "403 Forbidden: insufficient scopes" }],
      }),
    },
  } as unknown as ToolSet;
}

function makeManager(whitelist: string[]): ToolBridgeManager {
  const tools = makeToolSet();
  return {
    collectToolsWithServerPrefixAsync: async () => tools,
    getWhitelistWithServerPrefixAsync: async () => whitelist,
  };
}

/** Build the real BridgeServices, with only the tools front-door wired to a real bridge. */
function makeServices(approvalMode: "yolo" | "ask" | "wait", whitelist: string[]): BridgeServices {
  const bridge = new McpToolBridge(makeManager(whitelist), {
    getSettingsAsync: async () => ({ toolApprovalMode: approvalMode }),
  });
  // Only the routes this test exercises need real backing; the rest can throw.
  const notUsed = () => {
    throw new Error("not part of the front-door path");
  };
  return {
    mcp: {
      listAvailableServers: notUsed,
      addServerAsync: notUsed,
      updateServerAsync: notUsed,
      removeServerAsync: notUsed,
      getServerByIdAsync: notUsed,
    },
    llm: { getLLMConfig: notUsed, storeLLMConfig: notUsed },
    settings: { getSettingsAsync: notUsed, updateSettingsAsync: notUsed },
    tools: {
      listTools: () => bridge.listTools(),
      callTool: (name: string, args?: Record<string, unknown>) => bridge.callTool(name, args),
    },
  } as unknown as BridgeServices;
}

/** Stand up a real localhost HTTP server running the real router with Bearer auth. */
function startBridge(services: BridgeServices): Promise<{ server: HttpServer; port: number }> {
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const result = await routeRequest(services, {
        method: req.method ?? "GET",
        path: url.pathname,
        body,
      });
      const payload = JSON.stringify(result.body);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function makeClient(port: number): BridgeClient {
  return new BridgeClient({
    tokenLoader: async () => ({ port, token: TOKEN, startedAt: new Date().toISOString() }),
  });
}

describe("front-door integration — mcp-serve → BridgeClient → router → McpToolBridge", () => {
  let server: HttpServer;
  let port: number;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function boot(mode: "yolo" | "ask" | "wait", whitelist: string[] = []) {
    ({ server, port } = await startBridge(makeServices(mode, whitelist)));
    return makeClient(port);
  }

  it("lists the full aggregated toolset INCLUDING the internal in-memory tool", async () => {
    const client = await boot("yolo");
    const { tools } = await listToolsViaBridge(client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("GitHub__create_issue");
    // The #915 headline win, proven over the real HTTP path (not a mock).
    expect(names).toContain("Internal__fill_template");

    const gh = tools.find((t) => t.name === "GitHub__create_issue");
    expect(gh?.inputSchema).toMatchObject({ type: "object" });
    expect((gh?.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty(
      "title",
    );
  });

  it("calls a provider tool end-to-end and returns its content (yolo)", async () => {
    const client = await boot("yolo");
    const result = await callToolViaBridge(client, "GitHub__create_issue", { title: "Bug" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "Created issue: Bug" }]);
  });

  it("calls the INTERNAL in-memory tool end-to-end (#915)", async () => {
    const client = await boot("yolo");
    const result = await callToolViaBridge(client, "Internal__fill_template", { name: "Ada" });
    // A plain-string tool result is wrapped as text content with no error flag.
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "Hello Ada" }]);
  });

  it("surfaces an MCP-level isError (auth-denied) as a FAILURE, not a successful call", async () => {
    const client = await boot("yolo");
    const result = await callToolViaBridge(client, "GitHub__delete_repo", { repo: "x" });
    // The execute() resolved (no throw) with isError:true — it must reach Claude as an error.
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "403 Forbidden: insufficient scopes" }]);
  });

  it("refuses a non-whitelisted tool under 'ask' with a structured MCP isError (no hang)", async () => {
    const client = await boot("ask", /* whitelist */ []);
    const result = await callToolViaBridge(client, "GitHub__create_issue", { title: "Bug" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text?: string }).text).toMatch(/not approved/i);
  });

  it("runs a WHITELISTED tool under 'ask'", async () => {
    const client = await boot("ask", ["GitHub__create_issue"]);
    const result = await callToolViaBridge(client, "GitHub__create_issue", { title: "OK" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "Created issue: OK" }]);
  });

  it("rejects an unauthenticated request at the HTTP boundary", async () => {
    await boot("yolo");
    const badClient = new BridgeClient({
      tokenLoader: async () => ({
        port,
        token: "wrong-token",
        startedAt: new Date().toISOString(),
      }),
    });
    await expect(listToolsViaBridge(badClient)).rejects.toThrow(/unauthorized/i);
  });
});
