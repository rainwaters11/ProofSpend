import { ExecutionAuthorizationBindingSchema, type AuditEvent, type ExecutionAuthorizationBinding } from "./models";
import { consumeExecutionAuthorizationBinding } from "./integrity";

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
export class ExecutionAuthorizationBindingRepository {
  readonly #records = new Map<string, ExecutionAuthorizationBinding>();
  create(binding: ExecutionAuthorizationBinding): ExecutionAuthorizationBinding {
    if (this.#records.has(binding.id)) throw new DuplicateRecordError(binding.id);
    const saved = clone(ExecutionAuthorizationBindingSchema.parse(binding)); this.#records.set(saved.id, saved); return clone(saved);
  }
  get(id: string): ExecutionAuthorizationBinding | undefined { const value = this.#records.get(id); return value ? clone(value) : undefined; }
  consume(id: string, transactionId: string, consumedAt: string): ExecutionAuthorizationBinding {
    const stored = this.#records.get(id); if (!stored) throw new Error(`Authorization binding ${id} does not exist.`);
    const consumed = ExecutionAuthorizationBindingSchema.parse(consumeExecutionAuthorizationBinding(stored, transactionId, consumedAt));
    this.#records.set(id, clone(consumed)); return clone(consumed);
  }
}
type IdempotentEntry =
  | { fingerprint: string; status: "IN_FLIGHT"; promise: Promise<unknown> }
  | { fingerprint: string; status: "RESOLVED"; result: unknown }
  | { fingerprint: string; status: "REJECTED"; error: unknown };
export class InMemoryIdempotencyRepository {
  readonly #entries = new Map<string, Map<string, IdempotentEntry>>();
  execute<T>(scope: string, key: string, fingerprint: string, action: () => T | Promise<T>): Promise<T> {
    const scoped = this.#entries.get(scope); const existing = scoped?.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError(key);
      if (existing.status === "REJECTED") return Promise.reject(existing.error);
      if (existing.status === "RESOLVED") return Promise.resolve(clone(existing.result as T));
      return existing.promise.then((result) => clone(result as T));
    }
    const destination = scoped ?? new Map<string, IdempotentEntry>();
    let resolveAction!: (value: T | PromiseLike<T>) => void; let rejectAction!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => { resolveAction = resolve; rejectAction = reject; });
    destination.set(key, { fingerprint, status: "IN_FLIGHT", promise }); this.#entries.set(scope, destination);
    Promise.resolve().then(action).then((result) => { const saved = clone(result); destination.set(key, { fingerprint, status: "RESOLVED", result: saved }); resolveAction(saved); }, (error: unknown) => { destination.set(key, { fingerprint, status: "REJECTED", error }); rejectAction(error); });
    return promise.then(clone);
  }
}
