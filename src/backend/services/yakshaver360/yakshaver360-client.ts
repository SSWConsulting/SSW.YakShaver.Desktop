import { config } from "../../config/env";
import { IdentityServerAuthService } from "../auth/identity-server-auth";
import type {
  ProcessRecordingOptions,
  SandboxEvent,
  YakShaver360Project,
  YakShaver360Recording,
} from "./types";

export type RecordingDetail = {
  recording: YakShaver360Recording;
  project: YakShaver360Project;
  logs: unknown[];
};

/** Client for the YakShaver 360 front-end (/api/360/*), authed with the user's IDS bearer token. */
export class YakShaver360Client {
  private static instance: YakShaver360Client | null = null;
  private auth = IdentityServerAuthService.getInstance();

  static getInstance(): YakShaver360Client {
    if (!YakShaver360Client.instance) {
      YakShaver360Client.instance = new YakShaver360Client();
    }
    return YakShaver360Client.instance;
  }

  private baseUrl(): string {
    return config.yakshaver360BaseUrl();
  }

  private async authHeader(): Promise<{ Authorization: string }> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error("Not signed in: no YakShaver Identity Server access token available.");
    }
    return { Authorization: `Bearer ${token}` };
  }

  async listRecordings(projectId: string): Promise<YakShaver360Recording[]> {
    const headers = await this.authHeader();
    const url = `${this.baseUrl()}/api/360/recordings?projectId=${encodeURIComponent(projectId)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to list recordings (${response.status})`);
    }
    return (await response.json()) as YakShaver360Recording[];
  }

  /** Null on 404. */
  async getRecording(id: string): Promise<RecordingDetail | null> {
    const headers = await this.authHeader();
    const url = `${this.baseUrl()}/api/360/recordings/${encodeURIComponent(id)}`;
    const response = await fetch(url, { headers });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to get recording (${response.status})`);
    }
    return (await response.json()) as RecordingDetail;
  }

  /** Create a recording from an already-uploaded video (ticket from the upload route); returns its id. */
  async createRecording(params: {
    projectId: string;
    uploadTicket: string;
    notes?: string;
    durationSeconds: number;
  }): Promise<string> {
    const headers = await this.authHeader();
    const url = `${this.baseUrl()}/api/360/recordings`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Failed to create recording (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const { id } = (await response.json()) as { id: string };
    return id;
  }

  /** Start processing a recording, yielding each SandboxEvent as the SSE stream produces it. */
  async *processRecording(
    id: string,
    options: ProcessRecordingOptions = {},
    signal?: AbortSignal,
  ): AsyncGenerator<SandboxEvent> {
    const url = `${this.baseUrl()}/api/360/recordings/${encodeURIComponent(id)}/process`;
    yield* this.streamPost(url, options, signal);
  }

  /** Resume a paused (approval-required) run with an approve/reject decision. */
  async *executeApproval(
    id: string,
    body: { action: "approve" | "reject"; feedback?: string },
    signal?: AbortSignal,
  ): AsyncGenerator<SandboxEvent> {
    const url = `${this.baseUrl()}/api/360/recordings/${encodeURIComponent(id)}/execute`;
    yield* this.streamPost(url, body, signal);
  }

  /** POST a JSON body and parse the `text/event-stream` response into SandboxEvents. */
  private async *streamPost(
    url: string,
    body: unknown,
    signal?: AbortSignal,
  ): AsyncGenerator<SandboxEvent> {
    const headers = await this.authHeader();
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to start stream (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Frames are blank-line separated; keep the trailing (possibly partial) frame buffered.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = parseSseFrame(frame);
          if (event) yield event;
        }
      }
      const tail = parseSseFrame(buffer);
      if (tail) yield tail;
    } finally {
      reader.releaseLock();
    }
  }
}

/** Parse an SSE frame's `data:` lines into a SandboxEvent; null for keep-alives/comments/non-JSON. */
function parseSseFrame(frame: string): SandboxEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    return JSON.parse(payload) as SandboxEvent;
  } catch {
    return null;
  }
}
