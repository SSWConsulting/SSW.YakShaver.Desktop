import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { McpServerImportPreview } from "./McpServerImportPreview";

describe("McpServerImportPreview", () => {
  it("shows all mapped HTTP fields while masking header values", () => {
    render(
      <McpServerImportPreview
        configs={[
          {
            id: "",
            name: "context7",
            description: "Context7 MCP",
            transport: "streamableHttp",
            url: "https://mcp.context7.com/mcp",
            headers: { CONTEXT7_API_KEY: "real-secret-key" },
            version: "1.0.0",
            timeoutMs: 30_000,
          },
        ]}
      />,
    );

    const preview = screen.getByLabelText("Import preview for context7");
    expect(within(preview).getByText("Context7 MCP")).toBeInTheDocument();
    expect(within(preview).getByText("CONTEXT7_API_KEY:", { exact: false })).toBeInTheDocument();
    expect(within(preview).getByText("••••••••")).toBeInTheDocument();
    expect(within(preview).getByText("value hidden")).toBeInTheDocument();
    expect(within(preview).getByText("1.0.0")).toBeInTheDocument();
    expect(within(preview).getByText("30000 ms")).toBeInTheDocument();
    expect(within(preview).queryByText("real-secret-key")).not.toBeInTheDocument();
  });

  it("shows all mapped STDIO fields while masking environment values", () => {
    render(
      <McpServerImportPreview
        configs={[
          {
            id: "",
            name: "playwright",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@playwright/mcp@latest"],
            env: { PLAYWRIGHT_TOKEN: "real-token" },
            cwd: "C:\\workspace",
            stderr: "pipe",
          },
        ]}
      />,
    );

    const preview = screen.getByLabelText("Import preview for playwright");
    expect(within(preview).getByText("-y @playwright/mcp@latest")).toBeInTheDocument();
    expect(within(preview).getByText("PLAYWRIGHT_TOKEN:", { exact: false })).toBeInTheDocument();
    expect(within(preview).getByText("••••••••")).toBeInTheDocument();
    expect(within(preview).getByText("value hidden")).toBeInTheDocument();
    expect(within(preview).getByText("C:\\workspace")).toBeInTheDocument();
    expect(within(preview).getByText("pipe")).toBeInTheDocument();
    expect(within(preview).queryByText("real-token")).not.toBeInTheDocument();
  });
});
