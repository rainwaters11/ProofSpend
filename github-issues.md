# ProofSpend LaunchVault GitHub Issues

## Solo workflow

One issue → one branch → one pull request → merge to `main`.

## Labels

- `priority:p0`
- `priority:p1`
- `priority:p2`
- `type:feature`
- `type:bug`
- `type:test`
- `type:docs`
- `area:foundation`
- `area:vault`
- `area:milestones`
- `area:evidence`
- `area:agents`
- `area:circle`
- `area:backer-view`
- `area:frontend`
- `area:security`
- `codex-ready`
- `blocked`

## Milestones

1. Foundation
2. Fund and Allocate
3. Prove and Unlock
4. Arc and Demo

---

## Issue 1 — Audit Circle starter and scaffold LaunchVault

**Priority:** P0  
**Milestone:** Foundation

### Goal

Create the LaunchVault application foundation while preserving only the needed Circle Agent Stack pieces.

### Acceptance criteria

- Circle starter structure is documented.
- `packages/circle-tools` and `kits/openai-agents` are evaluated for reuse.
- Other framework kits are not imported.
- `apps/web` runs as a Next.js App Router app.
- strict TypeScript and Zod environment validation exist.
- mock mode works without credentials.
- safe health endpoint exists.
- lint, typecheck, test, and build scripts pass.
- no product features from later issues are implemented.

---

## Issue 2 — Implement LaunchVault domain, state machines, and mock data

**Priority:** P0  
**Milestone:** Foundation

### Goal

Create typed domain models and deterministic mock infrastructure.

### Acceptance criteria

- schemas exist for project, backer, vault, reserve, ledger entry, milestone, requirement, evidence item, transaction, proof record, release request, payment record, proof gap, disclosure preference, and audit event;
- money uses atomic units;
- state transitions are explicit;
- mock repositories and wallet adapter exist;
- PawPOVAI seeded scenario exists;
- every successful transition creates an audit event;
- invalid transitions are tested.

---

## Issue 3 — Build LaunchVault Treasury and Smart Reserves

**Priority:** P0  
**Milestone:** Fund and Allocate

### Goal

Receive or seed project capital and allocate it across approved reserves.

### Acceptance criteria

- create a project vault;
- allocate 1,000 USDC across five reserves;
- percentage totals cannot exceed 100%;
- rounding is deterministic;
- activation requires founder approval;
- duplicate allocation is prevented;
- reversals create ledger entries instead of deleting history;
- dashboard shows allocated, available, and remaining funds.

---

## Issue 4 — Build Milestone Engine

**Priority:** P0  
**Milestone:** Fund and Allocate

### Goal

Define milestone conditions and calculate release eligibility deterministically.

### Acceptance criteria

- milestones contain requirements, spend limit, release amount, due date, and status;
- requirement types include deliverable, receipt, transaction match, business purpose, and confirmation;
- engine returns incomplete, review, eligible, approved, released, or rejected;
- no LLM sets final status;
- duplicate release is impossible;
- reason codes and next actions are returned;
- unit tests cover boundaries.

---

## Issue 5 — Build Evidence Engine and Proof Recovery

**Priority:** P0  
**Milestone:** Prove and Unlock

### Goal

Capture receipts, deliverables, and context and map them to milestone requirements.

### Acceptance criteria

- image, screenshot, document, and natural-language inputs are supported in mock mode;
- file type, signature, and size are validated;
- extraction uses a strict schema;
- extracted and inferred fields are distinct;
- evidence receives a hash;
- user corrections create audit events;
- one missing-proof workflow is complete;
- uploaded content cannot override agent instructions.

---

## Issue 6 — Generate Proof-of-Progress records and Backer View

**Priority:** P0  
**Milestone:** Prove and Unlock

### Goal

Create trustworthy milestone proof while protecting founder privacy.

### Acceptance criteria

- eligible milestone creates a structured proof record;
- proof includes evidence hashes, verified spend, requirement outcomes, and proposed release;
- founder controls which fields are shareable;
- Backer View shows only approved information;
- raw receipts and private notes are hidden by default;
- disclosure filtering is tested;
- printable or shareable summary exists.

---

## Issue 7 — Integrate Circle Agent Wallet on Arc Testnet

**Priority:** P0  
**Milestone:** Arc and Demo

### Goal

Display wallet status and execute one approved USDC tranche release safely.

### Acceptance criteria

- typed WalletProvider exists;
- mock and Circle adapters implement the same interface;
- adapter selection is explicit;
- server-only credentials;
- chain, asset, address, amount, balance, approval, and idempotency are validated;
- Arc Testnet transaction status is persisted;
- UI shows mock/testnet mode;
- no silent fallback;
- official current setup instructions are documented.

---

## Issue 8 — Add optional signed proof or minimal LaunchVault contract

**Priority:** P1  
**Milestone:** Arc and Demo

### Goal

Add one credible onchain proof or conditional-release enhancement after Issue 7 works.

### Decision gate

Codex must first compare:

1. wallet-signed structured Proof-of-Progress;
2. minimal LaunchVault contract.

Choose the lower-risk option that adds the clearest judging value.

### Acceptance criteria

- threat model documented;
- no proxy or token;
- no duplicate release;
- role and approval model explicit;
- Arc Testnet interaction demonstrated;
- tests and deployment evidence included;
- application remains functional if this feature is disabled.

---

## Issue 9 — Build guided founder and backer demo

**Priority:** P0  
**Milestone:** Arc and Demo

### Goal

Deliver a polished three-minute experience.

### Acceptance criteria

- landing page explains Fund → Prove → Unlock;
- founder creates PawPOVAI vault;
- reserves allocate;
- milestone appears;
- evidence is submitted and matched;
- milestone becomes eligible;
- founder approves release;
- testnet or mock tranche executes;
- Backer View updates;
- one proof gap is resolved;
- mobile, loading, empty, review, blocked, success, and error states work;
- Playwright covers happy and failure paths.

---

## Issue 10 — Security, deployment, and submission package

**Priority:** P0  
**Milestone:** Arc and Demo

### Goal

Prepare the Arc submission, Swarm Village demo, and InvestFest preview.

### Acceptance criteria

- lint, typecheck, tests, and build pass;
- threat model and security notes exist;
- Vercel deployment succeeds;
- setup and reset instructions are reproducible;
- README explains Circle and Arc usage honestly;
- three-minute Arc pitch exists;
- Swarm Village agent walkthrough exists;
- InvestFest 30-second customer pitch exists;
- known limitations are disclosed;
- no claims of auditing, investment performance, or production readiness.
