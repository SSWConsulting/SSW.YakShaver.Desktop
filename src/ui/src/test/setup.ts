// Global setup for the jsdom + React Testing Library component-test harness.
// - `@testing-library/jest-dom/vitest` registers DOM matchers (toBeInTheDocument, etc.).
// - `cleanup()` after each test unmounts rendered trees so tests don't leak into each other.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement ResizeObserver, which some Radix primitives construct on
// mount; provide a no-op polyfill so those component tests can render.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});
