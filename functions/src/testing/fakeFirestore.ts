// Tiny in-memory stand-in for the subset of the firebase-admin Firestore API the functions use.
// Test-only: never imported by index.ts, so it is not bundled.
import type { Firestore } from 'firebase-admin/firestore'

type Data = Record<string, unknown>
type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains'

let autoId = 0
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

class Store {
  docs = new Map<string, Data>()
}

class DocSnap {
  constructor(public ref: DocRef, private value: Data | undefined) {}
  get id() { return this.ref.id }
  get exists() { return this.value !== undefined }
  data() { return clone(this.value) }
  get(field: string) { return this.value?.[field] }
}

class QuerySnap {
  constructor(public docs: DocSnap[]) {}
  get empty() { return this.docs.length === 0 }
  get size() { return this.docs.length }
  forEach(fn: (d: DocSnap) => void) { this.docs.forEach(fn) }
}

class DocRef {
  constructor(private store: Store, public path: string) {}
  get id() { return this.path.split('/').pop()! }
  get parent() { return new CollRef(this.store, this.path.split('/').slice(0, -1).join('/')) }
  collection(name: string) { return new CollRef(this.store, `${this.path}/${name}`) }
  async get() { return new DocSnap(this, clone(this.store.docs.get(this.path))) }
  async set(data: Data, opts?: { merge?: boolean }) {
    const prev = opts?.merge ? this.store.docs.get(this.path) ?? {} : {}
    this.store.docs.set(this.path, clone({ ...prev, ...data }))
  }
  async update(data: Data) {
    const prev = this.store.docs.get(this.path)
    if (!prev) throw new Error(`NOT_FOUND: ${this.path}`)
    this.store.docs.set(this.path, clone({ ...prev, ...data }))
  }
  async delete() { this.store.docs.delete(this.path) }
}

class Query {
  constructor(
    protected store: Store,
    public path: string,
    private filters: [string, Op, unknown][] = [],
    private max = Infinity,
  ) {}
  where(field: string, op: Op, value: unknown) {
    return new Query(this.store, this.path, [...this.filters, [field, op, value]], this.max)
  }
  limit(n: number) { return new Query(this.store, this.path, this.filters, n) }
  async get() {
    const depth = this.path.split('/').length + 1
    const out: DocSnap[] = []
    for (const [p, v] of this.store.docs) {
      if (!p.startsWith(`${this.path}/`) || p.split('/').length !== depth) continue
      if (!this.filters.every(([f, op, val]) => match(v[f], op, val))) continue
      out.push(new DocSnap(new DocRef(this.store, p), clone(v)))
      if (out.length >= this.max) break
    }
    return new QuerySnap(out)
  }
}

function match(a: unknown, op: Op, b: unknown): boolean {
  switch (op) {
    case '==': return a === b
    case '!=': return a !== b
    case '<': return (a as number) < (b as number)
    case '<=': return (a as number) <= (b as number)
    case '>': return (a as number) > (b as number)
    case '>=': return (a as number) >= (b as number)
    case 'in': return (b as unknown[]).includes(a)
    case 'array-contains': return Array.isArray(a) && a.includes(b)
  }
}

class CollRef extends Query {
  get id() { return this.path.split('/').pop()! }
  doc(id?: string) { return new DocRef(this.store, `${this.path}/${id ?? `auto${++autoId}`}`) }
  async add(data: Data) {
    const ref = this.doc()
    await ref.set(data)
    return ref
  }
}

class Batch {
  private ops: (() => Promise<void>)[] = []
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) { this.ops.push(() => ref.set(data, opts)); return this }
  update(ref: DocRef, data: Data) { this.ops.push(() => ref.update(data)); return this }
  delete(ref: DocRef) { this.ops.push(() => ref.delete()); return this }
  async commit() { for (const op of this.ops) await op() }
}

export class FakeFirestore {
  store = new Store()
  doc(path: string) { return new DocRef(this.store, path) }
  collection(path: string) { return new CollRef(this.store, path) }
  batch() { return new Batch() }
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const b = new Batch()
    const tx = {
      get: (ref: DocRef) => ref.get(),
      set: (ref: DocRef, d: Data, o?: { merge?: boolean }) => { b.set(ref, d, o); return tx },
      update: (ref: DocRef, d: Data) => { b.update(ref, d); return tx },
      delete: (ref: DocRef) => { b.delete(ref); return tx },
    }
    const out = await fn(tx)
    await b.commit()
    return out
  }

  // Test helpers
  put(path: string, data: object) { this.store.docs.set(path, clone(data as Data)) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read(path: string): Record<string, any> | undefined { return clone(this.store.docs.get(path)) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(collPath: string): (Record<string, any> & { _id: string })[] {
    const depth = collPath.split('/').length + 1
    return [...this.store.docs]
      .filter(([p]) => p.startsWith(`${collPath}/`) && p.split('/').length === depth)
      .map(([p, v]) => ({ ...clone(v), _id: p.split('/').pop()! }))
  }
  get asAdmin(): Firestore { return this as unknown as Firestore }
}
