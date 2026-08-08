import { z } from "zod";

const circleEnvironmentSchema = z.object({
  CIRCLE_CHAIN: z.literal("ARC-TESTNET"),
  CIRCLE_USDC_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  CIRCLE_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  CIRCLE_MAX_POLLS: z.coerce.number().int().positive(),
  CIRCLE_ARGSCAN_BASE_URL: z.string().url(),
});

export type CircleEnvironment = {
  blockchain: "ARC-TESTNET";
  usdcTokenAddress: string;
  pollIntervalMs: number;
  maxPolls: number;
  arcscanBaseUrl: string;
};

export function parseCircleEnvironment(
  environment: Record<string, string | undefined>,
): CircleEnvironment {
  const parsed = circleEnvironmentSchema.parse(environment);
  return {
    blockchain: parsed.CIRCLE_CHAIN,
    usdcTokenAddress: parsed.CIRCLE_USDC_TOKEN_ADDRESS,
    pollIntervalMs: parsed.CIRCLE_POLL_INTERVAL_MS,
    maxPolls: parsed.CIRCLE_MAX_POLLS,
    arcscanBaseUrl: parsed.CIRCLE_ARGSCAN_BASE_URL,
  };
}

export function getCircleEnvironment(): CircleEnvironment {
  return parseCircleEnvironment(process.env);
}
