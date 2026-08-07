# ProofSpend LaunchVault — product and technical design

## Product identity

**Tagline:** Fund the vision. Prove the progress. Unlock what comes next.  
**Category:** evidence-aware programmable capital
**Network:** Arc Testnet  
**Settlement asset:** USDC

LaunchVault helps founders organize project capital, submit evidence of progress, and participate in explicitly authorized milestone settlement while preserving privacy and an append-only history. It is a testnet prototype, not an investment product, auditor, tax service, or guarantee against fraud.

## Design lineage

ProofSpend carries forward the deterministic preflight, plain-language explanation, fail-closed state handling, and human-oversight principles first explored in SendSure. That relationship is conceptual and vocabulary-based. ProofSpend is not described as a SendSure fork, and no SendSure implementation is assumed to be present unless a future change explicitly imports and documents it.

The LLM is a core assistance layer, not the financial authority. It interprets unstructured evidence, extracts structured candidates, maps evidence to requirements, identifies ambiguity, asks Proof Recovery questions, explains results, and prepares proposed next actions. Deterministic services validate those candidates and own formal policy and money-state outcomes.

## Canonical authority model

The system has four separate layers:

1. **LLM-assisted AI analysis:** extract, match, summarize, explain, and propose from untrusted evidence.
2. **Deterministic policy:** validate schemas and atomic-unit money, produce requirement outcomes `PASS`, `REVIEW`, or `FAIL`, and calculate internal eligibility.
3. **Explicit authority:** an authorized human or evaluator approves an exact action.
4. **Arc execution:** a typed server-side Circle adapter separately prepares, submits, confirms, and reconciles the transaction.

The LLM and Verification Agent never calculate final balances, produce the authoritative policy result, finalize milestone state, approve or alter an exact intent, submit a value-moving action, complete or reject a job, or write reputation. After exact persisted approval, deterministic server-side execution revalidates and submits the action outside the agent tool loop.

## Canonical Arc flow

Every protocol write below requires its own exact persisted intent, approval by the authorized role, server-side preparation, immediate pre-submit revalidation, submission, confirmation, and reconciliation. Approval is action-specific and non-transferable: approval for registration does not approve job creation, and approval for job creation does not approve allowance or funding.

1. Issue #13 prepares an exact ERC-8004 registration intent for the ProofSpend Verification Agent.
2. The authorized agent owner reviews and approves that exact registration intent.
3. The server prepares, immediately revalidates, submits, confirms, and reconciles the ERC-8004 registration before the identity is treated as registered.
4. After Issue #8 dependencies are complete, Issue #8 prepares an exact ERC-8183 job-creation intent.
5. The authorized client reviews and approves that exact job-creation intent.
6. The server prepares, immediately revalidates, submits, confirms, and reconciles job creation before the job is treated as created.
7. Any USDC allowance and ERC-8183 funding operations are prepared as separate exact intents.
8. The authorized client/funder separately approves each allowance or funding intent.
9. The server separately prepares, immediately revalidates, submits, confirms, and reconciles each approved allowance or funding write before escrow is treated as funded.
10. The founder submits receipts, deliverables, and business context offchain.
11. The LLM-assisted Verification Agent produces structured evidence candidates, mappings, confidence, warnings, and explanations.
12. Deterministic policy validates the candidates and produces `PASS`, `REVIEW`, or `FAIL` outcomes and internal eligibility.
13. The Verification Agent may prepare a proposed next action, but that proposal has no financial authority.
14. The provider's deliverable-hash submission is represented by its own exact intent and approved by the authorized provider role.
15. The server prepares, immediately revalidates, submits, confirms, and reconciles the approved deliverable submission.
16. Completion or rejection is represented by a separate exact evaluator intent and approved by the authorized evaluator.
17. The server prepares, immediately revalidates, submits, confirms, and reconciles the approved evaluator action.
18. USDC settles or becomes refundable only through the confirmed ERC-8183 lifecycle; any refund claim is a separate authorized protocol write.
19. The application reconciles settlement or refund results before updating confirmed balances.
20. Any ERC-8004 reputation write is a separate exact intent approved and submitted by an independent reputation writer after the result; the agent owner may not write its own reputation.

ERC-8004 registration identifies an agent; it does not prove trustworthiness, correctness, auditing, or financial authority. The agent owner may not write reputation for its own agent. Internal `ELIGIBLE` and ERC-8183 `COMPLETED` are different states.

## MVP scenario

The fictional PawPOVAI InvestFest Soft Launch starts with 1,000 test USDC allocated in integer atomic units across Product and platform (350), Marketing (250), InvestFest travel (200), Operations (100), and Contingency (100).

Milestone 1, “Launch identity and outreach ready,” requires a visual identity asset, landing-page screenshot, promotional flyer, two expense records, eligible spend no greater than 150 USDC, and founder confirmation. The proposed next amount is 250 test USDC. The demo must show LLM-assisted evidence review, deterministic outcomes, an agent-prepared proposal, exact human approval, and truthful mock or Arc lifecycle states without implying that analysis, preparation, submission, or internal eligibility equals settlement.

## Core modules

### LaunchVault Treasury

Maintains project capital and purpose reserves using integer atomic units and append-only ledger entries. It shows allocated, available, committed, settled/refunded, and remaining amounts; prevents duplicate allocation; and records reversals rather than deleting history.

### Deterministic Milestone Engine

Stores milestone requirements, spend limit, due date, proposed amount, and application status. Each requirement produces `PASS`, `REVIEW`, or `FAIL` with reason codes and next actions. Application states may include incomplete, needs review, eligible, approved intent, prepared, submitted, confirmed, released/refunded, and rejected, but must not reuse ERC-8183 terms inaccurately.

### Evidence Engine and Proof Recovery

Captures receipt images, screenshots, transactions, invoices, deliverables, business-purpose statements, and confirmations. The LLM converts these untrusted inputs into structured candidates and explanations; deterministic validation decides whether those candidates are acceptable inputs to policy. Original evidence stays separate from AI-derived fields. Raw receipts and founder-private evidence remain offchain. Recovery identifies the highest-priority gap and asks one question at a time.

### Proof-of-Progress record

Creates an append-only, versioned application record containing requirement outcomes, approved evidence hashes, planned budget, deterministically verified spend, proposed amount, approval, timestamps, ERC-8183 job reference, deliverable commitment, and transaction lifecycle references as available. It is not automatically public or onchain, and a signed proof is not on the default path.

### Backer View

Shows only founder-approved information: capital summaries, reserve allocation, requirement outcomes, milestone progress, disclosed settlement/refund state, proof records, and disclosed risks. It hides raw receipts, private notes, unrelated activity, and credentials.

### Arc standards layer

- **Issue #13 / ERC-8004:** agent identity registration/verification and independent reputation governance only.
- **Issue #8 / ERC-8183:** job creation/funding, provider delivery, evaluator completion/rejection, settlement/refund, confirmation, and reconciliation only.

Issue #8 consumes the registered identity but does not absorb Issue #13.

## Agent architecture

The Founder Copilot routes and explains; Evidence Agent creates structured candidates; Milestone Agent explains deterministic results; Recovery Agent finds gaps; Backer Brief Agent summarizes approved disclosure. These roles may use an LLM for interpretation and language generation. The ProofSpend Verification Agent coordinates approved tools and has an ERC-8004 identity, but no inherent trust, policy, approval, or payment authority.

The complete Verification Agent orchestration—controlled OpenAI Agents SDK loop, structured evidence-service calls, deterministic-policy explanation, human interruption, and transaction-proposal preparation—is a backlog gap requiring a dedicated future issue unless the live backlog assigns it elsewhere. It must prohibit direct submission and preserve a record of tool calls, policy results, approval references, and transaction outcomes.

## Circle execution boundary

Issue #7 depends on Issues #2, #3, and #4. ADR-001 (Issue #7) selects Circle Developer-Controlled Wallets as the execution architecture; adapter implementation still waits for Issue #4. Preliminary research may happen earlier, but it cannot change the selected architecture or runtime configuration.

Selectively evaluate patterns from Circle `packages/circle-tools` and `kits/openai-agents`, verifying current official documentation and preserving required attribution. Exclude `packages/agent-cli`, terminal UI, unrelated framework kits, Base/Polygon assumptions, and autonomous payment behavior. Mock and Arc adapters share typed application-owned interfaces but are explicitly selected and never silently interchanged.

ERC-8183 is the default MVP settlement primitive. A custom LaunchVault contract, wallet-signed proof, x402, and nanopayments are deferred and not part of the default implementation path.

## Conceptual records

Projects, vaults, reserves, ledger entries, milestones, requirements, evidence items, AI-derived candidates, matches, policy decisions, proof records, approvals, exact transaction intents, prepared transactions, submissions, confirmations, reconciliation events, ERC-8004 registrations, ERC-8183 jobs/deliverables/evaluations/settlements/refunds, disclosure preferences, reputation results, proof gaps, agent runs, tool calls, and audit events.

## Security and governance

- Never commit secrets or expose privileged actions to the browser.
- Validate all external input with Zod and treat uploaded content and LLM output as untrusted data.
- Validate chain, asset, addresses, roles, amount, balance, state, approval, expiry, and idempotency.
- Persist intent before execution and result afterward; revalidate immediately before submission.
- Keep AI analysis, deterministic policy, approval, preparation, submission, confirmation, failure, and reconciliation separate.
- Preserve append-only audit history, corrections, agent tool calls, and approvals.
- Keep private evidence offchain and use approved hashes/commitments only.
- Never describe the prototype as audited, production-ready, investment advice, tax advice, or guaranteed fraud prevention.

## UX principles

Be founder-first, accessible, responsive, and explicit. Display `ModeBadge` and role context on money/protocol screens. Visually distinguish AI observation, deterministic result, awaiting approval, approved intent, mock, Arc Testnet, prepared, submitted, confirmed, failed, rejected, refunded, and reconciled states. Never show a fabricated identifier as live. Explain every `REVIEW`/`FAIL` and why a milestone is not eligible. Separate private, shared, and onchain-public data.

Issue #14 uses only the Phase A–D structure in `docs/roadmap.md`.

## Testing

Test atomic arithmetic, allocation/rounding, deterministic policy, malformed or adversarial LLM output, duplicate evidence, invalid transitions, disclosure filtering, exact approvals, stale-intent rejection, idempotency, preparation/submission separation, ERC-8183 completion/rejection and settlement/refund, owner self-reputation prohibition, confirmation/reconciliation, agent tool boundaries, and truthful UI states.

## Definition of done

A feature is complete only when its live acceptance criteria, dependencies, tests, build, error states, security/privacy boundaries, documentation, and reproducible evidence pass.
