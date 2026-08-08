import { APPLICATION_VERSION } from "@proofspend/shared";
import { NextResponse } from "next/server";

import { getEnvironment } from "../../../lib/env";

export function GET() {
  const environment = getEnvironment();

  return NextResponse.json({
    status: "ok",
    adapterMode: environment.PROOFSPEND_ADAPTER_MODE,
    agentMode: environment.PROOFSPEND_AGENT_MODE,
    version: APPLICATION_VERSION,
  });
}
