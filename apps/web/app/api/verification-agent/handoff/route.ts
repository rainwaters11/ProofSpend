import { NextResponse } from "next/server";

import {
  ApprovalDecisionSchema,
  HandoffResultSchema,
  handoffApprovedProposal,
  runVerificationAgent,
} from "@/lib/verification-agent";

export async function POST(request: Request) {
  try {
    const parsedBody = ApprovalDecisionSchema.parse(await request.json());
    const run = await runVerificationAgent();
    const result = HandoffResultSchema.parse(
      handoffApprovedProposal({ run, approval: parsedBody }),
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "HANDOFF_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
