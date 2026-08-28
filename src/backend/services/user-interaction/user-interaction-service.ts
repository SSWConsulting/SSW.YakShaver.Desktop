import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import type {
  InteractionRequest,
  ProjectSelectionPayload,
  ProjectSelectionResponse,
  ToolApprovalDecision,
  ToolApprovalPayload,
} from "../../../shared/types/user-interaction";
import { UserSettingsStorage } from "../storage/user-settings-storage";

const WAIT_MODE_AUTO_APPROVE_DELAY_MS = 15_000;
const MAX_SHAVE_AUTO_APPROVE_ENTRIES = 1_000;

export class UserInteractionService {
  private static instance: UserInteractionService;
  private pendingInteractions = new Map<string, (response: unknown) => void>();
  /** Per-shave auto-approve flags, keyed by shave ID. Persists across retries for the same shave. */
  private shaveAutoApproveMap = new Map<string, boolean>();
  /**
   * Per-shave run-stop callbacks, keyed by shave ID (#988 follow-up). A local-Claude-backend run
   * registers its "kill the `claude -p` child" callback here for the duration of the run so a
   * `deny_stop` decision — raised via the bridge, in a DIFFERENT call stack to the one that
   * spawned the child — can actually halt the run, the same way OpenAI mode's in-process
   * `deny_stop` handling ends its orchestrator loop. Not persisted like the auto-approve map: it's
   * only meaningful while a run is in flight, and is deregistered when the run ends.
   */
  private shaveRunStoppers = new Map<string, () => void>();

  private constructor() {}

  /**
   * Enable auto-approve for a specific shave.
   * Called at the start of initial processing (processVideoSource).
   * Persists across retries for the same shave ID.
   * Evicts the oldest entry when the map exceeds MAX_SHAVE_AUTO_APPROVE_ENTRIES.
   */
  public setShaveAutoApprove(shaveId: string): void {
    this.shaveAutoApproveMap.set(shaveId, true);
    if (this.shaveAutoApproveMap.size > MAX_SHAVE_AUTO_APPROVE_ENTRIES) {
      // Map iterates in insertion order — delete the oldest entry
      const oldest = this.shaveAutoApproveMap.keys().next().value;
      if (oldest !== undefined) {
        this.shaveAutoApproveMap.delete(oldest);
      }
    }
  }

  private isAutoApproveActive(shaveId?: string): boolean {
    return shaveId !== undefined && (this.shaveAutoApproveMap.get(shaveId) ?? false);
  }

  public static getInstance(): UserInteractionService {
    if (!UserInteractionService.instance) {
      UserInteractionService.instance = new UserInteractionService();
    }
    return UserInteractionService.instance;
  }

  /**
   * Request approval for a tool execution from the user
   */
  public async requestToolApproval(
    toolName: string,
    args: unknown,
    options?: { message?: string; shaveId?: string },
  ): Promise<ToolApprovalDecision> {
    const settings = await UserSettingsStorage.getInstance().getSettingsAsync();
    const mode = settings?.toolApprovalMode || "ask";

    if (mode === "yolo" || this.isAutoApproveActive(options?.shaveId)) {
      return { kind: "approve" };
    }

    const autoApproveAt =
      mode === "wait" ? Date.now() + WAIT_MODE_AUTO_APPROVE_DELAY_MS : undefined;

    const payload: ToolApprovalPayload = {
      toolName,
      args,
    };

    return this.request<ToolApprovalDecision>("tool_approval", payload, {
      ...options,
      autoApproveAt,
    });
  }

  /**
   * Request confirmation for a project selection
   */
  public async requestProjectSelection(
    payload: ProjectSelectionPayload,
    options?: { message?: string; shaveId?: string },
  ): Promise<ProjectSelectionResponse> {
    const settings = await UserSettingsStorage.getInstance().getSettingsAsync();
    const mode = settings?.toolApprovalMode || "ask";

    if (mode === "yolo" || this.isAutoApproveActive(options?.shaveId)) {
      return {
        projectId: payload.selectedProject.id,
      };
    }

    const autoApproveAt =
      mode === "wait" ? Date.now() + WAIT_MODE_AUTO_APPROVE_DELAY_MS : undefined;

    return this.request<ProjectSelectionResponse>("project_selection", payload, {
      ...options,
      autoApproveAt,
    });
  }

  /**
   * Generic method to request interaction from the user via IPC
   */
  private async request<TResponse>(
    type: InteractionRequest["type"],
    payload: unknown,
    options?: { autoApproveAt?: number; message?: string },
  ): Promise<TResponse> {
    const requestId = randomUUID();

    const request: InteractionRequest = {
      requestId,
      type,
      payload,
      autoApproveAt: options?.autoApproveAt,
      message: options?.message,
    };

    // Broadcast to all windows - the frontend InteractionProvider will pick it up
    this.broadcastRequest(request);

    return new Promise<TResponse>((resolve) => {
      this.pendingInteractions.set(requestId, (response) => {
        resolve(response as TResponse);
      });
    });
  }

  /**
   * Handle a response coming back from the frontend
   */
  public resolveInteraction(requestId: string, responseData: unknown): boolean {
    const resolver = this.pendingInteractions.get(requestId);
    if (!resolver) {
      return false;
    }

    this.pendingInteractions.delete(requestId);
    resolver(responseData);
    return true;
  }

  /**
   * Register the "stop this shave's run" callback for the duration of an in-flight local-Claude
   * run (#988 follow-up to #920). Returns a deregister function the caller MUST invoke when the
   * run ends (success, error, or timeout) so a finished run's callback is never left registered —
   * a leaked entry would be both a memory leak and (if ever invoked later) a no-op stop on a dead
   * process.
   */
  public registerShaveRunStopper(shaveId: string, stop: () => void): () => void {
    this.shaveRunStoppers.set(shaveId, stop);
    return () => {
      // Only clear if it's still OUR callback — guards against a concurrent re-register (e.g. an
      // immediate retry) racing this run's own cleanup and deregistering the new run's stopper.
      if (this.shaveRunStoppers.get(shaveId) === stop) {
        this.shaveRunStoppers.delete(shaveId);
      }
    };
  }

  /**
   * Stop the in-flight local-Claude run for a shave, if one is currently registered. Best-effort:
   * a shave with no registered run (OpenAI backend, or the run already ended) is a silent no-op —
   * the structured not-approved tool result is the only signal in that case.
   */
  public stopShaveRun(shaveId: string): void {
    const stop = this.shaveRunStoppers.get(shaveId);
    if (stop) {
      this.shaveRunStoppers.delete(shaveId);
      stop();
    }
  }

  /**
   * Cancel all pending interactions (e.g. when session ends)
   */
  public cancelAllPending(reason = "Session cancelled"): void {
    for (const [id, resolve] of this.pendingInteractions.entries()) {
      // For tool approvals, we can default to deny
      // For generic requests, we might need a specific error or cancellation type
      // Here we assume most current usage is tool approval capable of handling 'deny_stop'
      // If the promise expects a different type, this might need refinement or casting
      try {
        resolve({ kind: "deny_stop", feedback: reason });
      } catch (e) {
        console.error(`Failed to cancel interaction ${id}`, e);
      }
    }
    this.pendingInteractions.clear();
  }

  private broadcastRequest(request: InteractionRequest): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("user-interaction:request", request);
      }
    }
  }
}
