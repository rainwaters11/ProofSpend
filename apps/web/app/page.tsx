import { getEnvironment } from "../lib/env";

export default function Home() {
  const environment = getEnvironment();

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">ProofSpend LaunchVault</p>
        <h1 id="page-title">Fund the vision. Prove the progress. Unlock what comes next.</h1>
        <p className="summary">
          A foundation for evidence-aware programmable capital, designed for Arc Testnet.
        </p>

        <aside className="mode-notice" aria-label="Application mode">
          <strong>DEMO MODE</strong>
          <span>No real funds are being moved.</span>
          <small>Adapter: {environment.PROOFSPEND_ADAPTER_MODE}</small>
        </aside>

        <ol className="steps" aria-label="LaunchVault workflow">
          <li>Fund</li>
          <li>Prove</li>
          <li>Unlock</li>
        </ol>
      </section>
    </main>
  );
}
