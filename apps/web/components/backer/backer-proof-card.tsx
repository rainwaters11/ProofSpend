import { FileCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BackerSafeProjectRecord } from "@proofspend/domain";

type BackerProof = BackerSafeProjectRecord["proofs"][number];

interface BackerProofCardProps {
  proof: BackerProof;
}

/** Shows only the proof-of-progress hash and version — never the underlying private evidence. */
export function BackerProofCard({ proof }: BackerProofCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <FileCheck aria-hidden="true" className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm">Proof-of-Progress v{proof.version}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Synthetic mock hash
        </span>
        <span className="break-all font-mono text-xs text-muted-foreground">{proof.recordHash}</span>
        <span className="text-xs text-muted-foreground">
          Recorded {new Date(proof.createdAt).toLocaleDateString()}
        </span>
      </CardContent>
    </Card>
  );
}
