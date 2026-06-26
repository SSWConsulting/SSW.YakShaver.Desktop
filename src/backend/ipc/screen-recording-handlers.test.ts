import { ipcMain } from "electron";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { CameraWindow } from "../services/recording/camera-window";
import { RecordingControlBarWindow } from "../services/recording/control-bar-window";
import { CountdownWindow } from "../services/recording/countdown-window";
import { RecordingService } from "../services/recording/recording-service";
import { ScreenFrameWindow } from "../services/recording/screen-frame-window";
import { IPC_CHANNELS } from "./channels";
import { ScreenRecordingIPCHandlers } from "./screen-recording-handlers";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock("../index", () => ({
  getMainWindow: vi.fn().mockReturnValue(null),
}));

vi.mock("../services/ffmpeg/ffmpeg-service");
vi.mock("../services/recording/camera-window");
vi.mock("../services/recording/control-bar-window");
vi.mock("../services/recording/countdown-window");
vi.mock("../services/recording/recording-service");
vi.mock("../services/recording/screen-frame-window");

describe("ScreenRecordingIPCHandlers", () => {
  let cameraWindow: { hide: Mock };
  let controlBar: { hideWithSuccess: Mock };
  let screenFrameWindow: { hide: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    cameraWindow = { hide: vi.fn() };
    controlBar = { hideWithSuccess: vi.fn().mockReturnValue({ success: true }) };
    screenFrameWindow = { hide: vi.fn() };

    // @ts-expect-error - mock implementation
    CameraWindow.getInstance.mockReturnValue(cameraWindow);
    // @ts-expect-error - mock implementation
    RecordingControlBarWindow.getInstance.mockReturnValue(controlBar);
    // @ts-expect-error - mock implementation
    CountdownWindow.getInstance.mockReturnValue({});
    // @ts-expect-error - mock implementation
    RecordingService.getInstance.mockReturnValue({});
    // @ts-expect-error - mock implementation
    ScreenFrameWindow.getInstance.mockReturnValue(screenFrameWindow);

    new ScreenRecordingIPCHandlers();
  });

  function getHandler(channel: string) {
    const call = (ipcMain.handle as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler not registered for ${channel}`);
    return call[1] as (...args: unknown[]) => unknown;
  }

  // Regression guard for issue #805: the screen frame overlay was left on-screen after
  // recording stopped because HIDE_CONTROL_BAR did not destroy the screen frame window.
  it("destroys the screen frame overlay when the control bar is hidden", async () => {
    const handler = getHandler(IPC_CHANNELS.HIDE_CONTROL_BAR);

    const result = await handler({});

    expect(result).toEqual({ success: true });
    expect(cameraWindow.hide).toHaveBeenCalledTimes(1);
    expect(controlBar.hideWithSuccess).toHaveBeenCalledTimes(1);
    expect(screenFrameWindow.hide).toHaveBeenCalledTimes(1);
  });
});
