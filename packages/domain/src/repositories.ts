import type { AuditEvent } from "./models";

export class DuplicateRecordError extends Error { constructor(id: string) { super(`Record ${id} already exists.`); this.name = "DuplicateRecordError"; } }
export class IdempotencyConflictError extends Error { constructor(key: string) { super(`Idempotency key ${key} was reused for a different action.`); this.name = "IdempotencyConflictError"; } }
const clone = <T>(value: T): T => structuredClone(value);
export interface Identified { id: string }
export class InMemoryRepository<T extends Identified> {
  readonly #records = new Map<string, T>();
  create(record: T): T { if (this.#records.has(record.id)) throw new DuplicateRecordError(record.id); const saved = clone(record); this.#records.set(record.id, saved); return clone(saved); }
  get(id: string): T | undefined { const value = this.#records.get(id); return value ? clone(value) : undefined; }
  list(): T[] { return [...this.#records.values()].map(clone); }
}
export class InMemoryAuditRepository {
  readonly #events: AuditEvent[] = [];
  append(event: AuditEvent): AuditEvent { const saved = clone(event); this.#events.push(saved); return clone(saved); }
  list(): AuditEvent[] { return this.#events.map(clone); }
}
interface IdempotentEntry<T> { fingerprint: string; result: T }
export class InMemoryIdempotencyRepository {
  readonly #entries = new Map<string, Map<string, IdempotentEntry<unknown>>>();
  execute<T>(scope: string, key: string, fingerprint: string, action: () => T): T {
    const scopedEntries = this.#entries.get(scope);
    const existing = scopedEntries?.get(key);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError(key); return clone(existing.result as T); }
    const result = action();
    const nextScopedEntries = scopedEntries ?? new Map<string, IdempotentEntry<unknown>>();
    nextScopedEntries.set(key, { fingerprint, result: clone(result) });
    if (!scopedEntries) this.#entries.set(scope, nextScopedEntries);
    return clone(result);
  }
}
