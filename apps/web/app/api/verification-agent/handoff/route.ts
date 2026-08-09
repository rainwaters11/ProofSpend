import { NextResponse } from "next/server";

import { getEnvironment } from "@/lib/env";
import {
  AgentApiAccessError,
  ApprovalDecisionSchema,
  HandoffResultSchema,
  MAX_HANDOFF_ATTEMPTS_PER_RUN,
  MAX_HANDOFF_IDENTIFIER_LENGTH,
  authorizeAgentApiRequest,
  handoffApprovedProposal,
  loadVerificationAgentRun,
  persistApprovedHandoff,
  recordRejectedHandoff,
} from "@/lib/verification-agent";
import { z } from "zod";

const HandoffRequestSchema = z
  .object({
    runId: z.string().min(1).max(MAX_HANDOFF_IDENTIFIER_LENGTH),
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
    if (stored.handoffAttempts.length >= MAX_HANDOFF_ATTEMPTS_PER_RUN) {
      return NextResponse.json(
        { error: "HANDOFF_ATTEMPT_LIMIT_REACHED" },
        { status: 429 },
      );
    }
    const result = HandoffResultSchema.parse(
      handoffApprovedProposal({
        run: stored.run,
        approval: parsedBody.approval,
        authenticatedActorId: authorizedActorId,
      }),
    );
    if (result.status !== "HANDOFF_READY") {
      recordRejectedHandoff({
        runId: stored.run.runId,
        approval: parsedBody.approval,
        result,
      });
      return NextResponse.json({ error: "HANDOFF_REJECTED" }, { status: 422 });
    }
    if (
      !persistApprovedHandoff({
        runId: stored.run.runId,
        approval: parsedBody.approval,
        result,
      })
    ) {
      return NextResponse.json({ error: "HANDOFF_DUPLICATE" }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentApiAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = error instanceof Error ? error.message : "HANDOFF_FAILED";
    if (code === "HANDOFF_PERSISTENT_IDEMPOTENCY_REQUIRED") {
      return NextResponse.json({ error: code }, { status: 503 });
    }
    if (code === "HANDOFF_ATTEMPT_LIMIT_REACHED") {
      return NextResponse.json({ error: code }, { status: 429 });
    }
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
