import { PlaceholderPanel } from "@/components/shell/placeholder-panel";

export default async function VaultDetailPage({
  params,
}: {
  params: Promise<{ vaultId: string }>;
}) {
  const { vaultId } = await params;

  return (
    <PlaceholderPanel title={`LaunchVault detail — ${vaultId}`} phase="Phase C">
      <p className="mt-4 text-sm text-muted-foreground">
        The vault identifier in the URL is not validated against real data yet.
      </p>
    </PlaceholderPanel>
  );
}
