import { NextResponse } from "next/server";

import { getEnvironment } from "@/lib/env";
import {
  AgentApiAccessError,
  ApprovalDecisionSchema,
  HandoffResultSchema,
  authorizeAgentApiRequest,
  consumeProposalIdempotencyKey,
  handoffApprovedProposal,
  loadVerificationAgentRun,
} from "@/lib/verification-agent";
import { z } from "zod";

const HandoffRequestSchema = z
  .object({
    runId: z.string().min(1),
    approval: ApprovalDecisionSchema,
  })
  .strict();

export async function POST(request: Request) {
  try {
    const authorizedActorId = authorizeAgentApiRequest(request, getEnvironment());
    const parsedBody = HandoffRequestSchema.parse(await request.json());
    const stored = loadVerificationAgentRun(parsedBody.runId);
    if (stored === null || stored.authorizedActorId !== authorizedActorId) {
      return NextResponse.json({ error: "HANDOFF_RUN_NOT_FOUND" }, { status: 404 });
    }
    const result = HandoffResultSchema.parse(
      handoffApprovedProposal({
        run: stored.run,
        approval: parsedBody.approval,
        authenticatedActorId: authorizedActorId,
        consumeProposalKey: consumeProposalIdempotencyKey,
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentApiAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = error instanceof Error ? error.message : "HANDOFF_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
