import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShaveStatus } from "../../types";
import { parseFinalOutput, ShaveOutcomeView } from "./ShaveOutcomeView";

const { getById } = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock("../../services/ipc-client", () => ({
  ipcClient: { shave: { getById } },
}));
// The nested panel subscribes to electronAPI; stub it out for this view's tests.
vi.mock("./WorkflowProgressPanel", () => ({
  WorkflowProgressPanel: () => <div>workflow-progress</div>,
}));

const shave = (over: Record<string, unknown>) => ({
  id: "s1",
  title: "My shave",
  finalOutput: null,
  errorMessage: null,
  errorCode: null,
  workItemUrl: null,
  videoEmbedUrl: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShaveOutcomeView (#821 / #888 review)", () => {
  it("shows an in-progress message for a still-running (Processing) shave — no blank dead-end", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({ shaveStatus: ShaveStatus.Processing }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    expect(await screen.findByText("This shave is still running")).toBeInTheDocument();
  });

  it("shows the failure details for a Failed shave", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({
        shaveStatus: ShaveStatus.Failed,
        errorMessage: "boom",
        errorCode: "E_X",
      }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    expect(await screen.findByText("This shave failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the success outcome for a Completed shave (no in-progress/failed, shows the result)", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({
        shaveStatus: ShaveStatus.Completed,
        finalOutput:
          '```json\n{"URL":"https://github.com/o/r/issues/7","Description":"Created the issue"}\n```',
        videoEmbedUrl: "https://youtu.be/abc",
      }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    // the parsed work-item link + description confirm the success path rendered
    const link = await screen.findByRole("link", { name: /open work item/i });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/7");
    expect(screen.getByText("Created the issue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view recording/i })).toBeInTheDocument();
    // the full stage view renders for a completed shave (reconstructed)
    expect(screen.getByText("workflow-progress")).toBeInTheDocument();
    // and neither non-success branch shows
    expect(screen.queryByText("This shave is still running")).not.toBeInTheDocument();
    expect(screen.queryByText("This shave failed")).not.toBeInTheDocument();
  });

  it("renders without crashing when finalOutput is non-JSON model text", async () => {
    getById.mockResolvedValue({
      success: true,
      data: shave({
        shaveStatus: ShaveStatus.Completed,
        finalOutput: "sorry, I could not do that",
      }),
    });

    render(<ShaveOutcomeView shaveId="s1" />);

    // unparseable output -> no work item / description, but the view still renders
    expect(await screen.findByText("My shave")).toBeInTheDocument();
    expect(screen.getByText("workflow-progress")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open work item/i })).not.toBeInTheDocument();
  });
});

describe("parseFinalOutput (#888 review — brittle fence-stripping heuristic)", () => {
  it("parses a fenced ```json block", () => {
    expect(parseFinalOutput('```json\n{"URL":"https://x"}\n```')).toEqual({ URL: "https://x" });
  });

  it("parses bare JSON with no code fence", () => {
    expect(parseFinalOutput('{"Title":"T"}')).toEqual({ Title: "T" });
  });

  it("returns null for non-JSON model output (graceful, no throw)", () => {
    expect(parseFinalOutput("sorry, I could not do that")).toBeNull();
  });

  it("returns null for empty/missing output", () => {
    expect(parseFinalOutput(null)).toBeNull();
    expect(parseFinalOutput(undefined)).toBeNull();
    expect(parseFinalOutput("")).toBeNull();
  });

  it("parses an uppercase/variant fence (case-insensitive)", () => {
    expect(parseFinalOutput('```JSON\n{"URL":"https://x"}\n```')).toEqual({ URL: "https://x" });
  });

  it("parses a fenced block preceded by prose", () => {
    expect(parseFinalOutput('Here is the result:\n```json\n{"URL":"https://x"}\n```')).toEqual({
      URL: "https://x",
    });
  });

  it("preserves backticks inside a JSON value (no payload corruption)", () => {
    const desc = "run ```npm test``` first";
    const input = `\`\`\`json\n${JSON.stringify({ Description: desc })}\n\`\`\``;
    expect(parseFinalOutput(input)?.Description).toBe(desc);
  });
});
