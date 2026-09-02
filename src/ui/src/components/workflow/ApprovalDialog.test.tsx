import type { InteractionRequest, ToolApprovalPayload } from "@shared/types/user-interaction";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalDialog } from "./ApprovalDialog";

vi.mock("../../services/ipc-client", () => ({
  ipcClient: { mcp: { addToolToWhitelist: vi.fn().mockResolvedValue({ success: true }) } },
}));

function makeRequest(): InteractionRequest {
  const payload: ToolApprovalPayload = {
    toolName: "github__create_issue",
    args: { title: "A bug" },
  };

  return {
    requestId: "req-1",
    type: "tool_approval",
    payload,
  };
}

describe("ApprovalDialog Stop button", () => {
  it("stops the run in one click, without going through the correction form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalDialog request={makeRequest()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /Stop/ }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "deny_stop" });
  });

  it("keeps Allow available alongside Stop", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalDialog request={makeRequest()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Allow" }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "approve" });
  });
});
