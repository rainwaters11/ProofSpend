import { Gavel, Landmark, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type UserRole = "founder" | "backer" | "evaluator";

interface RoleBadgeProps {
  role: UserRole;
}

const ROLE_CONFIG: Record<UserRole, { label: string; icon: typeof Landmark }> = {
  founder: { label: "Founder", icon: Landmark },
  backer: { label: "Backer", icon: ShieldCheck },
  evaluator: { label: "Evaluator", icon: Gavel },
};

/**
 * Every screen must show the current role so founder/backer/evaluator
 * context is never confused (Issue #14 application-shell requirements).
 */
export function RoleBadge({ role }: RoleBadgeProps) {
  const { label, icon: Icon } = ROLE_CONFIG[role];

  return (
    <Badge variant="outline" aria-label={`Current role: ${label}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}
