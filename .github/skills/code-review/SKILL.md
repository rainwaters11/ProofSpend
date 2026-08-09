---
name: code-review
description: Review ProofSpend pull requests for demo-critical correctness, financial authorization safety, truthful live and mock behavior, and deadline-safe scope. Use for every pull request review and exact-head re-review in this repository.
---

# ProofSpend code review

## Establish the review target

1. Read the root `AGENTS.md`.
2. Read the linked issue and pull request description.
3. Read only the relevant records in `docs/decision-log.md`, `docs/roadmap.md`, `docs/dependency-map.md`, and applicable ADRs.
4. Record the exact pull request head SHA and changed-file list before reviewing.
5. Review the code at that exact head. Do not rely on a PR summary or an earlier review.

Use the GitHub MCP tools to inspect the linked issue, current head, changed files, review threads, and Actions status. Use Playwright MCP only when the change affects the visible demo, approval flow, live/mock labels, or explorer links. Reviews are read-only.

## Protect the deadline

The submission-critical story is:

1. A real OpenAI call analyzes evidence.
2. One missing-proof question is shown and corrected.
3. Deterministic code decides the result.
4. The system prepares the configured Arc Testnet USDC amount and stops for recorded human approval.
5. Server-only code submits and reconciles one real Circle transaction.
6. The UI truthfully shows the result and real explorer link.

Do not treat deferred ERC-8004, ERC-8183, CCTP, x402, Paymaster, custom contracts, generalized onboarding, or additional wallet-management work as a current defect unless the linked issue explicitly reactivates it.

## Severity

Report a P1 only when the change could:

- move value without valid exact approval;
- submit the wrong amount, asset, network, source wallet, destination, or intent;
- replay or duplicate a transfer;
- expose a secret or private evidence;
- present mock, prepared, or submitted data as confirmed live data;
- fabricate or accept a fabricated hash, explorer URL, or Circle operation ID;
- lose the only durable handle needed to poll or reconcile a submitted transfer;
- break CI, the build, or the submission-critical happy path.

Use P2 for bounded correctness or hardening that does not block that story. Recommend deferral for post-MVP expansion.

## Financial and protocol checks

- The proposal, approval, adapter input, and UI must match exactly.
- Revalidate persisted approval immediately before submission using current time and current configuration.
- The model may propose or explain but may never approve or invoke value submission.
- Keep prepare, submit, poll, confirm, and reconcile distinct and resumable.
- Persist idempotency and the provider operation ID before or atomically with submission.
- A live Circle provider operation ID must pass positive UUID validation; mock identifiers must remain visibly synthetic.
- Only genuine Arc Testnet hashes may receive explorer links.
- Keep Circle and OpenAI credentials server-side and redact them from logs and activity.
- Do not silently fall back from live mode to mock mode.

## Finding quality

- Inspect implementation and tests; do not infer correctness from names.
- Create one finding per root cause and do not repeat an existing unresolved finding.
- State the concrete failing scenario and user or security impact.
- Cite the smallest relevant line range.
- Distinguish a proven defect from a question or optional improvement.
- Confirm CI belongs to the exact reviewed head. If it does not, say so.
- If no P1 or P2 remains, say that plainly instead of inventing work.
