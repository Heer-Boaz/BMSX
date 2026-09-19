import type { HashLookup } from '../../collections/hash_map';
import type { LuaSourceLayoutLeaf, LuaSourceLayoutRecord } from './source_layout';

/**
 * Sequential source/unit walk. One seek descends the balanced index; subsequent
 * leaves consume its traversal stack, without random unit-origin lookups.
 */
export class LuaSourceLayoutCursor {
	private readonly pending: number[] = [];
	private leaf: LuaSourceLayoutLeaf | undefined;
	private start = 0;

	public constructor(private readonly records: HashLookup<number, LuaSourceLayoutRecord>, root: number, offset: number) {
		if (root === 0) return;
		let id = root, remaining = offset;
		for (;;) {
			const node = records.get(id)!;
			if (node.kind !== 'branch') {
				this.leaf = node;
				if (node.kind === 'text' && remaining === node.width) this.next();
				return;
			}
			const width = records.get(node.left)!.width;
			if (remaining <= width) { this.pending.push(node.right); id = node.left; }
			else { this.start += width; remaining -= width; id = node.right; }
		}
	}

	public get current(): LuaSourceLayoutLeaf | undefined { return this.leaf; }
	/** Absolute start of the current leaf, which can precede the seek offset. */
	public get offset(): number { return this.start; }

	public next(): boolean {
		if (this.leaf === undefined) return false;
		this.start += this.leaf.width;
		if (this.pending.length === 0) { this.leaf = undefined; return false; }
		let id = this.pending.pop()!;
		for (;;) {
			const node = this.records.get(id)!;
			if (node.kind !== 'branch') { this.leaf = node; return true; }
			this.pending.push(node.right);
			id = node.left;
		}
	}
}
