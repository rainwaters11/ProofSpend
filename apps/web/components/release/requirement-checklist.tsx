import { CircleHelp } from "lucide-react";

import type { MilestoneRequirement } from "@proofspend/domain";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format-money";

interface RequirementChecklistProps {
  requirements: MilestoneRequirement[];
}

function requirementDetail(requirement: MilestoneRequirement): string | null {
  if (requirement.kind === "EXPENSE_RECORDS") return `${requirement.requiredCount} records required`;
  if (requirement.kind === "SPEND_LIMIT") return `Limit: ${formatMoney(requirement.spendLimit)}`;
  return null;
}

/**
 * Screen 1 supporting element: milestone requirement checklist. Deterministic
 * PASS/REVIEW/FAIL policy evaluation is the Milestone Engine's job (Issue
 * #4, still open) — this demo has no policy result to show, so every
 * requirement renders as explicitly unresolved rather than fabricating a
 * "Satisfied" claim from evidence existence alone (AGENTS.md: show exactly
 * why requirements are PASS, REVIEW, or FAIL).
 */
export function RequirementChecklist({ requirements }: RequirementChecklistProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestone requirements</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {requirements.map((requirement) => {
            const detail = requirementDetail(requirement);
            return (
              <li key={requirement.id} className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground"
                  aria-hidden="true"
                >
                  <CircleHelp className="size-3.5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-foreground">{requirement.description}</span>
                  <span className="text-xs text-muted-foreground">
                    Not yet evaluated — Milestone Engine (#4) not connected
                    {detail ? ` · ${detail}` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
