import type { ReactNode } from "react";

import type { AdapterMode } from "@/components/mode-badge";
import type { UserRole } from "@/components/role-badge";
import { DesktopSidebar } from "@/components/shell/desktop-sidebar";
import { TopHeader } from "@/components/shell/top-header";

interface AppShellProps {
  children: ReactNode;
  mode: AdapterMode;
  role: UserRole;
}

export function AppShell({ children, mode, role }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader mode={mode} role={role} />

        <main id="main-content" className="flex-1 px-4 pb-24 pt-6 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
