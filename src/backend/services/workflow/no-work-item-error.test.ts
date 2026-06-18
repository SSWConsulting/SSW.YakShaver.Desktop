import { describe, expect, it } from "vitest";
import type { MCPTerminationReason } from "../mcp/mcp-orchestrator";
import { formatNoWorkItemError } from "./no-work-item-error";

describe("formatNoWorkItemError — #833 failure copy per termination reason", () => {
  const cases: Array<[MCPTerminationReason, RegExp]> = [
    ["length", /ran out of room/i],
    ["max-iterations", /ran out of room/i],
    ["cancelled", /cancelled/i],
    ["content-filter", /content filter/i],
    ["stop", /signed out or unavailable/i],
    ["unknown", /signed out or unavailable/i],
  ];

  it.each(cases)("%s -> matching message", (reason, pattern) => {
    const msg = formatNoWorkItemError(reason);
    expect(msg).toMatch(pattern);
    // Every branch must say nothing was created — that's the whole point of the gate.
    expect(msg.toLowerCase()).toContain("created");
  });
});
