import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModeBadge } from "./mode-badge";

describe("ModeBadge", () => {
  it("renders visible text for mock mode, not color alone", () => {
    render(<ModeBadge mode="mock" />);

    expect(screen.getByText("MOCK")).toBeInTheDocument();
    expect(screen.getByLabelText("Application mode: MOCK")).toBeInTheDocument();
  });

  it("renders visible text for arc-testnet mode, not color alone", () => {
    render(<ModeBadge mode="arc-testnet" />);

    expect(screen.getByText("ARC TESTNET")).toBeInTheDocument();
    expect(screen.getByLabelText("Application mode: ARC TESTNET")).toBeInTheDocument();
  });

  it("uses distinct text between mock and arc-testnet modes", () => {
    const { rerender } = render(<ModeBadge mode="mock" />);
    const mockText = screen.getByText("MOCK").textContent;

    rerender(<ModeBadge mode="arc-testnet" />);
    const testnetText = screen.getByText("ARC TESTNET").textContent;

    expect(mockText).not.toBe(testnetText);
  });
});
