# ProofSpend LaunchVault

Evidence-aware programmable capital for Arc Testnet.

## Foundation

Issue 1 establishes a Bun workspace, a minimal Next.js application, and typed wallet integration boundaries. It runs in explicit mock mode without credentials and does not move real funds.

```bash
bun install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
bun run lint
bun run typecheck
bun run test
bun run build
bun --filter @proofspend/web dev
```

The safe health endpoint is available at `http://localhost:3000/api/health`. Circle CLI authentication and Arc Testnet transactions are deferred to Issue 7. See [`docs/upstream-sources.md`](docs/upstream-sources.md) for upstream audit notes.

ProofSpend helps solopreneurs and small businesses protect, prove, and recover their money.
