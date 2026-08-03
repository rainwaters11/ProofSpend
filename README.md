# ProofSpend LaunchVault

**Fund the vision. Prove the progress. Unlock what comes next.**

<p align="center">
  <img src="proofspend-launchvault-hero.png" alt="ProofSpend LaunchVault product vision showing Smart Reserves, Proof-of-Progress, ERC-8004 agent identity, ERC-8183 milestone escrow, the Evidence Engine, and the LaunchVault Treasury" width="100%" />
</p>

<p align="center"><em>Product vision — mock foundation complete; Arc Testnet capabilities are in active development.</em></p>

ProofSpend LaunchVault is an evidence-aware programmable capital platform for founders, solopreneurs, and the people who fund their work. It connects business capital, milestone requirements, receipts, deliverables, deterministic policy, human approval, and Arc Testnet settlement into one accountable workflow.

> **Current status:** The technical foundation and Arc-native architecture are complete. The application currently runs in explicit mock mode, and no real funds are being moved. Smart Reserves, evidence workflows, ERC-8004 identity, ERC-8183 settlement, and the premium product interface are in active development.

## Why ProofSpend

Founders often manage business funding across receipts, spreadsheets, wallets, messages, and disconnected applications. That makes it difficult to answer three important questions:

1. What was the money intended to support?
2. What progress and evidence exist?
3. Should the next funding tranche be released?

ProofSpend is designed to turn those scattered records into verifiable, privacy-conscious Proof-of-Progress without allowing artificial intelligence to independently control money.

## The core workflow

```text
Fund capital
    ↓
Allocate purpose-based Smart Reserves
    ↓
Define milestone requirements
    ↓
Collect receipts, deliverables, transactions, and business purpose
    ↓
Evaluate evidence with deterministic policy
    ↓
Obtain explicit authorized human approval
    ↓
Submit and confirm the Arc Testnet action
    ↓
Share a selective Proof-of-Progress record with backers
```

## Planned product capabilities

### Smart Reserves
Organize incoming capital into protected categories such as product, marketing, travel, operations, and contingency while clearly separating available, allocated, escrowed, and settled funds.

### Evidence Engine
Connect receipts, deliverables, transaction records, and business-purpose statements to milestone requirements. Missing or uncertain proof is routed through a guided Proof Recovery workflow.

### Proof-of-Progress
Create privacy-safe records that show what was completed, what evidence supported the decision, which policy rules passed, and what funding action followed—without exposing raw private receipts.

### ERC-8004 verification-agent identity
Register the ProofSpend Verification Agent with an onchain identity and clear capability metadata. Agent identity answers who performed the evidence evaluation; it does not grant independent authority to move funds or write self-reputation.

### ERC-8183 milestone jobs and settlement
Represent the lifecycle of a funded milestone from job creation and escrow funding through deliverable submission, evaluation, completion, rejection, expiration, payout, or refund.

### Founder and Backer Views
Give founders a working treasury and evidence workspace while giving backers a selective view of verified progress, milestone status, agent identity, proof references, and settlement outcomes.

## Governance by design

ProofSpend separates automation into four decision layers:

1. **AI assistance** extracts, classifies, summarizes, and explains evidence.
2. **Deterministic policy** evaluates requirements and returns explicit outcomes such as PASS, REVIEW, or FAIL.
3. **Authorized human approval** confirms the exact financial action.
4. **Server-side execution** prepares, submits, and confirms the Arc Testnet transaction through a typed adapter.

The agent must never independently authorize or submit a value-moving action.

## What is working now

The merged foundation includes:

- Bun monorepo workspace
- Next.js App Router application
- Strict TypeScript configuration
- Zod-based server environment validation
- Explicit credential-free mock mode
- Typed Circle wallet integration boundary
- Deterministic `MockWalletProvider`
- Safe `/api/health` endpoint
- Repository-wide lint, typecheck, test, and build scripts
- Frozen dependency installation in GitHub Actions
- Fourteen implemented tests passing in CI
- Arc and Circle architecture, dependency, roadmap, and governance documentation

## Arc and Circle architecture

ProofSpend is being built for the **Payments track** of the Programmable Money Hackathon on Arc.

- **Arc Testnet** provides the programmable settlement environment.
- **Circle wallet infrastructure** will provide the approved wallet and contract-execution path after the Issue #7 architecture decision record is completed.
- **ERC-8004** provides registered agent identity and reputation boundaries.
- **ERC-8183** provides the milestone-job, escrow, evaluation, and settlement lifecycle.
- **ProofSpend** provides the evidence, policy, governance, treasury, and selective disclosure layer connecting those standards to real founder workflows.

See [`docs/architecture/arc-agentic-capital.md`](docs/architecture/arc-agentic-capital.md), [`docs/dependency-map.md`](docs/dependency-map.md), and [`docs/roadmap.md`](docs/roadmap.md) for the current technical plan.

## Demo scenario

The guided demo follows a founder preparing a PawPOVAI soft launch:

- capital is allocated into purpose-based reserves;
- a launch milestone is funded;
- receipts and deliverables are connected to the milestone;
- the Evidence Engine identifies any proof gaps;
- deterministic policy evaluates eligibility;
- an authorized human approves the action;
- an Arc Testnet settlement is prepared and confirmed;
- a privacy-safe Proof-of-Progress record is shared with the backer.

## Repository structure

```text
apps/web/                  Next.js application
packages/domain/           Deterministic business and state-transition models
packages/circle-adapter/   Mock and future Circle integration boundaries
packages/shared/           Shared constants and utilities
docs/                      Architecture, roadmap, decisions, and upstream audits
.agents/skills/            Repository-local Codex implementation and review skills
```

## Run the foundation locally

### Requirements

- Node.js 20.18.2 or newer
- Bun 1.2.14 or newer

```bash
bun install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
bun run lint
bun run typecheck
bun run test
bun run build
bun --filter @proofspend/web dev
```

Open `http://localhost:3000`.

The safe health endpoint is available at:

```text
http://localhost:3000/api/health
```

## Safety and truthfulness boundaries

- The current application is a mock-mode and Arc Testnet prototype.
- No real funds are moved by the current foundation.
- Mock behavior must never fabricate a transaction hash.
- Raw receipts and founder-private evidence remain offchain.
- AI recommendations are not approvals.
- This project is not tax, legal, investment, or accounting advice.
- ProofSpend does not claim to eliminate fraud or guarantee funding outcomes.

## Roadmap

The active implementation order is maintained in [`docs/roadmap.md`](docs/roadmap.md) and the repository Issues tab. Major phases include:

1. Deterministic domain models and state machines
2. Premium design system and responsive application shell
3. Smart Reserves and LaunchVault treasury
4. Milestone and Evidence Engines
5. Proof-of-Progress and Backer View
6. Circle wallet architecture and integration
7. ERC-8004 verification-agent registration
8. ERC-8183 milestone escrow and Arc Testnet settlement
9. Guided founder and backer demo
10. Security, accessibility, deployment, and submission review

---

**ProofSpend LaunchVault** gives founders greater control over their capital and gives backers verifiable evidence that meaningful progress happened before the next dollar is released.
