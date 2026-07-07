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

      // videoAnalysis:false mirrors the web Reprocess button (the vision path is
      // hard-coded to Moonshot and 401s under a non-Moonshot AGENT_API_KEY).
      let firstEvent = true;
      for await (const event of this.client.processRecording(recordingId, {
        videoAnalysis: false,
        autoExecute: true,
      })) {
        // runStart on the first event tells the live view to clear the previous run.
        broadcastCloud360Event({ shaveId, event, runStart: firstEvent });
        firstEvent = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcastCloud360Event({ shaveId, event: { type: "error", message } });
    }
  }
}
