import { describe, expect, it } from "vitest";

import { formatMoney } from "./format-money";

describe("formatMoney", () => {
  it("formats whole USDC amounts with two decimal places", () => {
    expect(formatMoney({ asset: "USDC", atomicUnits: "150000000" })).toBe("150.00 USDC");
  });

  it("formats fractional USDC amounts without losing precision", () => {
    expect(formatMoney({ asset: "USDC", atomicUnits: "1000001" })).toBe("1.000001 USDC");
  });

  it("groups thousands in the whole-number part", () => {
    expect(formatMoney({ asset: "USDC", atomicUnits: "1000000000" })).toBe("1,000.00 USDC");
  });

  it("formats zero without a leading sign", () => {
    expect(formatMoney({ asset: "USDC", atomicUnits: "0" })).toBe("0.00 USDC");
  });

  it("keeps a non-multiple-of-3 trailing fraction intact", () => {
    expect(formatMoney({ asset: "USDC", atomicUnits: "150500000" })).toBe("150.50 USDC");
    expect(formatMoney({ asset: "USDC", atomicUnits: "150123000" })).toBe("150.123 USDC");
  });
});
