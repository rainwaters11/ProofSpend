import { describe, expect, it } from "vitest";

import { exactIntentIdempotencyKey } from "./exact-intent-idempotency";

describe("exactIntentIdempotencyKey", () => {
  it("derives a stable RFC 4122 UUIDv5 with the RFC variant", () => {
    const hash = `sha256:${"a".repeat(64)}`;
    const first = exactIntentIdempotencyKey(hash);

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(exactIntentIdempotencyKey(hash)).toBe(first);
  });

  it("changes when the immutable exact intent hash changes", () => {
    expect(exactIntentIdempotencyKey(`sha256:${"a".repeat(64)}`)).not.toBe(
      exactIntentIdempotencyKey(`sha256:${"b".repeat(64)}`),
    );
  });
});
