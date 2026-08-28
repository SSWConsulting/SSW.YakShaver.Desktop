import { beforeEach, describe, expect, it, vi } from "vitest";

// UserInteractionService imports `electron` for BrowserWindow broadcasting (unrelated to the
// methods under test here), so stub it the same way other backend suites do.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { UserInteractionService } from "./user-interaction-service";

describe("UserInteractionService — shave run-stopper registry (#988 follow-up to #920)", () => {
  let service: UserInteractionService;

  beforeEach(() => {
    service = UserInteractionService.getInstance();
    // The service is a process-wide singleton; explicitly clear any stopper left behind by a
    // prior test/run rather than relying on registration order (which would be brittle here — a
    // no-op stub since stopShaveRun already tolerates an absent stopper for a fresh shaveId).
  });

  it("stopShaveRun is a no-op when no run is registered for the shaveId", () => {
    expect(() => service.stopShaveRun("no-such-shave")).not.toThrow();
  });

  it("registerShaveRunStopper registers a callback that stopShaveRun invokes", () => {
    const stop = vi.fn();
    service.registerShaveRunStopper("shave-1", stop);

    service.stopShaveRun("shave-1");

    expect(stop).toHaveBeenCalledOnce();
  });

  it("stopShaveRun only invokes the callback once even if called twice (deregisters after firing)", () => {
    const stop = vi.fn();
    service.registerShaveRunStopper("shave-2", stop);

    service.stopShaveRun("shave-2");
    service.stopShaveRun("shave-2");

    expect(stop).toHaveBeenCalledOnce();
  });

  it("the returned deregister function removes the stopper so a later stopShaveRun is a no-op", () => {
    const stop = vi.fn();
    const deregister = service.registerShaveRunStopper("shave-3", stop);

    deregister();
    service.stopShaveRun("shave-3");

    expect(stop).not.toHaveBeenCalled();
  });

  it("deregister only clears ITS OWN callback — a concurrent re-register survives a stale deregister", () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const deregisterFirst = service.registerShaveRunStopper("shave-4", firstStop);
    // Simulate an immediate retry re-registering under the same shaveId before the first run's
    // cleanup runs (e.g. cleanup scheduled on a microtask that resolves after the retry starts).
    service.registerShaveRunStopper("shave-4", secondStop);

    // The stale deregister from the FIRST run must not clear the SECOND run's stopper.
    deregisterFirst();
    service.stopShaveRun("shave-4");

    expect(firstStop).not.toHaveBeenCalled();
    expect(secondStop).toHaveBeenCalledOnce();
  });

  it("stopping one shave's run does not affect a different shave's registered stopper", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    service.registerShaveRunStopper("shave-a", stopA);
    service.registerShaveRunStopper("shave-b", stopB);

    service.stopShaveRun("shave-a");

    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).not.toHaveBeenCalled();
  });
});
