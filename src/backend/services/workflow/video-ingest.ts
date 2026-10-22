import { ProgressStage as WorkflowProgressStage } from "../../../shared/types/workflow";
import type { VideoUploadResult } from "../auth/types";
import type { YouTubeClient } from "../auth/youtube-client";
import type { LocalVideoStorageService } from "../video/local-video-storage";
import { applyUploadStageOutcome, type StageSink } from "./youtube-stage-decisions";

/**
 * #1062: the upload result recorded when no video host is connected. Nothing was uploaded, so it
 * is not a success — which keeps the URL-dependent steps (metadata update, portal video fields,
 * the video link in the work item) skipping themselves exactly as they do for a failed upload.
 */
export const LOCAL_SAVE_UPLOAD_RESULT: VideoUploadResult = {
  success: false,
  origin: "local",
};

/**
 * The "Uploading Video" payload for a recording kept locally. The UI keys its warning (and the
 * Open folder action) off `localFolder`, and `uploadResult` keeps reprocessing working.
 */
export function buildLocalSaveStagePayload(filePath: string, localFolder: string) {
  return {
    filePath,
    sourceOrigin: LOCAL_SAVE_UPLOAD_RESULT.origin,
    localFolder,
    uploadResult: LOCAL_SAVE_UPLOAD_RESULT,
  };
}

export interface RecordingIngestDeps {
  youtube: Pick<YouTubeClient, "isAuthenticated" | "uploadVideo">;
  localVideoStorage: Pick<LocalVideoStorageService, "saveRecordingAsync">;
}

export interface RecordingIngestResult {
  youtubeResult: VideoUploadResult;
  /** Set when the recording was kept locally because no video host is connected. */
  localFolder?: string;
}

/**
 * #1062: local storage is the default video host. With a video platform connected the recording
 * is uploaded as before; without one it is copied to a local folder and the "Uploading Video"
 * stage completes with that folder (shown as a warning, not an error) so the rest of the workflow
 * still runs. Shared by the first run and the upload retry so the two can't drift apart.
 */
export async function ingestRecordingAsync(
  filePath: string,
  durationSeconds: number | undefined,
  deps: RecordingIngestDeps,
  sink: StageSink,
): Promise<RecordingIngestResult> {
  if (!(await deps.youtube.isAuthenticated())) {
    const localFolder = await deps.localVideoStorage.saveRecordingAsync(filePath);
    sink.completeStage(
      WorkflowProgressStage.UPLOADING_VIDEO,
      buildLocalSaveStagePayload(filePath, localFolder),
    );
    return { youtubeResult: LOCAL_SAVE_UPLOAD_RESULT, localFolder };
  }

  const youtubeResult = await deps.youtube.uploadVideo(filePath);
  if (youtubeResult.success && youtubeResult.data && durationSeconds) {
    youtubeResult.data.duration = durationSeconds;
  }

  // #672: only show a green tick when the upload actually succeeded. uploadVideo returns
  // { success:false } (without throwing) when e.g. the Google account has no YouTube
  // channel — mark it failed (so the user sees why) but keep going: the work item is
  // still worth creating.
  applyUploadStageOutcome(youtubeResult, filePath, sink);
  return { youtubeResult };
}
