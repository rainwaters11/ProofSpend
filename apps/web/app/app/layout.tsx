import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { getAppShellStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function FounderAppLayout({ children }: { children: ReactNode }) {
  const status = getAppShellStatus(process.env);

  return (
    <AppShell
      mode={status.mode}
      role="founder"
      walletConfigured={status.walletConfigured}
    >
      {children}
    </AppShell>
  );
}
