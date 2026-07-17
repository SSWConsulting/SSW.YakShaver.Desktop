import { beforeEach, describe, expect, it, vi } from "vitest";

const { run, getLLMConfig } = vi.hoisted(() => ({
  run: vi.fn(),
  getLLMConfig: vi.fn(),
}));

vi.mock("../services/yakshaver360/cloud-360-orchestrator", () => ({
  Cloud360Orchestrator: vi.fn().mockImplementation(function Cloud360Orchestrator() {
    return { run };
  }),
}));

vi.mock("../services/storage/llm-storage", () => ({
  LlmStorage: { getInstance: () => ({ getLLMConfig }) },
}));

vi.mock("../services/shave/shave-service", () => ({
  ShaveService: {
    getInstance: () => ({
      getShaveVideoSourceInfo: () => ({ durationSeconds: 30 }),
      // other methods unused in the 360 branch
    }),
  },
}));

// The class under test decides the fork purely from getLLMConfig + projectId,
// so we test the decision helper directly to avoid Electron/ffmpeg imports.
import { runCloud360Path, shouldUseCloud360 } from "./process-video-cloud360";

beforeEach(() => {
  run.mockReset();
  getLLMConfig.mockReset();
});

describe("cloud-360 fork decision", () => {
  it("uses cloud-360 when backend is cloud-360", async () => {
    getLLMConfig.mockResolvedValue({ orchestrationBackend: "cloud-360" });
    expect(await shouldUseCloud360()).toBe(true);
  });

  it("does not use cloud-360 for openai/local-claude/absent", async () => {
    getLLMConfig.mockResolvedValue({ orchestrationBackend: "openai" });
    expect(await shouldUseCloud360()).toBe(false);
    getLLMConfig.mockResolvedValue(null);
    expect(await shouldUseCloud360()).toBe(false);
  });

  it("errors when no project is selected", async () => {
    const result = await runCloud360Path("/tmp/v.mp4", undefined, undefined);
    expect(result).toEqual({
      success: false,
      error: "No project selected for YakShaver Anywhere processing.",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the orchestrator with duration from the shave and returns success", async () => {
    run.mockResolvedValue(true);
    const result = await runCloud360Path("/tmp/v.mp4", "s1", "p1");
    expect(run).toHaveBeenCalledWith({
      filePath: "/tmp/v.mp4",
      projectId: "p1",
      shaveId: "s1",
      durationSeconds: 30,
    });
    expect(result).toEqual({ success: true });
  });

  it("reports failure when the orchestrator run does not succeed", async () => {
    run.mockResolvedValue(false);
    const result = await runCloud360Path("/tmp/v.mp4", "s1", "p1");
    expect(result).toEqual({
      success: false,
      error: "YakShaver Anywhere processing failed.",
    });
  });
});
