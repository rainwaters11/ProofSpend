import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

describe("Home", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when adapter mode is absent", () => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", undefined);

    expect(() => Home()).toThrow();
  });

  it("makes mock-only demo behavior unmistakable", () => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", "mock");
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("DEMO MODE")).toBeInTheDocument();
    expect(screen.getByText("No real funds are being moved.")).toBeInTheDocument();
    expect(screen.getByText("Adapter: mock")).toBeInTheDocument();
  });
});
