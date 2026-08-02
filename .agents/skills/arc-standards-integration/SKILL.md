---
name: arc-standards-integration
description: Review scoped Arc, Circle, ERC-8004, ERC-8183, transaction, and reputation work against official sources and ProofSpend authority boundaries.
---

# Arc Standards Integration

1. Read the live issue, `AGENTS.md`, roadmap, dependency map, decision log, Arc architecture record, and Issue #7 ADR when applicable.
2. Confirm dependencies before implementation: #7 requires #2/#3/#4; #13 requires #2/#7; #8 requires #4/#5/#6/#7/#13.
3. Verify current behavior against official Arc, ERC, and Circle primary sources. Never invent commands, addresses, chain identifiers, interfaces, or outputs.
4. Keep ERC-8004 identity/reputation (#13) separate from ERC-8183 jobs/settlement (#8). Registration is not trust; prohibit owner self-reputation.
5. Verify ERC-8183 client/provider/evaluator roles, funding, approved deliverable hash, completion/rejection, settlement/refund, confirmation, and reconciliation.
6. Confirm raw/private evidence remains offchain and internal `ELIGIBLE` is not ERC-8183 `COMPLETED`.
7. Confirm AI cannot approve, evaluate, submit, or write reputation independently.
8. Confirm exact intent, persisted approval, separate preparation/submission, immediate pre-submit revalidation, idempotency, confirmation, and reconciliation.
9. Confirm explicit mock/Arc selection and truthful prepared/submitted/confirmed/failure/refund states.
10. For Circle reuse, consider only verified patterns from `packages/circle-tools` and `kits/openai-agents`; reject `packages/agent-cli`, terminal UI, unrelated kits, autonomous payments, and silent non-Arc assumptions.
11. Reject a custom contract as the default unless a separately approved ADR documents a concrete gap.
12. Return `READY`, `READY WITH LIMITATIONS`, or `BLOCKED`, with source evidence, findings, and smallest remediations.
