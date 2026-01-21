import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcRendererOn = vi.fn();
const ipcRendererRemoveListener = vi.fn();
const ipcRendererInvoke = vi.fn();
const ipcRendererSend = vi.fn();

let exposedApi: unknown;

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      exposedApi = api;
    }),
  },
  ipcRenderer: {
    on: ipcRendererOn,
    removeListener: ipcRendererRemoveListener,
    invoke: ipcRendererInvoke,
    send: ipcRendererSend,
  },
}));

describe("preload", () => {
  beforeEach(() => {
    exposedApi = undefined;
    ipcRendererOn.mockClear();
    ipcRendererRemoveListener.mockClear();
    ipcRendererInvoke.mockClear();
    ipcRendererSend.mockClear();
    vi.resetModules();
  });

  it("wires protocol error listener through preload API", async () => {
    await import("./preload");

    const api = exposedApi as {
      app: {
        onProtocolError: (callback: (message: string) => void) => () => void;
      };
    };

    const callback = vi.fn();
    const unsubscribe = api.app.onProtocolError(callback);

    expect(ipcRendererOn).toHaveBeenCalledTimes(1);
    const [channel, listener] = ipcRendererOn.mock.calls[0];
    expect(channel).toBe("protocol:error");

    (listener as (event: unknown, payload: string) => void)({}, "boom");
    expect(callback).toHaveBeenCalledWith("boom");

    unsubscribe();
    expect(ipcRendererRemoveListener).toHaveBeenCalledWith(channel, listener);
  });
});
