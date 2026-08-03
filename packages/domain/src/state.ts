import type { Actor, AgenticJobStatus, AuditEvent } from "./models";

export class InvalidTransitionError extends Error {
  constructor(readonly machine: string, readonly from: string, readonly to: string) {
    super(`Invalid ${machine} transition from ${from} to ${to}.`); this.name = "InvalidTransitionError";
  }
}
export type ProofSpendApplicationState = "INCOMPLETE" | "NEEDS_REVIEW" | "ELIGIBLE" | "APPROVAL_PENDING" | "APPROVED" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "REJECTED" | "FAILED" | "RECONCILED";
const applicationTransitions: Record<ProofSpendApplicationState, readonly ProofSpendApplicationState[]> = {
  INCOMPLETE: ["NEEDS_REVIEW"], NEEDS_REVIEW: ["INCOMPLETE", "ELIGIBLE", "REJECTED"], ELIGIBLE: ["APPROVAL_PENDING"],
  APPROVAL_PENDING: ["APPROVED", "REJECTED"], APPROVED: ["PREPARED"], PREPARED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["CONFIRMED", "FAILED"], CONFIRMED: ["RECONCILED"], REJECTED: [], FAILED: [], RECONCILED: [],
};
const jobTransitions: Record<AgenticJobStatus, readonly AgenticJobStatus[]> = {
  OPEN: ["FUNDED", "EXPIRED"], FUNDED: ["SUBMITTED", "EXPIRED"], SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED"],
  COMPLETED: [], REJECTED: [], EXPIRED: [],
};
export interface TransitionContext { aggregateType: string; aggregateId: string; eventId: string; occurredAt: string; actor: Actor; authorizedActorId?: string; authorizedEvaluatorId?: string; idempotencyKey?: string }
function event(context: TransitionContext, from: string, to: string): AuditEvent {
  return { id: context.eventId, aggregateType: context.aggregateType, aggregateId: context.aggregateId, eventType: "STATE_TRANSITIONED", actor: context.actor, idempotencyKey: context.idempotencyKey ?? null, occurredAt: context.occurredAt, details: { from, to } };
}
export function transitionApplication(from: ProofSpendApplicationState, to: ProofSpendApplicationState, context: TransitionContext) {
  if (!applicationTransitions[from].includes(to)) throw new InvalidTransitionError("ProofSpend application", from, to);
  if (from === "APPROVAL_PENDING" && to === "APPROVED" && (!(context.actor.actorType === "FOUNDER" || context.actor.actorType === "EVALUATOR") || context.actor.actorId !== context.authorizedActorId)) throw new InvalidTransitionError("ProofSpend application authority", from, to);
  if (from === "PREPARED" && to === "SUBMITTED" && (context.actor.actorType !== "ADAPTER" || context.actor.actorId !== context.authorizedActorId)) throw new InvalidTransitionError("ProofSpend application authority", from, to);
  return { state: to, auditEvent: event(context, from, to) } as const;
}
export function transitionAgenticJob(from: AgenticJobStatus, to: AgenticJobStatus, context: TransitionContext) {
  if (!jobTransitions[from].includes(to)) throw new InvalidTransitionError("agentic job", from, to);
  if (from === "SUBMITTED" && (to === "COMPLETED" || to === "REJECTED") && (context.actor.actorType !== "EVALUATOR" || context.actor.actorId !== context.authorizedEvaluatorId)) throw new InvalidTransitionError("agentic job authority", from, to);
  return { status: to, auditEvent: event(context, from, to) } as const;
}
export function mapAgenticJobToApplication(status: AgenticJobStatus): ProofSpendApplicationState | null {
  if (status === "COMPLETED") return "CONFIRMED";
  if (status === "REJECTED" || status === "EXPIRED") return "REJECTED";
  return null;
}
