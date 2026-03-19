import type { TranscriptSegment } from "../../../shared/types/transcript";
import type { WorkflowState } from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../../services/auth/types";

export interface WorkflowCheckpoint {
  stage: keyof WorkflowState;
  data: CheckpointData;
  timestamp: number;
}

export interface CheckpointData {
  // UPLOADING_VIDEO
  filePath?: string;
  youtubeResult?: VideoUploadResult;

  // DOWNLOADING_VIDEO
  downloadUrl?: string;

  // CONVERTING_AUDIO
  mp3FilePath?: string;
  hasAudio?: boolean;

  // TRANSCRIBING
  transcript?: TranscriptSegment[];
  transcriptText?: string;

  // ANALYZING_TRANSCRIPT
  intermediateOutput?: string;

  // SELECTING_PROMPT
  projectDetails?: {
    name?: string;
    description?: string;
    desktopAgentProjectPrompt?: string;
    selectionReason?: string;
    selectedMcpServerIds?: string[];
  };
  projectMetaData?: string;
  desktopAgentProjectPrompt?: string;

  // EXECUTING_TASK
  mcpSteps?: Array<{
    type: string;
    toolName?: string;
    serverName?: string;
    args?: unknown;
    result?: unknown;
    error?: string;
    message?: string;
    reasoning?: string;
    timestamp?: number;
  }>;
  mcpResult?: string;
  finalOutput?: string;

  // UPDATING_METADATA
  videoId?: string;
  metadataPreview?: {
    title?: string;
    description?: string;
    tags?: string[];
    chapters?: Array<{ timestamp: string; label: string }>;
  };
}

export interface RetryStatus {
  stage: keyof WorkflowState;
  count: number;
  maxReached: boolean;
  lastError?: string;
  lastAttemptAt?: number;
}

export class WorkflowCheckpointService {
  private static instance: WorkflowCheckpointService;
  private checkpoints: Map<string, WorkflowCheckpoint> = new Map();
  private retryCounts: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): WorkflowCheckpointService {
    if (!WorkflowCheckpointService.instance) {
      WorkflowCheckpointService.instance = new WorkflowCheckpointService();
    }
    return WorkflowCheckpointService.instance;
  }

  private getKey(shaveId: string, stage: keyof WorkflowState): string {
    return `${shaveId}:${stage}`;
  }

  /**
   * Create or update a checkpoint for a specific stage
   */
  public createCheckpoint(shaveId: string, stage: keyof WorkflowState, data: CheckpointData): void {
    const key = this.getKey(shaveId, stage);
    this.checkpoints.set(key, {
      stage,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Get checkpoint data for a specific stage
   */
  public getCheckpoint(shaveId: string, stage: keyof WorkflowState): CheckpointData | undefined {
    const key = this.getKey(shaveId, stage);
    return this.checkpoints.get(key)?.data;
  }

  /**
   * Get all checkpoints for a workflow
   */
  public getAllCheckpoints(shaveId: string): Map<keyof WorkflowState, CheckpointData> {
    const result = new Map<keyof WorkflowState, CheckpointData>();
    const prefix = `${shaveId}:`;

    for (const [key, checkpoint] of this.checkpoints.entries()) {
      if (key.startsWith(prefix)) {
        result.set(checkpoint.stage, checkpoint.data);
      }
    }

    return result;
  }

  /**
   * Increment retry count for a stage
   */
  public incrementRetryCount(shaveId: string, stage: keyof WorkflowState): number {
    const key = this.getKey(shaveId, stage);
    const currentCount = this.retryCounts.get(key) || 0;
    const newCount = currentCount + 1;
    this.retryCounts.set(key, newCount);
    return newCount;
  }

  /**
   * Get current retry count for a stage
   */
  public getRetryCount(shaveId: string, stage: keyof WorkflowState): number {
    const key = this.getKey(shaveId, stage);
    return this.retryCounts.get(key) || 0;
  }

  /**
   * Get retry status for a stage
   */
  public getRetryStatus(
    shaveId: string,
    stage: keyof WorkflowState,
    lastError?: string,
  ): RetryStatus {
    const count = this.getRetryCount(shaveId, stage);
    const checkpoint = this.checkpoints.get(this.getKey(shaveId, stage));

    return {
      stage,
      count,
      maxReached: false,
      lastError,
      lastAttemptAt: checkpoint?.timestamp,
    };
  }

  /**
   * Check if retry is allowed for a stage
   */
  public canRetry(_shaveId: string, _stage: keyof WorkflowState): boolean {
    return true;
  }

  /**
   * Get all retry statuses for a workflow
   */
  public getAllRetryStatuses(shaveId: string): RetryStatus[] {
    const statuses: RetryStatus[] = [];
    const prefix = `${shaveId}:`;

    for (const key of this.retryCounts.keys()) {
      if (key.startsWith(prefix)) {
        const stage = key.split(":")[1] as keyof WorkflowState;
        statuses.push(this.getRetryStatus(shaveId, stage));
      }
    }

    return statuses;
  }

  /**
   * Clear all checkpoints and retry counts for a workflow
   */
  public clearAll(shaveId: string): void {
    const prefix = `${shaveId}:`;

    // Remove checkpoints
    for (const key of this.checkpoints.keys()) {
      if (key.startsWith(prefix)) {
        this.checkpoints.delete(key);
      }
    }

    // Remove retry counts
    for (const key of this.retryCounts.keys()) {
      if (key.startsWith(prefix)) {
        this.retryCounts.delete(key);
      }
    }
  }

  /**
   * Clear a specific stage checkpoint
   */
  public clearCheckpoint(shaveId: string, stage: keyof WorkflowState): void {
    const key = this.getKey(shaveId, stage);
    this.checkpoints.delete(key);
    this.retryCounts.delete(key);
  }

  /**
   * Reset retry count for a stage
   */
  public resetRetryCount(shaveId: string, stage: keyof WorkflowState): void {
    const key = this.getKey(shaveId, stage);
    this.retryCounts.delete(key);
  }
}
