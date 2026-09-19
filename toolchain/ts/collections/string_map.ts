import { hashText } from '../../../machine/ts/common/byte_hex_string';

/** A lookup contract, deliberately independent of Map insertion order. */
export interface StringLookup<V> {
	get(key: string): V | undefined;
}

// Bitmap HAMT, five hash bits per level. As in Immutable.js Map, builder
// ownership permits batch mutation only on nodes created since publication.
// No snapshot chains: each published root directly shares unchanged subtrees.
type Leaf<V> = {
	kind: 'leaf';
	owner: symbol;
	hash: number;
	key: string;
	value: V;
};
type Collision<V> = {
	kind: 'collision';
	owner: symbol;
	hash: number;
	entries: Leaf<V>[];
};
type Branch<V> = {
	kind: 'branch';
	owner: symbol;
	bitmap: number;
	children: Node<V>[];
};
type Node<V> = Leaf<V> | Collision<V> | Branch<V>;

export class StringMapSnapshot<V> implements StringLookup<V> {
	public constructor(private readonly root: Node<V> | undefined) {}

	public get(key: string): V | undefined {
		return lookup(this.root, key);
	}
}

/** Mutable publication owner. Snapshot creation is O(1), not a map copy. */
export class StringMapBuilder<V> implements StringLookup<V> {
	private root: Node<V> | undefined;
	private owner = Symbol();

	public get(key: string): V | undefined {
		return lookup(this.root, key);
	}

	public set(key: string, value: V): void {
		this.root = insert(this.root, 0, hashText(key), key, value, this.owner);
	}

	public delete(key: string): void {
		this.root = remove(this.root, 0, hashText(key), key, this.owner);
	}

	public snapshot(): StringMapSnapshot<V> {
		const snapshot = new StringMapSnapshot(this.root);
		this.owner = Symbol();
		return snapshot;
	}
}

function lookup<V>(root: Node<V> | undefined, key: string): V | undefined {
	const hash = hashText(key);
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

function insert<V>(node: Node<V> | undefined, shift: number, hash: number, key: string, value: V, owner: symbol): Node<V> {
	if (node === undefined) return { kind: 'leaf', owner, hash, key, value };
	if (node.kind !== 'branch') {
		if (node.hash !== hash) {
			return join(node, { kind: 'leaf', owner, hash, key, value }, shift, owner);
		}
		if (node.kind === 'leaf') {
			if (node.key !== key) return { kind: 'collision', owner, hash, entries: [node, { kind: 'leaf', owner, hash, key, value }] };
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
		const entry: Leaf<V> = { kind: 'leaf', owner, hash, key, value };
		if (index < 0) entries.push(entry);
		else entries[index] = entry;
		return node.owner === owner ? node : { kind: 'collision', owner, hash, entries };
	}
	const bit = 1 << ((hash >>> shift) & 31);
	const index = populationCount(node.bitmap & (bit - 1));
	const present = (node.bitmap & bit) !== 0;
	const old = present ? node.children[index] : undefined;
	const child = insert(old, shift + 5, hash, key, value, owner);
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
function join<V>(left: Leaf<V> | Collision<V>, right: Leaf<V>, shift: number, owner: symbol): Branch<V> {
	const leftSlot = (left.hash >>> shift) & 31;
	const rightSlot = (right.hash >>> shift) & 31;
	if (leftSlot === rightSlot) {
		return { kind: 'branch', owner, bitmap: 1 << leftSlot, children: [join(left, right, shift + 5, owner)] };
	}
	return { kind: 'branch', owner, bitmap: (1 << leftSlot) | (1 << rightSlot), children: leftSlot < rightSlot ? [left, right] : [right, left] };
}

function remove<V>(node: Node<V> | undefined, shift: number, hash: number, key: string, owner: symbol): Node<V> | undefined {
	if (node === undefined) return undefined;
	if (node.kind === 'leaf') return node.key === key ? undefined : node;
	if (node.kind === 'collision') {
		const index = node.entries.findIndex(entry => entry.key === key);
		if (index < 0) return node;
		if (node.entries.length === 2) return node.entries[index ^ 1];
		const entries = node.owner === owner ? node.entries : node.entries.slice();
		entries.splice(index, 1);
		return node.owner === owner ? node : { kind: 'collision', owner, hash: node.hash, entries };
	}
	const bit = 1 << ((hash >>> shift) & 31);
	if ((node.bitmap & bit) === 0) return node;
	const index = populationCount(node.bitmap & (bit - 1));
	const old = node.children[index];
	const child = remove(old, shift + 5, hash, key, owner);
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
