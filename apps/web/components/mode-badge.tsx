import { FlaskConical, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type AdapterMode = "mock" | "arc-testnet";

interface ModeBadgeProps {
  mode: AdapterMode;
}

const MODE_CONFIG: Record<AdapterMode, { label: string; icon: typeof FlaskConical }> = {
  mock: { label: "MOCK", icon: FlaskConical },
  "arc-testnet": { label: "ARC TESTNET", icon: Radio },
};

/**
 * Mock and Arc Testnet must never be visually distinguishable by color alone
 * (AGENTS.md UI rules, design.md truthfulness boundaries) — icon and text are
 * always rendered together.
 */
export function ModeBadge({ mode }: ModeBadgeProps) {
  const { label, icon: Icon } = MODE_CONFIG[mode];

  return (
    <Badge variant={mode} aria-label={`Application mode: ${label}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}
