# AGENTS.md — ProofSpend LaunchVault Repository Instructions

## Mission

Build ProofSpend LaunchVault as an Arc Testnet prototype for evidence-aware programmable capital.

Read `design.md` before planning or changing product behavior.

## Source-of-truth order

1. Current GitHub issue and acceptance criteria
2. `AGENTS.md`
3. `design.md`
4. Existing tests and schemas
5. README and approved architecture decisions

Stop and report conflicts instead of guessing.

## Work method

- Work on one GitHub issue at a time.
- Use branch `issue-<number>-<slug>`.
- Inspect before editing.
- Present a short plan before implementation.
- Wait for approval when the change is destructive, moves money, changes network configuration, introduces a contract, or adds a production dependency.
- Keep one pull request per issue.
- Do not create a `develop` branch.
- Do not implement adjacent features without approval.
- Do not claim commands passed unless they actually ran.

## Completion report

Return:

1. summary;
2. files changed;
3. commands and results;
4. tests passed, failed, or skipped;
5. manual verification;
6. security implications;
7. known limitations;
8. acceptance checklist;
9. next recommended issue.

## Architecture boundaries

- LLMs may extract, propose, summarize, and explain.
- LLMs may not calculate balances, finalize milestone status, authorize releases, or alter audit records.
- Financial values use integer atomic units.
- State transitions are explicit and tested.
- All external input uses Zod validation.
- Circle operations live behind typed server-side interfaces.
- Mock and Arc Testnet adapters share interfaces but are never silently interchanged.
- Audit events are append-only.
- Founder-private evidence is separate from backer-visible proof.
- Original evidence is separate from AI-derived fields.

## Product scope

### P0

- project LaunchVault;
- reserve allocation;
- milestone requirements;
- receipt and deliverable evidence;
- deterministic eligibility;
- proof record;
- human-approved testnet tranche release;
- selective Backer View;
- one Proof Recovery flow.

### P1

- signed proof record;
- optional minimal LaunchVault contract;
- x402 verification service payment when reliable.

### Out of scope until approved

- generalized crowdfunding;
- securities or equity issuance;
- production KYC;
- multi-chain capital routing;
- automated investor decisions;
- automatic tax filing;
- unrestricted autonomous spending;
- full BillBack implementation.

## Circle and Arc rules

- Use Arc Testnet only for the hackathon.
- Do not clone or operate `arc-node`.
- Verify current Circle commands from official docs or existing starter code.
- Do not invent CLI syntax, network identifiers, contract addresses, or environment variables.
- Do not present mainnet-only Circle policies as testnet-enforced.
- Never expose OTPs, API keys, wallet credentials, private keys, or entity secrets.
- Require idempotency for transfers and contract writes.
- Store intent before execution and result after execution.

## Agent boundaries

### Founder Copilot

May route work and explain status. May not release funds.

### Evidence Agent

May extract structured evidence candidates. May not silently finalize uncertain values.

### Milestone Agent

May propose eligibility with reasons. Deterministic code owns the actual status.

### Recovery Agent

May identify evidence gaps and ask one question at a time.

### Backer Brief Agent

May summarize founder-approved proof only.

## Financial and release checklist

Before any transfer or contract write:

- adapter mode confirmed;
- Arc Testnet confirmed;
- USDC asset confirmed;
- address validated;
- amount validated;
- balance validated;
- milestone status eligible;
- human approval recorded;
- idempotency key unused;
- transaction intent persisted.

## UI rules

- accessible and responsive;
- visible mock/testnet badge on every money screen;
- no fake live hashes;
- full empty, loading, review, blocked, success, and error states;
- clear founder/private versus backer/shared data;
- show exactly why a milestone is not eligible.

## Expected commands

Use repository scripts where available:

```bash
bun install
bun run lint
bun run typecheck
bun test
bun run test:integration
bun run test:e2e
bun run build
```

If a command does not exist, report that honestly.

## Blocking review findings

- floating-point money;
- client-side secrets;
- LLM-controlled release;
- silent mock fallback;
- missing idempotency;
- duplicate tranche release;
- backer access to private evidence;
- unvalidated uploads;
- unsupported claims of auditing, tax compliance, investment returns, or fraud prevention.
