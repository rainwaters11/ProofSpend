import {
  Activity,
  FileCheck2,
  Gauge,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Vault,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/app/overview", icon: LayoutDashboard },
  { label: "LaunchVault", href: "/app/vaults", icon: Vault },
  { label: "Smart Reserves", href: "/app/reserves", icon: Wallet },
  { label: "Milestones", href: "/app/milestones", icon: Gauge },
  { label: "Evidence", href: "/app/evidence", icon: FileCheck2 },
  { label: "Proof-of-Progress", href: "/app/proofs", icon: ScrollText },
  { label: "Backer View", href: "/proof/demo", icon: ShieldCheck },
  { label: "Activity", href: "/app/activity", icon: Activity },
  { label: "Settings", href: "/app/settings", icon: Settings },
];
