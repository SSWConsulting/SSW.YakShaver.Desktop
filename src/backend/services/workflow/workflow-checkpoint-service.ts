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

export class WorkflowCheckpointService {
  private static instance: WorkflowCheckpointService;
  private checkpoints: Map<string, WorkflowCheckpoint> = new Map();

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
   * Clear all checkpoints for a workflow
   */
  public clearAll(shaveId: string): void {
    const prefix = `${shaveId}:`;

    for (const key of this.checkpoints.keys()) {
      if (key.startsWith(prefix)) {
        this.checkpoints.delete(key);
      }
    }
  }

  /**
   * Clear a specific stage checkpoint
   */
  public clearCheckpoint(shaveId: string, stage: keyof WorkflowState): void {
    const key = this.getKey(shaveId, stage);
    this.checkpoints.delete(key);
  }
}
