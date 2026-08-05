import { AgenticJobRefSchema, type AgentIdentityRef, type AgenticJobRef } from "./models";
import { transitionAgenticJob, type TransitionContext } from "./state";

export interface WalletReference { mode: "MOCK"; walletId: string; asset: "USDC"; balanceAtomic: string; canSubmitTransactions: false }
export class MockWalletReferenceAdapter { getReference(): WalletReference { return { mode: "MOCK", walletId: "mock:wallet:pawpovai", asset: "USDC", balanceAtomic: "1000000000", canSubmitTransactions: false }; } }
export class MockIdentityAdapter {
  getIdentity(): AgentIdentityRef { return { standard: "ERC-8004", network: "synthetic:arc-testnet", chainId: "synthetic:chain", registryAddress: "mock:not-a-registry", agentId: "mock:unregistered:proofspend", ownerAddress: "mock:owner", metadataVersion: "1", registrationStatus: "UNREGISTERED", registrationReference: null, isMock: true }; }
}
export class MockAgenticJobAdapter {
  transition(job: AgenticJobRef, to: AgenticJobRef["status"], context: TransitionContext): { job: AgenticJobRef; auditEvent: ReturnType<typeof transitionAgenticJob>["auditEvent"] } {
    job = AgenticJobRefSchema.parse(job);
    if (!job.isMock) throw new Error("Mock adapter accepts only visibly synthetic jobs.");
    const result = transitionAgenticJob(job.status, to, { ...context, currentJobEvidence: job });
    const evidence = to === "EXPIRED" && context.jobEvidence === undefined ? { ...job, status: result.status } : context.jobEvidence;
    if (evidence === undefined) throw new Error("Mock job transition requires persisted target evidence.");
    return { job: AgenticJobRefSchema.parse(evidence), auditEvent: result.auditEvent };
  }
}
