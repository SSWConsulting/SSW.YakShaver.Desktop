import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("renders a centered, announced loading state by default", () => {
    const { container } = render(<LoadingState />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "items-center",
      "justify-center",
      "py-8",
    );
  });

  it("renders an inline decorative spinner without the block wrapper", () => {
    const { container } = render(<LoadingState inline className="size-6" />);
    const spinner = container.querySelector("svg");

    expect(container.firstElementChild?.tagName).toBe("svg");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).not.toHaveAttribute("role");
    expect(spinner).not.toHaveAttribute("aria-label");
    expect(spinner).toHaveClass("size-6", "animate-spin");
    expect(spinner).not.toHaveClass("size-4");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a contextual label when an inline loader has no visible status text", () => {
    render(<LoadingState inline label="Checking health" />);

    expect(screen.getByRole("status", { name: "Checking health" })).toBeInTheDocument();
  });
});
