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

  /** Returns true if the run reached a result event, false if it failed. */
  async run(params: Cloud360RunParams): Promise<boolean> {
    const { shaveId } = params;
    let succeeded = false;
    try {
      // Upload + sandbox spin-up emit no server events; synthesize status rows so the live
      // view shows progress instead of a blank feed during those silent stretches.
      broadcastCloud360Event({
        shaveId,
        event: { type: "status", message: "Uploading recording..." },
        runStart: true,
      });

      const recordingId = await this.client.uploadRecordingFromFile({
        projectId: params.projectId,
        filePath: params.filePath,
        durationSeconds: params.durationSeconds,
        notes: params.notes,
      });

      broadcastCloud360Event({
        shaveId,
        event: { type: "status", message: "Starting cloud sandbox..." },
      });

      // videoAnalysis:false mirrors the web Reprocess button (vision path is Moonshot-only, 401s otherwise).
      for await (const event of this.client.processRecording(recordingId, {
        videoAnalysis: false,
        autoExecute: true,
      })) {
        if (event.type === "result") succeeded = true;
        broadcastCloud360Event({ shaveId, event });
      }
      return succeeded;
    } catch (error) {
      // A stream error after the result event is just sandbox-teardown noise, not a failure.
      if (succeeded) return true;
      const message = error instanceof Error ? error.message : String(error);
      broadcastCloud360Event({ shaveId, event: { type: "error", message } });
      return false;
    }
  }
}
