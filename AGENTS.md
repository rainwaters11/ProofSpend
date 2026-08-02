# AGENTS.md — ProofSpend LaunchVault Repository Instructions

## Mission and sources

Build ProofSpend LaunchVault as an Arc Testnet prototype for evidence-aware programmable capital. Read `design.md`, the live issue, and applicable records in `docs/` before planning.

Source-of-truth order:

1. current live GitHub issue and acceptance criteria;
2. `AGENTS.md`;
3. approved decisions in `docs/decision-log.md` and architecture records;
4. `design.md`;
5. current tested implementation;
6. other repository documentation.

Stop and report conflicts instead of guessing.

## Work method

- Work on one issue, branch, and pull request at a time; use `issue-<number>-<slug>`.
- Inspect first and present a plan before implementation.
- Check `docs/roadmap.md` and `docs/dependency-map.md`; do not start an issue before its live dependencies are complete.
- Wait for approval for destructive work, value movement, network changes, contracts, or production dependencies.
- Do not implement adjacent issues, create `develop`, or claim commands passed unless they ran.
- Use `arc-standards-integration` for Arc, Circle, ERC-8004, ERC-8183, or reputation work.
- Use `launchvault-ui-quality` for perceptible UI and financial/protocol-state presentation.

## Completion report

Return: summary; files changed; commands and results; tests passed, failed, or skipped; manual verification; security implications; known limitations; acceptance checklist; and next recommended issue.

## Authority model

Four layers must remain separate:

1. AI extracts, matches, summarizes, and explains evidence.
2. Deterministic policy calculates requirement outcomes and internal eligibility.
3. An authorized human or explicitly authorized evaluator approves an exact action.
4. A typed server-side adapter prepares, submits, confirms, and reconciles the Arc Testnet transaction.

AI may never calculate final balances, finalize milestone status, approve or submit value-moving actions, complete or reject jobs, alter audit history, or write reputation. Financial values use integer atomic units; transitions are explicit and tested; external input uses Zod; audit events are append-only.

## Arc standards governance

- Issue #13 covers ERC-8004 identity and reputation governance only. Registration proves neither trustworthiness nor correctness. The agent owner may not write reputation for its own agent.
- Issue #8 covers ERC-8183 jobs, escrow, provider delivery, evaluation, completion/rejection, settlement, and refund only. It may consume the identity from Issue #13 but may not absorb Issue #13.
- ERC-8183 is the default MVP settlement primitive. A custom contract, signed proof, x402, and nanopayments are not on the default path.
- Raw receipts and founder-private evidence remain offchain. Only approved commitments and hashes may be submitted onchain.
- Internal `ELIGIBLE` is not ERC-8183 `COMPLETED`.
- Preparation, approval, submission, confirmation, and reconciliation are distinct persisted states.
- Revalidate the exact approved intent immediately before submission.
- Keep mock, Arc Testnet, prepared, submitted, confirmed, failed, rejected, refunded, and reconciled states technically and visually distinct.

## Circle and Arc rules

- Use Arc Testnet only; do not clone or operate `arc-node`.
- Issue #7 must decide the Circle execution architecture through an ADR and depends on Issues #2, #3, and #4.
- Until that ADR, do not select a wallet architecture or invent commands, identifiers, addresses, or environment variables.
- Selectively consider patterns from `packages/circle-tools` and `kits/openai-agents` only after verification against current official sources.
- Exclude `packages/agent-cli`, the terminal UI, unrelated framework kits, and autonomous payment behavior.
- All value-moving operations live behind typed server-side interfaces. Never expose OTPs, API keys, wallet credentials, private keys, or entity secrets.
- Require idempotency; persist intent before execution and result after execution; never silently interchange mock and Arc adapters.

## Product and privacy boundaries

P0 includes LaunchVault projects, reserves, milestone requirements, receipt/deliverable evidence, deterministic eligibility, proof records, human/evaluator-approved testnet settlement, selective Backer View, and one Proof Recovery flow.

Out of scope until explicitly approved: generalized crowdfunding; securities/equity; production KYC; multi-chain routing; automated investor decisions; automatic tax filing; unrestricted autonomous spending; full BillBack; custom settlement contracts; signed proof; x402; and nanopayments.

Original evidence is separate from AI-derived fields. Founder-private evidence is separate from backer-approved proof and stays offchain.

## Financial and protocol checklist

Before any value-moving or protocol write, confirm:

- approved issue/ADR and explicit adapter mode;
- Arc Testnet, USDC, contract/interface, addresses, roles, amount, and balance;
- deterministic status is eligible where required, without calling it `COMPLETED`;
- exact human/evaluator approval is persisted and still valid;
- preparation is separate from submission;
- intent fields, current state, authorization, expiry, and idempotency key are revalidated immediately before submission;
- idempotency key is unused and transaction intent is persisted;
- submission result, confirmation, and reconciliation are recorded separately;
- any reputation writer is independent of the agent owner.

## UI rules

- Accessible and responsive; show a visible mode badge on every money screen.
- Never show fake identifiers as live.
- Provide empty, loading, review, blocked, approval, prepared, submitted, confirmed, success, failure, rejected, refunded, and reconciliation states as applicable.
- Clearly separate founder/private, backer/shared, and onchain/public information.
- Show exactly why requirements are `PASS`, `REVIEW`, or `FAIL` and why a milestone is not eligible.

## Expected commands

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
```

Report unavailable commands honestly.

## Blocking review findings

- floating-point money or client-side secrets;
- LLM-controlled policy, approval, job evaluation, submission, or reputation;
- silent mock fallback or unapproved Circle architecture;
- combined preparation/submission or missing immediate revalidation;
- missing idempotency, duplicate settlement, or incomplete reconciliation;
- owner-written reputation for its own agent or registration presented as trust;
- private evidence onchain or backer access to private evidence;
- internal `ELIGIBLE` represented as ERC-8183 `COMPLETED`;
- prepared/submitted activity represented as confirmed;
- unvalidated uploads;
- unsupported claims of auditing, tax compliance, investment returns, or fraud prevention.
