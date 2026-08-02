---
name: launchvault-ui-quality
description: Review one approved LaunchVault frontend phase for accessibility, privacy, source compliance, and truthful money and protocol states.
---

# LaunchVault UI Quality

1. Read the live Issue #14 phase, `AGENTS.md`, design, roadmap, dependency map, decisions, and available domain contracts. Do not invent phases or behavior.
2. **Phase A:** review semantic tokens, shadcn foundation, responsive shell, navigation, `ModeBadge`, `RoleBadge`, and UI source/license documentation.
3. **Phase B:** review truthful landing content, Fund → Prove → Unlock, architecture/governance explanation, and prototype/Arc Testnet disclaimers.
4. **Phase C:** review only domain-backed founder, treasury, milestone, evidence, evaluator, Backer View, and activity compositions.
5. **Phase D:** review accessibility, mobile/tablet hardening, reduced motion, Playwright, feasible visual regression, performance, and bundle impact.
6. Verify founder-private, backer-shared, and onchain-public data are distinct; raw/private evidence is never leaked through UI, URLs, metadata, or logs.
7. Verify mock, Arc Testnet, awaiting approval, prepared, submitted, confirmed, failed, rejected, refunded, and reconciled states are visibly and technically distinct. Internal `ELIGIBLE` is not ERC-8183 `COMPLETED`.
8. Verify exact action details are reviewable before submission; fake/example job IDs or hashes are clearly labeled.
9. Verify empty, loading, review, blocked, success, and error paths, reason codes, keyboard/screen-reader behavior, contrast, responsive layouts, and reduced motion as in scope.
10. Reject claims of auditing, guaranteed fraud prevention, investment safety, production readiness, or trust based solely on registration.
11. Take screenshots for perceptible changes and return `READY`, `READY WITH LIMITATIONS`, or `BLOCKED` with exact evidence and remediations.
