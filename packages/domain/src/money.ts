import { z } from "zod";

export const AtomicUnitsSchema = z.string().regex(/^(0|[1-9]\d*)$/, "Expected canonical non-negative atomic units.");
export const MoneyAmountSchema = z.object({ asset: z.string().min(1), atomicUnits: AtomicUnitsSchema });
export type MoneyAmount = z.infer<typeof MoneyAmountSchema>;

export class MoneyError extends Error {
  constructor(readonly code: "ASSET_MISMATCH" | "INSUFFICIENT_FUNDS", message: string) {
    super(message); this.name = "MoneyError";
  }
}

export const money = (asset: string, atomicUnits: string): MoneyAmount =>
  MoneyAmountSchema.parse({ asset, atomicUnits });

function sameAsset(left: MoneyAmount, right: MoneyAmount): void {
  if (left.asset !== right.asset) throw new MoneyError("ASSET_MISMATCH", "Money assets must match.");
}

export function addMoney(left: MoneyAmount, right: MoneyAmount): MoneyAmount {
  sameAsset(left, right); return money(left.asset, (BigInt(left.atomicUnits) + BigInt(right.atomicUnits)).toString());
}
export function subtractMoney(left: MoneyAmount, right: MoneyAmount): MoneyAmount {
  sameAsset(left, right);
  const result = BigInt(left.atomicUnits) - BigInt(right.atomicUnits);
  if (result < 0n) throw new MoneyError("INSUFFICIENT_FUNDS", "Money subtraction cannot produce a negative amount.");
  return money(left.asset, result.toString());
}
export function compareMoney(left: MoneyAmount, right: MoneyAmount): -1 | 0 | 1 {
  sameAsset(left, right); const a = BigInt(left.atomicUnits); const b = BigInt(right.atomicUnits);
  return a < b ? -1 : a > b ? 1 : 0;
}
