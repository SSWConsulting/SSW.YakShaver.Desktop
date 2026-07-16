import { ShaveService } from "../services/shave/shave-service";
import { LlmStorage } from "../services/storage/llm-storage";
import { Cloud360Orchestrator } from "../services/yakshaver360/cloud-360-orchestrator";

/** True when the persisted orchestration backend is the cloud 360 path. */
export async function shouldUseCloud360(): Promise<boolean> {
  try {
    const cfg = await LlmStorage.getInstance().getLLMConfig();
    return cfg?.orchestrationBackend === "cloud-360";
  } catch {
    return false;
  }
}

/** Run the 360 cloud path. Returns a RetryResult-shaped object. */
export async function runCloud360Path(
  filePath: string,
  shaveId: string | undefined,
  projectId: string | undefined,
  durationSeconds?: number,
): Promise<{ success: boolean; error?: string }> {
  if (!projectId) {
    return { success: false, error: "No project selected for YakShaver Anywhere processing." };
  }
  // Duration comes from the caller; fall back to a shave lookup, then 0.
  const resolvedDuration =
    durationSeconds ??
    (shaveId
      ? (ShaveService.getInstance().getShaveVideoSourceInfo(shaveId)?.durationSeconds ?? 0)
      : 0);

  const succeeded = await new Cloud360Orchestrator().run({
    filePath,
    projectId,
    shaveId,
    durationSeconds: resolvedDuration,
  });
  // Failure detail is already broadcast to the live view; report an honest boolean here.
  return succeeded
    ? { success: true }
    : { success: false, error: "YakShaver Anywhere processing failed." };
}
