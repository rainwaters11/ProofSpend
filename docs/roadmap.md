# LaunchVault roadmap

Live issues are authoritative. This roadmap records the approved default order and prevents dependency or scope drift.

## Default implementation order

1. Issue #16 — synchronize architecture and repository guidance.
2. Issue #2 — domain, state machines, repositories, and mock data.
3. Issue #14 Phase A.
4. Issue #3 — Treasury and Smart Reserves.
5. Issue #4 — deterministic Milestone Engine.
6. Issue #14 Phase B and eligible portions of Phase C.
7. Issue #5 — Evidence Engine and Proof Recovery.
8. Issue #6 — Proof-of-Progress and Backer View.
9. Issue #7 — Circle execution ADR and approved adapter implementation.
10. Issue #13 — ERC-8004 identity and reputation governance.
11. Issue #8 — ERC-8183 milestone-job lifecycle and settlement.
12. Issue #14 Phase D.
13. Issue #9 — guided demo.
14. Issue #10 — security, deployment, and submission.

## Issue #14 approved phases

### Phase A

Semantic design tokens; shadcn foundation; responsive application shell; navigation; `ModeBadge` and `RoleBadge`; UI source and license documentation.

### Phase B

Truthful landing page; Fund → Prove → Unlock; product architecture and governance; prototype and Arc Testnet disclaimers.

### Phase C

Founder, treasury, milestone, evidence, evaluator, Backer View, and activity compositions as corresponding domain contracts become available. Eligible portions may ship incrementally; UI may not invent unavailable behavior.

### Phase D

Accessibility; mobile and tablet hardening; reduced motion; Playwright; visual regression where feasible; performance and bundle review.

## Gates

- Issue #7 depends on #2, #3, and #4. Preliminary Circle research may be documented earlier, but implementation and architecture selection wait for its ADR gate.
- Issue #13 depends on #2 and #7 and covers ERC-8004 only.
- Issue #8 depends on #4, #5, #6, #7, and #13 and covers ERC-8183 only.
- Issue #8 may consume Issue #13's identity but may not absorb its scope.

## Backlog gap

Create a dedicated future issue for complete Verification Agent orchestration unless the live backlog explicitly assigns it elsewhere: controlled OpenAI Agents SDK tool loop, structured evidence-service calls, deterministic-policy explanation, human-interruption request, transaction-proposal preparation, and prohibition against direct submission.

## Deferred/non-default

Signed proof, a custom LaunchVault contract, x402, and nanopayments are not on the default MVP path. ERC-8183 is the default settlement primitive.
