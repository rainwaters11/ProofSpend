import { DisclosurePreferencesSchema, ProofOfProgressSchema, SettlementRecordSchema, type DisclosurePreferences, type EvidenceItem, type ProofOfProgress, type Project, type SettlementRecord } from "./models";

export interface BackerSafeProjectRecord {
  project: Pick<Project, "id" | "name" | "description">;
  evidence: Array<Pick<EvidenceItem, "id" | "kind" | "sourceHash" | "submittedAt">>;
  proofs: Array<Pick<ProofOfProgress, "id" | "projectId" | "milestoneId" | "version" | "recordHash" | "createdAt">>;
  settlements: Array<Pick<SettlementRecord, "id" | "releaseRequestId" | "amount" | "state" | "updatedAt">>;
}

/** Builds an allowlisted disclosure projection; founder-private fields are never copied. */
export function filterBackerDisclosure(input: {
  project: Project;
  evidence: EvidenceItem[];
  proofs: ProofOfProgress[];
  settlements: SettlementRecord[];
  preferences: DisclosurePreferences;
}): BackerSafeProjectRecord {
  const preferences = DisclosurePreferencesSchema.parse(input.preferences);
  if (input.project.id !== preferences.projectId) throw new Error("Disclosure preferences belong to another project.");
  const validatedProofs = input.proofs.map((proof) => ProofOfProgressSchema.parse(proof));
  const validatedSettlements = input.settlements.map((settlement) => SettlementRecordSchema.parse(settlement));
  return {
    project: { id: input.project.id, name: input.project.name, description: input.project.description },
    evidence: [],
    proofs: preferences.discloseProofRecords
      ? validatedProofs.filter((proof) => proof.projectId === preferences.projectId && preferences.approvedProofIds.includes(proof.id) && (proof.visibility === "BACKER_SHARED" || proof.visibility === "ONCHAIN_PUBLIC")).map(({ id, projectId, milestoneId, version, recordHash, createdAt }) => ({ id, projectId, milestoneId, version, recordHash, createdAt }))
      : [],
    settlements: preferences.discloseSettlementState
      ? validatedSettlements.filter((settlement) => settlement.projectId === input.project.id).map(({ id, releaseRequestId, amount, state, updatedAt }) => ({ id, releaseRequestId, amount: structuredClone(amount), state, updatedAt }))
      : [],
  };
}
