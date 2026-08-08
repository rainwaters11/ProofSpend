# LaunchVault decision log

## Accepted decisions

### D-001 — Four-layer authority model

AI assists with evidence; deterministic code calculates outcomes; an authorized human/evaluator approves an exact action; a server-side adapter prepares, submits, confirms, and reconciles. AI cannot independently move value.

### D-002 — Separate standards and issue ownership

Issue #13 owns ERC-8004 identity and reputation governance. Issue #8 owns ERC-8183 jobs, escrow, delivery, evaluation, completion/rejection, settlement, and refund. Issue #8 consumes but does not absorb Issue #13.

### D-003 — Identity is not trust

ERC-8004 registration identifies the agent but does not prove trustworthiness, correctness, auditing, or authority. The agent owner may not write reputation for its own agent; reputation results require an independent address.

### D-004 — Private evidence stays offchain

Raw receipts, founder notes, and other private evidence remain offchain. Approved hashes or commitments may be referenced onchain.

### D-005 — Application and protocol states differ

Deterministic requirements use `PASS`, `REVIEW`, or `FAIL`. Internal `ELIGIBLE` is not ERC-8183 `COMPLETED`.

### D-006 — Transaction lifecycle separation

Preparation, exact approval, submission, confirmation, and reconciliation are separate persisted operations. Approved intent is revalidated immediately before submission; idempotency is mandatory.

### D-007 — ERC-8183 is the default MVP settlement primitive

A custom contract, signed proof, x402, and nanopayments are not on the default path. Reconsider a custom contract only through a separately approved ADR demonstrating a protocol gap.

### D-008 — Circle execution waits for Issue #7

Issue #7 depends on #2/#3/#4 and must approve an ADR before implementation. Selectively evaluate `packages/circle-tools` and `kits/openai-agents`; exclude `packages/agent-cli`, terminal UI, unrelated framework kits, and autonomous payment behavior.

### D-009 — Issue #14 uses four phases

Use only approved Phases A–D as recorded in `roadmap.md`; compositions ship only when supported by real domain contracts.

### D-010 — Verification Agent runtime scope is bounded and implemented in Issue #32

Issue #32 delivers the judge-facing, server-only Verification Agent orchestrator for the seeded PawPOVAI flow. It performs one bounded model analysis step, uses strict schema-validated deterministic tools, asks exactly one missing-receipt question, applies one validated founder correction, re-evaluates deterministically, prepares the exact 250 USDC non-authorizing proposal, and stops at `APPROVAL_REQUIRED`. Human approval and typed adapter execution remain outside the model loop. Issue #13 does not silently own this runtime, and Issue #8 still owns ERC-8183 settlement lifecycle behavior.

### D-011 — Circle execution architecture selected (ADR-001)

ADR-001 (`docs/architecture/adr-001-circle-execution-architecture.md`) selects **Circle Developer-Controlled Wallets** as the single primary custody and contract-execution path for Arc Testnet. The Agent Stack CLI and user-controlled wallets are rejected alternatives. The typed adapter boundary must be extended or replaced to add contract-call representation and separate submission, confirmation, and reconciliation operations. Issues #2, #3, and #4 are complete, so the architecture dependency gate is cleared and ADR-001 is accepted as the decision. Issue #7 acceptance still requires the Node.js 22.6+ runtime and CI upgrade the selected SDK needs, plus adapter implementation; this ADR records the decision only and does not change runtime configuration.

## Unresolved decisions

Issue #7 remains open. Before adapter implementation, the repository runtime and CI must be upgraded to Node.js 22.6+ (the selected Developer-Controlled Wallets SDK requirement; the repo currently documents and runs Node 20.18.2), the upstream-source audit and software-composition record must be completed, and adapter implementation work must define ERC-8004 controller/recovery details, independent reputation writer, ERC-8183 role addresses, deliverable commitment encoding, exact intent schema, confirmation/reconciliation policy, and deterministic rejection/refund recovery without inventing protocol deployment details here.
