# Arc agentic-capital architecture

## Purpose

LaunchVault combines private evidence processing, deterministic policy, explicit authority, and Arc Testnet settlement without giving an AI agent control of funds.

## Layers and actors

1. **Offchain AI layer:** Founder Copilot and specialist agents extract, match, summarize, and explain untrusted evidence.
2. **Deterministic layer:** domain services validate schemas, hashes, integer money, requirement outcomes, roles, state, and idempotency.
3. **Authority layer:** an authorized human/evaluator approves an exact intent.
4. **Execution layer:** a typed server-side adapter prepares, submits, confirms, and reconciles Arc transactions.

Relevant actors are founder/client, ProofSpend Verification Agent identity, deterministic policy engine, provider, evaluator, server adapter, and independent reputation writer. One address holding a role does not grant the AI independent authority to exercise it.

## Standards separation

### ERC-8004 — Issue #13

Registers and verifies the Verification Agent identity and defines reputation governance. Registration is not proof of trust, correctness, auditing, or authorization. The agent owner cannot write reputation for its own agent.

### ERC-8183 — Issue #8

Creates/funds the milestone job, accepts a provider deliverable hash, permits an authorized evaluator to complete or reject, and drives settlement or refund. It consumes the Issue #13 identity without taking ownership of identity/reputation scope.

ERC-8183 is the default MVP settlement primitive; no custom LaunchVault contract is assumed.

## Data boundary

Raw receipts, images, founder notes, business context, and private evidence remain offchain. AI-derived fields stay separate from originals. Onchain actions may reference an approved versioned Proof-of-Progress hash or other minimum protocol data, never the private source material. Backer View receives only founder-approved disclosure.

## State and sequence

```text
private evidence
  -> structured AI candidate
  -> deterministic PASS / REVIEW / FAIL
  -> internal eligibility
  -> exact authorized intent
  -> prepared transaction
  -> immediate revalidation
  -> submitted transaction
  -> Arc confirmation
  -> application reconciliation
```

For an ERC-8183 job, provider delivery and evaluator completion/rejection occur according to the job lifecycle; settlement/refund follows. Internal `ELIGIBLE` never implies ERC-8183 `COMPLETED`. Prepared, submitted, confirmed, failed, rejected, refunded, and reconciled states remain distinct.

## Exact intent and safety

The eventual domain schema must bind applicable chain, contract/interface, job, method, roles, asset, amount, destination, calldata or commitment, state expectation, idempotency key, and expiry. Before submission, revalidate the stored approval and all mutable prerequisites. Persist intent before execution and results after execution. Do not retry mutations automatically unless protocol-safe idempotency is proven.

ERC-8004 registration, ERC-8183 job creation, USDC allowance, ERC-8183 funding, provider deliverable submission, evaluator completion/rejection, refund claims, and reputation writes are independent protocol writes. Each requires its own exact persisted intent, approval by the authorized role, server-side preparation, immediate pre-submit revalidation, submission, confirmation, and reconciliation. Authorization for one write never authorizes another, and registration, creation, allowance, or funding must not occur before the corresponding approval is persisted and revalidated.

## Circle boundary

Issue #7 selects the execution architecture by ADR after #2/#3/#4. Earlier research does not select it. Selectively reuse verified patterns from Circle `packages/circle-tools` and `kits/openai-agents`; exclude `packages/agent-cli`, terminal UI, unrelated kits, autonomous payments, and unverified non-Arc assumptions.

## Failure and reconciliation

Rejected approval, stale intent, failed preparation, reverted or unconfirmed submission, evaluator rejection, refund, and reconciliation mismatch are explicit outcomes. They do not silently fall back to mock, mutate confirmed balances early, or erase audit history. Recovery rules must be deterministic and issue-scoped.

## Runtime backlog gap

Complete Verification Agent orchestration requires a dedicated future issue unless explicitly assigned in the live backlog. It includes a controlled OpenAI Agents SDK tool loop, structured evidence-service calls, deterministic-policy explanation, human interruption, transaction-proposal preparation, and prohibition against direct submission. It is not delivered by Issue #13 identity registration or Issue #8 settlement.
