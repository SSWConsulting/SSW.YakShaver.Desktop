import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { NewShave, NewVideoFile } from "../../../backend/db/schema";
import { normalizeYouTubeUrl } from "../../../backend/utils/youtube-url-utils";
import { ipcClient } from "../services/ipc-client";
import { ShaveStatus, type WorkflowProgress } from "../types";

interface FinalOutput {
  Status?: string;
  Repository?: string;
  Title?: string;
  URL?: string;
  Description?: string;
  Labels?: string[];
}

interface ParsedShaveOutput {
  status: string;
  title: string;
  workItemUrl: string;
}

function parseFinalOutput(finalOutput: string): ParsedShaveOutput {
  const emptyOutput: ParsedShaveOutput = {
    status: "",
    title: "",
    workItemUrl: "",
  };

  if (!finalOutput) {
    return emptyOutput;
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

export function useShaveManager() {
  /**
   * Check if a video URL already has a shave in the database.
   */
  const checkExistingShave = useCallback(async (videoUrl: string): Promise<number | null> => {
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
    async (shaveData: Omit<NewShave, "id">, recordingFile?: Omit<NewVideoFile, "id">) => {
      try {
        const result = await ipcClient.shave.create(shaveData, recordingFile);
        toast.success("Saved to My Shaves", {
          description: "Your video was saved to My Shaves.",
        });
        return result;
      } catch (error) {
        console.error("[Shave] Failed to save recording:", error);
        toast.error("Could not save to My Shaves", {
          description:
            "Video processing will continue, but we couldn't save this shave to My Shaves.",
        });
        return null;
      }
    },
    [],
  );

  /**
   * Listen for workflow completion and update shave
   * For Recordings: finish recording -> create shave with video file metadata -> update youtube url after upload completes -> update shave with final output
   * For YouTube URLs: input youtube url -> create shave with url, without video file metadata -> attach video file after upload completes -> update shave with final output
   */
  useEffect(() => {
    return ipcClient.workflow.onProgress(async (data: unknown) => {
      const progressData = data as WorkflowProgress;
      const { shaveId } = progressData;

      // Update shave status to Processing when upload/download starts
      if (
        (progressData.stage === "uploading_source" ||
          progressData.stage === "downloading_source") &&
        typeof shaveId === "number"
      ) {
        try {
          await ipcClient.shave.update(shaveId, {
            shaveStatus: ShaveStatus.Processing,
          });
        } catch (err) {
          console.error("[Shave] Error updating shave status to Processing (by id):", err);
        }
      }

      if (progressData.stage === "upload_completed" && typeof shaveId === "number") {
        const { uploadResult, sourceOrigin } = progressData;

        if (uploadResult?.data) {
          // Attach video file if source is external (e.g., YouTube)
          if (sourceOrigin === "external") {
            try {
              await ipcClient.shave.attachVideoFile(shaveId, {
                fileName: uploadResult.data.title,
                filePath: uploadResult.data.url,
                duration: uploadResult.data.duration || -1,
              });
            } catch (err) {
              console.error("[Shave] Error attaching external video file to shave:", err);
            }
          }

          // Only update the video embed URL for local recordings when finished uploading video
          if (sourceOrigin !== "external") {
            try {
              await ipcClient.shave.update(shaveId, {
                videoEmbedUrl: uploadResult.data.url,
              });
            } catch (err) {
              console.error("[Shave] Error updating shave video URL (by id):", err);
            }
          }
        }
        return;
      }

      // Update shave when there's final output
      if (typeof progressData.finalOutput !== "undefined" && typeof shaveId === "number") {
        const { uploadResult, finalOutput } = progressData;

        try {
          const parsedOutput = parseFinalOutput(finalOutput);
          const finalTitle =
            parsedOutput.title || uploadResult?.data?.title || "Untitled Work Item";
          const shaveStatus = parsedOutput.status as ShaveStatus;

          await ipcClient.shave.update(shaveId, {
            title: finalTitle,
            shaveStatus,
            workItemUrl: parsedOutput.workItemUrl,
          });
        } catch (error) {
          console.error("[Shave] Failed to save/update shave record::", error);
          const updateErrorMsg = error instanceof Error ? error.message : "Unknown error";
          toast.error("Failed to update shave record", {
            description: `There was an error updating the shave record with the final output from the workflow. ${updateErrorMsg}`,
          });
          return;
        }
      }
    });
  }, []);

  return {
    saveRecording,
    checkExistingShave,
  };
}
