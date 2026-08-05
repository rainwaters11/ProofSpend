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

function parseMoneyOperands(left: MoneyAmount, right: MoneyAmount): readonly [MoneyAmount, MoneyAmount] {
  return [MoneyAmountSchema.parse(left), MoneyAmountSchema.parse(right)];
}

export function addMoney(left: MoneyAmount, right: MoneyAmount): MoneyAmount {
  const [parsedLeft, parsedRight] = parseMoneyOperands(left, right);
  sameAsset(parsedLeft, parsedRight);
  return money(parsedLeft.asset, (BigInt(parsedLeft.atomicUnits) + BigInt(parsedRight.atomicUnits)).toString());
}
export function subtractMoney(left: MoneyAmount, right: MoneyAmount): MoneyAmount {
  const [parsedLeft, parsedRight] = parseMoneyOperands(left, right);
  sameAsset(parsedLeft, parsedRight);
  const result = BigInt(parsedLeft.atomicUnits) - BigInt(parsedRight.atomicUnits);
  if (result < 0n) throw new MoneyError("INSUFFICIENT_FUNDS", "Money subtraction cannot produce a negative amount.");
  return money(parsedLeft.asset, result.toString());
}
export function compareMoney(left: MoneyAmount, right: MoneyAmount): -1 | 0 | 1 {
  const [parsedLeft, parsedRight] = parseMoneyOperands(left, right);
  sameAsset(parsedLeft, parsedRight);
  const a = BigInt(parsedLeft.atomicUnits); const b = BigInt(parsedRight.atomicUnits);
  return a < b ? -1 : a > b ? 1 : 0;
}
