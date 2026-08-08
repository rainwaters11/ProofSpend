import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { ServerEnvironment } from "../env";

const SEEDED_FOUNDER_ACTOR_ID = "founder:fictional";
const LIVE_RATE_LIMIT = 3;
const LIVE_RATE_WINDOW_MS = 60_000;

const invocationWindows = new Map<string, { count: number; startedAt: number }>();
const consumedInvocationKeys = new Set<string>();

export class AgentApiAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function tokensMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function authorizeAgentApiRequest(
  request: Request,
  environment: ServerEnvironment,
): string {
  const configuredToken = environment.PROOFSPEND_AGENT_API_TOKEN;
  if (configuredToken === undefined) {
    throw new AgentApiAccessError("AGENT_API_AUTH_NOT_CONFIGURED", 503);
  }

  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!tokensMatch(configuredToken, suppliedToken)) {
    throw new AgentApiAccessError("AGENT_API_UNAUTHORIZED", 401);
  }

  return SEEDED_FOUNDER_ACTOR_ID;
}

export function authorizeAgentInvocation(
  request: Request,
  environment: ServerEnvironment,
  nowMs = Date.now(),
): string {
  const actorId = authorizeAgentApiRequest(request, environment);
  if (environment.PROOFSPEND_AGENT_MODE !== "openai") {
    return actorId;
  }

  const invocationKey = request.headers.get("idempotency-key");
  if (
    invocationKey === null ||
    invocationKey.length < 16 ||
    invocationKey.length > 128 ||
    !/^[A-Za-z0-9:_-]+$/.test(invocationKey)
  ) {
    throw new AgentApiAccessError("AGENT_INVOCATION_KEY_REQUIRED", 400);
  }
  if (consumedInvocationKeys.has(invocationKey)) {
    throw new AgentApiAccessError("AGENT_INVOCATION_REPLAYED", 409);
  }

  const currentWindow = invocationWindows.get(actorId);
  const window =
    currentWindow === undefined || nowMs - currentWindow.startedAt >= LIVE_RATE_WINDOW_MS
      ? { count: 0, startedAt: nowMs }
      : currentWindow;
  if (window.count >= LIVE_RATE_LIMIT) {
    throw new AgentApiAccessError("AGENT_INVOCATION_RATE_LIMITED", 429);
  }

  window.count += 1;
  invocationWindows.set(actorId, window);
  consumedInvocationKeys.add(invocationKey);
  return actorId;
}

export function resetAgentApiAccessForTest(): void {
  invocationWindows.clear();
  consumedInvocationKeys.clear();
}
