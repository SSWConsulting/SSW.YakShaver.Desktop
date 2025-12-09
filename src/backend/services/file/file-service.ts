import type { MakeDirectoryOptions, Mode, PathLike } from "node:fs";
import fs from "node:fs/promises";

export interface IFileService {
  access(path: PathLike): Promise<void>;
  mkdir(path: PathLike, options?: Mode | MakeDirectoryOptions | undefined): Promise<void>;
  readFile(path: PathLike): Promise<Buffer>;
  writeFile(path: PathLike, data: Buffer | string): Promise<void>;
  unlink(path: PathLike): Promise<void>;
}

export class FileService implements IFileService {
  access(path: PathLike) {
    return fs.access(path);
  }

  async mkdir(path: PathLike, options?: Mode | MakeDirectoryOptions | undefined): Promise<void> {
    await fs.mkdir(path, options);
    return;
  }

  readFile(path: PathLike): Promise<Buffer> {
    return fs.readFile(path);
  }

  writeFile(path: PathLike, data: Buffer | string): Promise<void> {
    return fs.writeFile(path, data);
  }

  unlink(path: PathLike): Promise<void> {
    return fs.unlink(path);
  }
}
