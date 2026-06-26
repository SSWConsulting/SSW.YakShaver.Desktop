// `IProcessSpawner` lives in the shared `process` module so both ffmpeg and the local-claude
// orchestrator consume one definition (DRY). Re-exported here for existing importers.
export type { IProcessSpawner } from "../process/process-spawner";

export interface ConversionProgress {
  percentage: number;
  timeProcessed: string;
  speed: string;
}
