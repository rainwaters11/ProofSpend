import { ExternalLink } from "lucide-react";

interface ExplorerLinkProps {
  transactionHash: string | null;
  explorerUrl: string | null;
  isMock: boolean;
}

/**
 * Mock transactions never render a clickable live explorer link — only a
 * plain synthetic reference — so a fabricated hash can never be mistaken
 * for a real Arc Testnet transaction (AGENTS.md truthfulness boundaries).
 */
export function ExplorerLink({ transactionHash, explorerUrl, isMock }: ExplorerLinkProps) {
  if (transactionHash === null) {
    return <span className="text-sm text-muted-foreground">No transaction hash yet</span>;
  }

  if (isMock || explorerUrl === null) {
    return (
      <span className="break-all font-mono text-sm text-muted-foreground" title="Synthetic mock reference, not a live Arc Testnet transaction">
        {transactionHash}
      </span>
    );
  }

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 break-all font-mono text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {transactionHash}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">(opens Arc Testnet explorer in a new tab)</span>
    </a>
  );
}
