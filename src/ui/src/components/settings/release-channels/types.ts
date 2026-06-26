export interface ProcessedRelease {
  prNumber: string;
  tag: string;
  version: string;
  publishedAt: string;
}

type ReleaseChannelType = "latest" | "pr";

export interface ReleaseChannel {
  type: ReleaseChannelType;
  channel?: string;
}
