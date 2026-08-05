import { CheckCircle2 } from "lucide-react";

import type { MilestoneRequirement } from "@proofspend/domain";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format-money";

interface RequirementChecklistProps {
  requirements: MilestoneRequirement[];
  satisfiedRequirementIds: Set<string>;
}

function requirementDetail(requirement: MilestoneRequirement): string | null {
  if (requirement.kind === "EXPENSE_RECORDS") return `${requirement.requiredCount} records required`;
  if (requirement.kind === "SPEND_LIMIT") return `Limit: ${formatMoney(requirement.spendLimit)}`;
  return null;
}

/** Screen 1 supporting element: milestone requirement checklist with pass/pending state. */
export function RequirementChecklist({ requirements, satisfiedRequirementIds }: RequirementChecklistProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Milestone requirements</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {requirements.map((requirement) => {
            const satisfied = satisfiedRequirementIds.has(requirement.id);
            const detail = requirementDetail(requirement);
            return (
              <li key={requirement.id} className="flex items-start gap-3">
                <span
                  className={
                    satisfied
                      ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
                      : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-border"
                  }
                  aria-hidden="true"
                >
                  {satisfied && <CheckCircle2 className="size-4" />}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-foreground">{requirement.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {satisfied ? "Satisfied" : "Pending"}
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
