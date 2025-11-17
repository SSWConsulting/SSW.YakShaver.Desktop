import { ipcMain } from "electron";
import { FFmpegService } from "../services/ffmpeg/ffmpeg-service";
import { FileService } from "../services/file/file-service";
import { formatErrorMessage } from "../utils/error-utils";
import { IPC_CHANNELS } from "./channels";

export class VideoIPCHandlers {
  private FileService = FileService.getInstance();
  private FFmpegService = FFmpegService.getInstance();

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle(IPC_CHANNELS.SELECT_VIDEO_FILE, async () => {
      const result = await this.FileService.selectFile();
      return result;
    });

    ipcMain.handle(IPC_CHANNELS.SELECT_OUTPUT_DIRECTORY, async () => {
      const result = await this.FileService.selectDirectory();
      return result;
    });

    ipcMain.handle(
      IPC_CHANNELS.CONVERT_VIDEO_TO_MP3,
      async (_event, inputPath: string, outputPath: string) => {
        try {
          const result = await this.FFmpegService.ConvertVideoToMp3(inputPath, outputPath);
          return { success: true, outputPath: result };
        } catch (error) {
          return {
            success: false,
            error: formatErrorMessage(error),
          };
        }
      },
    );
  }
}
