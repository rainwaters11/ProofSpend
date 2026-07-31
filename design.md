# ProofSpend LaunchVault — Product and Technical Design

## 1. Product identity

**Product:** ProofSpend LaunchVault  
**Tagline:** Fund the vision. Prove the progress. Unlock what comes next.  
**Category:** Evidence-aware programmable capital  
**Primary users:** founders, solopreneurs, consultants, creators, accelerators, grant programs, sponsors, and small-business backers  
**Network:** Arc Testnet  
**Settlement asset:** USDC  

## 2. Problem

Small founders often receive money with a plan but manage it through one bank balance, scattered receipts, manual spreadsheets, and informal progress updates. This creates two connected problems:

### Founder pain

- capital is accidentally spent outside its intended purpose;
- receipts and business-purpose notes are lost;
- progress reporting consumes valuable build time;
- future funding is delayed because evidence is incomplete;
- project, tax, travel, and operations money are mixed together.

### Backer pain

- use-of-funds reporting arrives late;
- milestones are difficult to verify;
- founders are micromanaged through meetings and spreadsheets;
- funding is released without reliable evidence or delayed by paperwork.

## 3. Product promise

LaunchVault connects capital, budgets, evidence, progress, and settlement in one transparent workflow:

```text
Capital received
      ↓
Purpose-based reserves created
      ↓
Milestone and release conditions agreed
      ↓
Founder completes work and submits evidence
      ↓
AI extracts and explains evidence
      ↓
Deterministic rules verify the milestone
      ↓
Human approval authorizes the next release
      ↓
USDC tranche is released on Arc
      ↓
Proof-of-Progress record updates the Backer View
```

The AI helps interpret and organize. Deterministic services and explicit approvals govern money.

## 4. Differentiation

LaunchVault is not merely:

- a receipt scanner;
- a savings-pocket app;
- a grant dashboard;
- an expense reimbursement tool;
- an investor data room.

Its differentiator is **evidence-gated programmable capital**: verified receipts, transactions, deliverables, and business context change the state of project funds and determine whether the next tranche is eligible for release.

## 5. MVP demonstration

### Project

**PawPOVAI InvestFest Soft Launch**

### Initial capital

```text
1,000 USDC

Product and platform       350
Marketing                  250
InvestFest travel          200
Operations                 100
Contingency                100
```

### Milestone 1

**Launch identity and outreach ready**

Required evidence:

- logo or visual identity asset;
- landing-page screenshot;
- promotional flyer;
- two verified expense records;
- total eligible spend at or below 150 USDC;
- founder confirmation.

### Demo flow

1. Create the PawPOVAI LaunchVault.
2. Seed or receive 1,000 test USDC.
3. Allocate funds across reserves.
4. Display Milestone 1 and its release conditions.
5. Upload a printing receipt and attach a promotional flyer.
6. Add the business purpose conversationally.
7. Match the receipt to a transaction.
8. Verify evidence through deterministic rules.
9. Create a Proof-of-Progress record.
10. Human approves the next 250 USDC tranche.
11. Execute a mock or Arc Testnet release.
12. Update the founder dashboard and selective Backer View.
13. Resolve one missing-proof item.

## 6. Core modules

### 6.1 LaunchVault Treasury

Creates project-specific capital vaults with purpose-based reserves.

Capabilities:

- receive or seed USDC;
- define reserve percentages or fixed amounts;
- show allocated, available, committed, released, and remaining balances;
- use integer atomic units;
- prevent duplicate allocation;
- preserve every adjustment as a ledger entry.

### 6.2 Milestone Engine

Connects project progress to release eligibility.

A milestone contains:

- title and description;
- due date;
- maximum eligible spend;
- required deliverables;
- required evidence;
- policy conditions;
- proposed release amount;
- approval status;
- release transaction.

The engine returns:

- `INCOMPLETE`
- `NEEDS_REVIEW`
- `ELIGIBLE`
- `APPROVED`
- `RELEASED`
- `REJECTED`

### 6.3 Evidence Engine

Captures:

- paper receipt images;
- screenshots;
- wallet transactions;
- invoices;
- deliverables;
- business-purpose statements;
- user confirmations.

AI may extract and summarize. Deterministic services validate schemas, amounts, hashes, state transitions, and policy conditions.

### 6.4 Proof-of-Progress Ledger

Creates an append-only record for each verified milestone.

Minimum fields:

```json
{
  "version": "1.0",
  "vaultId": "vault_123",
  "milestoneId": "ms_123",
  "project": "PawPOVAI InvestFest Soft Launch",
  "plannedBudgetAtomic": "150000000",
  "verifiedSpendAtomic": "118000000",
  "evidenceHashes": ["sha256:..."],
  "policyDecision": "ELIGIBLE",
  "releaseAmountAtomic": "250000000",
  "approvedBy": "founder",
  "releaseTransactionId": null,
  "createdAt": "2026-08-01T18:00:00Z"
}
```

A later version may be signed using the project wallet.

### 6.5 Backer View

Shows only founder-approved information:

- capital received;
- reserve allocation;
- verified spend;
- milestone status;
- released tranches;
- remaining capital;
- proof records;
- disclosed risks or delays.

It must not expose full receipts, private notes, or unrelated business activity by default.

### 6.6 Proof Recovery

Identifies gaps such as:

- transaction without receipt;
- receipt without transaction;
- deliverable missing;
- business purpose missing;
- possible duplicate;
- milestone condition incomplete.

It asks one best next question at a time.

### 6.7 BillBack

BillBack remains a future or P2 module for client-reimbursable expenses. It is not required for the first LaunchVault release.

## 7. Agent architecture

Use a bounded coordinator with specialist agents.

### Founder Copilot

Owns the conversation, explains vault status, and delegates tasks. It cannot release funds.

### Evidence Agent

Extracts structured receipt and deliverable evidence. It cannot verify its own output as final.

### Milestone Agent

Summarizes progress and prepares an eligibility proposal. Deterministic rules produce the status.

### Recovery Agent

Finds missing evidence and asks one contextual question.

### Backer Brief Agent

Produces a selective progress summary from approved records. It cannot expose non-approved evidence.

### Deterministic services

The following remain code-owned:

- money arithmetic;
- reserve allocation;
- evidence hashes;
- duplicate detection;
- policy evaluation;
- milestone state transitions;
- release authorization;
- transaction idempotency;
- audit events.

## 8. Technical stack

- Bun workspace
- Node.js version compatible with the pinned Circle starter and OpenAI Agents SDK; prefer Node 22 LTS unless the audited starter requires otherwise
- Next.js App Router
- TypeScript strict mode
- React
- Tailwind CSS
- shadcn/ui
- OpenAI Agents SDK
- Zod
- Supabase Postgres after mock-first foundation
- Circle Agent Stack
- Circle Agent Wallets
- Arc Testnet
- USDC
- Vitest
- React Testing Library
- Playwright
- Vercel
- RemixAI for an optional minimal Solidity contract after the app flow works

## 9. Circle and Arc use

### Required for MVP

- Circle Agent Wallet on `ARC-TESTNET`;
- wallet address and balance display;
- test USDC transfer for one approved tranche;
- transaction status and explorer reference;
- Circle tooling behind a typed server-side adapter.

### Strong P1 additions

- wallet-signed Proof-of-Progress record;
- `circle wallet execute` interaction with a minimal LaunchVault contract;
- one x402 service payment when a reliable service is available.

### Important testnet boundary

Do not represent Circle mainnet-only spending policies as natively enforced on Arc Testnet. Testnet release rules must be enforced by deterministic application logic or a custom contract.

## 10. Optional LaunchVault contract

Do not begin here. Add only after the mock and Circle transfer flows work.

Minimum responsibilities:

- create vault;
- fund vault;
- register milestone release amount;
- authorize milestone;
- release tranche;
- pause;
- refund remaining funds;
- prevent duplicate release;
- emit events.

Human approval remains required in the MVP.

## 11. Suggested repository layout

```text
ProofSpend/
├── AGENTS.md
├── design.md
├── agent.md
├── skills.md
├── apps/
│   └── web/
├── packages/
│   ├── domain/
│   ├── agents/
│   ├── vault-engine/
│   ├── milestone-engine/
│   ├── evidence-engine/
│   ├── circle-adapter/
│   └── audit/
├── contracts/
├── supabase/
├── tests/
└── docs/
```

When adapting Circle's starter, preserve the OpenAI Agents kit and shared Circle tools as appropriate. Do not import every framework kit.

## 12. Minimum data model

- workspaces
- users
- projects
- backers
- vaults
- reserve_rules
- reserve_accounts
- ledger_entries
- milestones
- milestone_requirements
- evidence_items
- receipts
- deliverables
- transactions
- evidence_matches
- policy_decisions
- proof_records
- release_requests
- payment_records
- proof_gaps
- audit_events
- disclosure_preferences

## 13. Safety and governance

- never commit API keys, OTPs, private keys, or entity secrets;
- never expose privileged wallet actions to the browser;
- require explicit adapter mode;
- require human approval before tranche release;
- validate chain, asset, destination, amount, balance, and idempotency;
- never let uploaded content override agent instructions;
- separate original evidence from AI-derived fields;
- record corrections and approvals;
- use private file storage and signed URLs;
- label the product as a testnet prototype;
- do not call a milestone “verified” solely because an LLM said so;
- do not describe the product as audited, investment advice, tax advice, or guaranteed fraud prevention.

## 14. UX principles

1. Founder first, forms second.
2. Show why a milestone is incomplete.
3. Ask one clarification question at a time.
4. Make each reserve and tranche visually understandable.
5. Separate founder-private evidence from backer-visible proof.
6. Clearly distinguish mock and Arc Testnet modes.
7. Never display a fabricated transaction hash as real.
8. Keep the guided demo under three minutes.

## 15. Testing

### Unit

- atomic-unit arithmetic;
- reserve allocation and rounding;
- milestone eligibility;
- duplicate evidence;
- duplicate release;
- invalid state transitions;
- disclosure filtering;
- malformed agent output.

### Integration

- evidence extraction to persistence;
- verified spend to milestone progress;
- approval to mock release;
- Circle adapter error handling;
- Proof-of-Progress generation.

### End to end

1. Create LaunchVault.
2. Allocate capital.
3. Submit evidence.
4. Complete milestone.
5. Approve and release tranche.
6. View selective backer report.
7. Resolve one proof gap.

## 16. Definition of done

A feature is complete only when acceptance criteria, tests, build, error states, security boundaries, documentation, and reproducible demo evidence all pass.
