import { z } from "zod";
import { type MoneyAmount, AtomicUnitsSchema, addMoney, money, subtractMoney } from "./money";
import {
  ActorSchema,
  type AgenticJobRef,
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
  sourceTrancheId: IdSchema.nullable(),
  approvalId: IdSchema.nullable(),
  approvedIntentHash: HashSchema.nullable(),
  approvalRecord: ApprovalRecordSchema.nullable(),
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
  state: z.enum(["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"]),
  reconciledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type IncomingTranche = z.infer<typeof IncomingTrancheSchema>;

const TreasuryExecutionAuthoritySchema = z.object({
  actorType: z.enum(["SYSTEM", "ADAPTER"]),
  actorId: IdSchema,
});
type TreasuryExecutionAuthority = z.infer<typeof TreasuryExecutionAuthoritySchema>;
const TreasuryFounderAuthoritySchema = z.object({
  actorType: z.literal("FOUNDER"),
  actorId: IdSchema,
});
type TreasuryFounderAuthority = z.infer<typeof TreasuryFounderAuthoritySchema>;

export interface TreasuryReconciliationInvariant {
  dashboard: {
    totalCapital: MoneyAmount;
    confirmed: MoneyAmount;
    escrowed: MoneyAmount;
    allocated: MoneyAmount;
    available: MoneyAmount;
    unallocated: MoneyAmount;
  };
  ledger: {
    totalCapital: MoneyAmount;
    confirmed: MoneyAmount;
    escrowed: MoneyAmount;
    allocated: MoneyAmount;
    available: MoneyAmount;
    unallocated: MoneyAmount;
  };
  isConsistent: boolean;
}

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
  const sortedResolved = [...proposal.resolvedAllocations].sort((a, b) => a.reserveId.localeCompare(b.reserveId));
  const sortedInstructions = [...proposal.instructions]
    .map((instruction) => (instruction.kind === "FIXED"
      ? ["FIXED", instruction.reserveId, instruction.atomicUnits]
      : ["PERCENTAGE", instruction.reserveId, instruction.basisPoints.toString()]))
    .sort((a, b) => {
      const reserveOrder = a[1]!.localeCompare(b[1]!);
      if (reserveOrder !== 0) return reserveOrder;
      return a[0]!.localeCompare(b[0]!);
    });
  const sourceJob = proposal.sourceJobRef === null
    ? null
    : {
      standard: proposal.sourceJobRef.standard,
      network: proposal.sourceJobRef.network,
      chainId: proposal.sourceJobRef.chainId,
      contractAddress: proposal.sourceJobRef.contractAddress,
      jobId: proposal.sourceJobRef.jobId,
      status: proposal.sourceJobRef.status,
      transactionHash: proposal.sourceJobRef.transaction?.transactionHash ?? null,
      transactionStatus: proposal.sourceJobRef.transaction?.status ?? null,
    };
  const settlementRef = proposal.settlementTransactionRef === null
    ? null
    : {
      network: proposal.settlementTransactionRef.network,
      chainId: proposal.settlementTransactionRef.chainId,
      transactionHash: proposal.settlementTransactionRef.transactionHash,
      status: proposal.settlementTransactionRef.status,
      operationType: proposal.settlementTransactionRef.operationType,
      isMock: proposal.settlementTransactionRef.isMock,
    };
  return JSON.stringify([
    1,
    proposal.projectId,
    proposal.vaultId,
    proposal.id,
    proposal.asset,
    sortedInstructions,
    sortedResolved.map((entry) => [entry.reserveId, entry.amount.atomicUnits]),
    proposal.sourceTrancheId,
    sourceJob,
    settlementRef,
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
  readonly #executionAuthority: TreasuryExecutionAuthority;
  readonly #founderAuthority: TreasuryFounderAuthority;
  #reserves: Reserve[];
  #proposals = new Map<string, AllocationProposal>();
  #incomingTranches = new Map<string, IncomingTranche>();
  #ledger: LedgerEntry[];
  #audit: AuditEvent[];
  #confirmed: SettlementAmount;
  #escrowed: SettlementAmount;

  constructor(input: { vault: LaunchVault; reserves: Reserve[]; actor: Actor; executionAuthority?: TreasuryExecutionAuthority; founderAuthority?: TreasuryFounderAuthority }) {
    this.#vault = LaunchVaultSchema.parse(input.vault);
    if (this.#vault.asset !== LAUNCHVAULT_SETTLEMENT_ASSET) throw new TreasuryError("UNSUPPORTED_ASSET", `Unsupported treasury asset ${this.#vault.asset}.`);
    const initializingActor = ActorSchema.parse(input.actor);
    const derivedAuthority = input.executionAuthority ?? (
      this.#vault.mode === "MOCK" && (initializingActor.actorType === "SYSTEM" || initializingActor.actorType === "ADAPTER")
        ? { actorType: initializingActor.actorType, actorId: initializingActor.actorId }
        : undefined
    );
    if (derivedAuthority === undefined) {
      throw new TreasuryError("INVALID_STATE", "Treasury execution authority must be explicitly configured for Arc Testnet or non-operator initialization actors.");
    }
    if (this.#vault.mode === "ARC_TESTNET" && derivedAuthority.actorType !== "ADAPTER") {
      throw new TreasuryError("INVALID_STATE", "Arc Testnet treasury execution authority must be an explicit ADAPTER.");
    }
    const derivedFounderAuthority =
      input.founderAuthority ?? (
        initializingActor.actorType === "FOUNDER"
          ? { actorType: "FOUNDER" as const, actorId: initializingActor.actorId }
          : undefined
      );
    if (derivedFounderAuthority === undefined) {
      throw new TreasuryError("INVALID_STATE", "Treasury founder authority must be explicitly configured when initialization actor is not the founder.");
    }
    this.#executionAuthority = TreasuryExecutionAuthoritySchema.parse(derivedAuthority);
    this.#founderAuthority = TreasuryFounderAuthoritySchema.parse(derivedFounderAuthority);
    const reserveIds = new Set<string>();
    this.#reserves = input.reserves.map((reserve) => {
      const parsed = ReserveSchema.parse(reserve);
      if (parsed.vaultId !== this.#vault.id) throw new TreasuryError("INVALID_STATE", `Reserve ${parsed.id} belongs to another vault.`);
      if (reserveIds.has(parsed.id)) throw new TreasuryError("INVALID_STATE", `Reserve ${parsed.id} is defined more than once.`);
      if (parsed.allocated.atomicUnits !== "0" || parsed.status !== "PROPOSED") {
        throw new TreasuryError("INVALID_STATE", `Reserve ${parsed.id} is not an empty PROPOSED definition for fresh treasury initialization.`);
      }
      reserveIds.add(parsed.id);
      return parsed;
    });
    if (this.#vault.mode === "ARC_TESTNET" && this.#vault.totalCapital.atomicUnits !== "0") {
      throw new TreasuryError("INVALID_STATE", "Arc Testnet treasury must start at zero confirmed capital; live settlement credit is deferred to the Circle/Arc integration layer.");
    }
    const initialConfirmedAtomicUnits = this.#vault.mode === "ARC_TESTNET" ? "0" : this.#vault.totalCapital.atomicUnits;
    this.#confirmed = amount(this.#vault.asset, initialConfirmedAtomicUnits);
    this.#escrowed = amount(this.#vault.asset, "0");
    this.#ledger = this.#vault.mode === "ARC_TESTNET"
      ? []
      : [
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
        actor: initializingActor,
        occurredAt: this.#vault.createdAt,
        idempotencyKey: null,
        previousState: "NONE",
        nextState: "INITIALIZED",
      }),
    ];
  }

  #assertAuthorizedOperator(actor: Actor): void {
    if (actor.actorType !== this.#executionAuthority.actorType || actor.actorId !== this.#executionAuthority.actorId) {
      throw new TreasuryError(
        "INVALID_STATE",
        `Treasury operation requires the exact authorized ${this.#executionAuthority.actorType} actor ${this.#executionAuthority.actorId}.`,
      );
    }
  }

  #assertAuthorizedFounder(actor: Actor): void {
    if (actor.actorType !== this.#founderAuthority.actorType || actor.actorId !== this.#founderAuthority.actorId) {
      throw new TreasuryError(
        "INVALID_STATE",
        `Treasury founder approval requires the exact authorized ${this.#founderAuthority.actorType} actor ${this.#founderAuthority.actorId}; received ${actor.actorType} actor ${actor.actorId}.`,
      );
    }
  }

  #jobRefFingerprint(job: AgenticJobRef | null): string | null {
    if (job === null) return null;
    const parsed = AgenticJobRefSchema.parse(job);
    return JSON.stringify([
      parsed.standard,
      parsed.network,
      parsed.chainId,
      parsed.contractAddress,
      parsed.jobId,
      parsed.clientAddress,
      parsed.providerAddress,
      parsed.evaluatorAddress,
      parsed.budget.asset,
      parsed.budget.atomicUnits,
      parsed.expiresAt,
      parsed.descriptionReference,
      parsed.deliverableReference,
      parsed.reasonReference,
      parsed.status,
      parsed.isMock,
      parsed.transaction === null
        ? null
        : [
          parsed.transaction.network,
          parsed.transaction.chainId,
          parsed.transaction.transactionHash,
          parsed.transaction.status,
          parsed.transaction.blockNumber,
          parsed.transaction.blockHash,
          parsed.transaction.explorerUrl,
          parsed.transaction.operationType,
          parsed.transaction.isMock,
        ],
      parsed.escrowTransaction === null
        ? null
        : [
          parsed.escrowTransaction.network,
          parsed.escrowTransaction.chainId,
          parsed.escrowTransaction.transactionHash,
          parsed.escrowTransaction.status,
          parsed.escrowTransaction.blockNumber,
          parsed.escrowTransaction.blockHash,
          parsed.escrowTransaction.explorerUrl,
          parsed.escrowTransaction.operationType,
          parsed.escrowTransaction.isMock,
        ],
    ]);
  }

  #transactionFingerprint(transactionRef: ArcTransactionRef): string {
    const parsed = ArcTransactionRefSchema.parse(transactionRef);
    return JSON.stringify([
      parsed.network,
      parsed.chainId,
      parsed.transactionHash,
      parsed.status,
      parsed.blockNumber,
      parsed.blockHash,
      parsed.explorerUrl,
      parsed.operationType,
      parsed.isMock,
    ]);
  }

  #transactionHashIdentity(transactionHash: string | null): string | null {
    return transactionHash?.toLowerCase() ?? null;
  }

  #computeBalances(input: {
    reserves: readonly Reserve[];
    confirmed: SettlementAmount;
    escrowed: SettlementAmount;
  }): TreasurySnapshot["balances"] {
    const allocated = input.reserves.reduce<SettlementAmount>((total, reserve) => addSettlement(total, reserve.allocated), amount(this.#vault.asset, "0"));
    if (toBigInt(allocated.atomicUnits) + toBigInt(input.escrowed.atomicUnits) > toBigInt(input.confirmed.atomicUnits)) {
      throw new TreasuryError("UNDERFLOW", "Allocated and escrowed capital cannot exceed confirmed capital.");
    }
    const available = subtractSettlement(input.confirmed, input.escrowed);
    const unallocated = subtractSettlement(available, allocated);
    return {
      confirmed: structuredClone(input.confirmed),
      escrowed: structuredClone(input.escrowed),
      available,
      allocated,
      unallocated,
    };
  }

  #deriveLedgerReconciliationInvariant(input: {
    reserves: readonly Reserve[];
    confirmed: SettlementAmount;
    escrowed: SettlementAmount;
    ledger: readonly LedgerEntry[];
    vault: LaunchVault;
  }): TreasuryReconciliationInvariant {
    let ledgerConfirmedAtomic = 0n;
    let ledgerEscrowedAtomic = 0n;
    let ledgerAllocatedAtomic = 0n;
    for (const entry of input.ledger.map((value) => LedgerEntrySchema.parse(value))) {
      const atomic = toBigInt(entry.amount.atomicUnits);
      if (entry.kind === "CAPITAL" || entry.kind === "SETTLEMENT") ledgerConfirmedAtomic += atomic;
      if (entry.kind === "REFUND") ledgerConfirmedAtomic -= atomic;
      if (entry.kind === "COMMITMENT") ledgerEscrowedAtomic += atomic;
      if (entry.kind === "REVERSAL") ledgerEscrowedAtomic -= atomic;
      if (entry.kind === "ALLOCATION") ledgerAllocatedAtomic += atomic;
    }
    const ledgerConfirmed = amount(this.#vault.asset, ledgerConfirmedAtomic.toString());
    const ledgerEscrowed = amount(this.#vault.asset, ledgerEscrowedAtomic.toString());
    const ledgerAllocated = amount(this.#vault.asset, ledgerAllocatedAtomic.toString());
    const ledgerAvailable = subtractSettlement(ledgerConfirmed, ledgerEscrowed);
    const ledgerUnallocated = subtractSettlement(ledgerAvailable, ledgerAllocated);
    const dashboard = this.#computeBalances({ reserves: input.reserves, confirmed: input.confirmed, escrowed: input.escrowed });
    const isConsistent =
      input.vault.totalCapital.atomicUnits === input.confirmed.atomicUnits &&
      ledgerConfirmed.atomicUnits === dashboard.confirmed.atomicUnits &&
      ledgerEscrowed.atomicUnits === dashboard.escrowed.atomicUnits &&
      ledgerAllocated.atomicUnits === dashboard.allocated.atomicUnits &&
      ledgerAvailable.atomicUnits === dashboard.available.atomicUnits &&
      ledgerUnallocated.atomicUnits === dashboard.unallocated.atomicUnits;
    return {
      dashboard: {
        totalCapital: amount(this.#vault.asset, input.vault.totalCapital.atomicUnits),
        confirmed: dashboard.confirmed,
        escrowed: dashboard.escrowed,
        allocated: dashboard.allocated,
        available: dashboard.available,
        unallocated: dashboard.unallocated,
      },
      ledger: {
        totalCapital: ledgerConfirmed,
        confirmed: ledgerConfirmed,
        escrowed: ledgerEscrowed,
        allocated: ledgerAllocated,
        available: ledgerAvailable,
        unallocated: ledgerUnallocated,
      },
      isConsistent,
    };
  }

  getReconciliationInvariant(): TreasuryReconciliationInvariant {
    return structuredClone(this.#deriveLedgerReconciliationInvariant({
      reserves: this.#reserves,
      confirmed: this.#confirmed,
      escrowed: this.#escrowed,
      ledger: this.#ledger,
      vault: this.#vault,
    }));
  }

  getSnapshot(): TreasurySnapshot {
    const balances = this.#computeBalances({ reserves: this.#reserves, confirmed: this.#confirmed, escrowed: this.#escrowed });
    const invariant = this.#deriveLedgerReconciliationInvariant({
      reserves: this.#reserves,
      confirmed: this.#confirmed,
      escrowed: this.#escrowed,
      ledger: this.#ledger,
      vault: this.#vault,
    });
    if (!invariant.isConsistent) throw new TreasuryError("INVALID_STATE", "Vault totals, balances, and ledger entries are inconsistent.");
    return {
      vault: structuredClone(this.#vault),
      reserves: structuredClone(this.#reserves),
      proposals: [...this.#proposals.values()].map((proposal) => structuredClone(proposal)),
      incomingTranches: [...this.#incomingTranches.values()].map((tranche) => structuredClone(tranche)),
      ledger: this.#ledger.map((entry) => structuredClone(entry)),
      audit: this.#audit.map((record) => structuredClone(record)),
      balances,
    };
  }

  async recordEscrowedCapital(input: { amount: MoneyAmount; actor: Actor; idempotencyKey: string; eventId: string; occurredAt: string }): Promise<void> {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedOperator(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
    const escrowAmount = SettlementMoneyAmountSchema.parse(input.amount);
    if (escrowAmount.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Escrow asset mismatch.");
    const fingerprint = JSON.stringify([this.#vault.id, escrowAmount.atomicUnits]);
    await this.#idempotency.execute("escrow-record", input.idempotencyKey, fingerprint, () => {
      const ledgerId = `ledger:escrow:${eventId}`;
      if (this.#audit.some((record) => record.id === eventId)) throw new TreasuryError("INVALID_STATE", `Audit event ${eventId} already exists.`);
      if (this.#ledger.some((entry) => entry.id === ledgerId)) throw new TreasuryError("INVALID_STATE", `Ledger entry ${ledgerId} already exists.`);
      const nextEscrowed = addSettlement(this.#escrowed, escrowAmount);
      const currentAllocated = this.#computeBalances({ reserves: this.#reserves, confirmed: this.#confirmed, escrowed: this.#escrowed }).allocated;
      if (toBigInt(currentAllocated.atomicUnits) + toBigInt(nextEscrowed.atomicUnits) > toBigInt(this.#confirmed.atomicUnits)) {
        throw new TreasuryError("UNDERFLOW", "Escrowed capital cannot exceed unallocated confirmed capital.");
      }
      this.#computeBalances({ reserves: this.#reserves, confirmed: this.#confirmed, escrowed: nextEscrowed });
      const nextLedgerEntry = LedgerEntrySchema.parse({
        id: ledgerId,
        kind: "COMMITMENT",
        vaultId: this.#vault.id,
        reserveId: null,
        amount: escrowAmount,
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        reversesEntryId: null,
      });
      const nextAuditEvent = event({
        id: eventId,
        aggregateId: this.#vault.id,
        actor,
        occurredAt,
        idempotencyKey: input.idempotencyKey,
        previousState: "AVAILABLE",
        nextState: "ESCROWED",
      });
      this.#escrowed = nextEscrowed;
      this.#ledger.push(nextLedgerEntry);
      this.#audit.push(nextAuditEvent);
      return true;
    });
  }

  async releaseEscrowedCapital(input: { amount: MoneyAmount; actor: Actor; idempotencyKey: string; eventId: string; occurredAt: string; reversesEntryId: string }): Promise<void> {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedOperator(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
    const reversesEntryId = IdSchema.parse(input.reversesEntryId);
    const releaseAmount = SettlementMoneyAmountSchema.parse(input.amount);
    if (releaseAmount.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Escrow release asset mismatch.");
    const fingerprint = JSON.stringify([this.#vault.id, releaseAmount.atomicUnits, reversesEntryId]);
    await this.#idempotency.execute("escrow-release", input.idempotencyKey, fingerprint, () => {
      const ledgerId = `ledger:escrow-release:${eventId}`;
      if (this.#audit.some((record) => record.id === eventId)) throw new TreasuryError("INVALID_STATE", `Audit event ${eventId} already exists.`);
      if (this.#ledger.some((entry) => entry.id === ledgerId)) throw new TreasuryError("INVALID_STATE", `Ledger entry ${ledgerId} already exists.`);
      if (toBigInt(releaseAmount.atomicUnits) > toBigInt(this.#escrowed.atomicUnits)) throw new TreasuryError("UNDERFLOW", "Escrow release exceeds escrowed capital.");
      const target = this.#ledger.find((entry) => entry.id === reversesEntryId);
      if (target === undefined) throw new TreasuryError("INVALID_TRANSITION", "Escrow release target does not exist.");
      if (target.kind !== "COMMITMENT") throw new TreasuryError("INVALID_TRANSITION", "Escrow release must reverse a COMMITMENT entry.");
      if (target.vaultId !== this.#vault.id || target.amount.asset !== this.#vault.asset) {
        throw new TreasuryError("INVALID_TRANSITION", "Escrow release target must belong to the same vault and asset.");
      }
      const relatedReversals = this.#ledger.filter((entry) => entry.kind === "REVERSAL" && entry.reversesEntryId === target.id);
      const alreadyReversed = relatedReversals.reduce((total, entry) => total + toBigInt(entry.amount.atomicUnits), 0n);
      const targetAtomic = toBigInt(target.amount.atomicUnits);
      const releaseAtomic = toBigInt(releaseAmount.atomicUnits);
      if (alreadyReversed + releaseAtomic > targetAtomic) throw new TreasuryError("UNDERFLOW", "Escrow release exceeds the remaining commitment amount.");
      const reversalEntry = LedgerEntrySchema.parse({
        id: ledgerId,
        kind: "REVERSAL",
        vaultId: this.#vault.id,
        reserveId: null,
        amount: releaseAmount,
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        reversesEntryId,
      });
      const nextEscrowed = subtractSettlement(this.#escrowed, releaseAmount);
      this.#computeBalances({ reserves: this.#reserves, confirmed: this.#confirmed, escrowed: nextEscrowed });
      const nextAuditEvent = event({
        id: eventId,
        aggregateId: this.#vault.id,
        actor,
        occurredAt,
        idempotencyKey: input.idempotencyKey,
        previousState: "ESCROWED",
        nextState: "AVAILABLE",
      });
      this.#escrowed = nextEscrowed;
      this.#ledger.push(reversalEntry);
      this.#audit.push(nextAuditEvent);
      return true;
    });
  }

  createAllocationProposal(input: {
    proposalId: string;
    instructions: AllocationInstruction[];
    actor: Actor;
    eventId: string;
    occurredAt: string;
    sourceTrancheId?: string | null;
    sourceJobRef?: z.infer<typeof AgenticJobRefSchema> | null;
    settlementTransactionRef?: ArcTransactionRef | null;
  }): AllocationProposal {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedFounder(actor);
    const eventId = IdSchema.parse(input.eventId);
    if (this.#audit.some((record) => record.id === eventId)) throw new TreasuryError("INVALID_STATE", `Audit event ${eventId} already exists.`);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
    if (this.#proposals.has(input.proposalId)) throw new TreasuryError("INVALID_STATE", `Proposal ${input.proposalId} already exists.`);
    const sourceTrancheId = input.sourceTrancheId === undefined || input.sourceTrancheId === null ? null : IdSchema.parse(input.sourceTrancheId);
    const sourceJobRef = input.sourceJobRef == null ? null : AgenticJobRefSchema.parse(input.sourceJobRef);
    const settlementTransactionRef = input.settlementTransactionRef == null ? null : ArcTransactionRefSchema.parse(input.settlementTransactionRef);
    if (settlementTransactionRef !== null && (settlementTransactionRef.status !== "CONFIRMED" || settlementTransactionRef.operationType !== "SETTLEMENT")) {
      throw new TreasuryError("INVALID_TRANSITION", "Allocation proposals may reference only confirmed SETTLEMENT transactions.");
    }
    if (sourceJobRef !== null && settlementTransactionRef === null) throw new TreasuryError("INVALID_TRANSITION", "Job-linked allocation proposals require a confirmed settlement transaction.");
    if (settlementTransactionRef === null && sourceTrancheId !== null) throw new TreasuryError("INVALID_TRANSITION", "Allocation proposal source tranche requires settlement transaction evidence.");
    if (settlementTransactionRef !== null && sourceTrancheId === null) throw new TreasuryError("INVALID_STATE", "Allocation proposal settlement source must include an explicit reconciled tranche ID.");
    if (settlementTransactionRef !== null && settlementTransactionRef.isMock !== (this.#vault.mode === "MOCK")) {
      throw new TreasuryError("INVALID_STATE", "Settlement transaction mock/live mode is incompatible with the treasury vault mode.");
    }
    const linkedTranche = sourceTrancheId === null ? null : this.#incomingTranches.get(sourceTrancheId) ?? null;
    if (settlementTransactionRef !== null && linkedTranche === null) {
      throw new TreasuryError("INVALID_STATE", "Allocation proposal settlement source must reference a persisted reconciled incoming tranche.");
    }
    if (linkedTranche !== null) {
      if (
        linkedTranche.vaultId !== this.#vault.id ||
        linkedTranche.projectId !== this.#vault.projectId ||
        linkedTranche.state !== "RECONCILED"
      ) {
        throw new TreasuryError("INVALID_STATE", "Allocation proposal source tranche must belong to this vault/project and be reconciled.");
      }
      if (settlementTransactionRef === null || this.#transactionFingerprint(linkedTranche.transactionRef) !== this.#transactionFingerprint(settlementTransactionRef)) {
        throw new TreasuryError("INVALID_STATE", "Allocation proposal settlement transaction must exactly match the reconciled source tranche evidence.");
      }
    }
    const canonicalJobRef = linkedTranche?.sourceJobRef ?? null;
    if (sourceJobRef !== null) {
      if (sourceJobRef.isMock !== (this.#vault.mode === "MOCK")) throw new TreasuryError("INVALID_STATE", "Source job mock/live mode is incompatible with the treasury vault mode.");
      if (canonicalJobRef === null) throw new TreasuryError("INVALID_STATE", "Job-linked allocation proposal requires matching tranche job evidence.");
      if (this.#jobRefFingerprint(canonicalJobRef) !== this.#jobRefFingerprint(sourceJobRef)) throw new TreasuryError("INVALID_STATE", "Job-linked allocation proposal source does not match the reconciled tranche.");
    }
    if (canonicalJobRef !== null && sourceJobRef === null) {
      throw new TreasuryError("INVALID_STATE", "Allocation proposal must preserve reconciled tranche job evidence.");
    }
    if (linkedTranche !== null && [...this.#proposals.values()].some((proposal) => proposal.sourceTrancheId === linkedTranche.id)) {
      throw new TreasuryError("INVALID_STATE", `Source tranche ${linkedTranche.id} is already bound to another allocation proposal.`);
    }

    const unallocated = this.getSnapshot().balances.unallocated;
    const instructions = input.instructions.map((instruction) => AllocationInstructionSchema.parse(instruction));
    const sourceBudgetAtomic = linkedTranche === null ? null : toBigInt(linkedTranche.amount.atomicUnits);
    const requestedFixedAtomic = instructions.reduce(
      (total, instruction) => total + (instruction.kind === "FIXED" ? toBigInt(instruction.atomicUnits) : 0n),
      0n,
    );
    if (sourceBudgetAtomic !== null && requestedFixedAtomic > sourceBudgetAtomic) {
      throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Allocation proposal exceeds its source tranche provenance budget.");
    }
    const resolved = resolveAllocations({
      budgetAtomicUnits: linkedTranche?.amount.atomicUnits ?? unallocated.atomicUnits,
      instructions,
      reserveIds: new Set(this.#reserves.map((reserve) => reserve.id)),
    });
    const resolvedTotal = resolved.reduce((total, allocation) => total + toBigInt(allocation.amount.atomicUnits), 0n);
    if (sourceBudgetAtomic !== null && resolvedTotal > sourceBudgetAtomic) {
      throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Allocation proposal exceeds its source tranche provenance budget.");
    }
    if (resolvedTotal > toBigInt(unallocated.atomicUnits)) {
      throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Allocation proposal exceeds available confirmed funds.");
    }
    const proposal = AllocationProposalSchema.parse({
      id: input.proposalId,
      projectId: this.#vault.projectId,
      vaultId: this.#vault.id,
      asset: this.#vault.asset,
      status: "PROPOSED",
      instructions,
      resolvedAllocations: resolved,
      sourceJobRef: canonicalJobRef,
      settlementTransactionRef: linkedTranche?.transactionRef ?? null,
      sourceTrancheId: linkedTranche?.id ?? null,
      approvalId: null,
      approvedIntentHash: null,
      approvalRecord: null,
      createdAt: occurredAt,
      approvedAt: null,
      appliedAt: null,
    });
    const auditRecord = event({
      id: eventId,
      aggregateId: proposal.id,
      actor,
      occurredAt,
      idempotencyKey: null,
      previousState: "NONE",
      nextState: proposal.status,
      relatedProposalId: proposal.id,
    });
    this.#proposals.set(proposal.id, proposal);
    this.#audit.push(auditRecord);
    return structuredClone(proposal);
  }

  async approveAllocationProposal(input: {
    proposalId: string;
    approval: ApprovalRecord;
    actor: Actor;
    eventId: string;
    occurredAt: string;
  }): Promise<AllocationProposal> {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedFounder(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
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
        actor.actorType !== "FOUNDER" ||
        approval.authorizedActorId !== actor.actorId ||
        approval.authorizedActorId !== this.#founderAuthority.actorId ||
        approval.decision !== "APPROVED" ||
        approval.approver?.actorType !== "FOUNDER" ||
        approval.approver.actorId !== actor.actorId ||
        approval.approver.actorId !== this.#founderAuthority.actorId ||
        approval.decidedAt === null
      ) {
        throw new TreasuryError("APPROVAL_MISMATCH", "Allocation approval must be an exact founder-approved RELEASE_APPROVAL for this proposal.");
      }
      const expiresAt = Date.parse(approval.expiresAt);
      const appliedAt = Date.parse(occurredAt);
      const decidedAt = Date.parse(approval.decidedAt);
      const proposalCreatedAt = Date.parse(current.createdAt);
      if (!Number.isFinite(expiresAt) || !Number.isFinite(appliedAt) || !Number.isFinite(decidedAt) || !Number.isFinite(proposalCreatedAt) || decidedAt < proposalCreatedAt || decidedAt > appliedAt || appliedAt >= expiresAt) {
        throw new TreasuryError("INVALID_STATE", "Allocation approval chronology is invalid or expired.");
      }
      const expectedHash = await hashAllocationProposalIntent(current);
      const persisted = this.#proposals.get(input.proposalId);
      if (persisted === undefined || persisted.status !== "PROPOSED" || JSON.stringify(persisted) !== JSON.stringify(current)) {
        throw new TreasuryError("INVALID_STATE", "Allocation proposal changed while approval was being recorded.");
      }
      if (approval.exactIntentHash !== expectedHash) throw new TreasuryError("APPROVAL_MISMATCH", "Approval hash does not match the exact allocation proposal.");
      const approved = AllocationProposalSchema.parse({
        ...persisted,
        status: "APPROVED",
        approvalId: approval.id,
        approvedIntentHash: expectedHash,
        approvalRecord: approval,
        approvedAt: occurredAt,
      });
      const auditRecord = event({
        id: eventId,
        aggregateId: approved.id,
        actor,
        occurredAt,
        idempotencyKey: approval.idempotencyKey,
        previousState: current.status,
        nextState: approved.status,
        relatedProposalId: approved.id,
      });
      this.#proposals.set(approved.id, approved);
      this.#audit.push(auditRecord);
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
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedOperator(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
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
      if (current.approvalId === null || current.approvedIntentHash === null || current.approvalRecord === null) {
        throw new TreasuryError("INVALID_STATE", "Approved proposal is missing approval evidence.");
      }
      const approval = ApprovalRecordSchema.parse(current.approvalRecord);
      if (
        approval.aggregateId !== current.id ||
        approval.actionKind !== "RELEASE_APPROVAL" ||
        approval.authorizedActorType !== "FOUNDER" ||
        approval.authorizedActorId !== this.#founderAuthority.actorId ||
        approval.decision !== "APPROVED" ||
        approval.approver?.actorType !== "FOUNDER" ||
        approval.approver.actorId !== approval.authorizedActorId ||
        approval.decidedAt === null
      ) {
        throw new TreasuryError("APPROVAL_MISMATCH", "Approved proposal no longer has valid founder approval evidence.");
      }
      const decidedAt = Date.parse(approval.decidedAt);
      const expiresAt = Date.parse(approval.expiresAt);
      const appliedAt = Date.parse(occurredAt);
      if (!Number.isFinite(decidedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(appliedAt) || decidedAt > appliedAt || appliedAt >= expiresAt) {
        throw new TreasuryError("INVALID_STATE", "Allocation approval is no longer valid at apply time.");
      }
      const expectedHash = await hashAllocationProposalIntent(current);
      const persisted = this.#proposals.get(input.proposalId);
      if (
        persisted === undefined ||
        persisted.status !== "APPROVED" ||
        persisted.approvalId !== current.approvalId ||
        persisted.approvedIntentHash !== current.approvedIntentHash ||
        JSON.stringify(persisted.approvalRecord) !== JSON.stringify(current.approvalRecord) ||
        JSON.stringify(persisted) !== JSON.stringify(current)
      ) {
        throw new TreasuryError("INVALID_STATE", "Allocation proposal changed while application was being recorded.");
      }
      if (current.approvedIntentHash !== expectedHash || approval.exactIntentHash !== expectedHash) {
        throw new TreasuryError("PROPOSAL_ALTERED", "Approved allocation proposal no longer matches its approved intent.");
      }

      const total = current.resolvedAllocations.reduce<SettlementAmount>((sum, entry) => addSettlement(sum, entry.amount), amount(this.#vault.asset, "0"));
      const balances = this.#computeBalances({ reserves: this.#reserves, confirmed: this.#confirmed, escrowed: this.#escrowed });
      if (total.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Allocation asset mismatch.");
      if (toBigInt(total.atomicUnits) > toBigInt(balances.unallocated.atomicUnits)) {
        throw new TreasuryError("INSUFFICIENT_AVAILABLE", "Allocation exceeds unallocated confirmed funds.");
      }

      const nextReserves = this.#reserves.map((reserve) => ReserveSchema.parse(reserve));
      const nextLedgerEntries: LedgerEntry[] = [];
      for (const entry of current.resolvedAllocations) {
        const reserveIndex = nextReserves.findIndex((reserve) => reserve.id === entry.reserveId);
        if (reserveIndex < 0) throw new TreasuryError("INVALID_STATE", `Reserve ${entry.reserveId} does not exist.`);
        const reserve = nextReserves[reserveIndex]!;
        nextReserves[reserveIndex] = ReserveSchema.parse({
          ...reserve,
          allocated: addSettlement(reserve.allocated, entry.amount),
          status: "ACTIVE",
        });
        nextLedgerEntries.push(
          LedgerEntrySchema.parse({
            id: `ledger:allocation:${current.id}:${entry.reserveId}`,
            kind: "ALLOCATION",
            vaultId: this.#vault.id,
            reserveId: entry.reserveId,
            amount: entry.amount,
            idempotencyKey: input.idempotencyKey,
            occurredAt,
            reversesEntryId: null,
          }),
        );
      }
      this.#computeBalances({ reserves: nextReserves, confirmed: this.#confirmed, escrowed: this.#escrowed });

      const applied = AllocationProposalSchema.parse({ ...current, status: "APPLIED", appliedAt: occurredAt });
      const auditRecord = event({
        id: eventId,
        aggregateId: applied.id,
        actor,
        occurredAt,
        idempotencyKey: input.idempotencyKey,
        previousState: current.status,
        nextState: applied.status,
        relatedProposalId: applied.id,
      });
      this.#reserves = nextReserves;
      this.#ledger.push(...nextLedgerEntries);
      this.#proposals.set(applied.id, applied);
      this.#audit.push(auditRecord);
      return structuredClone(applied);
    });
  }

  async recordIncomingTranche(input: {
    trancheId: string;
    amount: MoneyAmount;
    transactionRef: ArcTransactionRef;
    actor: Actor;
    idempotencyKey: string;
    eventId: string;
    occurredAt: string;
    sourceJobRef?: z.infer<typeof AgenticJobRefSchema> | null;
  }): Promise<IncomingTranche> {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedOperator(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
    const amountValue = SettlementMoneyAmountSchema.parse(input.amount);
    if (amountValue.asset !== this.#vault.asset) throw new TreasuryError("ASSET_MISMATCH", "Incoming tranche asset mismatch.");
    const transactionRef = ArcTransactionRefSchema.parse(input.transactionRef);
    if (transactionRef.operationType !== "SETTLEMENT") throw new TreasuryError("INVALID_TRANSITION", "Incoming tranche evidence must use SETTLEMENT transaction type.");
    let state: IncomingTranche["state"];
    switch (transactionRef.status) {
      case "PREPARED":
      case "SUBMITTED":
      case "CONFIRMED":
      case "FAILED":
        state = transactionRef.status;
        break;
      default:
        throw new TreasuryError("INVALID_TRANSITION", "Incoming tranche lifecycle accepts PREPARED, SUBMITTED, CONFIRMED, or FAILED transaction evidence.");
    }
    if (!transactionRef.isMock) {
      throw new TreasuryError(
        "INVALID_STATE",
        "Live Arc settlement credit is deferred to the Circle/Arc integration layer.",
      );
    }
    const sourceJobRef = input.sourceJobRef == null ? null : AgenticJobRefSchema.parse(input.sourceJobRef);
    if (sourceJobRef !== null) {
      if (sourceJobRef.isMock !== transactionRef.isMock) throw new TreasuryError("INVALID_STATE", "Incoming tranche job and transaction mode must match.");
      if (sourceJobRef.status !== "COMPLETED" || sourceJobRef.transaction === null || sourceJobRef.transaction.status !== "CONFIRMED" || sourceJobRef.transaction.operationType !== "JOB_EVALUATE") {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche job evidence must represent a completed ERC-8183 evaluation.");
      }
      if (sourceJobRef.transaction.network !== transactionRef.network || sourceJobRef.transaction.chainId !== transactionRef.chainId) {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche job evidence network and chain must match settlement evidence.");
      }
      if (sourceJobRef.budget.asset !== amountValue.asset || sourceJobRef.budget.atomicUnits !== amountValue.atomicUnits) {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche amount and asset must exactly match source job budget for this MVP path.");
      }
    }
    if (transactionRef.transactionHash !== null) {
      const transactionIdentity = this.#transactionHashIdentity(transactionRef.transactionHash);
      const conflicting = [...this.#incomingTranches.values()].find((entry) =>
        entry.id !== input.trancheId && this.#transactionHashIdentity(entry.transactionRef.transactionHash) === transactionIdentity,
      );
      if (conflicting !== undefined) throw new TreasuryError("INVALID_STATE", "Incoming tranche transaction hash is already bound to another tranche.");
    }
    const current = this.#incomingTranches.get(input.trancheId);
    if (current === undefined && state !== "PREPARED") {
      throw new TreasuryError("INVALID_TRANSITION", "New incoming tranche lifecycle must start in PREPARED state.");
    }
    if (current !== undefined && current.state === "RECONCILED") throw new TreasuryError("INVALID_STATE", "Reconciled tranches cannot be modified.");
    if (current !== undefined && current.state === "FAILED") throw new TreasuryError("INVALID_STATE", "Failed tranches cannot be modified.");
    if (current !== undefined) {
      if (current.projectId !== this.#vault.projectId || current.vaultId !== this.#vault.id) throw new TreasuryError("INVALID_STATE", "Incoming tranche target must preserve project and vault identity.");
      if (current.amount.atomicUnits !== amountValue.atomicUnits) throw new TreasuryError("INVALID_STATE", "Tranche amount cannot be altered.");
      if (current.amount.asset !== amountValue.asset) throw new TreasuryError("INVALID_STATE", "Tranche asset cannot be altered.");
      if (current.transactionRef.operationType !== transactionRef.operationType) throw new TreasuryError("INVALID_STATE", "Tranche transaction type cannot be altered.");
      if (current.transactionRef.isMock !== transactionRef.isMock) throw new TreasuryError("INVALID_STATE", "Tranche mock/live mode cannot be altered.");
      if (current.transactionRef.network !== transactionRef.network || current.transactionRef.chainId !== transactionRef.chainId) {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche transaction network and chain cannot be altered.");
      }
      const allowedTransitions: Record<IncomingTranche["state"], ReadonlySet<IncomingTranche["state"]>> = {
        PREPARED: new Set(["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"]),
        SUBMITTED: new Set(["SUBMITTED", "CONFIRMED", "FAILED"]),
        CONFIRMED: new Set(["CONFIRMED"]),
        FAILED: new Set(),
        RECONCILED: new Set(),
      };
      if (!allowedTransitions[current.state].has(state)) throw new TreasuryError("INVALID_TRANSITION", "Incoming tranche status cannot move backward or leave a terminal state.");
      if (current.transactionRef.status === "CONFIRMED" && this.#transactionFingerprint(current.transactionRef) !== this.#transactionFingerprint(transactionRef)) {
        throw new TreasuryError("INVALID_STATE", "Confirmed incoming tranche transaction evidence cannot be altered.");
      }
      if (current.transactionRef.transactionHash !== null && this.#transactionHashIdentity(transactionRef.transactionHash) !== this.#transactionHashIdentity(current.transactionRef.transactionHash)) {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche transaction hash cannot be substituted.");
      }
      if (this.#jobRefFingerprint(current.sourceJobRef) !== this.#jobRefFingerprint(sourceJobRef)) {
        throw new TreasuryError("INVALID_STATE", "Incoming tranche source job evidence cannot be substituted.");
      }
    }

    const fingerprint = JSON.stringify([
      input.trancheId,
      amountValue.atomicUnits,
      amountValue.asset,
      this.#transactionFingerprint(transactionRef),
      this.#jobRefFingerprint(sourceJobRef),
      actor.actorType,
      actor.actorId,
      state,
    ]);

    return this.#idempotency.execute("tranche-record", input.idempotencyKey, fingerprint, () => {
      const tranche = IncomingTrancheSchema.parse({
        id: input.trancheId,
        projectId: this.#vault.projectId,
        vaultId: this.#vault.id,
        amount: amountValue,
        transactionRef,
        sourceJobRef,
        state,
        reconciledAt: null,
        createdAt: current?.createdAt ?? occurredAt,
      });
      const auditRecord = event({
        id: eventId,
        aggregateId: tranche.id,
        actor,
        occurredAt,
        idempotencyKey: input.idempotencyKey,
        previousState: current?.state ?? "NONE",
        nextState: tranche.state,
        relatedTrancheId: tranche.id,
        relatedTransactionHash: tranche.transactionRef.transactionHash,
      });
      this.#incomingTranches.set(tranche.id, tranche);
      this.#audit.push(auditRecord);
      return structuredClone(tranche);
    });
  }

  async reconcileConfirmedTranche(input: {
    trancheId: string;
    actor: Actor;
    idempotencyKey: string;
    eventId: string;
    occurredAt: string;
  }): Promise<IncomingTranche> {
    const actor = ActorSchema.parse(input.actor);
    this.#assertAuthorizedOperator(actor);
    const eventId = IdSchema.parse(input.eventId);
    const occurredAt = z.string().datetime().parse(input.occurredAt);
    const tranche = this.#incomingTranches.get(input.trancheId);
    if (tranche === undefined) throw new TreasuryError("INVALID_STATE", `Tranche ${input.trancheId} does not exist.`);
    const fingerprint = JSON.stringify([tranche.id, tranche.amount.atomicUnits, tranche.transactionRef.transactionHash]);

    return this.#idempotency.execute("tranche-reconcile", input.idempotencyKey, fingerprint, () => {
      const current = this.#incomingTranches.get(input.trancheId);
      if (current === undefined) throw new TreasuryError("INVALID_STATE", `Tranche ${input.trancheId} does not exist.`);
      if (current.state !== "CONFIRMED") throw new TreasuryError("INVALID_TRANSITION", "Only CONFIRMED tranches can be reconciled.");
      if (current.transactionRef.operationType !== "SETTLEMENT" || current.transactionRef.status !== "CONFIRMED") {
        throw new TreasuryError("INVALID_TRANSITION", "Only confirmed SETTLEMENT tranche evidence may be reconciled.");
      }
      const nextConfirmed = addSettlement(this.#confirmed, current.amount);
      const nextVault = LaunchVaultSchema.parse({
        ...this.#vault,
        totalCapital: addSettlement(this.#vault.totalCapital, current.amount),
      });
      this.#computeBalances({ reserves: this.#reserves, confirmed: nextConfirmed, escrowed: this.#escrowed });
      const reconciled = IncomingTrancheSchema.parse({ ...current, state: "RECONCILED", reconciledAt: occurredAt });
      const settlementEntry = LedgerEntrySchema.parse({
        id: `ledger:tranche:${reconciled.id}`,
        kind: "SETTLEMENT",
        vaultId: this.#vault.id,
        reserveId: null,
        amount: reconciled.amount,
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        reversesEntryId: null,
      });
      const auditRecord = event({
        id: eventId,
        aggregateId: reconciled.id,
        actor,
        occurredAt,
        idempotencyKey: input.idempotencyKey,
        previousState: current.state,
        nextState: reconciled.state,
        relatedTrancheId: reconciled.id,
        relatedTransactionHash: reconciled.transactionRef.transactionHash,
      });
      const invariant = this.#deriveLedgerReconciliationInvariant({
        reserves: this.#reserves,
        confirmed: nextConfirmed,
        escrowed: this.#escrowed,
        ledger: [...this.#ledger, settlementEntry],
        vault: nextVault,
      });
      if (!invariant.isConsistent) throw new TreasuryError("INVALID_STATE", "Tranche reconciliation would create inconsistent ledger and balances.");
      this.#confirmed = nextConfirmed;
      this.#vault = nextVault;
      this.#incomingTranches.set(reconciled.id, reconciled);
      this.#ledger.push(settlementEntry);
      this.#audit.push(auditRecord);
      return structuredClone(reconciled);
    });
  }
}
