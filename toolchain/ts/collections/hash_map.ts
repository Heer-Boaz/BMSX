/** A lookup contract, deliberately independent of Map insertion order. */
export interface HashLookup<K, V> {
	get(key: K): V | undefined;
}

// Bitmap HAMT, five hash bits per level. As in Immutable.js Map, builder
// ownership permits batch mutation only on nodes created since publication.
// No snapshot chains: each published root directly shares unchanged subtrees.
type Leaf<K, V> = {
	kind: 'leaf';
	owner: symbol;
	hash: number;
	key: K;
	value: V;
};
type Collision<K, V> = {
	kind: 'collision';
	owner: symbol;
	hash: number;
	entries: Leaf<K, V>[];
};
type Branch<K, V> = {
	kind: 'branch';
	owner: symbol;
	bitmap: number;
	children: Node<K, V>[];
};
type Node<K, V> = Leaf<K, V> | Collision<K, V> | Branch<K, V>;
type EditState = { owner: symbol; size: number };

export class HashMapSnapshot<K, V> implements HashLookup<K, V> {
	public constructor(
		private readonly hashKey: (key: K) => number,
		private readonly root: Node<K, V> | undefined,
		public readonly size: number,
	) {}

	public edit(): HashMapBuilder<K, V> {
		return new HashMapBuilder(this.hashKey, this.root, this.size);
	}

	public get(key: K): V | undefined {
		return lookup(this.root, this.hashKey(key), key);
	}
}

/** Mutable publication owner. Snapshot creation is O(1), not a map copy. */
export class HashMapBuilder<K, V> implements HashLookup<K, V> {
	private readonly state: EditState;

	/** hashKey produces a 32-bit unsigned hash; key equality remains strict identity. */
	public constructor(
		private readonly hashKey: (key: K) => number,
		private root: Node<K, V> | undefined = undefined,
		size = 0,
	) {
		this.state = { owner: Symbol(), size };
	}

	public get size(): number { return this.state.size; }

	public get(key: K): V | undefined {
		return lookup(this.root, this.hashKey(key), key);
	}

	public set(key: K, value: V): void {
		this.root = insert(this.root, 0, this.hashKey(key), key, value, this.state);
	}

	public delete(key: K): void {
		this.root = remove(this.root, 0, this.hashKey(key), key, this.state);
	}

	public snapshot(): HashMapSnapshot<K, V> {
		const snapshot = new HashMapSnapshot(this.hashKey, this.root, this.state.size);
		this.state.owner = Symbol();
		return snapshot;
	}
}

function lookup<K, V>(root: Node<K, V> | undefined, hash: number, key: K): V | undefined {
	let node = root;
	let shift = 0;
	while (node !== undefined) {
		if (node.kind === 'leaf') return node.key === key ? node.value : undefined;
		if (node.kind === 'collision') {
			for (const entry of node.entries) if (entry.key === key) return entry.value;
			return undefined;
		}
		const bit = 1 << ((hash >>> shift) & 31);
		if ((node.bitmap & bit) === 0) return undefined;
		node = node.children[populationCount(node.bitmap & (bit - 1))];
		shift += 5;
	}
	return undefined;
}

function insert<K, V>(node: Node<K, V> | undefined, shift: number, hash: number, key: K, value: V, state: EditState): Node<K, V> {
	const owner = state.owner;
	if (node === undefined) {
		state.size++;
		return { kind: 'leaf', owner, hash, key, value };
	}
	if (node.kind !== 'branch') {
		if (node.hash !== hash) {
			state.size++;
			return join(node, { kind: 'leaf', owner, hash, key, value }, shift, owner);
		}
		if (node.kind === 'leaf') {
			if (node.key !== key) {
				state.size++;
				return { kind: 'collision', owner, hash, entries: [node, { kind: 'leaf', owner, hash, key, value }] };
			}
			if (node.value === value) return node;
			if (node.owner === owner) {
				node.value = value;
				return node;
			}
			return { kind: 'leaf', owner, hash, key, value };
		}
		const index = node.entries.findIndex(entry => entry.key === key);
		if (index >= 0 && node.entries[index].value === value) return node;
		const entries = node.owner === owner ? node.entries : node.entries.slice();
		const entry: Leaf<K, V> = { kind: 'leaf', owner, hash, key, value };
		if (index < 0) { entries.push(entry); state.size++; }
		else entries[index] = entry;
		return node.owner === owner ? node : { kind: 'collision', owner, hash, entries };
	}
	const bit = 1 << ((hash >>> shift) & 31);
	const index = populationCount(node.bitmap & (bit - 1));
	const present = (node.bitmap & bit) !== 0;
	const old = present ? node.children[index] : undefined;
	const child = insert(old, shift + 5, hash, key, value, state);
	if (old === child) return node;
	const children = node.owner === owner ? node.children : node.children.slice();
	if (present) children[index] = child;
	else children.splice(index, 0, child);
	if (node.owner === owner) {
		node.bitmap |= bit;
		return node;
	}
	return { kind: 'branch', owner, bitmap: node.bitmap | bit, children };
}

/** Different complete hashes must diverge within their seven five-bit groups. */
function join<K, V>(left: Leaf<K, V> | Collision<K, V>, right: Leaf<K, V>, shift: number, owner: symbol): Branch<K, V> {
	const leftSlot = (left.hash >>> shift) & 31;
	const rightSlot = (right.hash >>> shift) & 31;
	if (leftSlot === rightSlot) {
		return { kind: 'branch', owner, bitmap: 1 << leftSlot, children: [join(left, right, shift + 5, owner)] };
	}
	return { kind: 'branch', owner, bitmap: (1 << leftSlot) | (1 << rightSlot), children: leftSlot < rightSlot ? [left, right] : [right, left] };
}

function remove<K, V>(node: Node<K, V> | undefined, shift: number, hash: number, key: K, state: EditState): Node<K, V> | undefined {
	const owner = state.owner;
	if (node === undefined) return undefined;
	if (node.kind === 'leaf') {
		if (node.key !== key) return node;
		state.size--;
		return undefined;
	}
	if (node.kind === 'collision') {
		const index = node.entries.findIndex(entry => entry.key === key);
		if (index < 0) return node;
		state.size--;
		if (node.entries.length === 2) return node.entries[index ^ 1];
		const entries = node.owner === owner ? node.entries : node.entries.slice();
		entries.splice(index, 1);
		return node.owner === owner ? node : { kind: 'collision', owner, hash: node.hash, entries };
	}
	const bit = 1 << ((hash >>> shift) & 31);
	if ((node.bitmap & bit) === 0) return node;
	const index = populationCount(node.bitmap & (bit - 1));
	const old = node.children[index];
	const child = remove(old, shift + 5, hash, key, state);
	if (child === old) return node;
	if (child === undefined && node.children.length === 1) return undefined;
	// A leaf/collision has no level-dependent routing. Branches cannot be
	// lifted across hash groups even when they have only one child.
	if (child === undefined && node.children.length === 2 && node.children[index ^ 1].kind !== 'branch') {
		return node.children[index ^ 1];
	}
	const children = node.owner === owner ? node.children : node.children.slice();
	if (child === undefined) children.splice(index, 1);
	else children[index] = child;
	const bitmap = child === undefined ? node.bitmap ^ bit : node.bitmap;
	if (node.owner === owner) {
		node.bitmap = bitmap;
		return node;
	}
	return { kind: 'branch', owner, bitmap, children };
}

function populationCount(bits: number): number {
	bits -= (bits >>> 1) & 0x55555555;
	bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
	return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
