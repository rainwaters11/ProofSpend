# START HERE — ProofSpend LaunchVault

## Decision

Keep the existing GitHub repository: `rainwaters11/ProofSpend`.

Do **not** keep the original ProofSpend starter pack unchanged. The product has evolved from receipt-led expense management into **evidence-aware programmable capital**. Replace the old planning files with this LaunchVault pack before Codex scaffolds the app.

## Product

**ProofSpend LaunchVault**  
**Tagline:** Fund the vision. Prove the progress. Unlock what comes next.

LaunchVault helps founders and small businesses receive project capital, divide it into purpose-based reserves, prove how it was used, and unlock future funding only after agreed milestones are verified.

## What stays from the original idea

- Smart Reserve Vaults
- Receipt Intelligence
- Proof Recovery
- ReceiptX audit records
- BillBack as a later expansion

## What is new

- project-based LaunchVaults;
- milestone budgets and funding tranches;
- proof-of-progress records;
- selective Backer View;
- evidence-gated release of USDC;
- optional signed milestone records and Arc smart contract.

## First-day checklist

1. Keep the repository public.
2. Do not clone `arc-node`.
3. Add this pack to the repository root.
4. Keep the Circle starter repository separate until Codex audits it.
5. Create GitHub Issue 1 from `github-issues.md`.
6. Create branch `issue-1-foundation`.
7. Run Prompt 0 from `codex-prompts.md`.
8. Approve the plan only if it is limited to foundation work.
9. Confirm mock mode, lint, typecheck, tests, and build.
10. Open a pull request before moving to Issue 2.

## Required repository layout before scaffolding

```text
ProofSpend/
├── .agents/
├── .github/
├── .gitignore
├── AGENTS.md
├── agent.md
├── design.md
├── skills.md
├── START_HERE.md
├── github-issues.md
├── codex-prompts.md
├── MIGRATION_FROM_ORIGINAL_PACK.md
└── README.md
```

## Solo workflow

Use one issue, one branch, and one pull request at a time. Keep `main` as the only long-lived branch. Codex should never receive a single prompt to build the whole platform.
