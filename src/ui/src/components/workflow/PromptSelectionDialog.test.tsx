import type { InteractionRequest, ProjectSelectionPayload } from "@shared/types/user-interaction";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PromptSelectionDialog } from "./PromptSelectionDialog";

/**
 * #967: the confirmation dialog was a "wall of words" — the "Why this project" reasoning
 * text was always shown in full, and a redundant instructional sentence ("YakShaver
 * analysed your video...") duplicated the dialog title. This suite asserts the reasoning
 * is collapsed by default behind an expand/collapse control, and that the redundant
 * sentence is gone, while the rest of the confirm/select flow keeps working.
 */
function makeRequest(): InteractionRequest {
  const payload: ProjectSelectionPayload = {
    selectedProject: {
      id: "proj-1",
      name: "My Project",
      description: "The primary project",
      reason: "This project best matches the video content because it discusses the same feature.",
      source: "local",
    },
    allProjects: [
      {
        id: "proj-1",
        name: "My Project",
        description: "The primary project",
        source: "local",
      },
      {
        id: "proj-2",
        name: "Other Project",
        description: "Another project",
        source: "remote",
      },
    ],
  };

  return {
    requestId: "req-1",
    type: "project_selection",
    payload,
  };
}

describe("PromptSelectionDialog (#967)", () => {
  it("collapses the 'Why this project?' reasoning by default", () => {
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={vi.fn()} />);

    expect(screen.getByText("Why this project?")).toBeInTheDocument();
    // The reasoning text exists in the DOM (inside <details>) but is not visible/expanded.
    const details = screen.getByText("Why this project?").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("reveals the reasoning text once the expand control is toggled", async () => {
    const user = userEvent.setup();
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={vi.fn()} />);

    const summary = screen.getByText("Why this project?");
    await user.click(summary);

    const details = summary.closest("details");
    expect(details).toHaveAttribute("open");
    expect(
      screen.getByText(
        "This project best matches the video content because it discusses the same feature.",
      ),
    ).toBeInTheDocument();
  });

  it("does not render the redundant 'YakShaver analysed your video' sentence", () => {
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={vi.fn()} />);

    expect(screen.queryByText(/YakShaver analysed your video/i)).not.toBeInTheDocument();
  });

  it("keeps an accessible description wired to the confirm dialog (a11y regression guard)", () => {
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={vi.fn()} />);

    const dialog = screen.getByRole("alertdialog");
    const describedById = dialog.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();

    const description = describedById ? document.getElementById(describedById) : null;
    expect(description).not.toBeNull();
    expect(description?.textContent).not.toMatch(/YakShaver analysed your video/i);
  });

  it("still submits the initially selected project when Continue is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSubmit).toHaveBeenCalledWith({ projectId: "proj-1" });
  });

  it("still allows switching to the select view via Change", async () => {
    const user = userEvent.setup();
    render(<PromptSelectionDialog request={makeRequest()} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByRole("heading", { name: "Select a Prompt" })).toBeInTheDocument();
    expect(screen.getByText("Other Project")).toBeInTheDocument();
  });
});
