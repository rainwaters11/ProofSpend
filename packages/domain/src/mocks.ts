import { AgenticJobRefSchema, type AgentIdentityRef, type AgenticJobRef } from "./models";
import { transitionAgenticJob, type TransitionContext } from "./state";

export interface WalletReference { mode: "MOCK"; walletId: string; asset: "USDC"; balanceAtomic: string; canSubmitTransactions: false }
export class MockWalletReferenceAdapter { getReference(): WalletReference { return { mode: "MOCK", walletId: "mock:wallet:pawpovai", asset: "USDC", balanceAtomic: "1000000000", canSubmitTransactions: false }; } }
export class MockIdentityAdapter {
  getIdentity(): AgentIdentityRef { return { standard: "ERC-8004", network: "synthetic:arc-testnet", chainId: "synthetic:chain", registryAddress: "mock:not-a-registry", agentId: "mock:unregistered:proofspend", ownerAddress: "mock:owner", metadataVersion: "1", registrationStatus: "UNREGISTERED", registrationReference: null, isMock: true }; }
}
export class MockAgenticJobAdapter {
  async transition(job: AgenticJobRef, to: AgenticJobRef["status"], context: TransitionContext): Promise<{ job: AgenticJobRef; auditEvent: Awaited<ReturnType<typeof transitionAgenticJob>>["auditEvent"] }> {
    job = AgenticJobRefSchema.parse(job);
    if (!job.isMock) throw new Error("Mock adapter accepts only visibly synthetic jobs.");
    const result = await transitionAgenticJob(job.status, to, { ...context, currentJobEvidence: job });
    const evidence = AgenticJobRefSchema.parse(context.jobEvidence);
    return { job: evidence, auditEvent: result.auditEvent };
  }
}
