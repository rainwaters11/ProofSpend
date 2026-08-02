# ProofSpend LaunchVault issue index

Live GitHub issues and acceptance criteria are authoritative. This file is a synchronized roadmap aid; use one issue, branch, and pull request at a time. See [`docs/roadmap.md`](docs/roadmap.md) and [`docs/dependency-map.md`](docs/dependency-map.md).

## Issue #1 — Foundation (complete)

PR #11 established the Bun workspace, minimal Next.js application, Zod environment validation, explicit credential-free mock mode, typed wallet boundary, safe health endpoint, lockfile, and CI checks. It did not implement product features or live transfers.

## Issue #2 — Domain, state machines, and mock data

Create Zod schemas, integer-atomic-unit money types, explicit state machines, mock repositories/adapters, seeded fictional data, and append-only audit events. Invalid transitions must not mutate state.

## Issue #3 — Treasury and Smart Reserves

Build deterministic project capital allocation, founder-approved activation, ledger-based reversals, deterministic rounding, and duplicate-allocation protection.

## Issue #4 — Deterministic Milestone Engine

Evaluate requirements as `PASS`, `REVIEW`, or `FAIL`, return reason codes/next actions, calculate internal eligibility without an LLM, and prevent invalid or duplicate release transitions.

## Issue #5 — Evidence Engine and Proof Recovery

Validate untrusted evidence, preserve original versus AI-derived fields, hash evidence, record corrections, map evidence to requirements, and complete one recovery flow. Raw/private evidence remains offchain.

## Issue #6 — Proof-of-Progress and Backer View

Generate structured proof records from deterministic outcomes and implement founder-controlled disclosure. Backer View hides raw receipts and private notes by default.

## Issue #7 — Circle execution architecture ADR and adapter

**Dependencies:** Issues #2, #3, and #4.

First decide the supported Circle execution architecture through an ADR using current official sources. Only after approval, implement typed server-side boundaries for reads, preparation, submission, confirmation, and reconciliation. Require explicit mock/Arc selection, exact approvals, immediate pre-submit revalidation, Arc Testnet, USDC, role/address/amount/balance validation, and idempotency.

Selectively consider `packages/circle-tools` and `kits/openai-agents`. Exclude `packages/agent-cli`, terminal UI, unrelated framework kits, Base/Polygon assumptions, and autonomous payment behavior. Preliminary research may occur earlier; implementation may not.

## Issue #8 — ERC-8183 milestone-job lifecycle and settlement

**Dependencies:** Issues #4, #5, #6, #7, and #13.

Implement ERC-8183 job creation/funding, provider Proof-of-Progress deliverable-hash submission, authorized evaluator completion/rejection, USDC settlement/refund, confirmation, and reconciliation. Consume the registered identity from Issue #13 without absorbing its identity or reputation scope. Keep evidence offchain and internal `ELIGIBLE` distinct from ERC-8183 `COMPLETED`. ERC-8183 is the default MVP settlement primitive.

## Issue #9 — Guided founder and backer demo

Deliver the truthful three-minute Fund → Prove → Unlock flow using only implemented behavior. Distinguish mock, Arc Testnet, approval, prepared, submitted, confirmed, rejected, refunded, and reconciled states; never present fake identifiers as live.

## Issue #10 — Security, deployment, and submission

Complete security/privacy review, reproducible setup/reset, validation, deployment, demo evidence, pitches, and limitations without claims of auditing, investment performance, production readiness, or guaranteed fraud prevention.

## Issue #13 — ERC-8004 Verification Agent identity and reputation governance

**Dependencies:** Issues #2 and #7.

Register and verify the ProofSpend Verification Agent's ERC-8004 identity. Define ownership and independent reputation governance. Registration does not prove trustworthiness, correctness, auditing, or authority. The agent owner may not write reputation for its own agent.

Issue #13 does not implement ERC-8183 or the complete OpenAI Agents SDK runtime.

## Issue #14 — Frontend delivery in four phases

### Phase A

- semantic design tokens;
- shadcn foundation;
- responsive application shell;
- navigation;
- `ModeBadge` and `RoleBadge`;
- UI source and license documentation.

### Phase B

- truthful landing page;
- Fund → Prove → Unlock;
- product architecture and governance;
- prototype and Arc Testnet disclaimers.

### Phase C

Founder, treasury, milestone, evidence, evaluator, Backer View, and activity compositions as corresponding domain contracts become available. Do not fabricate unavailable behavior.

### Phase D

- accessibility;
- mobile and tablet hardening;
- reduced motion;
- Playwright;
- visual regression where feasible;
- performance and bundle review.

## Issue #16 — Synchronize repository architecture and roadmap

Align design, instructions, agent boundaries, issue index, prompts, roadmap, decision records, architecture, and executable skills without changing application behavior or dependencies.

## Backlog gap — complete Verification Agent runtime

A dedicated future issue must cover complete orchestration unless the live backlog explicitly assigns it elsewhere: controlled OpenAI Agents SDK tool loop, structured evidence-service calls, deterministic-policy explanation, human-interruption request, transaction-proposal preparation, and prohibition against direct submission. This work is not silently part of Issue #13 or #8.

## Deferred/non-default work

Custom LaunchVault contracts, signed proof, x402, nanopayments, generalized crowdfunding, production KYC, multi-chain routing, autonomous spending, and full BillBack require separate approval and are not on the default MVP path.
