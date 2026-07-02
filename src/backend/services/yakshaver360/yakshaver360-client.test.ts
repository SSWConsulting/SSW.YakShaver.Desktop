import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the electron/config import chain inert; the access token is injected via getAccessToken.
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: vi.fn().mockReturnValue("/tmp/userData") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}));

vi.mock("../../config/env", () => ({
  config: {
    yakshaver360BaseUrl: vi.fn().mockReturnValue("https://360.test"),
  },
}));

import { config } from "../../config/env";
import { IdentityServerAuthService } from "../auth/identity-server-auth";
import type { SandboxEvent } from "./types";
import { YakShaver360Client } from "./yakshaver360-client";

const TOKEN = "test-access-token";

// Encodes frames exactly like the 360 server (sse-stream.ts). Keep identical — drift breaks parsing.
function encodeSse(events: SandboxEvent[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

// Mock Response whose body streams the given chunks in order.
function streamingResponse(
  chunks: string[],
  init: { ok?: boolean; status?: number } = {},
): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body,
  } as unknown as Response;
}

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

async function collect(gen: AsyncGenerator<SandboxEvent>): Promise<SandboxEvent[]> {
  const out: SandboxEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function freshClient(): YakShaver360Client {
  // biome-ignore lint/suspicious/noExplicitAny: reset singleton for test isolation
  (YakShaver360Client as any).instance = null;
  const client = YakShaver360Client.getInstance();
  vi.spyOn(IdentityServerAuthService.prototype, "getAccessToken").mockResolvedValue(TOKEN);
  return client;
}

describe("YakShaver360Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (config.yakshaver360BaseUrl as ReturnType<typeof vi.fn>).mockReturnValue("https://360.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("SSE parsing (streamPost via processRecording)", () => {
    it("parses a realistic full run: status/log/named/result then the finally-block cleanup status", async () => {
      // Real yield order: `result` is NOT last — a "Cleaning up sandbox..." status follows it
      // (vercel.ts finally block), so the parser must not stop on `result`.
      const events: SandboxEvent[] = [
        { type: "status", message: "Creating sandbox..." },
        { type: "status", message: "Analyzing video (Kimi)..." },
        { type: "log", stream: "stdout", data: "Video description:\nA bug report\n" },
        { type: "named", name: "Fix login bug" },
        { type: "status", message: "Running YakShaver Agent..." },
        {
          type: "result",
          summary: "Created 1 issue",
          artifacts: ["https://github.com/o/r/issues/5"],
        },
        { type: "status", message: "Cleaning up sandbox..." },
      ];
      const client = freshClient();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamingResponse([encodeSse(events)])));

      const received = await collect(client.processRecording("rec-1"));
      expect(received).toEqual(events);
    });

    it("reassembles a frame split across two network chunks", async () => {
      const events: SandboxEvent[] = [
        { type: "status", message: "Creating sandbox..." },
        { type: "result", summary: "done", artifacts: [] },
      ];
      const full = encodeSse(events);
      const cut = 20; // splits the first frame's JSON across two reads
      const client = freshClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(streamingResponse([full.slice(0, cut), full.slice(cut)])),
      );

      const received = await collect(client.processRecording("rec-1"));
      expect(received).toEqual(events);
    });

    it("emits the real vercel isLocal error frame (the local-dev sandbox guard)", async () => {
      // Exact frame vercel.ts yields for a localhost host — what Desktop gets against local 360.
      const errorEvent: SandboxEvent = {
        type: "error",
        message:
          "Sandbox proxy host is http://localhost:3000 from NEXTAUTH_URL, which is not reachable from Vercel Sandbox. Set YAKSHAVER_SANDBOX_APP_HOST to a public https URL.",
      };
      const client = freshClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(streamingResponse([encodeSse([errorEvent])])),
      );

      const received = await collect(client.processRecording("rec-1"));
      expect(received).toEqual([errorEvent]);
    });

    it("flushes a trailing frame that has no terminating blank line", async () => {
      // Stream ends without a trailing \n\n; the last frame must still flush from the buffer.
      const client = freshClient();
      const partial = `data: ${JSON.stringify({ type: "status", message: "hi" })}`;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamingResponse([partial])));

      const received = await collect(client.processRecording("rec-1"));
      expect(received).toEqual([{ type: "status", message: "hi" }]);
    });

    it("ignores non-data lines and blank keep-alive frames", async () => {
      const client = freshClient();
      const chunk = `: keep-alive\n\n${`data: ${JSON.stringify({ type: "status", message: "ok" })}\n\n`}\n\n`;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamingResponse([chunk])));

      const received = await collect(client.processRecording("rec-1"));
      expect(received).toEqual([{ type: "status", message: "ok" }]);
    });

    it("sends bearer auth, JSON body and Accept: text/event-stream to the process endpoint", async () => {
      const client = freshClient();
      const fetchMock = vi.fn().mockResolvedValue(streamingResponse([""]));
      vi.stubGlobal("fetch", fetchMock);

      await collect(client.processRecording("rec-42", { videoAnalysis: false, autoExecute: true }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://360.test/api/360/recordings/rec-42/process");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(options.headers.Accept).toBe("text/event-stream");
      expect(JSON.parse(options.body)).toEqual({ videoAnalysis: false, autoExecute: true });
    });

    it("throws when the stream response is not ok", async () => {
      const client = freshClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, body: null } as unknown as Response),
      );

      await expect(collect(client.processRecording("rec-1"))).rejects.toThrow(/401/);
    });
  });

  describe("listRecordings / getRecording (JSON endpoints)", () => {
    it("returns recordings on 200 with the projectId query and bearer header", async () => {
      const client = freshClient();
      const rows = [{ id: "r1", projectId: "p1", filePath: "u", notes: "", status: "uploaded" }];
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rows));
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.listRecordings("p1");
      expect(result).toEqual(rows);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://360.test/api/360/recordings?projectId=p1");
      expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it("throws on a non-ok list response (mirrors route 401)", async () => {
      const client = freshClient();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(jsonResponse({ error: "Unauthorized" }, { ok: false, status: 401 })),
      );
      await expect(client.listRecordings("p1")).rejects.toThrow(/401/);
    });

    it("returns null when getRecording gets a 404", async () => {
      const client = freshClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ error: "Not found" }, { ok: false, status: 404 })),
      );
      expect(await client.getRecording("missing")).toBeNull();
    });

    it("throws when no access token is available", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: reset singleton for test isolation
      (YakShaver360Client as any).instance = null;
      const client = YakShaver360Client.getInstance();
      vi.spyOn(IdentityServerAuthService.prototype, "getAccessToken").mockResolvedValue(null);
      vi.stubGlobal("fetch", vi.fn());
      await expect(client.listRecordings("p1")).rejects.toThrow(/not signed in/i);
    });
  });
});
