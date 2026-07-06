import { describe, expect, it } from "vitest";
import { parseLogData, redactSecrets } from "./parse-log-data";

describe("redactSecrets", () => {
  it("redacts proxy tokens", () => {
    const out = redactSecrets('curl -H "x-yakshaver-proxy-token: abc.def" https://x');
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("abc.def");
  });
});

describe("parseLogData", () => {
  it("treats stderr as an error item", () => {
    expect(parseLogData("boom", "stderr")).toEqual([{ kind: "error", text: "boom" }]);
  });

  it("extracts assistant text and tool_use from stdout JSON", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the code" },
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    });
    const items = parseLogData(line, "stdout");
    expect(items).toEqual([
      { kind: "text", text: "Looking at the code" },
      { kind: "tool", name: "Bash", detail: "ls -la" },
    ]);
  });

  it("emits a thinking item for thinking blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "hmm" }] },
    });
    expect(parseLogData(line, "stdout")).toEqual([{ kind: "thinking", text: "hmm" }]);
  });

  it("collapses image tool results to a label", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: [{ type: "image" }] }] },
    });
    expect(parseLogData(line, "stdout")).toEqual([
      { kind: "tool-result", text: "[Image frame viewed by agent]" },
    ]);
  });

  it("skips system/start/ping noise", () => {
    expect(parseLogData(JSON.stringify({ type: "system" }), "stdout")).toEqual([]);
  });

  it("shows plain non-JSON text as a text item", () => {
    expect(parseLogData("just a line", "stdout")).toEqual([{ kind: "text", text: "just a line" }]);
  });
});
