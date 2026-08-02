---
name: launchvault-release-review
description: Audit ProofSpend LaunchVault release readiness, protocol evidence, privacy, and UI truthfulness without adding scope.
---

# LaunchVault Release Review

1. Read `AGENTS.md`, `design.md`, the live milestone/issues, roadmap, dependency map, decisions, and Arc architecture record.
2. Inspect status and uncommitted work; confirm dependencies and the Issue #7 ADR for any Circle execution implementation.
3. Run lint, typecheck, tests, end-to-end checks, and production build as available.
4. Use `arc-standards-integration` to review any ERC-8004 identity claim, independent reputation writer, ERC-8183 roles/job/funding/deliverable/evaluation/settlement/refund, exact intent, submission, confirmation, and reconciliation evidence.
5. Use `launchvault-ui-quality` to review the applicable Issue #14 phase, accessibility, privacy, and all visible money/protocol states.
6. Reset and complete the guided demo; verify any displayed network, job identifier, transaction hash, result, and limitation.
7. Confirm raw/private evidence remains offchain; registration is not presented as trust; the owner does not write its agent's reputation; internal `ELIGIBLE` is not represented as ERC-8183 `COMPLETED`.
8. Confirm preparation, exact approval, immediate pre-submit revalidation, submission, confirmation, failure, refund, and reconciliation are separate and truthfully represented.
9. Review secrets, uploads, prompt injection, state transitions, duplicate settlement, authorization, idempotency, disclosure, audit completeness, and custom-contract non-default status.
10. Return `READY`, `READY WITH DISCLOSED LIMITATIONS`, or `NOT READY`, with exact reasons and smallest next actions.

Never claim audited, production-ready, tax-compliant, investment-safe, trustworthy merely because of registration, or fraud-proof.
