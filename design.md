# ProofSpend LaunchVault — product and technical design

## Product identity

**Tagline:** Fund the vision. Prove the progress. Unlock what comes next.  
**Category:** evidence-aware programmable capital
**Network:** Arc Testnet  
**Settlement asset:** USDC

LaunchVault helps founders organize project capital, submit evidence of progress, and participate in explicitly authorized milestone settlement while preserving privacy and an append-only history. It is a testnet prototype, not an investment product, auditor, tax service, or guarantee against fraud.

## Canonical authority model

The system has four separate layers:

1. **AI assistance:** extract, match, summarize, and explain evidence.
2. **Deterministic policy:** validate schemas and atomic-unit money, produce requirement outcomes `PASS`, `REVIEW`, or `FAIL`, and calculate internal eligibility.
3. **Explicit authority:** an authorized human or evaluator approves an exact action.
4. **Arc execution:** a typed server-side adapter separately prepares, submits, confirms, and reconciles the transaction.

The AI never calculates final balances, finalizes milestone state, approves or submits a value-moving action, completes/rejects a job, or writes reputation.

## Canonical Arc flow

1. Issue #13 registers and verifies the ProofSpend Verification Agent through ERC-8004.
2. Issue #8 creates and funds an ERC-8183 milestone job after its dependencies are complete.
3. The founder submits receipts, deliverables, and business context offchain.
4. AI produces structured evidence candidates, mappings, and explanations.
5. Deterministic policy produces `PASS`, `REVIEW`, or `FAIL` outcomes and internal eligibility.
6. An authorized human/evaluator approves an exact action.
7. The server prepares the transaction without submitting it.
8. Immediately before submission, the server revalidates intent, authorization, current state, expiry, balance, roles, and idempotency.
9. The provider submits the approved Proof-of-Progress deliverable hash.
10. The authorized evaluator completes or rejects the ERC-8183 job.
11. USDC settles or refunds through the job lifecycle.
12. The application confirms and reconciles the Arc result.
13. An independent address may record an ERC-8004 reputation result afterward.

ERC-8004 registration identifies an agent; it does not prove trustworthiness, correctness, auditing, or financial authority. The agent owner may not write reputation for its own agent. Internal `ELIGIBLE` and ERC-8183 `COMPLETED` are different states.

## MVP scenario

The fictional PawPOVAI InvestFest Soft Launch starts with 1,000 test USDC allocated in integer atomic units across Product and platform (350), Marketing (250), InvestFest travel (200), Operations (100), and Contingency (100).

Milestone 1, “Launch identity and outreach ready,” requires a visual identity asset, landing-page screenshot, promotional flyer, two expense records, eligible spend no greater than 150 USDC, and founder confirmation. The proposed next amount is 250 test USDC. The demo must show evidence review, deterministic outcomes, exact approval, and truthful mock or Arc lifecycle states without implying that preparation, submission, or internal eligibility equals settlement.

## Core modules

### LaunchVault Treasury

Maintains project capital and purpose reserves using integer atomic units and append-only ledger entries. It shows allocated, available, committed, settled/refunded, and remaining amounts; prevents duplicate allocation; and records reversals rather than deleting history.

### Deterministic Milestone Engine

Stores milestone requirements, spend limit, due date, proposed amount, and application status. Each requirement produces `PASS`, `REVIEW`, or `FAIL` with reason codes and next actions. Application states may include incomplete, needs review, eligible, approved intent, prepared, submitted, confirmed, released/refunded, and rejected, but must not reuse ERC-8183 terms inaccurately.

### Evidence Engine and Proof Recovery

Captures receipt images, screenshots, transactions, invoices, deliverables, business-purpose statements, and confirmations. Original evidence stays separate from AI-derived fields. Raw receipts and founder-private evidence remain offchain. Recovery identifies the highest-priority gap and asks one question at a time.

### Proof-of-Progress record

Creates an append-only, versioned application record containing requirement outcomes, approved evidence hashes, planned budget, deterministically verified spend, proposed amount, approval, timestamps, ERC-8183 job reference, deliverable commitment, and transaction lifecycle references as available. It is not automatically public or onchain, and a signed proof is not on the default path.

### Backer View

Shows only founder-approved information: capital summaries, reserve allocation, requirement outcomes, milestone progress, disclosed settlement/refund state, proof records, and disclosed risks. It hides raw receipts, private notes, unrelated activity, and credentials.

### Arc standards layer

- **Issue #13 / ERC-8004:** agent identity registration/verification and independent reputation governance only.
- **Issue #8 / ERC-8183:** job creation/funding, provider delivery, evaluator completion/rejection, settlement/refund, confirmation, and reconciliation only.

Issue #8 consumes the registered identity but does not absorb Issue #13.

## Agent architecture

The Founder Copilot routes and explains; Evidence Agent creates structured candidates; Milestone Agent explains deterministic results; Recovery Agent finds gaps; Backer Brief Agent summarizes approved disclosure. The ProofSpend Verification Agent has an ERC-8004 identity but no inherent trust or payment authority.

The complete Verification Agent orchestration—controlled OpenAI Agents SDK loop, structured evidence-service calls, policy explanation, human interruption, and transaction-proposal preparation—is a backlog gap requiring a dedicated future issue unless the live backlog assigns it elsewhere. It must prohibit direct submission.

## Circle execution boundary

Issue #7 depends on Issues #2, #3, and #4 and must choose the supported Circle execution architecture through an ADR before implementation. Preliminary research may happen earlier, but it cannot select the architecture or change runtime configuration.

Selectively evaluate patterns from Circle `packages/circle-tools` and `kits/openai-agents`, verifying current official documentation and preserving required attribution. Exclude `packages/agent-cli`, terminal UI, unrelated framework kits, Base/Polygon assumptions, and autonomous payment behavior. Mock and Arc adapters share typed application-owned interfaces but are explicitly selected and never silently interchanged.

ERC-8183 is the default MVP settlement primitive. A custom LaunchVault contract, wallet-signed proof, x402, and nanopayments are deferred and not part of the default implementation path.

## Conceptual records

Projects, vaults, reserves, ledger entries, milestones, requirements, evidence items, matches, policy decisions, proof records, approvals, exact transaction intents, prepared transactions, submissions, confirmations, reconciliation events, ERC-8004 registrations, ERC-8183 jobs/deliverables/evaluations/settlements/refunds, disclosure preferences, reputation results, proof gaps, and audit events.

## Security and governance

- Never commit secrets or expose privileged actions to the browser.
- Validate all external input with Zod and treat uploaded content as untrusted data.
- Validate chain, asset, addresses, roles, amount, balance, state, approval, expiry, and idempotency.
- Persist intent before execution and result afterward; revalidate immediately before submission.
- Keep preparation, approval, submission, confirmation, failure, and reconciliation separate.
- Preserve append-only audit history, corrections, and approvals.
- Keep private evidence offchain and use approved hashes/commitments only.
- Never describe the prototype as audited, production-ready, investment advice, tax advice, or guaranteed fraud prevention.

## UX principles

Be founder-first, accessible, responsive, and explicit. Display `ModeBadge` and role context on money/protocol screens. Visually distinguish mock, Arc Testnet, awaiting approval, prepared, submitted, confirmed, failed, rejected, refunded, and reconciled states. Never show a fabricated identifier as live. Explain every `REVIEW`/`FAIL` and why a milestone is not eligible. Separate private, shared, and onchain-public data.

Issue #14 uses only the Phase A–D structure in `docs/roadmap.md`.

## Testing

Test atomic arithmetic, allocation/rounding, deterministic policy, malformed agent output, duplicate evidence, invalid transitions, disclosure filtering, exact approvals, stale-intent rejection, idempotency, preparation/submission separation, ERC-8183 completion/rejection and settlement/refund, owner self-reputation prohibition, confirmation/reconciliation, and truthful UI states.

## Definition of done

A feature is complete only when its live acceptance criteria, dependencies, tests, build, error states, security/privacy boundaries, documentation, and reproducible evidence pass.
