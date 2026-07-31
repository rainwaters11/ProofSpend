---
name: launchvault-release-review
description: Audit ProofSpend LaunchVault before a checkpoint, demo, deployment, InvestFest preview, or hackathon submission. Use for release readiness and demo truthfulness, not for building several new features.
---

# LaunchVault Release Review

1. Read `AGENTS.md`, `design.md`, and the current milestone.
2. Inspect repository status and uncommitted work.
3. Run lint, typecheck, tests, end-to-end tests, and production build.
4. Reset and complete the guided demo.
5. Verify mock and Arc Testnet labels.
6. Verify any displayed live transaction hash and network.
7. Review secrets, uploads, prompt injection, state transitions, duplicate releases, authorization, idempotency, private/backer disclosure, and audit completeness.
8. Compare behavior to issue acceptance criteria.
9. Return `READY`, `READY WITH DISCLOSED LIMITATIONS`, or `NOT READY` with exact reasons and smallest next actions.
10. Never claim audited, production-ready, tax-compliant, investment-safe, or fraud-proof.
