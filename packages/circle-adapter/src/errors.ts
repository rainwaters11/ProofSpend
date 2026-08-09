export type WalletErrorCode =
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PAYMENT_NOT_SUPPORTED";

export type SanitizedErrorCause = {
  errorType: string;
};

export class WalletProviderError extends Error {
  readonly code: WalletErrorCode;
  readonly cause?: unknown;

  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "WalletProviderError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export function normalizeWalletError(error: unknown): WalletProviderError {
  if (error instanceof WalletProviderError) {
    return error;
  }

  const cause: SanitizedErrorCause = {
    errorType: error instanceof Error ? error.name : typeof error,
  };

  return new WalletProviderError("PROVIDER_UNAVAILABLE", "Wallet provider request failed.", {
    cause,
  });
}
