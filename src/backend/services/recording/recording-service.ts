import EventEmitter from "node:events";
import { unlink, writeFile } from "node:fs/promises";
import { desktopCapturer } from "electron";
import tmp from "tmp";
import { getMainWindow } from "../../index";
import { formatErrorMessage } from "../../utils/error-utils";
import type { ScreenSource, StartRecordingResult, StopRecordingResult } from "./types";
import { VideoUploadResult } from "../auth/types";

export class RecordingService extends EventEmitter {
  private static instance: RecordingService;
  private tempFiles = new Map<string, tmp.FileResult>();
  private timer: NodeJS.Timeout | null = null;
  private startTime = 0;
  private displayId?: string;

  static getInstance() {
    RecordingService.instance ??= new RecordingService();
    return RecordingService.instance;
  }

  getCurrentRecordingDisplayId() {
    return this.displayId;
  }

  async handleStartRecording(sourceId?: string): Promise<StartRecordingResult> {
    try {
      this.stopTimer();

      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
      });
      if (!sources.length) return { success: false, error: "No screen sources available" };

      const selected =
        sources.find((s) => s.id === sourceId) || sources.find((s) => s.display_id) || sources[0];

      if (!selected) return { success: false, error: "Requested source not found" };

      this.displayId = selected.display_id;
      this.startTimer();

      return { success: true, sourceId: selected.id };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  async handleStopRecording(videoData: Uint8Array): Promise<StopRecordingResult> {
    this.stopTimer();
    try {
      if (!videoData?.length) return { success: false, error: "No video data provided" };

      const tempFile = tmp.fileSync({ postfix: ".mp4", keep: true });
      await writeFile(tempFile.name, videoData);
      this.tempFiles.set(tempFile.name, tempFile);

      return { success: true, filePath: tempFile.name };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  triggerTranscription(filePath: string, videoUploadResult: VideoUploadResult) {
    this.emit("recording-saved", filePath, videoUploadResult);
  }

  async cleanupTempFile(filePath: string) {
    const tempFile = this.tempFiles.get(filePath);
    if (tempFile) {
      tempFile.removeCallback();
      this.tempFiles.delete(filePath);
    } else {
      await unlink(filePath).catch(() => { });
    }
  }

  async cleanupAllTempFiles() {
    this.stopTimer();
    await Promise.all([...this.tempFiles.keys()].map((path) => this.cleanupTempFile(path)));
  }

  async listSources(): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: true,
    });

    const mainWindowId = getMainWindow()?.getMediaSourceId();

    return sources.map(({ id, name, display_id, appIcon, thumbnail }) => ({
      id,
      name,
      displayId: display_id,
      appIconDataURL: appIcon?.toDataURL(),
      thumbnailDataURL: thumbnail?.toDataURL(),
      type: display_id ? "screen" : "window",
      isMainWindow: id === mainWindowId,
    }));
  }

  private startTimer() {
    this.startTime = Date.now();
    this.timer = setInterval(() => {
      const time = Math.floor((Date.now() - this.startTime) / 1000);
      this.emit("recording-time-update", time);
    }, 1000);
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.startTime = 0;
    this.displayId = undefined;
  }
}
