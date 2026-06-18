import { describe, expect, it } from "vitest";
import { selectDisconnectedProviders } from "./mcp-status";

type Server = { id: string; name: string; builtin?: boolean; enabled?: boolean };

const servers: Server[] = [
  { id: "github", name: "GitHub" },
  { id: "ado", name: "Azure DevOps" },
  { id: "jira", name: "Jira", enabled: false }, // disabled -> not a provider
  { id: "yak_video_tools", name: "Yak_Video_Tools", builtin: true }, // builtin -> not a provider
];

describe("selectDisconnectedProviders (#869)", () => {
  it("reports enabled non-builtin providers whose health is explicitly unhealthy", () => {
    const result = selectDisconnectedProviders(servers, {
      github: { isHealthy: false },
      ado: { isHealthy: true },
    });
    expect(result).toEqual([{ id: "github", name: "GitHub" }]);
  });

  it("returns none when all providers are healthy", () => {
    const result = selectDisconnectedProviders(servers, {
      github: { isHealthy: true },
      ado: { isHealthy: true },
    });
    expect(result).toEqual([]);
  });

  it("ignores builtin and disabled servers even when unhealthy", () => {
    const result = selectDisconnectedProviders(servers, {
      github: { isHealthy: true },
      ado: { isHealthy: true },
      jira: { isHealthy: false },
      yak_video_tools: { isHealthy: false },
    });
    expect(result).toEqual([]);
  });

  it("does NOT report a provider whose health is still unknown (no false warning while loading)", () => {
    const result = selectDisconnectedProviders(servers, { ado: { isHealthy: true } });
    // github has no health entry yet -> not reported
    expect(result).toEqual([]);
  });

  it("reports multiple disconnected providers", () => {
    const result = selectDisconnectedProviders(servers, {
      github: { isHealthy: false },
      ado: { isHealthy: false },
    });
    expect(result.map((p) => p.name)).toEqual(["GitHub", "Azure DevOps"]);
  });
});
