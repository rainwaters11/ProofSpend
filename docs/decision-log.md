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

### D-010 — Issue #32 owns the bounded Verification Agent runtime

Issue #32 is the dedicated submission-ready implementation issue. It owns one server-only PawPOVAI orchestrator, one explicit OpenAI Responses API call in live mode, strict structured boundaries, one Proof Recovery question, deterministic re-evaluation, an exact 1 USDC non-authorizing proposal, and a hard stop at `APPROVAL_REQUIRED`. It does not own Circle submission, ERC-8004, ERC-8183, or generalized agent infrastructure.

### D-011 — Circle execution architecture selected (ADR-001)

ADR-001 (`docs/architecture/adr-001-circle-execution-architecture.md`) selects **Circle Developer-Controlled Wallets** as the single primary custody and contract-execution path for Arc Testnet. The Agent Stack CLI and user-controlled wallets are rejected alternatives. The typed adapter boundary must preserve separate preparation, submission, confirmation, and reconciliation operations. Issues #2, #3, and #4 are complete, and PR #31 cleared the Node.js 22.6+ runtime gate. Issue #7 still owns the bounded adapter implementation.

## Unresolved decisions

Issue #7 remains open for the reduced Arc Testnet transfer adapter. Its implementation must keep credentials server-side, use pre-created wallets, require an exact persisted human-approved intent, preserve idempotency, and return only truthful submission, confirmation, failure, transaction-hash, and explorer evidence. ERC-8004, full ERC-8183, generalized wallet management, and production custody operations remain separate work.
