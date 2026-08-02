import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";
import { NAV_ITEMS } from "./nav-items";

describe("AppShell", () => {
  it("renders header and primary navigation landmarks", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Primary" })[0]).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders every primary nav item", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    for (const item of NAV_ITEMS) {
      expect(screen.getAllByRole("link", { name: item.label }).length).toBeGreaterThan(0);
    }
  });

  it("exposes an accessible mobile navigation toggle with a visible focus target", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    const toggle = screen.getByRole("button", { name: "Open navigation menu" });
    expect(toggle).toBeInTheDocument();
    toggle.focus();
    expect(toggle).toHaveFocus();
  });

  it("shows mode and role context in the header", () => {
    render(
      <AppShell mode="arc-testnet" role="evaluator">
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByText("ARC TESTNET")).toBeInTheDocument();
    expect(screen.getByText("Evaluator")).toBeInTheDocument();
  });

  it("provides a skip-to-content link", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });
});
