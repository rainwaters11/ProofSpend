import { SettlementRecordSchema, type DisclosurePreferences, type EvidenceItem, type ProofOfProgress, type Project, type SettlementRecord } from "./models";

export interface BackerSafeProjectRecord {
  project: Pick<Project, "id" | "name" | "description">;
  evidence: Array<Pick<EvidenceItem, "id" | "kind" | "sourceHash" | "submittedAt">>;
  proofs: Array<Pick<ProofOfProgress, "id" | "milestoneId" | "version" | "recordHash" | "createdAt">>;
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
  if (input.project.id !== input.preferences.projectId) throw new Error("Disclosure preferences belong to another project.");
  return {
    project: { id: input.project.id, name: input.project.name, description: input.project.description },
    evidence: [],
    proofs: input.preferences.discloseProofRecords
      ? input.proofs.filter((proof) => input.preferences.approvedProofIds.includes(proof.id)).map(({ id, milestoneId, version, recordHash, createdAt }) => ({ id, milestoneId, version, recordHash, createdAt }))
      : [],
    settlements: input.preferences.discloseSettlementState
      ? input.settlements.map((settlement) => SettlementRecordSchema.parse(settlement)).map(({ id, releaseRequestId, amount, state, updatedAt }) => ({ id, releaseRequestId, amount: structuredClone(amount), state, updatedAt }))
      : [],
  };
}
