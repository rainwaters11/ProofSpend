import { NextResponse } from "next/server";

import { runVerificationAgent } from "@/lib/verification-agent";

export async function POST() {
  try {
    const result = await runVerificationAgent();
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AGENT_RUN_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
