import { Cloud360Orchestrator } from "../services/yakshaver360/cloud-360-orchestrator";
import { ShaveService } from "../services/shave/shave-service";
import { LlmStorage } from "../services/storage/llm-storage";

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
): Promise<{ success: boolean; error?: string }> {
  if (!projectId) {
    return { success: false, error: "No project selected for Cloud 360 processing." };
  }
  const durationSeconds = shaveId
    ? (ShaveService.getInstance().getShaveVideoSourceInfo(shaveId)?.durationSeconds ?? 0)
    : 0;

  await new Cloud360Orchestrator().run({ filePath, projectId, shaveId, durationSeconds });
  return { success: true };
}
