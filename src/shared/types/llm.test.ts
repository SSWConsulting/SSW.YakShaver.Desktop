import { describe, it, expect } from "vitest";
import type { OrchestrationBackend } from "./llm";

describe("OrchestrationBackend", () => {
  it("includes cloud-360 as an assignable value", () => {
    const backend: OrchestrationBackend = "cloud-360";
    expect(backend).toBe("cloud-360");
  });
});
