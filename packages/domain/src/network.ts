export const ARC_TESTNET_NETWORK = "ARC_TESTNET" as const;
export const ARC_TESTNET_CHAIN_ID = "5042002" as const;
export const ARC_TESTNET_EXPLORER_TRANSACTION_BASE_URL = "https://testnet.arcscan.app/tx/" as const;

export function arcTestnetExplorerTransactionUrl(transactionHash: string): string {
  return `${ARC_TESTNET_EXPLORER_TRANSACTION_BASE_URL}${transactionHash}`;
}
