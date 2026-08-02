import { Bell, ChevronDown, Wallet } from "lucide-react";

import type { AdapterMode } from "@/components/mode-badge";
import { ModeBadge } from "@/components/mode-badge";
import type { UserRole } from "@/components/role-badge";
import { RoleBadge } from "@/components/role-badge";
import { MobileNav } from "@/components/shell/mobile-nav";

interface TopHeaderProps {
  mode: AdapterMode;
  role: UserRole;
  projectName?: string;
}

/**
 * Placeholder values only — project selection, wallet status, and the
 * proof-gap count are wired to real domain data in a later Issue #14 phase
 * once Issue #2/#3 land. No balances or counts are fabricated here.
 */
export function TopHeader({ mode, role, projectName = "No project selected" }: TopHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-4">
      <MobileNav />

      <button
        type="button"
        className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Project selector: ${projectName}`}
      >
        <span className="max-w-40 truncate sm:max-w-none">{projectName}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <ModeBadge mode={mode} />
        <RoleBadge role={role} />

        <span
          className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex"
          aria-label="Wallet configuration status: not configured"
        >
          <Wallet aria-hidden="true" className="size-3.5" />
          Not configured
        </span>

        <button
          type="button"
          aria-label="Proof gaps and notifications: none yet"
          className="relative flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell aria-hidden="true" className="size-5" />
        </button>
      </div>
    </header>
  );
}
