# Upstream sources

## Issue #7 re-audit record

- Re-audit date: 2026-08-06.
- `circlefin/agent-stack-starter-kits` default branch (`master`) is unchanged since the Issue #1 audit: pinned commit `fb4f4c71c198a7ad32db30b4edad2869fa4b8872`.
- Circle Agent Stack `ARC-TESTNET` support and CLI command contracts were re-verified against official Circle documentation.
- ADR-001 (docs/architecture/adr-001-circle-execution-architecture.md) selects **Circle Developer-Controlled Wallets** as the primary custody/execution path. The Agent Stack CLI path remains documented as a rejected alternative.

## Issue #7 software-composition record

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `@circle-fin/developer-controlled-wallets` | 10.8.0 (pin at implementation) | Not declared on npm; verify before committing | Server-side wallet sets, wallets, balances, and contract execution on Arc Testnet |

## Circle Agent Stack starter kits audit

### Audit record

- Repository: `circlefin/agent-stack-starter-kits`
- Audited branch: `master`
- Audited commit: `fb4f4c71c198a7ad32db30b4edad2869fa4b8872`
- Commit title: `Add Apache 2.0 License and copyright notices to project files (#3)`
- Audit date: 2026-07-31
- License: Apache-2.0
- Upstream runtime baseline: Node.js `20+` and Bun `1.2+`
- Inspection method: GitHub repository files were reviewed through the connected GitHub integration after the implementation workspace's outbound GitHub access was blocked.

No Circle source was cloned, vendored, copied, reconstructed, or represented as imported during Issue 1. Issue 1 contains only ProofSpend-owned integration boundaries and a credential-free mock provider.

### Repository structure

The audited repository is a Bun workspace organized around framework-specific agent examples and shared packages:

```text
agent-stack-starter-kits/
├── kits/
│   ├── claude-agent-sdk/
│   ├── google-adk/
│   ├── langchain/
│   ├── mastra/
│   ├── openai-agents/
│   └── vercel-ai/
└── packages/
    ├── circle-tools/
    └── agent-cli/
```

The kits demonstrate agent wallets, Circle service discovery, x402 payments, and nanopayments through interactive terminal agents. `packages/circle-tools` is the framework-independent integration package. `packages/agent-cli` is an Ink-based terminal interface and is not part of ProofSpend's web architecture.

## `packages/circle-tools` evaluation

### What the package provides

`@agent-stack-ecosystem-kits/circle-tools` is a private TypeScript workspace package that wraps Circle CLI operations. Its public exports include:

- shared types;
- chain helpers;
- CLI execution and typed CLI errors;
- authentication/session helpers;
- browser/on-ramp helpers;
- wallet creation, listing, deployment, funding, and balances;
- service discovery and inspection;
- x402 service payment helpers;
- gateway balance and deposit helpers.

The audited README documents wrappers for wallet creation, wallet listing, balance reads, service search, service inspection, and service payment.

### Useful implementation patterns

The following patterns are candidates for selective adaptation in Issue 7:

- argument-array command execution with `execFileSync` instead of shell-string execution;
- typed `CircleCliError` values containing arguments, stdout, stderr, and exit status;
- JSON-output normalization and explicit JSON parse failures;
- retries limited to transient failures on idempotent read commands;
- no automatic retry for mutating commands, reducing duplicate wallet creation or duplicate payment risk;
- framework-independent wallet and balance functions that can sit behind ProofSpend's `WalletProvider` boundary;
- session/authentication separation from business-domain logic.

### Required ProofSpend adaptations

The audited implementation cannot be copied unchanged:

- its chain model supports `BASE` and `POLYGON`, with Base as the default; ProofSpend requires explicit `ARC-TESTNET` support;
- several README examples and tool descriptions are BASE-specific;
- synchronous CLI execution must remain server-only and must never run in a browser component;
- all commands and output contracts must be revalidated against the current Circle CLI before implementation;
- wallet reads, transaction preparation, user approval, submission, and confirmation must remain separate operations;
- mutating calls require idempotency controls and must never be triggered solely by free-form agent output;
- upstream errors must be normalized into ProofSpend's public-safe error types without leaking credentials, OTPs, environment values, or raw sensitive CLI output.

### Reuse decision

**Selectively adapt in Issue 7:**

- safe CLI argument construction;
- typed error and JSON parsing patterns;
- wallet/session/balance abstractions;
- idempotent-read retry policy;
- selected wallet helpers after Arc Testnet compatibility is verified.

**Defer or omit from the critical LaunchVault flow:**

- service marketplace discovery;
- x402 service purchasing;
- nanopayments;
- gateway deposits;
- fiat on-ramp UI;
- terminal-specific behavior;
- BASE/POLYGON chain constants copied unchanged.

These deferred features may be evaluated later, but they must not block the ERC-8183 milestone settlement path.

## `kits/openai-agents` evaluation

### Audited package and dependencies

The audited OpenAI Agents kit uses:

- `@openai/agents`: `^0.11.0`;
- `dotenv`: `^17.4.2`;
- `zod`: `^4.0.0`;
- `typescript`: `^5.5.0`;
- the shared `circle-tools` package;
- the shared `agent-cli` terminal package.

Its demonstrated architecture is:

```text
OpenAI Agents SDK tool loop
        ↓
OpenAI tool adapters
        ↓
Circle CLI wrappers
        ↓
Circle Agent Stack wallets, services, and x402
```

The example creates an autonomous payment agent that performs wallet onboarding, balance checks, service discovery, and USDC nanopayments. The terminal runner also handles OpenAI Agents SDK interruptions by displaying the proposed tool and arguments, then requiring an explicit user `yes` or `no` before approval or rejection.

### Useful implementation patterns

The following patterns are candidates for the ProofSpend Verification Agent:

- Zod schemas for tool arguments;
- narrow tool adapters around framework-independent services;
- human approval through tool-call interruptions;
- explicit display of the proposed tool name and arguments before approval;
- separation between the agent loop and the Circle utility package;
- configuration loading and clear tool-result reporting.

### Required ProofSpend adaptations

ProofSpend must not reuse the autonomous-payment behavior unchanged:

- the Verification Agent should extract, classify, explain, and recommend; it must not independently approve or submit a value-moving transaction;
- deterministic policy, not model prose, determines milestone eligibility;
- an authorized human or role-controlled evaluator must explicitly approve the prepared action;
- transaction submission occurs only after approval and must be confirmed before balances are updated;
- the audited kit is BASE/x402 oriented, while ProofSpend's primary path is Arc Testnet plus ERC-8004 identity and ERC-8183 job settlement;
- tool exposure must be least-privilege and role-aware;
- uploaded evidence is untrusted input and cannot alter system instructions, authorization, policy, or transaction parameters.

### Reuse decision

**Selectively adapt in Issue 7 and the future dedicated Verification Agent runtime issue:**

- OpenAI Agents SDK tool-definition patterns;
- Zod tool schemas;
- interruption-based human approval patterns;
- separation of agent orchestration from Circle utilities;
- safe, structured tool-result reporting.

Issue 13 remains limited to ERC-8004 identity and reputation governance. It must not absorb OpenAI Agents SDK orchestration or the complete Verification Agent runtime.

**Do not import:**

- the Ink terminal UI;
- the autonomous onboarding conversation;
- instructions requiring the agent to perform every action;
- automatic wallet creation, deployment, funding, or payment from a general agent loop;
- BASE/POLYGON assumptions;
- service-marketplace and nanopayment flows as dependencies of the MVP.

## Issue 1 decision and Issue 7 handoff

Issue 1 intentionally stops at typed application-owned boundaries and `MockWalletProvider`. It does not include Circle authentication, Circle CLI execution, Arc transactions, x402, nanopayments, or any copied upstream source.

Before Issue 7 implementation, the team must:

1. Re-audit the latest official Circle starter and documentation.
2. Pin the exact upstream commit used for any adaptation.
3. Verify current Circle CLI commands, output contracts, authentication flow, and `ARC-TESTNET` support.
4. Record every copied or adapted file and preserve applicable Apache-2.0 copyright, license, modification, and attribution notices.
5. Keep mock and Arc Testnet adapter modes explicit and visibly distinct.
6. Preserve the boundary: agent recommends or prepares, deterministic policy evaluates, an authorized human approves, and the server-side adapter submits.
