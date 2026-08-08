import { NextResponse } from "next/server";

import {
  ApprovalDecisionSchema,
  HandoffResultSchema,
  VerificationAgentResultSchema,
  handoffApprovedProposal,
} from "@/lib/verification-agent";
import { z } from "zod";

const HandoffRequestSchema = z
  .object({
    run: VerificationAgentResultSchema,
    approval: ApprovalDecisionSchema,
  })
  .strict();

export async function POST(request: Request) {
  try {
    const parsedBody = HandoffRequestSchema.parse(await request.json());
    const result = HandoffResultSchema.parse(
      handoffApprovedProposal({ run: parsedBody.run, approval: parsedBody.approval }),
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "HANDOFF_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
