import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";
import { sidebarToggleLabel } from "./desktop-sidebar";
import { NAV_ITEMS } from "./nav-items";

describe("AppShell", () => {
  it("renders header and primary navigation landmarks", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    expect(markup).toContain("<header");
    expect(markup).toContain('aria-label="Primary"');
    expect(markup).toContain('id="main-content"');
  });

  it("renders every primary nav item", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    for (const item of NAV_ITEMS) {
      expect(markup).toContain(`href="${item.href}"`);
      expect(markup).toContain(item.label);
    }
  });

  it("exposes an accessible mobile navigation toggle as a native, focusable button", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    const toggleMatch = markup.match(
      /<button[^>]*aria-label="Open navigation menu"[^>]*>/,
    );

    expect(toggleMatch).not.toBeNull();
    expect(toggleMatch?.[0]).not.toContain('tabindex="-1"');
  });

  it("uses action-accurate accessible labels for the collapsible sidebar", () => {
    expect(sidebarToggleLabel(false)).toBe("Collapse sidebar");
    expect(sidebarToggleLabel(true)).toBe("Expand sidebar");
  });

  it("shows mode and role context in the header at every breakpoint", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="arc-testnet" role="evaluator">
        <p>Page content</p>
      </AppShell>,
    );

    expect(markup).toContain("ARC TESTNET");
    expect(markup).toContain("Evaluator");
  });

  it("provides a skip-to-content link", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    expect(markup).toMatch(/<a[^>]*href="#main-content"[^>]*>\s*Skip to main content/);
  });

  it("never applies the legacy landing-page class to the app shell main region", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    const mainMatch = markup.match(/<main[^>]*class="([^"]*)"/);

    expect(mainMatch).not.toBeNull();
    expect(mainMatch?.[1].split(" ")).not.toContain("landing-page");
  });

  it("keeps mode/role badges on their own row, separate from the project selector, on mobile", () => {
    const markup = renderToStaticMarkup(
      <AppShell mode="mock" role="founder">
        <p>Page content</p>
      </AppShell>,
    );

    const mobileProjectSelectorMatch = markup.match(
      /<button[^>]*class="[^"]*md:hidden[^"]*"[^>]*aria-label="Project selector: No project selected"[^>]*>/,
    );

    expect(mobileProjectSelectorMatch).not.toBeNull();
    expect(mobileProjectSelectorMatch?.[0]).toContain("w-full");
  });
});
