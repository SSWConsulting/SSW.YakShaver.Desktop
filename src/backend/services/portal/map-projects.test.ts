import { describe, expect, it } from "vitest";
import { mapProjectsResponse } from "./map-projects";

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
