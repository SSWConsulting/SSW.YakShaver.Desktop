import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import type { MCPServerConfig } from "@shared/types/mcp";
import { describe, expect, it } from "vitest";
import { deriveSettingsHealth, type SettingsHealthInputs } from "./settings-health";

const healthyLlm = {
  languageModel: { provider: "openai" as const, model: "gpt-5.2", apiKey: "sk-live-123" },
};

function inputs(overrides: Partial<SettingsHealthInputs> = {}): SettingsHealthInputs {
  return {
    llmConfig: healthyLlm,
    mcpServers: [],
    mcpHealthById: {},
    hasGithubToken: true,
    ...overrides,
  };
}

const githubServer = {
  id: PRESET_SERVER_IDS.GITHUB,
  name: "GitHub",
  enabled: true,
} as Pick<MCPServerConfig, "id" | "name" | "enabled">;

describe("deriveSettingsHealth", () => {
  it("reports nothing when every checked config is healthy", () => {
    expect(deriveSettingsHealth(inputs())).toEqual({});
  });

  describe("Model Settings (llm)", () => {
    it("flags a missing language model as critical", () => {
      const health = deriveSettingsHealth(inputs({ llmConfig: { languageModel: null } }));
      expect(health.llm?.severity).toBe("critical");
      expect(health.llm?.message).toMatch(/api key/i);
    });

    it("flags an empty/whitespace API key as critical", () => {
      const health = deriveSettingsHealth(
        inputs({ llmConfig: { languageModel: { ...healthyLlm.languageModel, apiKey: "  " } } }),
      );
      expect(health.llm?.severity).toBe("critical");
    });

    it("flags a null config (nothing set up yet) as critical", () => {
      expect(deriveSettingsHealth(inputs({ llmConfig: null })).llm?.severity).toBe("critical");
    });
  });

  describe("MCP Settings (mcp)", () => {
    it("flags an enabled backlog provider that is confirmed disconnected", () => {
      const health = deriveSettingsHealth(
        inputs({
          mcpServers: [githubServer],
          mcpHealthById: { [PRESET_SERVER_IDS.GITHUB]: { isHealthy: false } },
        }),
      );
      expect(health.mcp?.severity).toBe("critical");
      expect(health.mcp?.message).toContain("GitHub");
      expect(health.mcp?.message).toMatch(/\bis\b/);
    });

    it("does NOT flag a healthy backlog provider", () => {
      const health = deriveSettingsHealth(
        inputs({
          mcpServers: [githubServer],
          mcpHealthById: { [PRESET_SERVER_IDS.GITHUB]: { isHealthy: true } },
        }),
      );
      expect(health.mcp).toBeUndefined();
    });

    it("does NOT flag a disabled backlog provider even if unhealthy", () => {
      const health = deriveSettingsHealth(
        inputs({
          mcpServers: [{ ...githubServer, enabled: false }],
          mcpHealthById: { [PRESET_SERVER_IDS.GITHUB]: { isHealthy: false } },
        }),
      );
      expect(health.mcp).toBeUndefined();
    });

    it("does NOT flag an unhealthy NON-preset (custom) server", () => {
      const health = deriveSettingsHealth(
        inputs({
          mcpServers: [{ id: "custom-xyz", name: "Docs", enabled: true }],
          mcpHealthById: { "custom-xyz": { isHealthy: false } },
        }),
      );
      expect(health.mcp).toBeUndefined();
    });

    it("does NOT flag while health is still loading (undefined)", () => {
      const health = deriveSettingsHealth(
        inputs({ mcpServers: [githubServer], mcpHealthById: {} }),
      );
      expect(health.mcp).toBeUndefined();
    });

    it("pluralises the verb when multiple providers are disconnected", () => {
      const jira = {
        id: PRESET_SERVER_IDS.JIRA,
        name: "Jira",
        enabled: true,
      } as typeof githubServer;
      const health = deriveSettingsHealth(
        inputs({
          mcpServers: [githubServer, jira],
          mcpHealthById: {
            [PRESET_SERVER_IDS.GITHUB]: { isHealthy: false },
            [PRESET_SERVER_IDS.JIRA]: { isHealthy: false },
          },
        }),
      );
      expect(health.mcp?.message).toMatch(/\bare\b/);
      expect(health.mcp?.message).toContain("GitHub");
      expect(health.mcp?.message).toContain("Jira");
    });
  });

  describe("Releases (release)", () => {
    it("flags a missing GitHub token as critical", () => {
      expect(deriveSettingsHealth(inputs({ hasGithubToken: false })).release?.severity).toBe(
        "critical",
      );
    });

    it("does NOT flag when a token is present", () => {
      expect(deriveSettingsHealth(inputs({ hasGithubToken: true })).release).toBeUndefined();
    });
  });

  it("reports multiple independent issues at once", () => {
    const health = deriveSettingsHealth(
      inputs({ llmConfig: { languageModel: null }, hasGithubToken: false }),
    );
    expect(Object.keys(health).sort()).toEqual(["llm", "release"]);
  });
});
