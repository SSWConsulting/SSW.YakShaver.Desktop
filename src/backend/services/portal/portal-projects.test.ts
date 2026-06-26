import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpsRequest: vi.fn(),
}));

vi.mock("node:https", () => ({
  default: {
    request: mocks.httpsRequest,
  },
}));

import { config } from "../../config/env";
import {
  fetchProjectSummaries,
  mapProjectsResponse,
  PROJECT_SUMMARIES_PATH,
} from "./portal-projects";

describe("mapProjectsResponse (#816)", () => {
  it("maps the /projects/summaries array to Project[]", () => {
    const result = mapProjectsResponse([
      { id: "p1", title: "Acme", description: "Acme project" },
      { id: "p2", title: "Beta" },
    ]);
    expect(result).toEqual([
      { id: "p1", name: "Acme", description: "Acme project" },
      { id: "p2", name: "Beta", description: null },
    ]);
  });

  it("maps a genuinely empty membership list to []", () => {
    expect(mapProjectsResponse([])).toEqual([]);
  });

  it("returns null for a non-array body (unrecognised shape -> surface an error)", () => {
    expect(mapProjectsResponse(null)).toBeNull();
    expect(mapProjectsResponse(undefined)).toBeNull();
    expect(mapProjectsResponse({})).toBeNull();
    expect(mapProjectsResponse({ items: [] })).toBeNull();
    expect(mapProjectsResponse("nope")).toBeNull();
  });

  it("returns null when array entries lack the expected id/title fields", () => {
    // A 2xx body that is an array of the wrong shape must NOT degrade to a false-empty list.
    expect(mapProjectsResponse([{ tenantId: "t1", displayName: "Tenant One" }])).toBeNull();
    expect(mapProjectsResponse([{ id: "only-id" }])).toBeNull();
    expect(mapProjectsResponse([null])).toBeNull();
  });

  it("returns null if any entry is malformed even when others are valid", () => {
    expect(mapProjectsResponse([{ id: "a", title: "A" }, { id: "b" }])).toBeNull();
  });
});

/**
 * Drives the mocked `https.request` callback as a real request/response would: emits the given
 * body in two chunks then `end`. Returns the captured request options so tests can assert the
 * URL/headers the connected (happy) path actually builds — the side the existing suite never
 * exercised (one-sided-verification review finding).
 */
function mockHttpsResponse(body: string, statusCode = 200, statusMessage = "OK") {
  const captured: { options?: Record<string, unknown> } = {};
  mocks.httpsRequest.mockImplementation(
    (
      options: Record<string, unknown>,
      callback: (res: EventEmitter & { statusCode?: number; statusMessage?: string }) => void,
    ) => {
      captured.options = options;
      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        statusMessage?: string;
      };
      res.statusCode = statusCode;
      res.statusMessage = statusMessage;
      // The handler attaches its `data`/`end` listeners synchronously inside this callback,
      // so emit synchronously once `end()` is called (mirroring real I/O ordering).
      return {
        on: vi.fn(),
        end: vi.fn(() => {
          callback(res);
          if (body.length > 0) {
            const half = Math.ceil(body.length / 2);
            res.emit("data", body.slice(0, half));
            res.emit("data", body.slice(half));
          }
          res.emit("end");
        }),
      };
    },
  );
  return captured;
}

/** Drives the mocked request to emit a connection-level error (e.g. DNS/TLS failure). */
function mockHttpsError(error: Error) {
  mocks.httpsRequest.mockImplementation(() => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = vi.fn();
    queueMicrotask(() => req.emit("error", error));
    return req;
  });
}

describe("fetchProjectSummaries (#816 happy + failure paths)", () => {
  const previousPortalApiUrl = process.env.PORTAL_API_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PORTAL_API_URL = "https://portal.example.test/api";
  });

  afterEach(() => {
    if (previousPortalApiUrl === undefined) {
      delete process.env.PORTAL_API_URL;
    } else {
      process.env.PORTAL_API_URL = previousPortalApiUrl;
    }
  });

  it("requests the exact <portalApiUrl-path>/projects/summaries path with a Bearer header", async () => {
    const captured = mockHttpsResponse(JSON.stringify([{ id: "p1", title: "Acme" }]));

    await fetchProjectSummaries("the-access-token");

    const base = new URL(config.portalApiUrl());
    expect(captured.options).toMatchObject({
      hostname: base.hostname,
      method: "GET",
      path: `${base.pathname.replace(/\/$/, "")}${PROJECT_SUMMARIES_PATH}`,
    });
    expect(captured.options?.path).toBe("/api/projects/summaries");
    const headers = captured.options?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer the-access-token");
  });

  it("resolves the parsed JSON body on a 2xx response (connected happy path)", async () => {
    mockHttpsResponse(JSON.stringify([{ id: "p1", title: "Acme", description: "A" }]));

    await expect(fetchProjectSummaries("token")).resolves.toEqual([
      { id: "p1", title: "Acme", description: "A" },
    ]);
  });

  it("rejects on a non-2xx status", async () => {
    mockHttpsResponse("nope", 500, "Internal Server Error");

    await expect(fetchProjectSummaries("token")).rejects.toThrow(/500/);
  });

  it("rejects when the 2xx body is not valid JSON", async () => {
    mockHttpsResponse("<html>not json</html>", 200, "OK");

    await expect(fetchProjectSummaries("token")).rejects.toThrow(/Failed to parse JSON/);
  });

  it("rejects when the underlying request errors (DNS/TLS failure)", async () => {
    mockHttpsError(new Error("ENOTFOUND"));

    await expect(fetchProjectSummaries("token")).rejects.toThrow(/ENOTFOUND/);
  });

  it("end-to-end: a 2xx summaries body maps to the rendered Project[] (AC2 happy path)", async () => {
    mockHttpsResponse(
      JSON.stringify([
        { id: "p1", title: "Acme", description: "Acme project" },
        { id: "p2", title: "Beta" },
      ]),
    );

    const parsed = await fetchProjectSummaries("token");
    expect(mapProjectsResponse(parsed)).toEqual([
      { id: "p1", name: "Acme", description: "Acme project" },
      { id: "p2", name: "Beta", description: null },
    ]);
  });
});
