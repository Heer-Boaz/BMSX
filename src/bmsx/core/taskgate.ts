export type GateCategory = string;

export interface GateScope {
	blocking?: boolean;      // counts toward ready()
	category?: GateCategory; // 'texture' | 'audio' | 'model' | ...
	tag?: string;            // debug label
}

// internal owner branding to prevent cross-group misuse
type TaskGateToken = Readonly<{
	gen: number;
	id: number;
	blocking: boolean;
	category: GateCategory;
	tag?: string;
	_group: string; // owning group name
}>;

type Bucket = {
	gen: number;
	nextId: number;
	blockingPending: number;
	countsByCat: Map<GateCategory, number>; // all tokens, blocking or not
	live: Map<number, TaskGateToken>;
};

export class TaskGate {
	private buckets = new Map<string, Bucket>();
	private groups = new Map<string, GateGroup>(); // cache to avoid per-call allocs

	/** Create or fetch a group (bucket/handle). */
	group(name: string): GateGroup {
		let g = this.groups.get(name);
		if (g) return g;
		if (!this.buckets.has(name)) {
			this.buckets.set(name, {
				gen: 0, nextId: 1, blockingPending: 0,
				countsByCat: new Map(), live: new Map()
			});
		}
		g = new GateGroup(name, this);
		this.groups.set(name, g);
		return g;
	}

	/** Global snapshot across all groups. */
	snapshotAll() {
		const out: Record<string, ReturnType<GateGroup["snapshot"]>> = {};
		for (const name of this.buckets.keys()) out[name] = this.group(name).snapshot();
		return out;
	}

	// --- internal for GateGroup ---
	_bucket(name: string): Bucket {
		const b = this.buckets.get(name);
		if (!b) throw new Error(`TaskGate bucket "${name}" not found`);
		return b;
	}
}

export class GateGroup {
	constructor(private name: string, private gate: TaskGate) { }

	/** Reset this group; invalidate late resolves. */
	bump(): number {
		const b = this.gate._bucket(this.name);
		b.gen++;
		b.blockingPending = 0;
		b.countsByCat.clear();
		b.live.clear();
		return b.gen;
	}

	/** Start scope in this group. */
	begin(scope: GateScope = {}): TaskGateToken {
		const b = this.gate._bucket(this.name);
		const t: TaskGateToken = Object.freeze({
			gen: b.gen,
			id: b.nextId++,
			blocking: !!scope.blocking,
			category: scope.category ?? "other",
			tag: scope.tag,
			_group: this.name,
		});
		b.live.set(t.id, t);
		b.countsByCat.set(t.category, (b.countsByCat.get(t.category) ?? 0) + 1);
		if (t.blocking) b.blockingPending++;
		return t;
	}

	/** End of scope. Late/other gen or wrong group → ignored. */
	end(token: TaskGateToken): void {
		if (!token) {
			throw new Error(`[GateGroup:${this.name}] end() called without token.`);
		}
		if (token._group !== this.name) {
			throw new Error(`[GateGroup:${this.name}] end() with foreign token id=${token.id} from "${token._group}".`);
		}

		const b = this.gate._bucket(this.name);
		if (token.gen !== b.gen) return; // late/other gen

		if (!b.live.delete(token.id)) {
			throw new Error(`[GateGroup:${this.name}] end() on unknown token id=${token.id}.`);
		}

		const n = (b.countsByCat.get(token.category) ?? 1) - 1;
		if (n > 0) b.countsByCat.set(token.category, n); else b.countsByCat.delete(token.category);

		if (token.blocking) {
			if (b.blockingPending <= 0) {
				throw new Error(`[GateGroup:${this.name}] blockingPending underflow on token id=${token.id}.`);
			}
			b.blockingPending--;
		}
	}

	/** End all live scopes matching a category. */
	endCategory(category: GateCategory): void {
		const b = this.gate._bucket(this.name);
		for (const token of b.live.values()) {
			if (token.category === category) this.end(token);
		}
	}

	/** Convenience: end everything in this group. */
	endAll(): void {
		const b = this.gate._bucket(this.name);
		for (const token of b.live.values()) this.end(token);
	}

	/** Is this group ready with respect to blocking scopes? */
	get ready(): boolean { return this.gate._bucket(this.name).blockingPending === 0; }

	get liveCount(): number { return this.gate._bucket(this.name).live.size; }

	/** Is this group free of scopes for a category (blocking or not)? */
	readyFor(category: GateCategory): boolean {
		const b = this.gate._bucket(this.name);
		return (b.countsByCat.get(category) ?? 0) === 0;
	}

	/** Is this group free of *blocking* scopes for a category? */
	readyForBlocking(category: GateCategory): boolean {
		const b = this.gate._bucket(this.name);
		for (const t of b.live.values()) if (t.category === category && t.blocking) return false;
		return true;
	}

	/** Telemetry. */
	snapshot() {
		const b = this.gate._bucket(this.name);
		// compute blocking-by-category on demand
		const blockingByCat = new Map<GateCategory, number>();
		for (const t of b.live.values()) if (t.blocking)
			blockingByCat.set(t.category, (blockingByCat.get(t.category) ?? 0) + 1);
		const live: Array<{ id: number; cat: GateCategory; blocking: boolean; tag?: string }> = [];
		for (const value of b.live.values()) {
			live.push({ id: value.id, cat: value.category, blocking: value.blocking, tag: value.tag });
		}

		return {
			gen: b.gen,
			ready: b.blockingPending === 0,
			blockingPending: b.blockingPending,
			countsByCat: Object.fromEntries(b.countsByCat.entries()),
			blockingByCat: Object.fromEntries(blockingByCat.entries()),
			live,
		};
	}

	/** Track a Promise as scope (auto begin/end). */
	track<T>(p: Promise<T>, scope: GateScope = {}): Promise<T> {
		const token = this.begin(scope);
		return p.finally(() => this.end(token));
	}

	/** Track a function that returns a Promise. */
	trackFn<T>(fn: () => Promise<T>, scope: GateScope = {}): Promise<T> {
		const token = this.begin(scope);
		try {
			const p = fn();
			return p.finally(() => this.end(token));
		} catch (e) {
			this.end(token);
			throw e;
		}
	}
}

// One global gate; create groups per subsystem/operation.
export const taskGate = new TaskGate();
export const runGate: GateGroup = taskGate.group('run:main');
export const renderGate: GateGroup = taskGate.group('render:main');
