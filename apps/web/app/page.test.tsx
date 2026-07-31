import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("makes mock-only demo behavior unmistakable", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("DEMO MODE")).toBeInTheDocument();
    expect(screen.getByText("No real funds are being moved.")).toBeInTheDocument();
    expect(screen.getByText("Adapter: mock")).toBeInTheDocument();
  });
});
