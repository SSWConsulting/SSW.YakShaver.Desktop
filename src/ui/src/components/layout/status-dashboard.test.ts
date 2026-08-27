import { PRESET_SERVER_IDS } from "@shared/mcp/preset-servers";
import { describe, expect, it } from "vitest";
import { AuthStatus } from "@/types";
import { deriveStatusDashboard, type StatusDashboardInputs } from "./status-dashboard";

const GITHUB = PRESET_SERVER_IDS.GITHUB;
const ADO = PRESET_SERVER_IDS.AZURE_DEVOPS;

function inputs(overrides: Partial<StatusDashboardInputs> = {}): StatusDashboardInputs {
  return {
    isAuthenticated: true,
    videoHostStatus: AuthStatus.AUTHENTICATED,
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

  describe("video host status", () => {
    it("is green when the video host (YouTube) is connected", () => {
      const result = deriveStatusDashboard(inputs({ videoHostStatus: AuthStatus.AUTHENTICATED }));
      expect(result.videoHost.level).toBe("green");
      expect(result.videoHost.message).toMatch(/youtube/i);
    });

    it("is red and explains the disabled Record button when no video host is connected", () => {
      const result = deriveStatusDashboard(
        inputs({ videoHostStatus: AuthStatus.NOT_AUTHENTICATED }),
      );
      expect(result.videoHost.level).toBe("red");
      expect(result.videoHost.message).toBe(
        "You don't have any video host connected, so you can't start recording",
      );
    });

    it("is red when the video host auth errored", () => {
      const result = deriveStatusDashboard(inputs({ videoHostStatus: AuthStatus.ERROR }));
      expect(result.videoHost.level).toBe("red");
    });

    it("does NOT report green while the video host status is still unknown/loading", () => {
      const result = deriveStatusDashboard(inputs({ videoHostStatus: undefined }));
      expect(result.videoHost.level).toBe("red");
    });

    it("holds a neutral 'checking' state instead of flashing red while the first check runs", () => {
      const result = deriveStatusDashboard(
        // What the context reports on launch before its check resolves.
        inputs({ videoHostStatus: AuthStatus.NOT_AUTHENTICATED, isVideoHostLoading: true }),
      );
      expect(result.videoHost.level).toBe("yellow");
      expect(result.videoHost.message).toMatch(/checking/i);
    });

    it("still reports green while loading if the host is already known to be connected", () => {
      const result = deriveStatusDashboard(
        inputs({ videoHostStatus: AuthStatus.AUTHENTICATED, isVideoHostLoading: true }),
      );
      expect(result.videoHost.level).toBe("green");
    });

    it("shows a transient connecting message (not the red warning) while connecting", () => {
      const result = deriveStatusDashboard(inputs({ videoHostStatus: AuthStatus.AUTHENTICATING }));
      expect(result.videoHost.level).toBe("yellow");
      expect(result.videoHost.message).toMatch(/connecting/i);
    });

    describe("YakShaver Anywhere (cloud-360) mode", () => {
      const anywhere = (overrides: Partial<StatusDashboardInputs> = {}) =>
        inputs({
          llmConfig: {
            languageModel: { provider: "openai", model: "gpt-5.2", apiKey: "test-api-key-123" },
            orchestrationBackend: "cloud-360",
          },
          ...overrides,
        });

      it("is green when signed in, since sign-in IS the video host there", () => {
        const result = deriveStatusDashboard(
          // No YouTube connection at all — irrelevant in this mode.
          anywhere({ isAuthenticated: true, videoHostStatus: AuthStatus.NOT_AUTHENTICATED }),
        );
        expect(result.videoHost.level).toBe("green");
        expect(result.videoHost.message).toMatch(/yakshaver anywhere/i);
      });

      it("is red when not signed in, even with YouTube connected", () => {
        const result = deriveStatusDashboard(
          anywhere({ isAuthenticated: false, videoHostStatus: AuthStatus.AUTHENTICATED }),
        );
        expect(result.videoHost.level).toBe("red");
        expect(result.videoHost.message).toMatch(/sign in.*before you can start recording/i);
      });

      it("shows a transient signing-in message while sign-in is underway", () => {
        const result = deriveStatusDashboard(
          anywhere({ isAuthenticated: false, authStatus: AuthStatus.AUTHENTICATING }),
        );
        expect(result.videoHost.level).toBe("yellow");
        expect(result.videoHost.message).toMatch(/signing in/i);
      });
    });
  });

  it("reports all four rows independently", () => {
    const result = deriveStatusDashboard({
      isAuthenticated: false,
      mcpServers: [],
      mcpHealthById: {},
      llmConfig: null,
    });
    expect(result.login.level).toBe("yellow");
    expect(result.videoHost.level).toBe("red");
    expect(result.mcp.level).toBe("red");
    expect(result.languageModel.level).toBe("red");
  });
});
