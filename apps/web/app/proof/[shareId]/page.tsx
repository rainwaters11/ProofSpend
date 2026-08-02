import { PlaceholderPanel } from "@/components/shell/placeholder-panel";

/**
 * Public Backer View placeholder. Not wrapped in the founder AppShell — the
 * issue's information architecture lists /proof/[shareId] as a public route
 * distinct from /app/*. Real disclosure filtering ships in a later phase
 * once Issue #6 exists; this route renders no private evidence and no
 * fabricated data.
 */
export default async function BackerViewPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <PlaceholderPanel title={`Backer View — ${shareId}`} phase="Phase C">
        <p className="mt-4 text-sm text-muted-foreground">
          This share link is not validated against real disclosure data yet.
        </p>
      </PlaceholderPanel>
    </main>
  );
}
