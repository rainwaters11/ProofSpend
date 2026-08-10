# LaunchVault agent blueprint

ProofSpend agents may use an LLM to interpret unstructured evidence, generate structured candidates, explain results, and prepare proposals. Deterministic services validate inputs and apply allowed state changes; authorized people or evaluators approve exact actions; typed server adapters handle Arc transactions. No AI agent or LLM may independently produce the authoritative financial decision, approve its own proposal, or submit a value-moving action.

ProofSpend carries forward the deterministic preflight and human-oversight principles first explored in SendSure. That lineage is conceptual and vocabulary-based; this blueprint does not assume SendSure code is reused.

## Founder Copilot

Helps founders configure a vault, understand reserves, submit evidence, and complete milestones. It may use an LLM to interpret intent, prepare proposals, route tasks, explain status, and ask questions. It may not calculate final balances, produce the formal policy outcome, finalize status, approve actions, submit transactions, or disclose private evidence.

## Evidence Agent

Turns untrusted receipts, deliverables, screenshots, and statements into structured candidates containing source hash, extracted and inferred values, confidence, mapping suggestions, missing fields, and warnings. LLM output remains untrusted until schema and domain validation succeed. Uploaded content cannot change instructions, policy, authorization, or tool access. Raw evidence remains offchain.

## Milestone Agent

Explains requirement-by-requirement progress, missing evidence, spend summaries, and next actions. It may use an LLM to translate deterministic reason codes into plain language. Deterministic policy alone returns `PASS`, `REVIEW`, or `FAIL` requirement outcomes and calculates internal eligibility.

## Recovery Agent

Prioritizes release-blocking gaps, duplicates/conflicts, unmatched transactions or receipts, missing deliverables, missing business purpose, and missing project mappings. It asks one best question at a time and cannot alter policy or approval state.

## Backer Brief Agent

Summarizes founder-approved, shareable records only. It may use an LLM to produce a concise explanation, but every included fact must come from approved disclosure data. It cannot access or expose raw receipts, private notes, unrelated projects, credentials, or hidden founder data.

## ProofSpend Verification Agent identity

Issue #13 registers and verifies this agent's ERC-8004 identity and defines reputation governance. Registration is an identity reference—not proof that the agent is trustworthy, correct, audited, or authorized. The agent owner may not write reputation for its own agent; any reputation result must be recorded by an independent address after the relevant outcome.

Issue #13 does not implement the complete agent runtime or ERC-8183 settlement.

## ERC-8183 roles

Issue #8 implements the milestone-job lifecycle after its dependencies are complete. The provider may submit an approved Proof-of-Progress deliverable hash. An explicitly authorized evaluator approves completion or rejection; the deterministic server-side adapter executes the approved evaluator action. Settlement or refund follows the ERC-8183 lifecycle. The AI never funds a job, approves a proposal, submits a transaction, completes or rejects a job, or conflates internal `ELIGIBLE` with ERC-8183 `COMPLETED`.

## Handoff contract

1. The LLM-assisted agent returns a structured extraction, mapping, explanation, or proposed next action.
2. Deterministic services validate schemas, atomic-unit arithmetic, evidence hashes, policy outcomes, roles, and transitions.
3. The deterministic engine—not the LLM—produces the formal `PASS`, `REVIEW`, or `FAIL` result and internal eligibility.
4. An authorized human/evaluator reviews and approves an exact action.
5. A server-side adapter prepares the transaction without submitting it.
6. The approved intent, authorization, state, expiry, and idempotency are revalidated immediately before submission.
7. Submission, confirmation, failure, and reconciliation are persisted separately.
8. Agent runs, tool calls, policy results, approval references, and transaction outcomes remain auditable.

Explicit approval is required for reserve activation, proof visibility, mock-to-Arc switching, ERC-8004 registration, ERC-8183 job creation/funding, provider delivery, evaluator completion/rejection, settlement/refund, and any privileged change.

## Live bounded Verification Agent runtime (Issue #32)

Issue #32 implements a small, server-only Verification Agent orchestrator for the seeded PawPOVAI judge path. The runtime is intentionally narrow:

- one OpenAI Responses API invocation over a sanitized evidence summary in explicit `PROOFSPEND_AGENT_MODE=openai`;
- deterministic `mock` provider support for CI and offline development;
- strict schema validation at model input/output, tool output, activity trace, proposal, and handoff boundaries;
- deterministic Evidence Engine and Milestone Engine ownership of policy outcomes;
- one missing-receipt question, one validated founder correction, deterministic re-evaluation, and exact 1 USDC proposal;
- stop at `APPROVAL_REQUIRED` with human authorization and value-moving execution outside the model loop;
- sanitized ordered activity trace labels (`AI`, `DETERMINISTIC`, `HUMAN`, `MOCK` or `ARC TESTNET`);
- no silent fallback from live to mock mode, no stored OpenAI response, and no fabricated Arc hash/confirmation/explorer output in mock mode;
- authenticated API access, unique live invocation keys, and a bounded per-actor live request rate;
- server-owned run lookup, authenticated actor binding, proposal-expiry enforcement, and proposal-key deduplication;
- a source-wallet-bound canonical intent hash displayed before approval, durable compare-and-consume authorization for the bounded single-instance Arc Testnet demo, and idempotent recovery or resumed polling if Circle accepted a request before the server recorded its response;
- truthful `SUBMITTED`, `CONFIRMED`, and `FAILED` UI states, with a real explorer link only after Circle returns a confirmed Arc transaction hash.

This runtime remains separate from Issue #13 identity governance and Issue #8 ERC-8183 settlement lifecycle ownership.

The file-backed authorization store is a bounded single-instance demo control, not a production multi-instance database. Production persistence, generalized chat, arbitrary evidence uploads, wallet creation, full ERC-8183 lifecycle operations, and autonomous payment behavior remain out of scope.
