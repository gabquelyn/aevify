/**
 * TEST ONLY. Minimal in-memory stand-in for the MongoDB driver, covering exactly the operations the
 * Aevify API uses (findOne, find/sort/limit/toArray, insertOne, updateOne, countDocuments,
 * createIndex with unique + partial filters). Lets route tests run without a database.
 */

type Doc = Record<string, unknown>;
type Filter = Record<string, unknown>;

const clone = <T>(value: T): T => structuredClone(value);

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number);
  const bv = b instanceof Date ? b.getTime() : (b as number);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function equals(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (b === null) return a === null || a === undefined; // Mongo: { x: null } matches missing
  return a === b;
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && Object.keys(cond).some((k) => k.startsWith("$"))) {
      return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
        switch (op) {
          case "$lt":
            return value !== undefined && compare(value, arg) < 0;
          case "$gt":
            return value !== undefined && compare(value, arg) > 0;
          case "$ne":
            return !equals(value, arg);
          case "$in":
            return (arg as unknown[]).some((x) => equals(value, x));
          case "$type":
            return arg === "string" ? typeof value === "string" : true;
          default:
            throw new Error(`FakeDb: unsupported operator ${op}`);
        }
      });
    }
    return equals(value, cond);
  });
}

type UniqueIndex = { keys: string[]; partial?: Filter };

class FakeCursor {
  constructor(private docs: Doc[]) {}
  sort(spec: Record<string, 1 | -1>) {
    const [[key, dir]] = Object.entries(spec) as [[string, 1 | -1]];
    this.docs.sort((a, b) => compare(a[key], b[key]) * dir);
    return this;
  }
  limit(n: number) {
    this.docs = this.docs.slice(0, n);
    return this;
  }
  async toArray() {
    return this.docs.map(clone);
  }
}

export class FakeCollection {
  docs: Doc[] = [];
  private unique: UniqueIndex[] = [{ keys: ["_id"] }];

  async createIndex(spec: Record<string, number>, options?: { unique?: boolean; partialFilterExpression?: Filter }) {
    if (options?.unique) this.unique.push({ keys: Object.keys(spec), partial: options.partialFilterExpression });
    return "index";
  }

  private violatesUnique(doc: Doc, ignore?: Doc) {
    return this.unique.some(({ keys, partial }) => {
      if (partial && !matches(doc, partial)) return false;
      return this.docs.some(
        (other) => other !== ignore && (!partial || matches(other, partial)) && keys.every((k) => equals(other[k], doc[k] ?? null)),
      );
    });
  }

  async insertOne(doc: Doc) {
    if (this.violatesUnique(doc)) throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    this.docs.push(clone(doc));
    return { acknowledged: true, insertedId: doc._id };
  }

  async findOne(filter: Filter) {
    const found = this.docs.find((d) => matches(d, filter));
    return found ? clone(found) : null;
  }

  find(filter: Filter = {}) {
    return new FakeCursor(this.docs.filter((d) => matches(d, filter)));
  }

  async countDocuments(filter: Filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  async updateOne(filter: Filter, update: { $set?: Doc }) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const next = { ...doc, ...clone(update.$set ?? {}) };
    if (this.violatesUnique(next, doc)) throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    Object.assign(doc, next);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

export class MemoryDb {
  databaseName = "aevify-test";
  private collections = new Map<string, FakeCollection>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name)!;
  }
  async command() {
    return { ok: 1 };
  }
  reset() {
    this.collections.clear();
  }
}
