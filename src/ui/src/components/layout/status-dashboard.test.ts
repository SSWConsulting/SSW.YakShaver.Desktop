import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { describe, expect, it } from "vitest";
import { AuthStatus } from "@/types";
import { deriveStatusDashboard, type StatusDashboardInputs } from "./status-dashboard";

const GITHUB = PRESET_SERVER_IDS.GITHUB;
const ADO = PRESET_SERVER_IDS.AZURE_DEVOPS;

function inputs(overrides: Partial<StatusDashboardInputs> = {}): StatusDashboardInputs {
  return {
    isAuthenticated: true,
    mcpServers: [],
    mcpHealthById: {},
    llmConfig: {
      languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
    },
    ...overrides,
  };
}

describe("deriveStatusDashboard (#948)", () => {
  describe("login status", () => {
    it("is green when authenticated", () => {
      const result = deriveStatusDashboard(inputs({ isAuthenticated: true }));
      expect(result.login.level).toBe("green");
    });

    it("warns with the portal-sync message when not authenticated", () => {
      const result = deriveStatusDashboard(inputs({ isAuthenticated: false }));
      expect(result.login.level).toBe("yellow");
      expect(result.login.message).toMatch(/not be synced with the portal/i);
    });

    it("shows a distinct signing-in message (not the portal-sync warning) while AUTHENTICATING", () => {
      const result = deriveStatusDashboard(
        inputs({ isAuthenticated: false, authStatus: AuthStatus.AUTHENTICATING }),
      );
      expect(result.login.level).toBe("yellow");
      expect(result.login.message).not.toMatch(/not be synced with the portal/i);
      expect(result.login.message).toMatch(/signing in/i);
    });
  });

  describe("MCP server status", () => {
    it("is red with the exact warning message when no MCP server is connected", () => {
      const result = deriveStatusDashboard(inputs({ mcpServers: [], mcpHealthById: {} }));
      expect(result.mcp.level).toBe("red");
      expect(result.mcp.message).toBe(
        "You don't have any MCP server connected, so the shave or request might fail",
      );
    });

    it("is green when at least one backlog provider is confirmed connected", () => {
      const result = deriveStatusDashboard(
        inputs({
          mcpServers: [{ id: GITHUB, name: "GitHub", enabled: true }],
          mcpHealthById: { [GITHUB]: { isHealthy: true } },
        }),
      );
      expect(result.mcp.level).toBe("green");
    });

    it("is red when servers are configured but all unhealthy", () => {
      const result = deriveStatusDashboard(
        inputs({
          mcpServers: [
            { id: GITHUB, name: "GitHub", enabled: true },
            { id: ADO, name: "Azure DevOps", enabled: true },
          ],
          mcpHealthById: {
            [GITHUB]: { isHealthy: false },
            [ADO]: { isHealthy: false },
          },
        }),
      );
      expect(result.mcp.level).toBe("red");
    });

    it("does NOT report a disabled server as connected even if health looks healthy", () => {
      const result = deriveStatusDashboard(
        inputs({
          mcpServers: [{ id: GITHUB, name: "GitHub", enabled: false }],
          mcpHealthById: { [GITHUB]: { isHealthy: true } },
        }),
      );
      expect(result.mcp.level).toBe("red");
    });

    it("does NOT report green while health is still unknown/loading", () => {
      const result = deriveStatusDashboard(
        inputs({ mcpServers: [{ id: GITHUB, name: "GitHub", enabled: true }], mcpHealthById: {} }),
      );
      expect(result.mcp.level).toBe("red");
    });

    it("does NOT count a healthy non-backlog (custom) server as connected", () => {
      const result = deriveStatusDashboard(
        inputs({
          mcpServers: [{ id: "custom-xyz", name: "Docs", enabled: true }],
          mcpHealthById: { "custom-xyz": { isHealthy: true } },
        }),
      );
      expect(result.mcp.level).toBe("red");
    });
  });

  describe("language model status", () => {
    it("is red with the exact warning message when no language model is configured", () => {
      const result = deriveStatusDashboard(inputs({ llmConfig: { languageModel: null } }));
      expect(result.languageModel.level).toBe("red");
      expect(result.languageModel.message).toBe(
        "You don't have any language model connected, so probably the shave will fail",
      );
    });

    it("is red when the config exists but the API key is blank", () => {
      const result = deriveStatusDashboard(
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "   " },
          },
        }),
      );
      expect(result.languageModel.level).toBe("red");
    });

    it("is green when a language model with an API key is configured", () => {
      const result = deriveStatusDashboard(inputs());
      expect(result.languageModel.level).toBe("green");
    });

    it("is red when llmConfig itself is null (never configured)", () => {
      const result = deriveStatusDashboard(inputs({ llmConfig: null }));
      expect(result.languageModel.level).toBe("red");
    });

    it("is green on local-claude backend when an api key is set and readiness wasn't checked", () => {
      const result = deriveStatusDashboard(
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
            orchestrationBackend: "local-claude",
          },
          orchestratorReadiness: null,
        }),
      );
      expect(result.languageModel.level).toBe("green");
    });

    it("is red on local-claude backend when the CLI isn't ready, even with an api key set (#948 gap)", () => {
      const result = deriveStatusDashboard(
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
            orchestrationBackend: "local-claude",
          },
          orchestratorReadiness: {
            installed: false,
            authenticated: false,
            ready: false,
            state: "not-installed",
            message: "Claude Code CLI not found.",
          },
        }),
      );
      expect(result.languageModel.level).toBe("red");
      expect(result.languageModel.message).toMatch(/claude code cli not found/i);
    });

    it("is green on local-claude backend when the CLI is ready", () => {
      const result = deriveStatusDashboard(
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
            orchestrationBackend: "local-claude",
          },
          orchestratorReadiness: {
            installed: true,
            authenticated: true,
            ready: true,
            state: "ready",
            message: "",
          },
        }),
      );
      expect(result.languageModel.level).toBe("green");
    });

    it("ignores orchestrator readiness when the backend isn't local-claude", () => {
      const result = deriveStatusDashboard(
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
          },
          orchestratorReadiness: {
            installed: false,
            authenticated: false,
            ready: false,
            state: "not-installed",
            message: "",
          },
        }),
      );
      expect(result.languageModel.level).toBe("green");
    });
  });

  it("reports all three rows independently", () => {
    const result = deriveStatusDashboard({
      isAuthenticated: false,
      mcpServers: [],
      mcpHealthById: {},
      llmConfig: null,
    });
    expect(result.login.level).toBe("yellow");
    expect(result.mcp.level).toBe("red");
    expect(result.languageModel.level).toBe("red");
  });
});
