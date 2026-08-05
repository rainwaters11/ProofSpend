import { ShieldCheck } from "lucide-react";

import { ModeBadge } from "@/components/mode-badge";
import { RoleBadge } from "@/components/role-badge";
import { BackerProofCard } from "@/components/backer/backer-proof-card";
import { BackerSettlementCard } from "@/components/backer/backer-settlement-card";
import { EmptyState } from "@/components/release/state-view";
import { buildBackerDisclosure, buildReleaseScenario } from "@/lib/release-scenario";

/**
 * Screen 7 — Backer View. Renders only `filterBackerDisclosure` output
 * (packages/domain/src/disclosure.ts) so founder-private evidence can never
 * reach this route by construction, not just by convention (AGENTS.md
 * product and privacy boundaries, D-004). Not wrapped in the founder
 * AppShell — this is a public route.
 */
export default async function BackerViewPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  if (shareId !== "demo") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          title="Share link not found"
          description={`"${shareId}" does not match a published Backer View in this mock scenario. Try the demo share link.`}
        />
      </main>
    );
  }

  const scenario = buildReleaseScenario();
  const disclosure = buildBackerDisclosure(scenario);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RoleBadge role="backer" />
          <ModeBadge mode="mock" />
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">{disclosure.project.name}</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{disclosure.project.description}</p>
      </div>

      <div className="rounded-lg border border-mode-mock/40 bg-mode-mock/10 px-4 py-3 text-sm text-foreground">
        This is a prototype Backer View on Arc Testnet. Every value below passed through the
        allowlisted disclosure filter — raw receipts and founder-private notes are never sent to
        this page.
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Verified spend</h2>
        {disclosure.settlements.length === 0 ? (
          <EmptyState
            title="No disclosed settlements yet"
            description="The founder has not shared settlement state for this project."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {disclosure.settlements.map((settlement) => (
              <BackerSettlementCard key={settlement.id} settlement={settlement} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Proof-of-Progress</h2>
        {disclosure.proofs.length === 0 ? (
          <EmptyState
            title="No proof records shared yet"
            description="The founder has not approved a Proof-of-Progress record for backer disclosure."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {disclosure.proofs.map((proof) => (
              <BackerProofCard key={proof.id} proof={proof} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Arc Testnet is a prototype network. No real funds or securities are involved.
      </p>
    </main>
  );
}
