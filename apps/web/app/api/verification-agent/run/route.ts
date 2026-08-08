import { NextResponse } from "next/server";

import { getEnvironment } from "@/lib/env";
import {
  AgentApiAccessError,
  authorizeAgentInvocation,
  runVerificationAgent,
  saveVerificationAgentRun,
} from "@/lib/verification-agent";

export async function POST(request: Request) {
  try {
    const environment = getEnvironment();
    const authorizedActorId = authorizeAgentInvocation(request, environment);
    const result = await runVerificationAgent();
    saveVerificationAgentRun({ authorizedActorId, run: result });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentApiAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = error instanceof Error ? error.message : "AGENT_RUN_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
