import { PlaceholderPanel } from "@/components/shell/placeholder-panel";

export default async function MilestoneDetailPage({
  params,
}: {
  params: Promise<{ milestoneId: string }>;
}) {
  const { milestoneId } = await params;

  return (
    <PlaceholderPanel title={`Milestone detail — ${milestoneId}`} phase="Phase C">
      <p className="mt-4 text-sm text-muted-foreground">
        AI recommendation, deterministic policy result, and human approval will render as three
        separate, clearly labeled panels here — never collapsed into one generic status.
      </p>
    </PlaceholderPanel>
  );
}
