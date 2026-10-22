import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoHostingStep } from "./VideoHostingStep";

vi.mock("@/components/auth/YouTubeConnection", () => ({ YouTubeConnection: () => null }));
vi.mock("@/components/settings/video-host/LocalStorageHostCard", () => ({
  LocalStorageHostCard: () => null,
}));

describe("VideoHostingStep (#1062)", () => {
  it("lets the user continue without connecting a video platform", () => {
    const onRegisterHandlers = vi.fn();

    render(<VideoHostingStep onRegisterHandlers={onRegisterHandlers} />);

    const handlers = onRegisterHandlers.mock.calls.at(-1)?.[0];
    expect(handlers.isReady).toBe(true);
    expect(handlers.validate()).toBe(true);
  });
});
