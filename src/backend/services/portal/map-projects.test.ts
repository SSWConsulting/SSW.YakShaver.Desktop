import { describe, expect, it } from "vitest";
import { mapProjectsResponse } from "./map-projects";

describe("mapProjectsResponse (#816)", () => {
  it("maps an { items } envelope to Project[]", () => {
    const result = mapProjectsResponse({
      items: [
        { id: "p1", name: "Acme", role: "owner" },
        { id: "p2", name: "Beta" },
      ],
    });
    expect(result).toEqual([
      { id: "p1", name: "Acme", role: "owner" },
      { id: "p2", name: "Beta", role: null },
    ]);
  });

  it("maps a bare array", () => {
    expect(mapProjectsResponse([{ id: "x", name: "X" }])).toEqual([
      { id: "x", name: "X", role: null },
    ]);
  });

  it("tolerates tenant field-name variants (tenantId / displayName / membershipRole)", () => {
    const result = mapProjectsResponse([
      { tenantId: "t1", displayName: "Tenant One", membershipRole: "member" },
    ]);
    expect(result).toEqual([{ id: "t1", name: "Tenant One", role: "member" }]);
  });

  it("falls back to the id for a missing name, and 'Untitled' when neither exists", () => {
    expect(mapProjectsResponse([{ id: "only-id" }])).toEqual([
      { id: "only-id", name: "only-id", role: null },
    ]);
    expect(mapProjectsResponse([{}])).toEqual([{ id: "", name: "Untitled", role: null }]);
  });

  it("returns an empty array for null / non-array / missing items (empty-state path)", () => {
    expect(mapProjectsResponse(null)).toEqual([]);
    expect(mapProjectsResponse(undefined)).toEqual([]);
    expect(mapProjectsResponse({})).toEqual([]);
    expect(mapProjectsResponse({ items: null })).toEqual([]);
    expect(mapProjectsResponse("nope")).toEqual([]);
  });

  it("skips null entries in the list", () => {
    expect(mapProjectsResponse([null, { id: "a", name: "A" }, undefined])).toEqual([
      { id: "a", name: "A", role: null },
    ]);
  });
});
