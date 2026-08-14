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

const adapterModeSchema = z.enum(["mock", "arc-testnet"]);

const circleWalletEnvironmentSchema = z.object({
  CIRCLE_API_KEY: z.string().trim().min(1),
  CIRCLE_ENTITY_SECRET: z.string().trim().regex(/^[a-fA-F0-9]{64}$/),
  CIRCLE_SOURCE_WALLET_ID: z.string().uuid(),
  CIRCLE_DESTINATION_WALLET_ID: z.string().uuid(),
  CIRCLE_DESTINATION_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  CIRCLE_CHAIN: z.literal("ARC-TESTNET"),
  CIRCLE_USDC_TOKEN_ADDRESS: z.literal("0x3600000000000000000000000000000000000000"),
  CIRCLE_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  CIRCLE_MAX_POLLS: z.coerce.number().int().positive(),
  CIRCLE_ARGSCAN_BASE_URL: z.literal("https://testnet.arcscan.app"),
});

const circleLiveEnvironmentSchema = circleWalletEnvironmentSchema.extend({
  PROOFSPEND_AUTH_STORE_PATH: z.string().trim().min(1),
});

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

const integratedLiveEnvironmentSchema = circleLiveEnvironmentSchema
  .extend({
    OPENAI_API_KEY: z.string().trim().min(1),
    LLM_MODEL: z.string().trim().min(1),
    PROOFSPEND_AGENT_API_TOKEN: z.string().trim().min(32),
    PROOFSPEND_ADAPTER_MODE: z.literal("arc-testnet"),
    PROOFSPEND_AGENT_MODE: z.literal("openai"),
  })
  .passthrough();

const environmentSchema = z.union([
  mockEnvironmentSchema,
  openAiEnvironmentSchema,
  integratedLiveEnvironmentSchema,
]);

export type ServerEnvironment = z.infer<typeof environmentSchema>;

export interface AppShellStatus {
  mode: z.infer<typeof adapterModeSchema>;
  walletConfigured: boolean;
}

/**
 * Returns the small, non-sensitive environment projection used by the app
 * shell. Live credentials are checked server-side but never returned. Using
 * safeParse for the wallet check also lets static builds render the selected
 * mode without requiring deployment-only Circle credentials at build time.
 */
export function getAppShellStatus(
  environment: Record<string, string | undefined>,
): AppShellStatus {
  const mode = adapterModeSchema.parse(environment.PROOFSPEND_ADAPTER_MODE);

  return {
    mode,
    walletConfigured:
      mode === "arc-testnet" &&
      circleWalletEnvironmentSchema.safeParse(environment).success,
  };
}

export function parseEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return environmentSchema.parse({
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
    LLM_MODEL: environment.LLM_MODEL,
    PROOFSPEND_AGENT_API_TOKEN: environment.PROOFSPEND_AGENT_API_TOKEN,
    CIRCLE_CHAIN: environment.CIRCLE_CHAIN,
    CIRCLE_API_KEY: environment.CIRCLE_API_KEY,
    CIRCLE_ENTITY_SECRET: environment.CIRCLE_ENTITY_SECRET,
    CIRCLE_SOURCE_WALLET_ID: environment.CIRCLE_SOURCE_WALLET_ID,
    CIRCLE_DESTINATION_WALLET_ID: environment.CIRCLE_DESTINATION_WALLET_ID,
    CIRCLE_DESTINATION_WALLET_ADDRESS: environment.CIRCLE_DESTINATION_WALLET_ADDRESS,
    CIRCLE_USDC_TOKEN_ADDRESS: environment.CIRCLE_USDC_TOKEN_ADDRESS,
    CIRCLE_POLL_INTERVAL_MS: environment.CIRCLE_POLL_INTERVAL_MS,
    CIRCLE_MAX_POLLS: environment.CIRCLE_MAX_POLLS,
    CIRCLE_ARGSCAN_BASE_URL: environment.CIRCLE_ARGSCAN_BASE_URL,
    PROOFSPEND_AUTH_STORE_PATH: environment.PROOFSPEND_AUTH_STORE_PATH,
    PROOFSPEND_ADAPTER_MODE: environment.PROOFSPEND_ADAPTER_MODE,
    PROOFSPEND_AGENT_MODE: environment.PROOFSPEND_AGENT_MODE,
  });
}

export function getEnvironment(): ServerEnvironment {
  return parseEnvironment(process.env);
}
