import type { ChildProcess } from "node:child_process";

export interface ConversionProgress {
  percentage: number;
  timeProcessed: string;
  speed: string;
}

export interface IProcessSpawner {
  spawn(command: string, args: string[]): ChildProcess;
}
