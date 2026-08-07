"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { NAV_ITEMS } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";

export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? "Expand sidebar" : "Collapse sidebar";
}

export function DesktopSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const toggleLabel = sidebarToggleLabel(collapsed);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface p-3 md:flex",
        collapsed ? "w-[4.5rem]" : "w-64",
      )}
    >
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <item.icon aria-hidden="true" className="size-5 shrink-0" />
              <span className={cn(collapsed && "sr-only")}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={toggleLabel}
        aria-pressed={collapsed}
        className="flex h-11 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {collapsed ? (
          <ChevronsRight aria-hidden="true" className="size-4" />
        ) : (
          <ChevronsLeft aria-hidden="true" className="size-4" />
        )}
        <span className={cn(collapsed && "sr-only")}>{collapsed ? "Expand" : "Collapse"}</span>
      </button>
    </nav>
  );
}
