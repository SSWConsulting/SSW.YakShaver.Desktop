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

  it("calls onTimeout when — and only when — the timeout actually fires (#698 stale-write guard)", async () => {
    const onTimeout = vi.fn();
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockReturnValue(new Promise(() => {})),
    };

    const resultPromise = runManualLoopWithTimeout(
      orchestrator,
      "transcript",
      undefined,
      {},
      2_000,
      onTimeout,
    );

    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    await resultPromise;

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not call onTimeout when the loop finishes before the timeout", async () => {
    const onTimeout = vi.fn();
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockResolvedValue({
        text: "done",
        backlogActionSucceeded: true,
        artifacts: [],
        terminationReason: "stop",
      }),
    };

    await runManualLoopWithTimeout(orchestrator, "transcript", undefined, {}, 60_000, onTimeout);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not call onTimeout when the loop rejects with a non-timeout error", async () => {
    const onTimeout = vi.fn();
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(
      runManualLoopWithTimeout(orchestrator, "transcript", undefined, {}, 5_000, onTimeout),
    ).rejects.toThrow("boom");

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("#1062: forwards the user's Stop to the orchestrator", async () => {
    const stop = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockImplementation(async (_t, _v, options) => {
        seenSignal = options?.signal;
        return {
          text: "",
          backlogActionSucceeded: false,
          artifacts: [],
          terminationReason: "stop",
        };
      }),
    };

    await runManualLoopWithTimeout(orchestrator, "t", undefined, { signal: stop.signal }, 60_000);
    stop.abort();

    expect(seenSignal?.aborted).toBe(true);
  });

  it("#1062: reports a Stop that made the backend reject as 'cancelled', not an error", async () => {
    const stop = new AbortController();
    const orchestrator: IBacklogOrchestrator = {
      manualLoopAsync: vi.fn().mockImplementation(async () => {
        stop.abort();
        throw new Error("claude child killed");
      }),
    };

    const result = await runManualLoopWithTimeout(
      orchestrator,
      "t",
      undefined,
      { signal: stop.signal },
      60_000,
    );

    expect(result.terminationReason).toBe("cancelled");
    expect(result.backlogActionSucceeded).toBe(false);
  });
});
