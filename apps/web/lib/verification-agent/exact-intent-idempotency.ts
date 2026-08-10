import { createHash } from "node:crypto";

const UUID_V5_NAMESPACE = "9fce1f58-7f8b-5d0d-8f7d-0f49de3c30d2";
const EXACT_INTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

/** Derives a stable RFC 4122 UUIDv5 from the immutable canonical intent hash. */
export function exactIntentIdempotencyKey(exactIntentHash: string): string {
  if (!EXACT_INTENT_HASH_PATTERN.test(exactIntentHash)) {
    throw new Error("EXACT_INTENT_HASH_INVALID");
  }
  const bytes = createHash("sha1")
    .update(uuidBytes(UUID_V5_NAMESPACE))
    .update(exactIntentHash, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
