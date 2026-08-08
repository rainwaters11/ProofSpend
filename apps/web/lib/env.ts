import "server-only";

import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalAgentApiToken = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(32).optional(),
);

const mockEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: optionalNonEmptyString,
    LLM_MODEL: optionalNonEmptyString,
    PROOFSPEND_AGENT_API_TOKEN: optionalAgentApiToken,
    CIRCLE_CHAIN: z.literal("ARC-TESTNET").optional(),
    PROOFSPEND_ADAPTER_MODE: z.literal("mock"),
    PROOFSPEND_AGENT_MODE: z.literal("mock"),
  })
  .passthrough();

const openAiEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().trim().min(1),
    LLM_MODEL: z.string().trim().min(1),
    PROOFSPEND_AGENT_API_TOKEN: optionalAgentApiToken,
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
  return environmentSchema.parse({
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
    LLM_MODEL: environment.LLM_MODEL,
    PROOFSPEND_AGENT_API_TOKEN: environment.PROOFSPEND_AGENT_API_TOKEN,
    CIRCLE_CHAIN: environment.CIRCLE_CHAIN,
    PROOFSPEND_ADAPTER_MODE: environment.PROOFSPEND_ADAPTER_MODE,
    PROOFSPEND_AGENT_MODE: environment.PROOFSPEND_AGENT_MODE,
  });
}

export function getEnvironment(): ServerEnvironment {
  return parseEnvironment(process.env);
}
