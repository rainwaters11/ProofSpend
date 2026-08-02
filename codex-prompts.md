# Issue-scoped Codex prompts — ProofSpend LaunchVault

Open a fresh session for one live issue. Read `AGENTS.md`, the live issue, `design.md`, roadmap, dependency map, decision log, and applicable architecture records. Present a plan and observe required approval gates. Completed issue prompts are historical, not instructions to repeat work.

## Issue #1 — completed foundation

Issue #1 and PR #11 are complete. Do not rerun or rebuild the foundation.

## Issues #2–#6

```text
Implement only the selected live issue using launchvault-issue-builder.
Verify its dependencies and current implementation first. Preserve integer atomic
money, explicit state transitions, append-only audit events, original versus
AI-derived evidence, private offchain evidence, deterministic PASS/REVIEW/FAIL,
and founder-controlled disclosure. Do not add Circle execution or adjacent scope.
```

## Issue #7 — Circle execution ADR and adapter

```text
Implement GitHub Issue #7 only using launchvault-issue-builder and
arc-standards-integration. Confirm Issues #2, #3, and #4 are complete.

First re-audit current official Circle and Arc sources and produce an ADR that
chooses the supported execution architecture. Do not implement until the ADR is
approved. Never invent commands, identifiers, addresses, outputs, or variables.

Selectively evaluate packages/circle-tools and kits/openai-agents. Exclude
packages/agent-cli, terminal UI, unrelated framework kits, and autonomous
payment behavior. Separate reads, preparation, exact approval, immediate
pre-submit revalidation, submission, confirmation, and reconciliation. Never
silently fall back from Arc Testnet to mock and execute no transaction without
separate approval.
```

## Issue #13 — ERC-8004 identity and reputation governance

```text
Implement GitHub Issue #13 only using launchvault-issue-builder and
arc-standards-integration. Confirm Issues #2 and #7 are complete.

Register and verify the ProofSpend Verification Agent identity through ERC-8004
and define independent reputation governance. Registration is not proof of
trustworthiness, correctness, auditing, or authority. The agent owner may not
write reputation for its own agent.

Do not implement ERC-8183 or the complete Verification Agent/OpenAI Agents SDK
runtime. Preserve the documented backlog gap.
```

## Issue #8 — ERC-8183 jobs and settlement

```text
Implement GitHub Issue #8 only using launchvault-issue-builder and
arc-standards-integration. Confirm Issues #4, #5, #6, #7, and #13 are complete.

Implement ERC-8183 job creation/funding, provider delivery-hash submission,
authorized evaluator completion/rejection, settlement/refund, confirmation,
and reconciliation. Consume the Issue #13 identity without absorbing identity
or reputation scope. Keep raw/private evidence offchain and internal ELIGIBLE
separate from ERC-8183 COMPLETED. AI may not approve, evaluate, or submit a
value-moving action. ERC-8183 is the default MVP settlement primitive.
```

## Issue #14 — frontend phases

```text
Implement only the approved live Issue #14 phase using launchvault-issue-builder
and launchvault-ui-quality. Do not invent additional phases or product behavior.

Phase A: semantic design tokens; shadcn foundation; responsive shell;
navigation; ModeBadge and RoleBadge; UI source/license documentation.

Phase B: truthful landing page; Fund → Prove → Unlock; architecture and
governance; prototype and Arc Testnet disclaimers.

Phase C: founder, treasury, milestone, evidence, evaluator, Backer View, and
activity compositions only as their domain contracts become available.

Phase D: accessibility; mobile/tablet hardening; reduced motion; Playwright;
visual regression where feasible; performance and bundle review.

Take screenshots for perceptible changes. Distinguish private/shared/public and
mock/testnet/prepared/submitted/confirmed/rejected/refunded/reconciled states.
```

## Issue #16 — architecture synchronization

```text
Implement GitHub Issue #16 only. Synchronize the approved documentation and
repository-local skills with the Arc-native authority model, issue dependencies,
separate ERC-8004 and ERC-8183 scopes, and four approved Issue #14 phases.
Do not change application behavior, dependencies, CI runtimes, wallets,
contracts, environment configuration, or network configuration.
```

## Issues #9 and #10

```text
Use launchvault-issue-builder for the selected issue. For release review also
use launchvault-release-review, arc-standards-integration, and
launchvault-ui-quality. Demonstrate only implemented behavior; verify privacy,
authorization, protocol evidence, exact transaction states, reconciliation,
accessibility, fallbacks, and disclosed limitations.
```

## Backlog gap

After Issue #16, create a dedicated issue for the complete Verification Agent runtime unless the live backlog explicitly assigns it elsewhere. Scope: controlled OpenAI Agents SDK tool loop, structured evidence-service calls, deterministic-policy explanation, human interruption, transaction-proposal preparation, and direct-submission prohibition.

Custom contracts, signed proof, x402, and nanopayments are not default prompts or MVP dependencies.
