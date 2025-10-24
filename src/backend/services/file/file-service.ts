import { dialog } from "electron";

export class FileService {
  private static instance: FileService;

  static getInstance() {
    FileService.instance ??= new FileService();
    return FileService.instance;
  }

  async selectFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Video Files",
          extensions: ["mp4", "avi", "mov", "mkv", "webm", "flv", "m4v"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  }

  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  }
}
