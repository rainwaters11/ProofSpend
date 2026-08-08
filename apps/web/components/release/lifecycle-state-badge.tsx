import {
  CheckCircle2,
  CircleDashed,
  Clock,
  FileEdit,
  Radio,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Wrench,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import type { ReleaseLifecycleState } from "@/lib/release-scenario";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const STATE_CONFIG: Record<
  ReleaseLifecycleState,
  { label: string; icon: LucideIcon; variant: BadgeVariant }
> = {
  DRAFT: { label: "Draft", icon: FileEdit, variant: "outline" },
  ELIGIBLE: { label: "Eligible", icon: CircleDashed, variant: "outline" },
  APPROVAL_PENDING: { label: "Awaiting approval", icon: ShieldQuestion, variant: "warning" },
  APPROVED: { label: "Approved", icon: ShieldCheck, variant: "secondary" },
  PREPARED: { label: "Prepared", icon: Wrench, variant: "secondary" },
  SUBMITTED: { label: "Submitted", icon: Clock, variant: "warning" },
  CONFIRMED: { label: "Confirmed", icon: CheckCircle2, variant: "success" },
  RECONCILED: { label: "Reconciled", icon: CheckCircle2, variant: "success" },
  REJECTED: { label: "Rejected", icon: ShieldX, variant: "destructive" },
  FAILED: { label: "Failed", icon: XCircle, variant: "destructive" },
};

interface LifecycleStateBadgeProps {
  state: ReleaseLifecycleState;
}

/**
 * Prepared/submitted/confirmed/failed must stay technically and visually
 * distinct (AGENTS.md Arc standards governance) — icon + text pair with
 * color on every state, never color alone.
 */
export function LifecycleStateBadge({ state }: LifecycleStateBadgeProps) {
  const { label, icon: Icon, variant } = STATE_CONFIG[state];

  return (
    <Badge variant={variant} aria-label={`Release status: ${label}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}

export function transactionStatusIcon(status: "NONE" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED"): LucideIcon {
  switch (status) {
    case "NONE":
      return CircleDashed;
    case "PREPARED":
      return Wrench;
    case "SUBMITTED":
      return Radio;
    case "CONFIRMED":
      return CheckCircle2;
    case "FAILED":
      return XCircle;
  }
}
