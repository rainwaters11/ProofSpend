# ADR-001 — Circle execution and custody architecture

Status: **Proposed — pending approval** (Issue #7 decision gate)

## Context

Issue #7 requires ProofSpend to select **one** primary Circle custody and contract-execution path for Arc Testnet, then implement a typed server-side adapter behind the existing `WalletProvider` boundary. The selected path must support the ERC-8004 registration calls (Issue #13) and ERC-8183 job/settlement calls (Issue #8) on Arc Testnet, while preserving explicit mock mode, prepare/submit separation, idempotency, redaction, and server-side credentials.

## Decision criteria

From Issue #7, the chosen path is evaluated on:

- current official support for `ARC-TESTNET`;
- contract-execution support;
- credential and entity-secret model;
- ability to represent separate client, provider, evaluator, owner, and validator roles;
- transaction preparation, submission, and polling;
- implementation and operational risk;
- hackathon time;
- compatibility with the existing `WalletProvider` boundary;
- compatibility with ERC-8004 and ERC-8183 calls;
- reproducibility in GitHub Actions and deployment environments.

## Considered options

### Option A — Circle Agent Stack (CLI + Agent Wallets)

Verified facts (2026-08-06, official Circle docs):

- `ARC-TESTNET` is officially supported by Agent Wallets (testnet only).
- Authentication is email + OTP via the `circle` CLI; testnet sessions are stored separately and expire after 7 days.
- Agent wallets are smart-contract accounts; at most 5 per user.
- Wallet create, list, balance, fund (testnet faucet), execute, and transaction list are available with `--output json`.
- Contract calls are available via `circle wallet execute` and read-only `circle contract query`.
- No API key or entity secret is required.

Assessment:

- Strong fit for a quick personal prototype and for shelling out with argument arrays.
- Risks: 7-day session expiry complicates CI and deployments; the 5-wallet cap constrains per-client role wallets; behavior depends on a local CLI binary; the audited `packages/circle-tools` wrappers are BASE/POLYGON-oriented and must be re-verified for Arc.
- This path is not the one used by Arc's current ERC-8004/ERC-8183 example flows.

### Option B — Circle Developer-Controlled Wallets (SDK)

Verified facts (2026-08-06, official Circle docs and npm):

- Node.js v22.6 or later is required.
- Setup uses a Circle Console API key plus a registered entity secret; the SDK provides `generateEntitySecret` and `registerEntitySecretCiphertext` helpers and returns a recovery file that must be stored server-side.
- The client is initialized with `initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })`.
- Wallets are organized into wallet sets; one wallet set groups wallets under a single entity secret.
- `createWallets({ walletSetId, blockchains: ["ARC-TESTNET"], count, accountType: "EOA" | "SCA" })` creates wallets on demand; wallet sets and wallets are effectively unlimited, enabling one wallet per client and per role.
- Package: `@circle-fin/developer-controlled-wallets` (current 10.8.0, TypeScript declarations included).
- Arc's current ERC-8004 and ERC-8183 examples and the Arc App Kit (with a Circle Wallets adapter) are built on this path.

Assessment:

- Directly aligns with the ERC-8004/ERC-8183 implementation issues.
- Persistent server-side credentials are simpler to reproduce in CI than expiring CLI sessions.
- Unlimited wallets cleanly model backer/client, founder/provider, evaluator, and validator roles.
- Contract execution and transaction polling are supported through the SDK and Arc App Kit.
- Costs: Node 22.6+ upgrade, entity-secret lifecycle management, and API-key scoping are required.

### Option C — Circle User-Controlled Wallets (considered, deferred)

Circle also offers user-controlled wallets where each end user controls their own wallet with familiar sign-in (social, email, or PIN) and approves every transaction, and modular passkey wallets.

This model is not selected for the MVP because LaunchVault's value-moving actions are backend-orchestrated (deterministic policy, exact human approval, server-side submission), which is the developer-controlled custody case. User-controlled wallets would move transaction approval to each backer's client session, change the authorization boundary, and are not the model used by Arc's ERC-8004/ERC-8183 example flows. A future backer self-custody flow may revisit this only through a separately approved ADR.

## Decision

Select **Option B — Circle Developer-Controlled Wallets** as the single primary custody and contract-execution path for the LaunchVault MVP.

Option A remains documented as a rejected alternative and may be revisited only through a separately approved ADR as a future adapter. The MVP will not maintain two production-style custody systems.

## Consequences

Positive:

- ERC-8004 (Issue #13) and ERC-8183 (Issue #8) can consume the same adapter without a second custody stack.
- Wallet-per-client and wallet-per-role mapping supports the required authority model; a shared entity secret signs only the authorized wallet's action, never mixing balances.
- CI and deployment use environment-variable credentials rather than expiring sessions.
- The existing `WalletProvider` boundary remains the controlling application architecture; `MockWalletProvider` and the Circle adapter implement the same typed interface.

Risks and required follow-ups:

- Upgrade application and CI runtime to Node.js 22.6+ and pin the SDK version.
- Manage `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` strictly server-side; never expose them in browser storage, logs, or screenshots; store the recovery file securely.
- Idempotency must be enforced at the application level (the domain layer already models idempotency keys and authorization bindings), because per-wallet operations require caller-provided idempotency keys.
- Transaction preparation and submission must remain separate persisted operations with immediate pre-submit revalidation, per AGENTS.md.
- The SDK license is not declared on npm; verify the license terms before committing the dependency.
- Arc Testnet remains the only network; mainnet is out of scope.

## References

- Circle Developer-Controlled Wallets quickstart: https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet (verified 2026-08-06)
- Circle Wallets documentation: https://developers.circle.com/wallets (verified 2026-08-06)
- `@circle-fin/developer-controlled-wallets` on npm: https://www.npmjs.com/package/@circle-fin/developer-controlled-wallets (verified 2026-08-06)
- Arc App Kit — Circle Wallets adapter: https://docs.arc.io/app-kit/tutorials/adapter-setups#circle-wallets (referenced 2026-08-06)
- Circle Agent Stack supported blockchains: https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains (verified 2026-08-06)
