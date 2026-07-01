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
});
