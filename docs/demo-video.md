# Guided demo video capture

Issue #9 uses a dedicated Playwright capture script rather than changing the normal end-to-end tests. The script records five independent 1280×720 clips from deterministic PawPOVAI seed data:

1. `launchvault.webm`
2. `evidence-gap.webm`
3. `proof-recovery.webm`
4. `approval-and-settlement.webm`
5. `backer-view-and-replay.webm`

## Record the reproducible mock cut

Start the application in explicit mock mode:

```bash
CIRCLE_CHAIN=ARC-TESTNET \
PROOFSPEND_ADAPTER_MODE=mock \
PROOFSPEND_AGENT_MODE=mock \
bun --filter @proofspend/web dev
```

In a second terminal, record the clips:

```bash
bun --filter @proofspend/web demo:record
```

The ignored output directory is `apps/web/demo-recordings/`. Set `PROOFSPEND_DEMO_OUTPUT_DIR` to override it. The recorder checks `/api/health` and fails closed unless both agent and adapter modes are `mock`.

Each clip gets its own browser context. The context is closed before the temporary Playwright video is renamed, ensuring the video is completely written. Captures use reduced motion, deliberate cursor movement, and short pauses after navigation and lifecycle changes.

## Add the verified public Arcscan proof

The deterministic cut never fabricates or guesses an Arcscan URL. After the single separately authorized Arc Testnet settlement is confirmed, independently verify its public transaction URL and pass the exact URL only while recording the final proof cut:

```bash
PROOFSPEND_DEMO_ARCSCAN_URL='https://testnet.arcscan.app/tx/0x<64-hex-character-confirmed-transaction-hash>' \
bun --filter @proofspend/web demo:record
```

The script accepts only an HTTPS `testnet.arcscan.app/tx/0x…` URL with a canonical 32-byte transaction hash. It does not execute a transaction, read wallet credentials, call Circle, or infer confirmation. Without that environment variable, the fifth clip ends on the deterministic replay and prints a truthful limitation.

Do not paste API keys, entity secrets, private evidence, private wallet identifiers, OTPs, or credentials into the command, browser, narration, or committed files. A transaction must not be executed merely to make a recording; reuse the one verified settlement recording for subsequent edits.

## Suggested edit and narration order

- **LaunchVault:** funding is milestone-based rather than released upfront.
- **Evidence gap:** the seeded pre-correction activity makes the missing-proof problem concrete.
- **Proof Recovery:** AI asks a focused question; deterministic policy re-evaluates; the proposal stops at `APPROVAL_REQUIRED`.
- **Approval and settlement:** the mock lifecycle preview keeps approval, preparation, submission, confirmation, and reconciliation visibly separate while `ARC TESTNET` remains visible.
- **Backer View and replay:** only allowlisted disclosure reaches the backer; private receipt data stays hidden. End on the verified Arcscan proof only when one exists.

The application remains a prototype. The mock lifecycle preview is not evidence that an Arc transaction occurred, and Issue #9 is not complete until the final guided video and its verified evidence are reviewed.
