import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HealthStatus } from "./health-status";

it("shows an authentication-failed label distinct from generic unhealthy", () => {
  render(
    <HealthStatus isDisabled={false} isChecking={false} isHealthy={false} authFailed error="401" />,
  );
  expect(screen.getAllByText(/authentication failed/i).length).toBeGreaterThan(0);
});
