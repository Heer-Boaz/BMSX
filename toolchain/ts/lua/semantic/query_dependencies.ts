declare const dependencyNodeBrand: unique symbol;
type DependencyNodeID = number & { readonly [dependencyNodeBrand]: true };

/** Snapshot-local dependency graph for mutable fact indices and retained queries. */
export class SemanticQueryDependencies {
	private readonly revisions: number[] = [0];
	private readonly dirty: boolean[] = [false];
	private readonly factInputs: (Set<DependencyNodeID> | undefined)[] = [undefined];
	private readonly users: (DependencyNodeID[] | undefined)[] = [undefined];
	private readonly queryReads: (Map<DependencyNodeID, number> | undefined)[] = [undefined];
	private readonly captures: number[] = [0];
	private readonly lastReaders: DependencyNodeID[] = [0 as DependencyNodeID];
	private readonly lastQueryReadCaptures: number[] = [0];
	private capture = 0;
	private readonly invalidated: (((key: number) => void) | undefined)[] = [undefined];
	private readonly invalidatedKeys: number[] = [0];
	private readonly parents: DependencyNodeID[] = [];
	private readonly pending: DependencyNodeID[] = [];
	private active = 0 as DependencyNodeID;
	private revision = 0;

	public create(invalidated: ((key: number) => void) | undefined, key: number): DependencyNodeID {
		const node = this.revisions.length as DependencyNodeID;
		this.revisions.push(0);
		this.dirty.push(false);
		this.captures.push(0);
		this.factInputs.push(undefined);
		this.users.push(undefined);
		this.queryReads.push(undefined);
		this.lastReaders.push(0 as DependencyNodeID);
		this.lastQueryReadCaptures.push(0);
		this.invalidated.push(invalidated);
		this.invalidatedKeys.push(key);
		return node;
	}

	public get tracking(): boolean {
		return this.active !== 0;
	}

	public getRevision(): number {
		return this.revision;
	}

	public isCurrent(node: DependencyNodeID, revision: number): boolean {
		return this.revisions[node] === revision;
	}

	public read(node: DependencyNodeID): number {
		if (this.active !== 0 && this.lastReaders[node] !== this.active) {
			this.lastReaders[node] = this.active;
			let inputs = this.factInputs[this.active];
			if (!inputs) {
				inputs = new Set();
				this.factInputs[this.active] = inputs;
			}
			if (!inputs.has(node)) {
				inputs.add(node);
				let users = this.users[node];
				if (!users) {
					users = [];
					this.users[node] = users;
				}
				users.push(this.active);
			}
		}
		return this.revisions[node];
	}

	public readQuery(node: DependencyNodeID): void {
		if (this.active !== 0) {
			const capture = this.captures[this.active];
			if (this.lastQueryReadCaptures[node] !== capture) {
				this.lastQueryReadCaptures[node] = capture;
				let reads = this.queryReads[this.active];
				if (!reads) {
					reads = new Map();
					this.queryReads[this.active] = reads;
				}
				if (!reads.has(node)) {
					let users = this.users[node];
					if (!users) {
						users = [];
						this.users[node] = users;
					}
					users.push(this.active);
				}
				reads.set(node, capture);
			}
		}
	}

	public readResult(node: DependencyNodeID, evaluatedRevision: number): void {
		this.readQuery(node);
		// A parent consuming an approximation with pending inputs must also
		// remain unsettled, even if it subscribed after the original write.
		if (this.revisions[node] !== evaluatedRevision) this.invalidateUsers(node, ++this.revision);
	}

	public begin(node: DependencyNodeID): number {
		this.parents.push(this.active);
		this.active = node;
		this.captures[node] = ++this.capture;
		this.dirty[node] = false;
		return this.revisions[node];
	}

	public end(): void {
		this.captures[this.active] = 0;
		this.active = this.parents.pop()!;
	}

	public changed(node: DependencyNodeID | undefined): void {
		const revision = ++this.revision;
		if (node === undefined) return;
		this.revisions[node] = revision;
		this.invalidateUsers(node, revision);
	}

	public published(node: DependencyNodeID): void {
		// Changed output wakes readers, including those that consumed a cyclic
		// approximation while this node was already dirty. It is not a new input
		// to the producing query unless an actual dependency cycle leads back.
		this.invalidateUsers(node, ++this.revision);
	}

	private invalidateUsers(node: DependencyNodeID, revision: number): void {
		const pending = this.pending;
		pending.length = 1;
		pending[0] = node;
		for (let head = 0; head < pending.length; head += 1) {
			const current = pending[head];
			const users = this.users[current];
			if (!users) continue;
			for (let index = 0; index < users.length; index += 1) {
				const user = users[index];
				// A refreshed query result is consumed after evaluation. Its old
				// read must not invalidate a parent before that parent reads it again.
				// Direct fact reads remain conservatively dependent on their rows.
				if (this.captures[user] !== 0) {
					const readCapture = this.queryReads[user]?.get(current);
					if (readCapture !== undefined && readCapture !== this.captures[user]) continue;
				}
				if (this.dirty[user]) continue;
				this.dirty[user] = true;
				this.revisions[user] = revision;
				// An eager query schedules work; evaluation never runs in publication.
				this.invalidated[user]?.(this.invalidatedKeys[user]);
				pending.push(user);
			}
		}
	}
}

/** An index row has a dependency identity even when it currently has no facts. */
export class SemanticDependencyIndex {
	private readonly nodes = new Map<number, DependencyNodeID>();

	constructor(
		private readonly dependencies: SemanticQueryDependencies,
		private readonly invalidated?: (key: number) => void,
	) {}

	public node(key: number): DependencyNodeID {
		let node = this.nodes.get(key);
		if (node === undefined) {
			node = this.dependencies.create(this.invalidated, key);
			this.nodes.set(key, node);
		}
		return node;
	}

	public read(key: number): void {
		if (this.dependencies.tracking) this.dependencies.read(this.node(key));
	}

	public changed(key: number): void {
		this.dependencies.changed(this.nodes.get(key));
	}
}

/** Query evaluation state; values and cycle semantics stay with the query owner. */
type QueryEvaluation = {
	readonly node: DependencyNodeID;
	evaluatedRevision: number;
	startedRevision: number;
	computing: boolean;
};

export class SemanticQueryEvaluation {
	private readonly entries = new Map<number, QueryEvaluation>();
	private evaluations = 0;

	constructor(
		private readonly dependencies: SemanticQueryDependencies,
		private readonly invalidated?: (key: number) => void,
	) {}

	public isCurrent(key: number): boolean {
		const entry = this.entry(key);
		const current = this.dependencies.isCurrent(entry.node, entry.evaluatedRevision);
		if (current || entry.computing) this.dependencies.readQuery(entry.node);
		return current;
	}

	public isComputing(key: number): boolean {
		return this.entry(key).computing;
	}

	public begin(key: number): void {
		const entry = this.entry(key);
		entry.computing = true;
		entry.startedRevision = this.dependencies.begin(entry.node);
		this.evaluations += 1;
	}

	public end(key: number, changed = false): void {
		this.dependencies.end();
		const entry = this.entry(key);
		entry.computing = false;
		entry.evaluatedRevision = entry.startedRevision;
		if (changed) this.dependencies.published(entry.node);
		this.dependencies.readResult(entry.node, entry.evaluatedRevision);
	}

	public get count(): number {
		return this.evaluations;
	}

	private entry(key: number): QueryEvaluation {
		let entry = this.entries.get(key);
		if (!entry) {
			entry = { node: this.dependencies.create(this.invalidated, key), evaluatedRevision: -1, startedRevision: 0, computing: false };
			this.entries.set(key, entry);
		}
		return entry;
	}
}

/** Retained approximations for cyclic array-valued queries, with reusable evaluation buffers. */
export class SemanticQueryResults<T> extends SemanticQueryEvaluation {
	private readonly results = new Map<number, T[]>();
	private readonly buffers: T[][] = [];

	public values(key: number): readonly T[] {
		let values = this.results.get(key);
		if (!values) {
			values = [];
			this.results.set(key, values);
		}
		return values;
	}

	public buffer(depth: number): T[] {
		let buffer = this.buffers[depth];
		if (!buffer) {
			buffer = [];
			this.buffers[depth] = buffer;
		}
		buffer.length = 0;
		return buffer;
	}

	public publish(key: number, values: readonly T[]): readonly T[] {
		let retained = this.results.get(key);
		if (!retained) {
			retained = [];
			this.results.set(key, retained);
		}
		this.end(key, updateQueryResult(retained, values));
		return retained;
	}
}

/** Replace a complete approximation; the owner publishes all changed columns together. */
export function updateQueryResult<T>(retained: T[], values: readonly T[]): boolean {
	let changed = retained.length !== values.length;
	for (let index = 0; index < values.length; index += 1) {
		if (retained[index] !== values[index]) changed = true;
		retained[index] = values[index];
	}
	retained.length = values.length;
	return changed;
}
