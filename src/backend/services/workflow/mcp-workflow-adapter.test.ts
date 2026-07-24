import { describe, expect, it } from "vitest";
import type { MCPStep } from "../../../shared/types/mcp";
import { ProgressStage as WorkflowProgressStage } from "../../../shared/types/workflow";
import type { ExecutingTaskPayload } from "../../../shared/types/workflow-payloads";
import { McpWorkflowAdapter } from "./mcp-workflow-adapter";
import type { WorkflowStateManager } from "./workflow-state-manager";

/**
 * Minimal in-memory stand-in for {@link WorkflowStateManager} that records the EXECUTING_TASK
 * payload/status the way the real manager would, without pulling in electron/telemetry singletons.
 */
function makeStubManager() {
  const store: { payload?: string; status: string } = { status: "not_started" };
  const manager = {
    getStepState: () => ({ payload: store.payload, status: store.status }),
    updateStagePayload: (_stage: unknown, payload: unknown, status?: string) => {
      store.payload = JSON.stringify(payload);
      if (status) store.status = status;
    },
    completeStage: (_stage: unknown, payload?: unknown) => {
      store.payload = payload ? JSON.stringify(payload) : undefined;
      store.status = "completed";
    },
    failStage: (_stage: unknown, _error: string) => {
      store.payload = JSON.stringify({ error: _error });
      store.status = "failed";
    },
  } as unknown as WorkflowStateManager;

  const readPayload = (): ExecutingTaskPayload =>
    store.payload ? (JSON.parse(store.payload) as ExecutingTaskPayload) : { steps: [] };

  return { manager, readPayload, getStatus: () => store.status };
}

describe("McpWorkflowAdapter", () => {
  it("seeds the orchestrator backend into the EXECUTING_TASK payload at construction", () => {
    const { manager, readPayload } = makeStubManager();

    new McpWorkflowAdapter(manager, { orchestrator: "claude-code" });

    expect(readPayload().orchestrator).toBe("claude-code");
    expect(readPayload().steps).toEqual([]);
  });

  it("defaults to the openai backend label when seeded as such", () => {
    const { manager, readPayload } = makeStubManager();

    new McpWorkflowAdapter(manager, { transcriptText: "hi", orchestrator: "openai" });

    expect(readPayload().orchestrator).toBe("openai");
    expect(readPayload().transcriptText).toBe("hi");
  });

  it("preserves the orchestrator field as steps stream in and the stage completes", () => {
    const { manager, readPayload } = makeStubManager();
    const adapter = new McpWorkflowAdapter(manager, { orchestrator: "claude-code" });

    const start: MCPStep = { type: "start", message: "Orchestrating with Claude Code (local)…" };
    adapter.onStep(start);

    expect(readPayload().orchestrator).toBe("claude-code");
    expect(readPayload().steps).toHaveLength(1);

    adapter.complete("done", "final");

    const final = readPayload();
    expect(final.orchestrator).toBe("claude-code");
    expect(final.steps).toHaveLength(1);
    expect(final.mcpResult).toBe("done");
  });

  it("preserves the streamed steps and orchestrator badge on the failed path (#833)", () => {
    const { manager, readPayload, getStatus } = makeStubManager();
    const adapter = new McpWorkflowAdapter(manager, { orchestrator: "claude-code" });

    adapter.onStep({ type: "start", message: "Orchestrating with Claude Code…" });
    adapter.onStep({ type: "tool_call", toolName: "create_backlog_item" });

    adapter.fail("drafted result", "final output", "No work item was created");

    const final = readPayload();
    expect(getStatus()).toBe("failed");
    // failStage clobbers the slot to { error } — fail() must restore the snapshot taken first.
    expect(final.orchestrator).toBe("claude-code");
    expect(final.steps).toHaveLength(2);
    expect(final.error).toBe("No work item was created");
    expect(final.mcpResult).toBe("drafted result");
    expect(final.finalOutput).toBe("final output");
  });

  it("does not stamp an orchestrator when none is provided", () => {
    const { manager, readPayload } = makeStubManager();

    // No initialContext at all — payload is only seeded once a step arrives.
    const adapter = new McpWorkflowAdapter(manager);
    adapter.onStep({ type: "start" });

    expect(readPayload().orchestrator).toBeUndefined();
  });

  it("targets the EXECUTING_TASK stage", () => {
    expect(WorkflowProgressStage.EXECUTING_TASK).toBe("executing_task");
  });

  /**
   * #698: `runManualLoopWithTimeout` abandons the underlying `manualLoopAsync` call on timeout
   * without necessarily stopping it (MCPOrchestrator ignores the cancellation signal). Because
   * `WorkflowStateManager` instances are cached and reused per shaveId across retries, a late
   * `onStep`/`complete`/`fail` from that abandoned call would otherwise land on whatever the next
   * attempt has since written. `discard()` is the guard against that.
   */
  describe("discard() (#698)", () => {
    it("ignores onStep after discard", () => {
      const { manager, readPayload } = makeStubManager();
      const adapter = new McpWorkflowAdapter(manager, { orchestrator: "openai" });

      adapter.onStep({ type: "start", message: "before discard" });
      adapter.discard();
      adapter.onStep({ type: "tool_call", toolName: "create_backlog_item" });

      expect(readPayload().steps).toHaveLength(1);
    });

    it("ignores complete() after discard", () => {
      const { manager, readPayload, getStatus } = makeStubManager();
      const adapter = new McpWorkflowAdapter(manager, { orchestrator: "openai" });
      // Constructing with initialContext seeds the payload and sets status "in_progress" — that's
      // the baseline discard() must leave untouched (it only guards AGAINST FURTHER writes).
      const statusBeforeDiscard = getStatus();

      adapter.discard();
      adapter.complete("late result", "late output");

      expect(getStatus()).toBe(statusBeforeDiscard);
      expect(readPayload().mcpResult).toBeUndefined();
    });

    it("ignores fail() after discard", () => {
      const { manager, readPayload, getStatus } = makeStubManager();
      const adapter = new McpWorkflowAdapter(manager, { orchestrator: "openai" });
      const statusBeforeDiscard = getStatus();

      adapter.discard();
      adapter.fail("late result", "late output", "late error");

      expect(getStatus()).toBe(statusBeforeDiscard);
      expect(readPayload().error).toBeUndefined();
    });

    it("does not affect a fresh adapter for the same manager (simulating a subsequent retry)", () => {
      const { manager, readPayload, getStatus } = makeStubManager();

      const timedOutAttempt = new McpWorkflowAdapter(manager, { orchestrator: "openai" });
      timedOutAttempt.onStep({ type: "start", message: "attempt 1" });
      timedOutAttempt.discard();

      // A retry for the same shaveId reuses the same WorkflowStateManager instance in the real
      // IPC handler (workflowManagers is keyed by shaveId), but gets its own adapter.
      const retryAttempt = new McpWorkflowAdapter(manager, { orchestrator: "claude-code" });
      retryAttempt.onStep({ type: "start", message: "attempt 2" });
      retryAttempt.complete("retry result", "retry output");

      expect(getStatus()).toBe("completed");
      expect(readPayload().mcpResult).toBe("retry result");

      // The discarded attempt 1 adapter must not be able to clobber this even if its underlying
      // call finally settles after the retry has already completed.
      timedOutAttempt.complete("stale late result", "stale late output");
      expect(getStatus()).toBe("completed");
      expect(readPayload().mcpResult).toBe("retry result");
    });
  });
});
