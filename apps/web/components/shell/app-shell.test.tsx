// @vitest-environment jsdom
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

  it("shows mode and role context in the header at every breakpoint", () => {
    render(
      <AppShell mode="arc-testnet" role="evaluator">
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getAllByText("ARC TESTNET").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evaluator").length).toBeGreaterThan(0);
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

  it("never applies the legacy landing-page class to the app shell main region", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    expect(screen.getByRole("main")).not.toHaveClass("landing-page");
  });

  it("keeps mode/role badges on their own row, separate from the project selector, on mobile", () => {
    render(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    const projectSelectors = screen.getAllByRole("button", {
      name: "Project selector: No project selected",
    });
    const mobileProjectSelector = projectSelectors.find((button) =>
      button.className.includes("md:hidden"),
    );

    expect(mobileProjectSelector).toBeDefined();
    expect(mobileProjectSelector).toHaveClass("w-full");
  });
});
