# Step-by-Step Codex Prompts — ProofSpend LaunchVault

## Usage

Open a fresh Codex session for each issue. Ask for a plan first. Do not paste the whole file into one session.

---

## Prompt 0 — Audit only

```text
You are the senior technical lead for ProofSpend LaunchVault.

Read:
- AGENTS.md
- design.md
- skills.md
- START_HERE.md
- MIGRATION_FROM_ORIGINAL_PACK.md
- GitHub Issue 1

Inspect the current ProofSpend repository and the public Circle repository
circlefin/agent-stack-starter-kits.

Do not modify files. Do not clone arc-node.

Report:
1. current repository structure;
2. useful Circle starter packages;
3. the OpenAI Agents kit version and runtime requirements;
4. the recommended workspace layout;
5. files to preserve, copy, adapt, or omit;
6. proposed apps/web structure;
7. environment-variable names without values;
8. dependency or version risks;
9. exact commands to run;
10. exact Issue 1 implementation plan.

Wait for approval.
```

---

## Prompt 1 — Foundation

```text
Implement GitHub Issue 1 only using the launchvault-issue-builder skill.

Before editing, inspect and present a concise plan. Wait for approval.

After approval:
- preserve README, .gitignore, AGENTS.md, design.md, and local skills;
- reuse only the Circle OpenAI Agents and shared Circle tooling needed;
- create apps/web with Next.js App Router and strict TypeScript;
- add Zod environment validation;
- add explicit mock mode and safe health endpoint;
- establish lint, typecheck, tests, and production build;
- do not implement vaults, milestones, evidence, database, contract, or live transfers.

Run all available checks and return the AGENTS.md completion report.
```

---

## Prompt 2 — Domain and mock infrastructure

```text
Implement GitHub Issue 2 only using the launchvault-issue-builder skill.

Create Zod schemas, domain types, repositories, state machines, audit events,
mock wallet, and seeded PawPOVAI data.

Use integer atomic units. Invalid transitions must return typed errors and
must not mutate state. Add comprehensive tests.

Do not add Supabase or live Circle calls.
```

---

## Prompt 3 — Treasury and reserves

```text
Implement GitHub Issue 3 only using the launchvault-issue-builder skill.

Build deterministic LaunchVault Treasury and Smart Reserves.

Seed 1,000 USDC and allocate:
- 35% Product and platform
- 25% Marketing
- 20% InvestFest travel
- 10% Operations
- 10% Contingency

Require founder approval, deterministic rounding, atomic units, ledger-based
reversals, and idempotency. Add a minimal API and dashboard panel. Test all
boundary cases. Do not implement milestone or evidence features.
```

---

## Prompt 4 — Milestone Engine

```text
Implement GitHub Issue 4 only using the launchvault-issue-builder skill.

Create Milestone 1: Launch identity and outreach ready.

Requirements:
- logo/identity asset;
- landing-page screenshot;
- promotional flyer;
- two verified expense records;
- eligible spend <= 150 USDC;
- founder confirmation.

Release proposal: 250 USDC.

Build deterministic requirement evaluation, reason codes, next actions,
state transitions, authorization gates, and duplicate-release protection.
The LLM may summarize but cannot set final status.
```

---

## Prompt 5 — Evidence and recovery

```text
Implement GitHub Issue 5 only using the launchvault-issue-builder skill.

Support safe evidence capture for receipt images, screenshots, deliverables,
and natural-language business context.

Return strict structured candidates with extracted/inferred distinction,
confidence, evidence hashes, missing fields, and warnings.

Map evidence to milestone requirements. Add one Proof Recovery scenario for a
transaction missing business purpose. Treat uploaded content as untrusted.
Use synthetic fixtures and add failure tests.
```

---

## Prompt 6 — Proof record and Backer View

```text
Implement GitHub Issue 6 only using the launchvault-issue-builder skill.

Generate a structured Proof-of-Progress record when Milestone 1 is eligible.
Include requirement outcomes, evidence hashes, planned budget, verified
spend, proposed release, and timestamps.

Build founder-controlled disclosure preferences and a selective Backer View.
Raw receipts, private notes, and unrelated projects must remain hidden by
default. Add disclosure and authorization tests.
```

---

## Prompt 7 — Circle and Arc Testnet

```text
Implement GitHub Issue 7 only using the launchvault-issue-builder skill.

Inspect current official Circle Agent Stack docs and the repository's Circle
code before implementation. Do not invent commands, variables, chain IDs, or
contract addresses.

Create WalletProvider methods for status, address, balance, transfer
preparation, execution, and transaction status. Implement mock and Circle
adapters. Require explicit mode, server-only credentials, Arc Testnet, USDC,
human approval, balance checks, address checks, and idempotency.

Execute no transfer until I separately approve live/testnet execution.
```

---

## Prompt 8 — Decide signed proof versus contract

```text
Implement the decision phase of GitHub Issue 8 only.

Compare:
A. EIP-712 or wallet-signed Proof-of-Progress record;
B. minimal LaunchVault smart contract for milestone tranche release.

Evaluate judging value, implementation time, attack surface, Circle support,
Arc Testnet reliability, demo clarity, and fallback behavior.

Recommend one. Present architecture, security assumptions, files, tests, and
exact implementation sequence. Wait for approval before coding or deploying.
```

### RemixAI prompt if a contract is approved

```text
Act as a senior Solidity security engineer.

Create the smallest non-upgradeable LaunchVault contract needed to fund a
project and release milestone tranches on Arc Testnet.

Use Solidity ^0.8.24 and audited OpenZeppelin components. No platform token,
no proxy, no investment return logic, and no autonomous release.

Required protections:
- SafeERC20;
- role-based authorization;
- pausable;
- reentrancy protection;
- custom errors;
- idempotent vault and milestone IDs;
- no duplicate release;
- no release without approval;
- refund rule;
- events;
- complete tests.

First state the purpose, roles, trust assumptions, attacks, and why a contract
is superior to a signed proof for this MVP. Wait for approval before final code.
```

---

## Prompt 9 — Guided demo

```text
Implement GitHub Issue 9 only using the launchvault-issue-builder skill.

Build a polished guided founder and backer demo:
1. create PawPOVAI LaunchVault;
2. receive/seed 1,000 USDC;
3. allocate reserves;
4. show Milestone 1;
5. submit evidence;
6. resolve missing business purpose;
7. calculate eligibility;
8. approve 250 USDC release;
9. execute mock or configured Arc Testnet tranche;
10. update the Backer View.

Include clear mock/testnet labels, accessible mobile UI, all states, demo
reset, and Playwright tests. Never label a fake hash as live.
```

---

## Prompt 10 — Release review

```text
Use the launchvault-release-review skill.

Audit ProofSpend LaunchVault for the Arc submission, Swarm Village demo, and
InvestFest preview. Do not add new scope until the audit is complete.

Run all available checks, complete the seeded demo, review security and
privacy boundaries, verify transaction evidence, and return a release
decision with exact remediation order.

Also produce:
- Arc three-minute script;
- Swarm Village agent walkthrough;
- InvestFest 30-second customer pitch;
- screenshots/evidence checklist;
- safe fallback plan;
- final README corrections.
```
