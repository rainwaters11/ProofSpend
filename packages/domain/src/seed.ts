import { SettlementMoneyAmountSchema, type AllocationRule, type DisclosurePreferences, type LaunchVault, type Milestone, type MilestoneRequirement, type Project, type Reserve, type SettlementMoneyAmount } from "./models";

const NOW = "2026-01-15T12:00:00.000Z";
const usdc = (atomicUnits: string): SettlementMoneyAmount => SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits });
export interface PawPovAiSeed { project: Project; vault: LaunchVault; reserves: Reserve[]; allocationRules: AllocationRule[]; milestone: Milestone; requirements: MilestoneRequirement[]; disclosurePreferences: DisclosurePreferences }
export function createPawPovAiSeed(): PawPovAiSeed {
  const allocations = [["product", "Product and platform", "350000000"], ["marketing", "Marketing", "250000000"], ["travel", "InvestFest travel", "200000000"], ["operations", "Operations", "100000000"], ["contingency", "Contingency", "100000000"]] as const;
  const reserves = allocations.map(([id, name, amount]) => ({ id: `reserve:${id}`, vaultId: "vault:pawpovai", name, allocated: usdc(amount), status: "PROPOSED" as const }));
  const requirements: MilestoneRequirement[] = [
    ["identity", "DELIVERABLE", "Visual identity asset"], ["landing", "DELIVERABLE", "Landing-page screenshot"], ["flyer", "DELIVERABLE", "Promotional flyer"],
  ].map(([id, kind, description]) => ({ id: `requirement:${id}`, milestoneId: "milestone:launch-ready", kind: kind as "DELIVERABLE", description }));
  requirements.push({ id: "requirement:expenses", milestoneId: "milestone:launch-ready", kind: "EXPENSE_RECORDS", description: "Two expense records", requiredCount: 2 });
  requirements.push({ id: "requirement:spend", milestoneId: "milestone:launch-ready", kind: "SPEND_LIMIT", description: "Eligible spend no greater than 150 test USDC", spendLimit: usdc("150000000") });
  requirements.push({ id: "requirement:confirmation", milestoneId: "milestone:launch-ready", kind: "FOUNDER_CONFIRMATION", description: "Founder confirmation" });
  const seed: PawPovAiSeed = {
    project: { id: "project:pawpovai", name: "PawPOVAI InvestFest Soft Launch", founderId: "founder:fictional", description: "Fictional LaunchVault demonstration project.", createdAt: NOW },
    vault: { id: "vault:pawpovai", projectId: "project:pawpovai", asset: "USDC", totalCapital: usdc("1000000000"), mode: "MOCK", createdAt: NOW }, reserves,
    allocationRules: reserves.map((reserve) => ({ id: `rule:${reserve.id}`, reserveId: reserve.id, purpose: reserve.name, maximum: reserve.allocated, requiresApproval: true })),
    milestone: { id: "milestone:launch-ready", projectId: "project:pawpovai", title: "Launch identity and outreach ready", proposedAmount: usdc("1000000"), status: "INCOMPLETE", requirementIds: requirements.map((r) => r.id), dueAt: null }, requirements,
    disclosurePreferences: { projectId: "project:pawpovai", discloseCapitalSummary: true, discloseRequirementOutcomes: false, discloseProofRecords: false, discloseSettlementState: false, approvedProofIds: [], updatedAt: NOW },
  };
  return structuredClone(seed);
}
