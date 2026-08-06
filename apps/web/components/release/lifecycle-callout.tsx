import { AlertOctagon, Clock, ShieldX, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ReconciliationRecord } from "@proofspend/domain";

import type { ReleaseLifecycleState } from "@/lib/release-scenario";
import { cn } from "@/lib/utils";

interface CalloutConfig {
  icon: LucideIcon;
  tone: "warning" | "destructive" | "success";
  title: string;
  description: ReactNode;
}

function calloutFor(
  state: ReleaseLifecycleState,
  reconciliation: ReconciliationRecord | null,
  isMock: boolean,
): CalloutConfig | null {
  switch (state) {
    case "SUBMITTED":
      return {
        icon: Clock,
        tone: "warning",
        title: isMock ? "Pending — synthetic submission recorded" : "Pending — submitted to Arc Testnet",
        description: isMock
          ? "This mock scenario has advanced to a synthetic \"submitted\" state — no transaction was broadcast to Arc Testnet. Funds are not, and were never, available to the recipient in this demonstration."
          : "The transaction has been broadcast and is waiting for block confirmation. Funds are not yet available to the recipient.",
      };
    case "REJECTED":
      return {
        icon: ShieldX,
        tone: "destructive",
        title: "Rejected by founder",
        description: "The founder reviewed this exact release request and declined to approve it. No funds moved.",
      };
    case "FAILED":
      return {
        icon: AlertOctagon,
        tone: "destructive",
        title: "Failed",
        description: isMock
          ? "This mock scenario represents a failed outcome — no real prepared or submitted transaction ever existed on Arc Testnet. No funds were transferred in this demonstration."
          : "The prepared or submitted transaction did not reach a confirmed state on Arc Testnet. No funds were transferred; a new attempt requires a fresh prepared transaction.",
      };
    case "RECONCILED":
      return {
        icon: Sparkles,
        tone: "success",
        title: "Reconciled",
        description: isMock
          ? "This mock scenario represents a matched reconciliation between a synthetic transaction and settlement record — no real Arc Testnet transaction exists."
          : reconciliation?.result === "MATCHED"
            ? "The confirmed Arc Testnet transaction and the internal settlement record match exactly. This release is closed out."
            : "Reconciliation is recorded but did not match — this requires manual review before it can close out.",
      };
    default:
      return null;
  }
}

const TONE_CLASSES: Record<CalloutConfig["tone"], string> = {
  warning: "border-warning/40 bg-warning/10 text-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-foreground",
  success: "border-success/40 bg-success/10 text-foreground",
};

const ICON_TONE_CLASSES: Record<CalloutConfig["tone"], string> = {
  warning: "text-warning",
  destructive: "text-destructive",
  success: "text-success",
};

interface LifecycleCalloutProps {
  state: ReleaseLifecycleState;
  reconciliation: ReconciliationRecord | null;
  isMock: boolean;
}

/**
 * Makes pending and failure states impossible to miss, not just implied by a
 * badge (AGENTS.md UI rules). Copy must not claim a real Arc Testnet
 * broadcast/confirmation for mock data — the MOCK badge elsewhere on the
 * page does not license an unconditional protocol claim in this text.
 */
export function LifecycleCallout({ state, reconciliation, isMock }: LifecycleCalloutProps) {
  const config = calloutFor(state, reconciliation, isMock);
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      role={config.tone === "destructive" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", TONE_CLASSES[config.tone])}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", ICON_TONE_CLASSES[config.tone])} />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{config.title}</span>
        <span className="text-sm text-muted-foreground">{config.description}</span>
      </div>
    </div>
  );
}
