import "server-only";

import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const mockEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: optionalNonEmptyString,
    LLM_MODEL: optionalNonEmptyString,
    CIRCLE_CHAIN: z.literal("ARC-TESTNET").optional(),
    PROOFSPEND_ADAPTER_MODE: z.literal("mock"),
    PROOFSPEND_AGENT_MODE: z.literal("mock"),
  })
  .passthrough();

const openAiEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().trim().min(1),
    LLM_MODEL: z.string().trim().min(1),
    CIRCLE_CHAIN: z.literal("ARC-TESTNET").optional(),
    PROOFSPEND_ADAPTER_MODE: z.literal("mock"),
    PROOFSPEND_AGENT_MODE: z.literal("openai"),
  })
  .passthrough();

const environmentSchema = z.union([mockEnvironmentSchema, openAiEnvironmentSchema]);

export type ServerEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return environmentSchema.parse(environment);
}

export function getEnvironment(): ServerEnvironment {
  return parseEnvironment(process.env);
}
