import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBacklogOrchestrator } from "../mcp/backlog-orchestrator";
import { runManualLoopWithTimeout } from "./executing-task-timeout";

describe("runManualLoopWithTimeout — #698 wall-clock guard on the Executing Task loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves normally when the loop finishes before the timeout", async () => {
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockResolvedValue({
        text: "done",
        backlogActionSucceeded: true,
        artifacts: [{ type: "issue", idOrUrl: "https://example.com/1" }],
        terminationReason: "stop",
      }),
    };

    const result = await runManualLoopWithTimeout(
      orchestrator,
      "transcript",
      undefined,
      {},
      60_000,
    );

    expect(result.backlogActionSucceeded).toBe(true);
    expect(result.terminationReason).toBe("stop");
  });

  it("fails closed with terminationReason 'timeout' when the loop never settles", async () => {
    // A loop that never resolves/rejects — simulates the real bug (#698): a stuck LLM/tool
    // round-trip that hangs forever with no error.
    const hangingLoop = new Promise(() => {});
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockReturnValue(hangingLoop),
    };

    const resultPromise = runManualLoopWithTimeout(
      orchestrator,
      "transcript",
      undefined,
      {},
      5_000,
    );

    await vi.advanceTimersByTimeAsync(5_000);

    const result = await resultPromise;
    expect(result).toEqual({
      text: "",
      backlogActionSucceeded: false,
      artifacts: [],
      terminationReason: "timeout",
    });
  });

  it("passes an AbortSignal to the orchestrator and aborts it on timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockImplementation((_transcript, _upload, options) => {
        capturedSignal = options?.signal;
        return new Promise(() => {});
      }),
    };

    const resultPromise = runManualLoopWithTimeout(
      orchestrator,
      "transcript",
      undefined,
      {},
      1_000,
    );

    expect(capturedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await resultPromise;

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("re-throws non-timeout errors from the loop unchanged", async () => {
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockRejectedValue(new Error("LLM client not initialized")),
    };

    await expect(
      runManualLoopWithTimeout(orchestrator, "transcript", undefined, {}, 5_000),
    ).rejects.toThrow("LLM client not initialized");
  });
});
