import type { WorkflowState } from "@shared/types/workflow";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type {
  CreateShaveData,
  CreateVideoData,
  CreateVideoSourceData,
} from "../../../backend/db/schema";
import { normalizeYouTubeUrl } from "../../../backend/utils/youtube-url-utils";
import { ipcClient } from "../services/ipc-client";
import { ShaveStatus, type VideoUploadOrigin, type VideoUploadResult } from "../types";
import {
  isWorkflowReadyForFinalOutput,
  parseWorkflowProgressNeoPayload,
  parseWorkflowStepPayload,
} from "../utils";

interface FinalOutput {
  Status?: string;
  Repository?: string;
  Title?: string;
  URL?: string;
  Description?: string;
  Labels?: string[];
}

interface ParsedShaveOutput {
  status: ShaveStatus;
  title: string;
  workItemUrl: string;
}

function parseFinalOutput(finalOutput: string): ParsedShaveOutput | null {
  if (!finalOutput) {
    return null;
  }

  try {
    const cleanOutput = finalOutput.replace(/```json\n?|\n?```/g, "").trim();
    const llmOutput: FinalOutput = JSON.parse(cleanOutput);

    return {
      status:
        llmOutput.Status?.toLowerCase() === "fail" ? ShaveStatus.Failed : ShaveStatus.Completed,
      title: llmOutput.Title || "",
      workItemUrl: llmOutput.URL || "",
    };
  } catch (e) {
    console.error("[Shave] Failed to parse finalOutput as JSON:", e);
    throw new Error(
      `Invalid shave output format: Unable to parse LLM response. This prevents saving the shave record. ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringValue(payload: unknown, key: string): string | undefined {
  return isRecord(payload) && typeof payload[key] === "string" ? payload[key] : undefined;
}

function isVideoUploadResult(value: unknown): value is VideoUploadResult {
  return isRecord(value) && typeof value.success === "boolean";
}

function getUploadResult(payload: unknown): VideoUploadResult | undefined {
  return isRecord(payload) && isVideoUploadResult(payload.uploadResult)
    ? payload.uploadResult
    : undefined;
}

function getSourceOrigin(
  payload: unknown,
  uploadResult?: VideoUploadResult,
): VideoUploadOrigin | undefined {
  const sourceOrigin = getStringValue(payload, "sourceOrigin") ?? uploadResult?.origin;
  return sourceOrigin === "upload" || sourceOrigin === "external" ? sourceOrigin : undefined;
}

export function useShaveManager() {
  const processingShavesRef = useRef<Set<string>>(new Set());
  const uploadCompletedKeysRef = useRef<Set<string>>(new Set());
  const finalUpdatedKeysRef = useRef<Set<string>>(new Set());

  /**
   * Check if a video URL already has a shave in the database.
   */
  const checkExistingShave = useCallback(async (videoUrl: string): Promise<string | null> => {
    if (!videoUrl) return null;

    try {
      // Normalize the URL (especially for YouTube links)
      const normalizedUrl = normalizeYouTubeUrl(videoUrl);
      if (!normalizedUrl) return null;

      // Check if a shave exists with this URL
      const result = await ipcClient.shave.findByVideoUrl(normalizedUrl);

      if (result.success && result.data) {
        return result.data.id;
      }

      return null;
    } catch (error) {
      console.error("[Shave] Error checking for existing shave:", error);
      return null;
    }
  }, []);

  /**
   * Save a recording with video file metadata and shave information
   */
  const saveRecording = useCallback(
    async (
      shaveData: CreateShaveData,
      recordingFile?: CreateVideoData,
      videoSource?: CreateVideoSourceData,
    ) => {
      try {
        const result = await ipcClient.shave.create(shaveData, recordingFile, videoSource);
        toast.success("Saved to My Shaves", {
          description: "Your video was saved to My Shaves.",
        });
        return result;
      } catch (error) {
        console.error("[Shave] Failed to save recording:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error("Could not save to My Shaves", {
          description:
            "Video processing will continue, but we couldn't save this shave to My Shaves.",
        });
        return { success: false, error: errorMessage };
      }
    },
    [],
  );

  const handleWorkflowProgressNeo = useCallback(async (shaveId: string, state: WorkflowState) => {
    const hasProcessingStarted =
      state.uploading_video.status === "in_progress" ||
      state.downloading_video.status === "in_progress";

    if (hasProcessingStarted && !processingShavesRef.current.has(shaveId)) {
      processingShavesRef.current.add(shaveId);

      try {
        const shave = await ipcClient.shave.getById(shaveId);
        if (shave?.success && shave.data && shave.data.shaveStatus === ShaveStatus.Pending) {
          await ipcClient.shave.update(shaveId, {
            shaveStatus: ShaveStatus.Processing,
          });
        }
      } catch (err) {
        console.error("[Shave] Error updating shave status to Processing (by id):", err);
      }
    }

    const uploadPayload = parseWorkflowStepPayload(state.uploading_video);
    const downloadPayload = parseWorkflowStepPayload(state.downloading_video);
    const uploadResult = getUploadResult(uploadPayload) ?? getUploadResult(downloadPayload);
    const sourceOrigin =
      getSourceOrigin(uploadPayload, uploadResult) ??
      getSourceOrigin(downloadPayload, uploadResult);
    const uploadCompleted =
      state.uploading_video.status === "completed" ||
      state.downloading_video.status === "completed";

    if (uploadCompleted && uploadResult?.data && sourceOrigin) {
      const uploadCompletedKey = `${shaveId}:${sourceOrigin}:${uploadResult.data.url}`;

      if (!uploadCompletedKeysRef.current.has(uploadCompletedKey)) {
        uploadCompletedKeysRef.current.add(uploadCompletedKey);

        if (sourceOrigin === "external") {
          try {
            await ipcClient.shave.attachVideoSource(shaveId, {
              title: uploadResult.data.title,
              sourceUrl: uploadResult.data.url,
              // Use -1 to explicitly indicate unknown duration
              durationSeconds: uploadResult.data.duration ?? -1,
            });
          } catch (err) {
            console.error("[Shave] Error attaching external video file to shave:", err);
          }
        } else {
          try {
            await ipcClient.shave.update(shaveId, {
              videoEmbedUrl: uploadResult.data.url,
            });
          } catch (err) {
            console.error("[Shave] Error updating shave video URL (by id):", err);
          }
        }

        // Save the video title to local DB as soon as it's available so that
        // if the workflow fails before the final output step, we already have
        // a meaningful title rather than the "Untitled" placeholder.
        if (uploadResult.data.title) {
          try {
            await ipcClient.shave.update(shaveId, {
              title: uploadResult.data.title,
            });
          } catch (err) {
            console.error("[Shave] Error updating shave title from upload result:", err);
          }
        }
      }
    }

    if (!isWorkflowReadyForFinalOutput(state)) {
      return;
    }

    const executingPayload = parseWorkflowStepPayload(state.executing_task);
    const finalOutput = getStringValue(executingPayload, "finalOutput");
    if (typeof finalOutput === "undefined") {
      return;
    }

    const finalUpdatedKey = `${shaveId}:${finalOutput}`;
    if (finalUpdatedKeysRef.current.has(finalUpdatedKey)) {
      return;
    }
    finalUpdatedKeysRef.current.add(finalUpdatedKey);

    try {
      const parsedOutput = parseFinalOutput(finalOutput);

      if (parsedOutput) {
        const finalTitle = parsedOutput.title || uploadResult?.data?.title || "Untitled Work Item";

        await ipcClient.shave.update(shaveId, {
          title: finalTitle,
          shaveStatus: parsedOutput.status,
          workItemUrl: parsedOutput.workItemUrl,
        });
      }
    } catch (error) {
      console.error("[Shave] Failed to save/update shave record::", error);
      const updateErrorMsg = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to update shave record", {
        description: `There was an error updating the shave record with the final output from the workflow. ${updateErrorMsg}`,
      });
    }
  }, []);

  /**
   * Listen for workflow completion and update shave
   * For Recordings: finish recording -> create shave with video file metadata -> update youtube url after upload completes -> update shave with final output
   * For YouTube URLs: input youtube url -> create shave with url, without video file metadata -> attach video file after upload completes -> update shave with final output
   */
  useEffect(() => {
    return ipcClient.workflow.onProgressNeo((data: unknown) => {
      const progress = parseWorkflowProgressNeoPayload(data);
      if (!progress.shaveId || !progress.state) {
        return;
      }

      void handleWorkflowProgressNeo(progress.shaveId, progress.state);
    });
  }, [handleWorkflowProgressNeo]);

  return {
    saveRecording,
    checkExistingShave,
  };
}
