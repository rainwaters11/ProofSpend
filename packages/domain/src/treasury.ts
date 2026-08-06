import { z } from "zod";
import { type MoneyAmount, AtomicUnitsSchema, addMoney, money, subtractMoney } from "./money";
import {
  ActorSchema,
  AgenticJobRefSchema,
  ApprovalRecordSchema,
  ArcTransactionRefSchema,
  AuditEventSchema,
  LAUNCHVAULT_SETTLEMENT_ASSET,
  LaunchVaultSchema,
  LedgerEntrySchema,
  type Actor,
  type ApprovalRecord,
  type ArcTransactionRef,
  type AuditEvent,
  type LaunchVault,
  type LedgerEntry,
  type Reserve,
  ReserveSchema,
  SettlementMoneyAmountSchema,
} from "./models";
import { InMemoryIdempotencyRepository } from "./repositories";

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IdSchema = z.string().min(1);
type SettlementAmount = z.infer<typeof SettlementMoneyAmountSchema>;

export const TreasuryAllocationRoundingPolicy =
  "Percentage allocations use integer atomic units: floor each percentage share, then distribute remaining units one-by-one by largest remainder (tie-breaker: reserveId ascending).";

export class TreasuryError extends Error {
  constructor(
    readonly code:
      | "INVALID_STATE"
      | "ASSET_MISMATCH"
      | "INSUFFICIENT_AVAILABLE"
      | "PERCENTAGE_OVER_100"
      | "PROPOSAL_ALTERED"
      | "APPROVAL_MISMATCH"
      | "UNSUPPORTED_ASSET"
      | "UNDERFLOW"
      | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
    this.name = "TreasuryError";
  }
}

const FixedAllocationInstructionSchema = z.object({
  reserveId: IdSchema,
  kind: z.literal("FIXED"),
  atomicUnits: AtomicUnitsSchema,
});
const PercentageAllocationInstructionSchema = z.object({
  reserveId: IdSchema,
  kind: z.literal("PERCENTAGE"),
  basisPoints: z.number().int().min(0).max(10_000),
});
export const AllocationInstructionSchema = z.discriminatedUnion("kind", [
  FixedAllocationInstructionSchema,
  PercentageAllocationInstructionSchema,
]);
export type AllocationInstruction = z.infer<typeof AllocationInstructionSchema>;

export const ResolvedAllocationSchema = z.object({ reserveId: IdSchema, amount: SettlementMoneyAmountSchema });
export type ResolvedAllocation = z.infer<typeof ResolvedAllocationSchema>;

export const AllocationProposalSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  vaultId: IdSchema,
  asset: z.literal(LAUNCHVAULT_SETTLEMENT_ASSET),
  status: z.enum(["PROPOSED", "APPROVED", "APPLIED"]),
  instructions: z.array(AllocationInstructionSchema).min(1),
  resolvedAllocations: z.array(ResolvedAllocationSchema).min(1),
  sourceJobRef: AgenticJobRefSchema.nullable(),
  settlementTransactionRef: ArcTransactionRefSchema.nullable(),
  approvalId: IdSchema.nullable(),
  approvedIntentHash: HashSchema.nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  appliedAt: z.string().datetime().nullable(),
});
export type AllocationProposal = z.infer<typeof AllocationProposalSchema>;

export const IncomingTrancheSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  vaultId: IdSchema,
  amount: SettlementMoneyAmountSchema,
  transactionRef: ArcTransactionRefSchema,
  sourceJobRef: AgenticJobRefSchema.nullable(),
  state: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "RECONCILED"]),
  reconciledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type IncomingTranche = z.infer<typeof IncomingTrancheSchema>;

export interface TreasurySnapshot {
  vault: LaunchVault;
  reserves: Reserve[];
  proposals: AllocationProposal[];
  incomingTranches: IncomingTranche[];
  ledger: LedgerEntry[];
  audit: AuditEvent[];
  balances: {
    confirmed: MoneyAmount;
    escrowed: MoneyAmount;
    available: MoneyAmount;
    allocated: MoneyAmount;
    unallocated: MoneyAmount;
  };
}

function amount(asset: string, atomicUnits: string): SettlementAmount {
  return SettlementMoneyAmountSchema.parse(money(asset, atomicUnits));
}
function addSettlement(left: SettlementAmount, right: SettlementAmount): SettlementAmount {
  return SettlementMoneyAmountSchema.parse(addMoney(left, right));
}
function subtractSettlement(left: SettlementAmount, right: SettlementAmount): SettlementAmount {
  return SettlementMoneyAmountSchema.parse(subtractMoney(left, right));
}

function createIntentPayload(proposal: AllocationProposal): string {
  const sorted = [...proposal.resolvedAllocations].sort((a, b) => a.reserveId.localeCompare(b.reserveId));
  return JSON.stringify([
    1,
    proposal.projectId,
    proposal.vaultId,
    proposal.id,
    proposal.asset,
    sorted.map((entry) => [entry.reserveId, entry.amount.atomicUnits]),
  ]);
}

export async function hashAllocationProposalIntent(proposal: AllocationProposal): Promise<string> {
  const parsed = AllocationProposalSchema.parse(proposal);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(createIntentPayload(parsed)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function event(input: {
  id: string;
  aggregateId: string;
  actor: Actor;
  occurredAt: string;
  idempotencyKey: string | null;
  previousState: string;
  nextState: string;
  relatedProposalId?: string | null;
  relatedTrancheId?: string | null;
  relatedTransactionHash?: string | null;
}): AuditEvent {
  return AuditEventSchema.parse({
    id: input.id,
    aggregateType: "launchvault-treasury",
    aggregateId: input.aggregateId,
    eventType: "STATE_TRANSITIONED",
    actor: ActorSchema.parse(input.actor),
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
    details: {
      previousState: input.previousState,
      nextState: input.nextState,
      proposalId: input.relatedProposalId ?? null,
      trancheId: input.relatedTrancheId ?? null,
      transactionHash: input.relatedTransactionHash ?? null,
    },
  });
}

function toBigInt(value: string): bigint {
  return BigInt(AtomicUnitsSchema.parse(value));
}

function resolveAllocations(params: {
  budgetAtomicUnits: string;
  instructions: AllocationInstruction[];
  reserveIds: Set<string>;
}): ResolvedAllocation[] {
  const instructions = params.instructions.map((instruction) => AllocationInstructionSchema.parse(instruction));
  const budget = toBigInt(params.budgetAtomicUnits);
  const totals = new Map<string, bigint>();
  let fixedTotal = 0n;
  let percentageTotal = 0;

  for (const instruction of instructions) {
    if (!params.reserveIds.has(instruction.reserveId)) throw new TreasuryError("INVALID_STATE", `Unknown reserve ${instruction.reserveId}.`);
    if (instruction.kind === "FIXED") {
      const value = toBigInt(instruction.atomicUnits);
      fixedTotal += value;
      totals.set(instruction.reserveId, (totals.get(instruction.reserveId) ?? 0n) + value);
    } else {
      percentageTotal += instruction.basisPoints;
    }
  }

  if (percentageTotal > 10_000) throw new TreasuryError("PERCENTAGE_OVER_100", "Percentage allocation cannot exceed 100%.");
  if (fixedTotal > budget) throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Fixed allocations exceed available confirmed funds.");

  const percentageBudget = budget - fixedTotal;
  const percentageInstructions = instructions
    .filter((instruction): instruction is z.infer<typeof PercentageAllocationInstructionSchema> => instruction.kind === "PERCENTAGE")
    .map((instruction) => {
      const numerator = percentageBudget * BigInt(instruction.basisPoints);
      return {
        reserveId: instruction.reserveId,
        floor: numerator / 10_000n,
        remainder: numerator % 10_000n,
      };
    });

  let consumedByPercentages = 0n;
  for (const allocation of percentageInstructions) {
    consumedByPercentages += allocation.floor;
    totals.set(allocation.reserveId, (totals.get(allocation.reserveId) ?? 0n) + allocation.floor);
  }

  const percentageTarget = (percentageBudget * BigInt(percentageTotal)) / 10_000n;
  let remaining = percentageTarget - consumedByPercentages;
  const remainderOrder = [...percentageInstructions].sort((left, right) =>
    right.remainder === left.remainder ? left.reserveId.localeCompare(right.reserveId) : right.remainder > left.remainder ? 1 : -1,
  );
  for (const target of remainderOrder) {
    if (remaining <= 0n) break;
    totals.set(target.reserveId, (totals.get(target.reserveId) ?? 0n) + 1n);
    remaining -= 1n;
  }

  const resolved = [...totals.entries()]
    .map(([reserveId, atomic]) => ({ reserveId, amount: amount(LAUNCHVAULT_SETTLEMENT_ASSET, atomic.toString()) }))
    .sort((left, right) => left.reserveId.localeCompare(right.reserveId));

  if (resolved.length === 0) throw new TreasuryError("INVALID_STATE", "Allocation proposal must resolve at least one reserve.");

  return resolved.map((entry) => ResolvedAllocationSchema.parse(entry));
}

export class LaunchVaultTreasury {
  readonly #idempotency = new InMemoryIdempotencyRepository();

  #vault: LaunchVault;
  #reserves: Reserve[];
  #proposals = new Map<string, AllocationProposal>();
  #incomingTranches = new Map<string, IncomingTranche>();
  #ledger: LedgerEntry[];
  #audit: AuditEvent[];
  #confirmed: SettlementAmount;
  #escrowed: SettlementAmount;

  constructor(input: { vault: LaunchVault; reserves: Reserve[]; actor: Actor }) {
    this.#vault = LaunchVaultSchema.parse(input.vault);
    if (this.#vault.asset !== LAUNCHVAULT_SETTLEMENT_ASSET) throw new TreasuryError("UNSUPPORTED_ASSET", `Unsupported treasury asset ${this.#vault.asset}.`);
    this.#reserves = input.reserves.map((reserve) => {
      const parsed = ReserveSchema.parse(reserve);
      if (parsed.vaultId !== this.#vault.id) throw new TreasuryError("INVALID_STATE", `Reserve ${parsed.id} belongs to another vault.`);
      return { ...parsed, allocated: amount(this.#vault.asset, "0"), status: "PROPOSED" as const };
    });
    this.#confirmed = amount(this.#vault.asset, this.#vault.totalCapital.atomicUnits);
    this.#escrowed = amount(this.#vault.asset, "0");
    this.#ledger = [
      LedgerEntrySchema.parse({
        id: "ledger:seed-capital",
        kind: "CAPITAL",
        vaultId: this.#vault.id,
        reserveId: null,
        amount: amount(this.#vault.asset, this.#vault.totalCapital.atomicUnits),
        idempotencyKey: "seed:capital",
        occurredAt: this.#vault.createdAt,
        reversesEntryId: null,
      }),
    ];
    this.#audit = [
      event({
        id: "audit:treasury-initialized",
        aggregateId: this.#vault.id,
        actor: input.actor,
        occurredAt: this.#vault.createdAt,
        idempotencyKey: null,
        previousState: "NONE",
        nextState: "INITIALIZED",
      }),
    ];
  }

  getSnapshot(): TreasurySnapshot {
    const allocated = this.#reserves.reduce<SettlementAmount>((total, reserve) => addSettlement(total, reserve.allocated), amount(this.#vault.asset, "0"));
    if (toBigInt(allocated.atomicUnits) + toBigInt(this.#escrowed.atomicUnits) > toBigInt(this.#confirmed.atomicUnits)) throw new TreasuryError("UNDERFLOW", "Allocated and escrowed capital cannot exceed confirmed capital.");
    const available = subtractSettlement(this.#confirmed, this.#escrowed);
    const unallocated = subtractSettlement(available, allocated);
    return {
      vault: structuredClone(this.#vault),
      reserves: structuredClone(this.#reserves),
      proposals: [...this.#proposals.values()].map((proposal) => structuredClone(proposal)),
      incomingTranches: [...this.#incomingTranches.values()].map((tranche) => structuredClone(tranche)),
      ledger: this.#ledger.map((entry) => structuredClone(entry)),
      audit: this.#audit.map((record) => structuredClone(record)),
      balances: {
        confirmed: structuredClone(this.#confirmed),
        escrowed: structuredClone(this.#escrowed),
        available,
        allocated,
        unallocated,
      },
    };
  }

  async recordEscrowedCapital(input: { amount: MoneyAmount; actor: Actor; idempotencyKey: string; eventId: string; occurredAt: string }): Promise<void> {
    const escrowAmount = SettlementMoneyAmountSchema.parse(input.amount);
    if (escrowAmount.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Escrow asset mismatch.");
    const fingerprint = JSON.stringify([this.#vault.id, escrowAmount.atomicUnits]);
    await this.#idempotency.execute("escrow-record", input.idempotencyKey, fingerprint, () => {
      if (toBigInt(addSettlement(this.#escrowed, escrowAmount).atomicUnits) > toBigInt(this.#confirmed.atomicUnits)) throw new TreasuryError("UNDERFLOW", "Escrowed capital cannot exceed confirmed capital.");
      this.#escrowed = addSettlement(this.#escrowed, escrowAmount);
      this.#ledger.push(
        LedgerEntrySchema.parse({
          id: `ledger:escrow:${input.eventId}`,
          kind: "COMMITMENT",
          vaultId: this.#vault.id,
          reserveId: null,
          amount: escrowAmount,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          reversesEntryId: null,
        }),
      );
      this.#audit.push(
        event({
          id: input.eventId,
          aggregateId: this.#vault.id,
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          previousState: "AVAILABLE",
          nextState: "ESCROWED",
        }),
      );
      return true;
    });
  }

  async releaseEscrowedCapital(input: { amount: MoneyAmount; actor: Actor; idempotencyKey: string; eventId: string; occurredAt: string; reversesEntryId?: string }): Promise<void> {
    const releaseAmount = SettlementMoneyAmountSchema.parse(input.amount);
    if (releaseAmount.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Escrow release asset mismatch.");
    const fingerprint = JSON.stringify([this.#vault.id, releaseAmount.atomicUnits, input.reversesEntryId ?? null]);
    await this.#idempotency.execute("escrow-release", input.idempotencyKey, fingerprint, () => {
      if (toBigInt(releaseAmount.atomicUnits) > toBigInt(this.#escrowed.atomicUnits)) throw new TreasuryError("UNDERFLOW", "Escrow release exceeds escrowed capital.");
      const matchingCommitmentId =
        input.reversesEntryId ??
        [...this.#ledger].reverse().find((entry) => entry.kind === "COMMITMENT" && entry.amount.atomicUnits === releaseAmount.atomicUnits)?.id ??
        null;
      if (matchingCommitmentId === null) throw new TreasuryError("INVALID_TRANSITION", "Escrow release must reference an existing escrow commitment.");
      this.#escrowed = subtractSettlement(this.#escrowed, releaseAmount);
      this.#ledger.push(
        LedgerEntrySchema.parse({
          id: `ledger:escrow-release:${input.eventId}`,
          kind: "REVERSAL",
          vaultId: this.#vault.id,
          reserveId: null,
          amount: releaseAmount,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          reversesEntryId: matchingCommitmentId,
        }),
      );
      this.#audit.push(
        event({
          id: input.eventId,
          aggregateId: this.#vault.id,
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          previousState: "ESCROWED",
          nextState: "AVAILABLE",
        }),
      );
      return true;
    });
  }

  createAllocationProposal(input: {
    proposalId: string;
    instructions: AllocationInstruction[];
    actor: Actor;
    eventId: string;
    occurredAt: string;
    sourceJobRef?: z.infer<typeof AgenticJobRefSchema> | null;
    settlementTransactionRef?: ArcTransactionRef | null;
  }): AllocationProposal {
    if (this.#proposals.has(input.proposalId)) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} already exists.`);
    const sourceJobRef = input.sourceJobRef === undefined ? null : AgenticJobRefSchema.parse(input.sourceJobRef);
    const settlementTransactionRef = input.settlementTransactionRef === undefined ? null : ArcTransactionRefSchema.parse(input.settlementTransactionRef);
    if (settlementTransactionRef !== null && settlementTransactionRef.status !== "CONFIRMED") throw new TreasuryError("INVALID_TRANSITION", "Allocation proposals may reference only confirmed settlement transactions.");
    if (sourceJobRef !== null && settlementTransactionRef === null) throw new TreasuryError("INVALID_TRANSITION", "Job-linked allocation proposals require a confirmed settlement transaction.");

    const unallocated = this.getSnapshot().balances.unallocated;
    const resolved = resolveAllocations({
      budgetAtomicUnits: unallocated.atomicUnits,
      instructions: input.instructions,
      reserveIds: new Set(this.#reserves.map((reserve) => reserve.id)),
    });
    const proposal = AllocationProposalSchema.parse({
      id: input.proposalId,
      projectId: this.#vault.projectId,
      vaultId: this.#vault.id,
      asset: this.#vault.asset,
      status: "PROPOSED",
      instructions: input.instructions,
      resolvedAllocations: resolved,
      sourceJobRef,
      settlementTransactionRef,
      approvalId: null,
      approvedIntentHash: null,
      createdAt: input.occurredAt,
      approvedAt: null,
      appliedAt: null,
    });
    this.#proposals.set(proposal.id, proposal);
    this.#audit.push(
      event({
        id: input.eventId,
        aggregateId: proposal.id,
        actor: input.actor,
        occurredAt: input.occurredAt,
        idempotencyKey: null,
        previousState: "NONE",
        nextState: proposal.status,
        relatedProposalId: proposal.id,
      }),
    );
    return structuredClone(proposal);
  }

  async approveAllocationProposal(input: {
    proposalId: string;
    approval: ApprovalRecord;
    actor: Actor;
    eventId: string;
    occurredAt: string;
  }): Promise<AllocationProposal> {
    const proposal = this.#proposals.get(input.proposalId);
    if (proposal === undefined) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} does not exist.`);
    const approval = ApprovalRecordSchema.parse(input.approval);
    const fingerprint = JSON.stringify([proposal.id, approval.id, approval.exactIntentHash, approval.idempotencyKey]);
    return this.#idempotency.execute("allocation-approve", approval.idempotencyKey, fingerprint, async () => {
      const current = this.#proposals.get(input.proposalId);
      if (current === undefined) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} does not exist.`);
      if (current.status !== "PROPOSED") throw new TreasuryError("INVALID_STATE", `Only PROPOSED allocations may be approved; current state is ${current.status}.`);
      if (
        approval.aggregateId !== current.id ||
        approval.actionKind !== "RELEASE_APPROVAL" ||
        approval.authorizedActorType !== "FOUNDER" ||
        approval.authorizedActorId !== input.actor.actorId ||
        approval.decision !== "APPROVED" ||
        approval.approver?.actorType !== "FOUNDER" ||
        approval.approver.actorId !== input.actor.actorId
      ) {
        throw new TreasuryError("APPROVAL_MISMATCH", "Allocation approval must be an exact founder-approved RELEASE_APPROVAL for this proposal.");
      }
      const expiresAt = Date.parse(approval.expiresAt);
      const occurredAt = Date.parse(input.occurredAt);
      if (!Number.isFinite(expiresAt) || !Number.isFinite(occurredAt) || expiresAt <= occurredAt) throw new TreasuryError("INVALID_STATE", "Allocation approval is expired.");
      const expectedHash = await hashAllocationProposalIntent(current);
      if (approval.exactIntentHash !== expectedHash) throw new TreasuryError("APPROVAL_MISMATCH", "Approval hash does not match the exact allocation proposal.");
      const approved = AllocationProposalSchema.parse({
        ...current,
        status: "APPROVED",
        approvalId: approval.id,
        approvedIntentHash: expectedHash,
        approvedAt: input.occurredAt,
      });
      this.#proposals.set(approved.id, approved);
      this.#audit.push(
        event({
          id: input.eventId,
          aggregateId: approved.id,
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: approval.idempotencyKey,
          previousState: current.status,
          nextState: approved.status,
          relatedProposalId: approved.id,
        }),
      );
      return structuredClone(approved);
    });
  }

  async applyApprovedProposal(input: {
    proposalId: string;
    actor: Actor;
    idempotencyKey: string;
    eventId: string;
    occurredAt: string;
  }): Promise<AllocationProposal> {
    const proposal = this.#proposals.get(input.proposalId);
    if (proposal === undefined) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} does not exist.`);
    const fingerprint = JSON.stringify([
      proposal.id,
      proposal.approvalId,
      proposal.approvedIntentHash,
      proposal.resolvedAllocations.map((entry) => [entry.reserveId, entry.amount.atomicUnits]),
    ]);

    return this.#idempotency.execute("allocation-apply", input.idempotencyKey, fingerprint, async () => {
      const current = this.#proposals.get(input.proposalId);
      if (current === undefined) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} does not exist.`);
      if (current.status !== "APPROVED") throw new TreasuryError("INVALID_STATE", `Only APPROVED allocations may be applied; current state is ${current.status}.`);
      if (current.approvalId === null || current.approvedIntentHash === null) throw new TreasuryError("INVALID_STATE", "Approved proposal is missing approval evidence.");
      const expectedHash = await hashAllocationProposalIntent(current);
      if (current.approvedIntentHash !== expectedHash) throw new TreasuryError("PROPOSAL_ALTERED", "Approved allocation proposal no longer matches its approved intent.");

      const total = current.resolvedAllocations.reduce<SettlementAmount>((sum, entry) => addSettlement(sum, entry.amount), amount(this.#vault.asset, "0"));
      const balances = this.getSnapshot().balances;
      if (total.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Allocation asset mismatch.");
      if (toBigInt(total.atomicUnits) > toBigInt(balances.unallocated.atomicUnits)) {
        throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Allocation exceeds unallocated confirmed funds.");
      }

      for (const entry of current.resolvedAllocations) {
        const reserveIndex = this.#reserves.findIndex((reserve) => reserve.id === entry.reserveId);
        if (reserveIndex < 0) throw new TreasuryError("INVALID_STATE", `Reserve ${entry.reserveId} does not exist.`);
        const reserve = this.#reserves[reserveIndex]!;
        this.#reserves[reserveIndex] = ReserveSchema.parse({
          ...reserve,
          allocated: addSettlement(reserve.allocated, entry.amount),
          status: "ACTIVE",
        });
        this.#ledger.push(
          LedgerEntrySchema.parse({
            id: `ledger:allocation:${current.id}:${entry.reserveId}`,
            kind: "ALLOCATION",
            vaultId: this.#vault.id,
            reserveId: entry.reserveId,
            amount: entry.amount,
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.occurredAt,
            reversesEntryId: null,
          }),
        );
      }

      const applied = AllocationProposalSchema.parse({ ...current, status: "APPLIED", appliedAt: input.occurredAt });
      this.#proposals.set(applied.id, applied);
      this.#audit.push(
        event({
          id: input.eventId,
          aggregateId: applied.id,
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          previousState: current.status,
          nextState: applied.status,
          relatedProposalId: applied.id,
        }),
      );
      return structuredClone(applied);
    });
  }

  recordIncomingTranche(input: {
    trancheId: string;
    amount: MoneyAmount;
    transactionRef: ArcTransactionRef;
    actor: Actor;
    eventId: string;
    occurredAt: string;
    sourceJobRef?: z.infer<typeof AgenticJobRefSchema> | null;
  }): IncomingTranche {
    const amountValue = SettlementMoneyAmountSchema.parse(input.amount);
    if (amountValue.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Incoming tranche asset mismatch.");
    const transactionRef = ArcTransactionRefSchema.parse(input.transactionRef);
    const sourceJobRef = input.sourceJobRef === undefined ? null : AgenticJobRefSchema.parse(input.sourceJobRef);
    const state = transactionRef.status === "CONFIRMED" ? "CONFIRMED" : "PENDING_CONFIRMATION";
    const current = this.#incomingTranches.get(input.trancheId);
    if (current !== undefined && current.state === "RECONCILED") throw new TreasuryError("INVALID_STATE", "Reconciled tranches cannot be modified.");
    if (current !== undefined && current.amount.atomicUnits !== amountValue.atomicUnits) throw new TreasuryError("INVALID_STATE", "Tranche amount cannot be altered.");

    const tranche = IncomingTrancheSchema.parse({
      id: input.trancheId,
      projectId: this.#vault.projectId,
      vaultId: this.#vault.id,
      amount: amountValue,
      transactionRef,
      sourceJobRef,
      state,
      reconciledAt: null,
      createdAt: current?.createdAt ?? input.occurredAt,
    });
    this.#incomingTranches.set(tranche.id, tranche);
    this.#audit.push(
      event({
        id: input.eventId,
        aggregateId: tranche.id,
        actor: input.actor,
        occurredAt: input.occurredAt,
        idempotencyKey: null,
        previousState: current?.state ?? "NONE",
        nextState: tranche.state,
        relatedTrancheId: tranche.id,
        relatedTransactionHash: tranche.transactionRef.transactionHash,
      }),
    );
    return structuredClone(tranche);
  }

  async reconcileConfirmedTranche(input: {
    trancheId: string;
    actor: Actor;
    idempotencyKey: string;
    eventId: string;
    occurredAt: string;
  }): Promise<IncomingTranche> {
    const tranche = this.#incomingTranches.get(input.trancheId);
    if (tranche === undefined) throw new TreasuryError("INVALID_STATE", `Tranche ${input.trancheId} does not exist.`);
    const fingerprint = JSON.stringify([tranche.id, tranche.amount.atomicUnits, tranche.transactionRef.transactionHash]);

    return this.#idempotency.execute("tranche-reconcile", input.idempotencyKey, fingerprint, () => {
      const current = this.#incomingTranches.get(input.trancheId);
      if (current === undefined) throw new TreasuryError("INVALID_STATE", `Tranche ${input.trancheId} does not exist.`);
      if (current.state !== "CONFIRMED") throw new TreasuryError("INVALID_TRANSITION", "Only CONFIRMED tranches can be reconciled.");
      this.#confirmed = addSettlement(this.#confirmed, current.amount);
      const reconciled = IncomingTrancheSchema.parse({ ...current, state: "RECONCILED", reconciledAt: input.occurredAt });
      this.#incomingTranches.set(reconciled.id, reconciled);
      this.#ledger.push(
        LedgerEntrySchema.parse({
          id: `ledger:tranche:${reconciled.id}`,
          kind: "SETTLEMENT",
          vaultId: this.#vault.id,
          reserveId: null,
          amount: reconciled.amount,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          reversesEntryId: null,
        }),
      );
      this.#audit.push(
        event({
          id: input.eventId,
          aggregateId: reconciled.id,
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          previousState: current.state,
          nextState: reconciled.state,
          relatedTrancheId: reconciled.id,
          relatedTransactionHash: reconciled.transactionRef.transactionHash,
        }),
      );
      return structuredClone(reconciled);
    });
  }
}
