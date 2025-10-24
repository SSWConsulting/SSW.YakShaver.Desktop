import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import type { ConversionProgress } from "./types";

// Resolve FFmpeg path; when packaged, ensure we point to app.asar.unpacked
let ffmpegPath = ffmpeg.path;
if (ffmpegPath.includes("app.asar")) {
  ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
}

export class FFmpegService {
  private static instance: FFmpegService;

  static getInstance() {
    FFmpegService.instance ??= new FFmpegService();
    return FFmpegService.instance;
  }

  async ConvertVideoToMp3(
    inputPath: string,
    outputPath: string,
    onProgress?: (progress: ConversionProgress) => void,
  ): Promise<string> {
    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    // Validate ffmpeg binary exists before spawn (better error than ENOENT)
    try {
      await fs.access(ffmpegPath);
    } catch {
      throw new Error(`FFmpeg binary not found at: ${ffmpegPath}.`);
    }

    return new Promise((resolve, reject) => {
      // FFmpeg command to convert video to MP3
      const args = [
        "-i",
        inputPath, // Input file path
        "-vn", // Disable video recording (if input has video)
        "-c:a",
        "libmp3lame", // Audio codec for MP3
        "-q:a",
        "2", // Audio quality (VBR, 0-9, lower is better)
        "-b:a",
        "192k", // Audio bitrate
        "-f",
        "mp3", // Output format
        outputPath, // Output file path
      ];

      const ffmpeg = spawn(ffmpegPath, args);

      let stderr = "";
      let duration = 0;

      ffmpeg.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        stderr += output;

        // Parse duration from ffmpeg output
        const durationMatch = output.match(
          /Duration: (\d{2}):(\d{2}):(\d{2})\.\d{2}/,
        );
        if (durationMatch) {
          const hours = parseInt(durationMatch[1], 10);
          const minutes = parseInt(durationMatch[2], 10);
          const seconds = parseInt(durationMatch[3], 10);
          duration = hours * 3600 + minutes * 60 + seconds;
        }

        // Parse progress from ffmpeg output
        if (onProgress && duration > 0) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.\d{2}/);
          const speedMatch = output.match(/speed=\s*([0-9.]+)x/);

          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const percentage = Math.min(100, (currentTime / duration) * 100);

            onProgress({
              percentage: Math.round(percentage * 100) / 100,
              timeProcessed: `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`,
              speed: speedMatch ? `${speedMatch[1]}x` : "0x",
            });
          }
        }
      });

      ffmpeg.on("close", (code: number | null) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          const error = `FFmpeg process exited with code ${code}. Error: ${stderr}`;
          console.error(error);
          reject(new Error(error));
        }
      });

      ffmpeg.on("error", (error: Error) => {
        console.error("FFmpeg spawn error:", error);
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }
}
