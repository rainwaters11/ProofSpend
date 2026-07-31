import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

describe("Home", () => {
  beforeEach(() => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", "mock");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("makes mock-only demo behavior unmistakable", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("DEMO MODE")).toBeInTheDocument();
    expect(screen.getByText("No real funds are being moved.")).toBeInTheDocument();
    expect(screen.getByText("Adapter: mock")).toBeInTheDocument();
  });

  it("fails closed when adapter mode is missing", () => {
    vi.unstubAllEnvs();

    expect(() => render(<Home />)).toThrow();
  });
});
