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

### D-010 — Verification Agent runtime is a backlog gap

After Issue #16, create a dedicated implementation issue unless the live backlog explicitly assigns the work elsewhere. It must cover controlled OpenAI Agents SDK orchestration, structured evidence-service calls, deterministic-policy explanation, human interruption, transaction-proposal preparation, and direct-submission prohibition. Issue #13 does not silently own this runtime.

### D-011 — Circle execution architecture selected (ADR-001)

ADR-001 (`docs/architecture/adr-001-circle-execution-architecture.md`) selects **Circle Developer-Controlled Wallets** as the single primary custody and contract-execution path for Arc Testnet. The Agent Stack CLI and user-controlled wallets are rejected alternatives. The typed adapter boundary must be extended or replaced to add contract-call representation and separate submission, confirmation, and reconciliation operations. Issues #2, #3, and #4 are complete, so the dependency gate is cleared and ADR-001 is accepted; only adapter implementation details remain for Issue #7.

## Unresolved decisions

Circle adapter implementation remains open for Issue #7. Implementation work must define ERC-8004 controller/recovery details, independent reputation writer, ERC-8183 role addresses, deliverable commitment encoding, exact intent schema, confirmation/reconciliation policy, and deterministic rejection/refund recovery without inventing protocol deployment details here.
