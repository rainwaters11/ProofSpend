import type { MoneyAmount } from "@proofspend/domain";

const USDC_DECIMALS = 6;

/**
 * USDC atomic units are 6-decimal integers (packages/domain/src/seed.ts
 * uses the same scale, e.g. "150000000" atomic units == 150 USDC). Formats
 * with a thousands separator and shows at least two decimal places, trimming
 * only trailing zeros beyond that — real fractional precision is never
 * rounded away, but whole amounts stay readable (design.md: "large but
 * restrained financial metrics").
 */
export function formatMoney(amount: MoneyAmount): string {
  const negative = amount.atomicUnits.startsWith("-");
  const digits = negative ? amount.atomicUnits.slice(1) : amount.atomicUnits;
  const padded = digits.padStart(USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -USDC_DECIMALS);
  let fraction = padded.slice(-USDC_DECIMALS);
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${groupedWhole}.${fraction} ${amount.asset}`;
}
