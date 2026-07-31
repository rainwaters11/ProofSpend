import "server-only";

import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  OPENAI_API_KEY: optionalNonEmptyString,
  LLM_MODEL: optionalNonEmptyString,
  CIRCLE_CHAIN: z.literal("ARC-TESTNET").optional(),
  PROOFSPEND_ADAPTER_MODE: z.literal("mock").default("mock"),
});

export type ServerEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return environmentSchema.parse(environment);
}

export function getEnvironment(): ServerEnvironment {
  return parseEnvironment(process.env);
}
