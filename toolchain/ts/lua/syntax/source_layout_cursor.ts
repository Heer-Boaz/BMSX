import type { HashLookup } from '../../collections/hash_map';
import { positionInText, type LuaSourceLayoutLeaf, type LuaSourceLayoutRecord } from './source_layout';
import type { LuaSourcePosition } from './ast';

/**
 * Sequential source/unit walk. One seek descends the balanced index; subsequent
 * leaves consume its traversal stack, without random unit-origin lookups.
 */
export class LuaSourceLayoutCursor {
	private readonly pending: number[] = [];
	private leaf: LuaSourceLayoutLeaf | undefined;
	private start = 0;
	private line = 1;
	private column = 1;

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
			const left = records.get(node.left)!;
			const width = left.width;
			if (remaining <= width) { this.pending.push(node.right); id = node.left; }
			else {
				this.start += width;
				this.line += left.breaks;
				this.column = left.breaks === 0 ? this.column + width : left.tail + 1;
				remaining -= width;
				id = node.right;
			}
		}
	}

	public get current(): LuaSourceLayoutLeaf | undefined { return this.leaf; }
	/** Absolute start of the current leaf, which can precede the seek offset. */
	public get offset(): number { return this.start; }

	/** Project within or after this leaf; offsets preceding the cursor require a new seek. */
	public positionAt(offset: number): LuaSourcePosition {
		if (this.leaf !== undefined && offset >= this.start + this.leaf.width) {
			this.advanceSummary(this.leaf);
			this.leaf = undefined;
			while (this.pending.length > 0) {
				let node = this.records.get(this.pending.pop()!)!;
				if (offset >= this.start + node.width) { this.advanceSummary(node); continue; }
				while (node.kind === 'branch') {
					const left = this.records.get(node.left)!;
					if (offset < this.start + left.width) {
						this.pending.push(node.right);
						node = left;
					} else {
						this.advanceSummary(left);
						node = this.records.get(node.right)!;
					}
				}
				this.leaf = node;
				break;
			}
		}
		return this.leaf === undefined ? { line: this.line, column: this.column }
			: positionInText((this.leaf as Extract<LuaSourceLayoutLeaf, { kind: 'text' }>).lineStarts, offset - this.start, this.line, this.column);
	}

	/** Advancing over a subtree uses its aggregate, never visits its leaves. */
	private advanceSummary(node: LuaSourceLayoutRecord): void {
		this.start += node.width;
		this.line += node.breaks;
		this.column = node.breaks === 0 ? this.column + node.width : node.tail + 1;
	}

	public next(): boolean {
		if (this.leaf === undefined) return false;
		this.advanceSummary(this.leaf);
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
