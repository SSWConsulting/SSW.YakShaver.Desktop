import { describe, expect, it } from "vitest";
import type { MCPTerminationReason } from "../mcp/mcp-orchestrator";
import { formatNoWorkItemError } from "./no-work-item-error";

describe("formatNoWorkItemError — #833 failure copy per termination reason", () => {
  const cases: Array<[MCPTerminationReason, RegExp]> = [
    ["length", /ran out of room/i],
    ["max-iterations", /ran out of room/i],
    ["cancelled", /cancelled/i],
    ["content-filter", /content filter/i],
    ["timeout", /timed out/i],
    ["stop", /signed out or unavailable/i],
    ["unknown", /signed out or unavailable/i],
  ];

  it.each(cases)("%s -> matching message", (reason, pattern) => {
    const msg = formatNoWorkItemError(reason);
    expect(msg).toMatch(pattern);
    // Every branch must say nothing was created — that's the whole point of the gate.
    expect(msg.toLowerCase()).toContain("created");
  });

  it("verificationUnavailable overrides the generic copy with a 'may have created / verify' message", () => {
    // A tool succeeded but no judge model is configured: the item MAY exist. The message must NOT
    // claim the connection is signed out (that's false and provokes a duplicate re-run) and must
    // tell the user to check before retrying. Holds even for the 'stop' reason that otherwise maps
    // to the misleading generic copy.
    const msg = formatNoWorkItemError("stop", { verificationUnavailable: true });
    expect(msg).toMatch(/may have created/i);
    expect(msg).toMatch(/check your backlog/i);
    expect(msg).toMatch(/language model/i);
    expect(msg).not.toMatch(/signed out/i);
  });
});
