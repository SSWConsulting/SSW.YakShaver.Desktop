import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the mocking pattern used by control-bar-window.test.ts: electron
// isn't available under vitest's node environment, so `app.isPackaged` and a
// minimal BrowserWindow-shaped webContents are mocked directly.
const { mockApp } = vi.hoisted(() => ({
  mockApp: { isPackaged: false },
}));

vi.mock("electron", () => ({
  app: mockApp,
}));

import { applyDevToolsGuard, isProductionBuild } from "./devtools-guard";

type Handler = (...args: unknown[]) => void;

function createMockWindow() {
  const handlers = new Map<string, Handler>();
  const closeDevTools = vi.fn();
  const webContents = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    closeDevTools,
  };
  return {
    window: { webContents } as unknown as Electron.BrowserWindow,
    handlers,
    closeDevTools,
  };
}

describe("isProductionBuild", () => {
  it("mirrors app.isPackaged rather than NODE_ENV", () => {
    mockApp.isPackaged = false;
    expect(isProductionBuild()).toBe(false);

    mockApp.isPackaged = true;
    expect(isProductionBuild()).toBe(true);
  });
});

describe("applyDevToolsGuard", () => {
  beforeEach(() => {
    mockApp.isPackaged = false;
  });

  it("does nothing outside production (development stays unaffected)", () => {
    mockApp.isPackaged = false;
    const { window, handlers } = createMockWindow();

    applyDevToolsGuard(window);

    expect(handlers.size).toBe(0);
  });

  it.each([
    { key: "F12", control: false, meta: false, shift: false, alt: false },
    { key: "i", control: true, meta: false, shift: true, alt: false },
    { key: "I", control: true, meta: false, shift: true, alt: false },
    { key: "j", control: true, meta: false, shift: true, alt: false },
    { key: "c", control: true, meta: false, shift: true, alt: false },
    { key: "i", control: false, meta: true, shift: true, alt: false }, // Cmd+Shift+I alias
    { key: "i", control: false, meta: true, shift: false, alt: true }, // macOS Cmd+Option+I (Chromium's real default)
    { key: "j", control: false, meta: true, shift: false, alt: true }, // macOS Cmd+Option+J
    { key: "c", control: false, meta: true, shift: false, alt: true }, // macOS Cmd+Option+C
  ])("blocks the $key devtools shortcut in production regardless of the app Menu", ({
    key,
    control,
    meta,
    shift,
    alt,
  }) => {
    mockApp.isPackaged = true;
    const { window, handlers } = createMockWindow();

    applyDevToolsGuard(window);

    const beforeInputEvent = handlers.get("before-input-event");
    expect(beforeInputEvent).toBeDefined();

    const preventDefault = vi.fn();
    beforeInputEvent?.({ preventDefault }, { type: "keyDown", key, control, meta, shift, alt });

    // This is the crux of #455: the app's Menu can omit "Toggle DevTools"
    // entirely, but Chromium's default accelerators still fire unless
    // explicitly intercepted here.
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not block unrelated keys in production", () => {
    mockApp.isPackaged = true;
    const { window, handlers } = createMockWindow();

    applyDevToolsGuard(window);

    const beforeInputEvent = handlers.get("before-input-event");
    const preventDefault = vi.fn();
    beforeInputEvent?.(
      { preventDefault },
      { type: "keyDown", key: "a", control: true, meta: false, shift: true, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores keyUp events (only intercepts keyDown)", () => {
    mockApp.isPackaged = true;
    const { window, handlers } = createMockWindow();

    applyDevToolsGuard(window);

    const beforeInputEvent = handlers.get("before-input-event");
    const preventDefault = vi.fn();
    beforeInputEvent?.(
      { preventDefault },
      { type: "keyUp", key: "F12", control: false, meta: false, shift: false, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("force-closes DevTools if it is ever opened in production (belt-and-suspenders)", () => {
    mockApp.isPackaged = true;
    const { window, handlers, closeDevTools } = createMockWindow();

    applyDevToolsGuard(window);

    const devtoolsOpened = handlers.get("devtools-opened");
    expect(devtoolsOpened).toBeDefined();

    devtoolsOpened?.();

    expect(closeDevTools).toHaveBeenCalledTimes(1);
  });
});
