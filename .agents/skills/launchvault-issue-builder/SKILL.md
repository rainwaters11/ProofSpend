---
name: launchvault-issue-builder
description: Implement one scoped ProofSpend LaunchVault GitHub issue from dependency verification through tests and completion reporting.
---

# LaunchVault Issue Builder

1. Read root `AGENTS.md`, the complete live issue, relevant `design.md` sections, `docs/roadmap.md`, `docs/dependency-map.md`, `docs/decision-log.md`, and applicable architecture records.
2. Confirm the issue's live dependencies are complete. Issue #7 requires #2/#3/#4; #13 requires #2/#7; #8 requires #4/#5/#6/#7/#13.
3. Inspect current code, tests, schemas, scripts, adapters, and documentation before editing.
4. Present current behavior, exact files, sequence, risks, assumptions, and tests. Wait where approval is required.
5. Use `arc-standards-integration` for Circle, Arc transactions, ERC-8004, ERC-8183, or reputation work.
6. Use `launchvault-ui-quality` for perceptible UI or money/protocol-state presentation.
7. Implement only the issue and add/update tests without silently filling backlog gaps.
8. Keep Issue #13 limited to ERC-8004 identity/reputation governance; do not add the complete Verification Agent runtime.
9. Keep Issue #8 limited to ERC-8183 jobs and settlement; do not absorb Issue #13.
10. Run narrow checks, then all required repository checks when feasible.
11. Review the diff for atomic money, authorization, role separation, offchain evidence, exact intent, prepare/submit separation, immediate revalidation, idempotency, secrets, disclosure, audit integrity, confirmation/reconciliation, owner self-reputation, and truthful mock/testnet/transaction states.
12. Update documentation and return the required completion report.

Stop rather than invent Circle commands, Arc identifiers, contract addresses, protocol behavior, or external API behavior. Do not begin Issue #7 implementation before Issues #2, #3, and #4 are complete.
