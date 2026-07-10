import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "./types";

const { broadcast, uploadRecordingFromFile, processRecording } = vi.hoisted(() => ({
  broadcast: vi.fn(),
  uploadRecordingFromFile: vi.fn(),
  processRecording: vi.fn(),
}));

vi.mock("./cloud-360-broadcast", () => ({ broadcastCloud360Event: broadcast }));

vi.mock("./yakshaver360-client", () => ({
  YakShaver360Client: {
    getInstance: () => ({ uploadRecordingFromFile, processRecording }),
  },
}));

import { Cloud360Orchestrator } from "./cloud-360-orchestrator";

async function* gen(events: SandboxEvent[]): AsyncGenerator<SandboxEvent> {
  for (const e of events) yield e;
}

beforeEach(() => {
  broadcast.mockReset();
  uploadRecordingFromFile.mockReset();
  processRecording.mockReset();
});

describe("Cloud360Orchestrator", () => {
  it("uploads then processes and broadcasts every event with shaveId", async () => {
    uploadRecordingFromFile.mockResolvedValue("rec-1");
    processRecording.mockReturnValue(
      gen([
        { type: "status", message: "Creating sandbox..." },
        { type: "result", summary: "done", artifacts: ["https://github.com/a/b/issues/1"] },
      ]),
    );

    const ok = await new Cloud360Orchestrator().run({
      filePath: "/tmp/v.mp4",
      projectId: "p1",
      shaveId: "s1",
      durationSeconds: 42,
    });
    expect(ok).toBe(true);

    expect(uploadRecordingFromFile).toHaveBeenCalledWith({
      projectId: "p1",
      filePath: "/tmp/v.mp4",
      durationSeconds: 42,
      notes: undefined,
    });
    expect(processRecording).toHaveBeenCalledWith("rec-1", {
      videoAnalysis: false,
      autoExecute: true,
    });
    // Two synthetic status rows (upload + sandbox spin-up) bracket the silent stages,
    // then every server event is forwarded.
    expect(broadcast).toHaveBeenCalledTimes(4);
    // The first synthetic status is tagged runStart so the live view clears the previous run.
    expect(broadcast).toHaveBeenNthCalledWith(1, {
      shaveId: "s1",
      event: { type: "status", message: "Uploading recording..." },
      runStart: true,
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, {
      shaveId: "s1",
      event: { type: "status", message: "Starting cloud sandbox..." },
    });
    expect(broadcast).toHaveBeenNthCalledWith(3, {
      shaveId: "s1",
      event: { type: "status", message: "Creating sandbox..." },
    });
    expect(broadcast.mock.calls[3][0].event.type).toBe("result");
    expect(broadcast.mock.calls[3][0].runStart).toBeUndefined();
  });

  it("swallows a stream error that arrives after the result event", async () => {
    uploadRecordingFromFile.mockResolvedValue("rec-1");
    async function* resultThenThrow(): AsyncGenerator<SandboxEvent> {
      yield { type: "result", summary: "done", artifacts: ["https://github.com/a/b/issues/1"] };
      throw new Error("fetch failed");
    }
    processRecording.mockReturnValue(resultThenThrow());

    await expect(
      new Cloud360Orchestrator().run({
        filePath: "/tmp/v.mp4",
        projectId: "p1",
        shaveId: "s1",
        durationSeconds: 1,
      }),
    ).resolves.toBe(true);

    // The result is broadcast, but the post-success "fetch failed" is not surfaced as an error.
    const errorCalls = broadcast.mock.calls.filter((c) => c[0].event.type === "error");
    expect(errorCalls).toHaveLength(0);
    expect(broadcast.mock.calls.some((c) => c[0].event.type === "result")).toBe(true);
  });

  it("broadcasts an error event (does not throw) when upload fails", async () => {
    uploadRecordingFromFile.mockRejectedValue(new Error("Not signed in"));

    await expect(
      new Cloud360Orchestrator().run({
        filePath: "/tmp/v.mp4",
        projectId: "p1",
        durationSeconds: 1,
      }),
    ).resolves.toBe(false);

    expect(processRecording).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith({
      shaveId: undefined,
      event: { type: "error", message: "Not signed in" },
    });
  });
});
