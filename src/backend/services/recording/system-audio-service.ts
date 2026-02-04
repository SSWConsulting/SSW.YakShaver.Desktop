import { ipcMain, webContents } from "electron";
import {
  getSystemAudioPermissionStatus,
  openSystemSettings,
  requestSystemAudioPermission,
  SystemAudioRecorder,
} from "native-audio-node";

// IPC channel for streaming audio data to renderer
const SYSTEM_AUDIO_DATA_CHANNEL = "system-audio:data";
const SYSTEM_AUDIO_START_CHANNEL = "system-audio:start";
const SYSTEM_AUDIO_STOP_CHANNEL = "system-audio:stop";
const SYSTEM_AUDIO_STATUS_CHANNEL = "system-audio:status";

export class SystemAudioService {
  private static instance: SystemAudioService;
  private recorder: SystemAudioRecorder | null = null;
  private isRecording = false;

  private constructor() {
    this.registerHandlers();
  }

  static getInstance(): SystemAudioService {
    if (!SystemAudioService.instance) {
      SystemAudioService.instance = new SystemAudioService();
    }
    return SystemAudioService.instance;
  }

  // Send to all renderer windows to ensure the right one receives it
  private sendToAllWindows(channel: string, data: unknown) {
    const allWebContents = webContents.getAllWebContents();
    for (const wc of allWebContents) {
      if (!wc.isDestroyed()) {
        wc.send(channel, data);
      }
    }
  }

  private registerHandlers() {
    ipcMain.handle(SYSTEM_AUDIO_START_CHANNEL, async () => {
      return this.start();
    });

    ipcMain.handle(SYSTEM_AUDIO_STOP_CHANNEL, async () => {
      return this.stop();
    });

    ipcMain.handle(SYSTEM_AUDIO_STATUS_CHANNEL, async () => {
      const permissionStatus = getSystemAudioPermissionStatus();
      return {
        isRecording: this.isRecording,
        permissionStatus,
        isAvailable: permissionStatus === "authorized",
      };
    });
  }

  async start(): Promise<{
    success: boolean;
    error?: string;
    metadata?: unknown;
    needsPermission?: boolean;
  }> {
    if (this.isRecording) {
      return { success: true };
    }

    try {
      // Check permission status first
      const permissionStatus = getSystemAudioPermissionStatus();
      console.log("[SystemAudio] Permission status:", permissionStatus);

      if (permissionStatus !== "authorized") {
        // Try to request permission
        const granted = await requestSystemAudioPermission();
        console.log("[SystemAudio] Permission request result:", granted);

        if (!granted) {
          // Open system settings for user to grant permission
          console.log("[SystemAudio] Opening system settings...");
          openSystemSettings();
          return {
            success: false,
            error:
              "System audio permission required. Please enable 'Screen & System Audio Recording' for this app in System Settings, then restart the app.",
            needsPermission: true,
          };
        }
      }

      // Create recorder with settings optimized for mixing
      this.recorder = new SystemAudioRecorder({
        sampleRate: 48000, // Match typical audio context sample rate
        chunkDurationMs: 100, // 100ms chunks for reasonable latency
        stereo: false, // Mono for simpler mixing
      });

      let chunkCount = 0;
      // Send audio data to renderer
      this.recorder.on("data", (chunk) => {
        chunkCount++;
        if (chunkCount === 1 || chunkCount % 50 === 0) {
          console.log(`[SystemAudio] Sending chunk #${chunkCount}, size: ${chunk.data.byteLength}`);
        }
        // Send raw PCM data to all windows - copy to a new Buffer to ensure clean transfer
        const buffer = Buffer.from(chunk.data);
        this.sendToAllWindows(SYSTEM_AUDIO_DATA_CHANNEL, buffer);
      });

      this.recorder.on("metadata", (metadata) => {
        console.log("[SystemAudio] Metadata:", metadata);
        this.sendToAllWindows("system-audio:metadata", metadata);
      });

      this.recorder.on("error", (error) => {
        console.error("[SystemAudio] Error:", error);
      });

      await this.recorder.start();
      this.isRecording = true;
      console.log("[SystemAudio] Started recording system audio");

      return {
        success: true,
        metadata: this.recorder.getMetadata(),
      };
    } catch (error) {
      console.error("[SystemAudio] Failed to start:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stop(): Promise<{ success: boolean }> {
    if (!this.isRecording || !this.recorder) {
      return { success: true };
    }

    try {
      await this.recorder.stop();
      this.recorder = null;
      this.isRecording = false;
      console.log("[SystemAudio] Stopped recording system audio");
      return { success: true };
    } catch (error) {
      console.error("[SystemAudio] Failed to stop:", error);
      return { success: false };
    }
  }
}
