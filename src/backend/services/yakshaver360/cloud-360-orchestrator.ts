import { broadcastCloud360Event } from "./cloud-360-broadcast";
import { YakShaver360Client } from "./yakshaver360-client";

export interface Cloud360RunParams {
  filePath: string;
  projectId: string;
  shaveId?: string;
  durationSeconds: number;
  notes?: string;
}

/** Drives the 360 cloud path: upload the recording, process it, stream events to the UI. */
export class Cloud360Orchestrator {
  private client = YakShaver360Client.getInstance();

  async run(params: Cloud360RunParams): Promise<void> {
    const { shaveId } = params;
    try {
      const recordingId = await this.client.uploadRecordingFromFile({
        projectId: params.projectId,
        filePath: params.filePath,
        durationSeconds: params.durationSeconds,
        notes: params.notes,
      });

      for await (const event of this.client.processRecording(recordingId, { autoExecute: true })) {
        broadcastCloud360Event({ shaveId, event });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcastCloud360Event({ shaveId, event: { type: "error", message } });
    }
  }
}
