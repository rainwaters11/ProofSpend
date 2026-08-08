# Start here — ProofSpend LaunchVault

ProofSpend LaunchVault is an Arc Testnet prototype for evidence-aware programmable capital. Issue #1 and merged PR #11 established the Bun/Next.js foundation at commit `5a3483fed9948fc592b03c9df6dc0dd437bce0c9`.

## Before working

1. Read the complete live issue and acceptance criteria.
2. Read `AGENTS.md` and `design.md`.
3. Read [`docs/roadmap.md`](docs/roadmap.md), [`docs/dependency-map.md`](docs/dependency-map.md), and [`docs/decision-log.md`](docs/decision-log.md).
4. For Arc work, read [`docs/architecture/arc-agentic-capital.md`](docs/architecture/arc-agentic-capital.md).
5. Use one issue, branch, and pull request at a time. Keep `main` as the only long-lived branch.

## Architecture in one view

AI extracts and explains evidence. Deterministic policy produces `PASS`, `REVIEW`, or `FAIL` and calculates internal eligibility. An authorized human/evaluator approves an exact action. A server-side adapter separately prepares, submits, confirms, and reconciles the Arc Testnet transaction.

Issue #13 owns ERC-8004 identity and reputation governance. Issue #8 owns ERC-8183 jobs and settlement; it consumes but does not absorb Issue #13. Private evidence stays offchain, registration is not trust, owner self-reputation is prohibited, and `ELIGIBLE` is not `COMPLETED`.

## Current order

Issue #16 → #2 → #14 Phase A → #3 → #4 → #14 Phase B and eligible Phase C portions → #5 → #6 → #7 → #13 → #8 → #14 Phase D → #9 → #10.

Issue #7's ADR-001 (`docs/architecture/adr-001-circle-execution-architecture.md`) selects **Circle Developer-Controlled Wallets** as the Arc Testnet custody and contract-execution path; the #2/#3/#4 dependency gate is cleared and only adapter implementation details remain. Circle patterns may be researched earlier. Consider only `packages/circle-tools` and `kits/openai-agents` selectively; exclude `packages/agent-cli`, terminal UI, unrelated framework kits, and autonomous payments.

Issue #14 uses only the approved four phases documented in the roadmap. The complete Verification Agent runtime is a backlog gap requiring a dedicated future issue unless the live backlog explicitly assigns it elsewhere.

## Validation

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
```
