type ReleaseChannelType = "latest" | "pr";

export interface ReleaseChannel {
  type: ReleaseChannelType;
  channel?: string;
}
