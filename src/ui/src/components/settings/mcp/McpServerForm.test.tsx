import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { McpServerFormWrapper } from "./McpServerForm";

const INITIAL_SERVER = {
  id: "",
  name: "github",
  description: "GitHub MCP Server",
  transport: "streamableHttp" as const,
  url: "https://api.githubcopilot.com/mcp/",
};

describe("McpServerFormWrapper JSON mode", () => {
  it("switches between modes without validating required fields", async () => {
    const user = userEvent.setup();

    render(
      <McpServerFormWrapper
        isEditing={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(screen.getByLabelText("MCP server JSON")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Form" }));

    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates required JSON fields only when saving", async () => {
    const user = userEvent.setup();

    render(
      <McpServerFormWrapper
        isEditing={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save Server" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("preserves parsed JSON when switching back to form mode", async () => {
    const user = userEvent.setup();

    render(
      <McpServerFormWrapper
        initialData={INITIAL_SERVER}
        isEditing={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    const editor = screen.getByLabelText("MCP server JSON");
    expect(editor).toBeInstanceOf(HTMLTextAreaElement);
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }
    const updatedJson = editor.value.replace('"name": "github"', '"name": "github-updated"');
    fireEvent.change(editor, { target: { value: updatedJson } });
    await user.click(screen.getByRole("button", { name: "Form" }));

    expect(screen.getByLabelText(/Name/)).toHaveValue("github-updated");
    expect(screen.getByLabelText(/URL/)).toHaveValue(INITIAL_SERVER.url);
  });

  it("submits the same internal configuration from JSON mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <McpServerFormWrapper
        initialData={INITIAL_SERVER}
        isEditing={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Save Server" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(INITIAL_SERVER));
  });

  it("submits all servers from a wrapped MCP configuration", async () => {
    const user = userEvent.setup();
    const onSubmitMany = vi.fn();

    render(
      <McpServerFormWrapper
        isEditing={false}
        onSubmit={vi.fn()}
        onSubmitMany={onSubmitMany}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "JSON" }));
    fireEvent.change(screen.getByLabelText("MCP server JSON"), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
            filesystem: { command: "npx", args: ["-y", "filesystem"] },
          },
        }),
      },
    });

    expect(screen.getByText("Import preview (2 servers)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Server" }));

    await waitFor(() => expect(onSubmitMany).toHaveBeenCalledTimes(1));
    expect(onSubmitMany.mock.calls[0][0]).toHaveLength(2);
  });
});
