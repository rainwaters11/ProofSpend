import { NextResponse } from "next/server";

import { createPawPovAiEvidenceScenario } from "@proofspend/domain";
import { z } from "zod";

import { getEnvironment } from "@/lib/env";
import {
  AgentApiAccessError,
  authorizeAgentApiRequest,
  loadVerificationAgentRun,
  replaceVerificationAgentRun,
  resumeVerificationAgentAfterFounderCorrection,
} from "@/lib/verification-agent";

const CorrectionRequestSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const authorizedActorId = authorizeAgentApiRequest(request, getEnvironment());
    const body = CorrectionRequestSchema.parse(await request.json());
    const stored = loadVerificationAgentRun(body.runId);
    if (stored === null || stored.authorizedActorId !== authorizedActorId) {
      return NextResponse.json({ error: "CORRECTION_RUN_NOT_FOUND" }, { status: 404 });
    }
    const scenario = createPawPovAiEvidenceScenario();
    const result = resumeVerificationAgentAfterFounderCorrection({
      run: stored.run,
      authenticatedActorId: authorizedActorId,
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
    });
    replaceVerificationAgentRun({ authorizedActorId, run: result });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentApiAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = error instanceof Error ? error.message : "FOUNDER_CORRECTION_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
