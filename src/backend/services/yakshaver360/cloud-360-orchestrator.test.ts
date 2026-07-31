import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "./types";

const { broadcast, uploadRecordingFromFile, processRecording, checkCloud360Credits, getAccessToken } =
  vi.hoisted(() => ({
    broadcast: vi.fn(),
    uploadRecordingFromFile: vi.fn(),
    processRecording: vi.fn(),
    checkCloud360Credits: vi.fn(),
    getAccessToken: vi.fn(),
  }));

vi.mock("./cloud-360-broadcast", () => ({ broadcastCloud360Event: broadcast }));

vi.mock("./credit-precheck", () => ({ checkCloud360Credits }));

vi.mock("../auth/identity-server-auth", () => ({
  IdentityServerAuthService: { getInstance: () => ({ getAccessToken }) },
}));

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
  // Default: signed in with credits available, so existing cases exercise the happy path.
  checkCloud360Credits.mockReset().mockResolvedValue({ canShave: true });
  getAccessToken.mockReset().mockResolvedValue("token-1");
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

  // Issue #3899: the credit gate must stop the run before the upload, not after it.
  it("blocks before uploading when the credit pre-check fails", async () => {
    checkCloud360Credits.mockResolvedValue({
      canShave: false,
      message: "Out of YakShaver credits, so this recording can't be processed.",
    });

    await expect(
      new Cloud360Orchestrator().run({
        filePath: "/tmp/v.mp4",
        projectId: "p1",
        shaveId: "s1",
        durationSeconds: 1,
      }),
    ).resolves.toBe(false);

    expect(uploadRecordingFromFile).not.toHaveBeenCalled();
    expect(processRecording).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith({
      shaveId: "s1",
      event: {
        type: "error",
        message: "Out of YakShaver credits, so this recording can't be processed.",
      },
      runStart: true,
    });
  });

  it("still uploads when the user is not signed in, leaving the failure to the upload call", async () => {
    getAccessToken.mockResolvedValue(null);
    uploadRecordingFromFile.mockRejectedValue(new Error("Not signed in"));

    await expect(
      new Cloud360Orchestrator().run({ filePath: "/tmp/v.mp4", projectId: "p1", durationSeconds: 1 }),
    ).resolves.toBe(false);

    expect(checkCloud360Credits).not.toHaveBeenCalled();
    expect(uploadRecordingFromFile).toHaveBeenCalled();
  });
});
