import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";

/**
 * Phase A ships the shell only. Mode and role are hardcoded placeholders
 * here; wiring them to real adapter/session state is out of scope until the
 * domain (#2), auth, and role-aware session work land in a later phase.
 */
export default function FounderAppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell mode="mock" role="founder">
      {children}
    </AppShell>
  );
}
