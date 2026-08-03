# ProofSpend domain

This workspace contains the Issue 2 LaunchVault domain foundation: Zod-validated records, integer atomic-unit money, separate ProofSpend and ERC-8183 state machines, append-only in-memory audit history, idempotency, deterministic mock references, and fictional PawPOVAI seed data.

It does not execute milestone policy, authorize releases, submit transactions, or call a wallet or contract. Raw evidence stays behind private storage references; the deterministic Backer disclosure filter uses an explicit allowlist of approved records. Mock identifiers are visibly synthetic, ERC-8004 registration is not trust, and internal `ELIGIBLE` is never ERC-8183 `COMPLETED`.
