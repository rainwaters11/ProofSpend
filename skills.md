# ProofSpend LaunchVault skills catalog

Executable repository skills live under `.agents/skills/<name>/SKILL.md`. Durable product rules belong in `design.md`; repository constraints belong in `AGENTS.md`; decisions and ordering belong in `docs/`.

## Included skills

### `launchvault-issue-builder`

Implements one numbered issue after checking live scope, dependencies, architecture records, tests, and security boundaries.

### `launchvault-release-review`

Audits a checkpoint or release for demo truthfulness, security, privacy, protocol evidence, and reproducibility.

### `arc-standards-integration`

Required for Circle, Arc transaction, ERC-8004, ERC-8183, or reputation work. It verifies official sources, roles, identity/reputation governance, job lifecycle, exact intent, and transaction-state separation.

### `launchvault-ui-quality`

Required for perceptible frontend work and financial/protocol-state presentation. It enforces the approved Issue #14 Phase A–D scope, accessibility, privacy, and truthful states.

## Skill rules

- one workflow per skill;
- read `docs/roadmap.md`, `docs/dependency-map.md`, `docs/decision-log.md`, and applicable architecture records;
- no skill may bypass deterministic policy or financial approval;
- successful completion requires evidence;
- a custom-contract review skill is not on the default MVP path.
