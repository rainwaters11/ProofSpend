---
name: launchvault-issue-builder
description: Implement one scoped ProofSpend LaunchVault GitHub issue from inspection through tests and completion reporting. Use for a numbered feature or bug issue. Do not use for broad multi-issue builds.
---

# LaunchVault Issue Builder

1. Read root `AGENTS.md`.
2. Read the relevant `design.md` sections.
3. Read the full issue and acceptance criteria.
4. Inspect code, tests, schemas, scripts, and existing Circle integration.
5. Present current behavior, proposed files, sequence, risks, assumptions, and tests.
6. Wait for approval when required by `AGENTS.md`.
7. Implement only the issue.
8. Add or update tests.
9. Run the narrow checks, then full required checks when feasible.
10. Review the diff for money arithmetic, authorization, idempotency, secrets, disclosure boundaries, and mock/testnet confusion.
11. Update documentation.
12. Return the required completion report.

Stop rather than invent current Circle commands, Arc values, contract addresses, or external API behavior.
