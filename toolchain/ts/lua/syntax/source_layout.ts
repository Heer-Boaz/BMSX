import { HashMapBuilder, type HashMapSnapshot } from '../../collections/hash_map';
import type { LuaSourcePosition } from './ast';
import { LuaSourceLayoutCursor } from './source_layout_cursor';

/** Occurrence identity, not a position or a hash of the occurrence's text. */
export type LuaSourceUnit = number & { readonly sourceUnit: unique symbol };
export type LuaSourceUnitPlacement = { readonly unit: LuaSourceUnit; readonly offset: number };

// Identities are allocated once, including across branches from an old snapshot.
// The counter retains no source, tree or snapshot.
let nextLayoutId = 1;
export function createLuaSourceUnit(): LuaSourceUnit {
	return nextLayoutId++ as LuaSourceUnit;
}

const TEXT_CHUNK_LENGTH = 1024;
const hashLayoutId = (id: number): number => id >>> 0;

type Summary = {
	readonly parent: number;
	readonly width: number;
	readonly breaks: number;
	readonly tail: number;
	readonly height: number;
};
type Text = Summary & { readonly kind: 'text'; readonly text: string; readonly lineStarts: readonly number[] };
type Unit = Summary & { readonly kind: 'unit'; readonly unit: LuaSourceUnit };
type Branch = Summary & { readonly kind: 'branch'; readonly left: number; readonly right: number };
export type LuaSourceLayoutLeaf = Text | Unit;
export type LuaSourceLayoutRecord = Text | Unit | Branch;
type Record = LuaSourceLayoutRecord;

/**
 * Source-order location index, not an AST. Its inverse index retains parent
 * edges per snapshot, so moving a subtree changes its root edge, not every
 * descendant origin. Text leaves include trivia and unparsed/error suffixes.
 */
export class LuaSourceLayout {
	public constructor(
		private readonly records: HashMapSnapshot<number, Record>,
		private readonly root: number,
	) {}

	/** Units must be in source order; coincident units remain distinct. */
	public static create(source: string, units: readonly LuaSourceUnitPlacement[] = []): LuaSourceLayout {
		return LuaSourceLayoutBuilder.create(source, units).snapshot();
	}

	public edit(): LuaSourceLayoutBuilder {
		return new LuaSourceLayoutBuilder(this.records.edit(), this.root);
	}

	public get length(): number { return this.root === 0 ? 0 : this.records.get(this.root)!.width; }
	public get recordCount(): number { return this.records.size; }
	public get height(): number { return this.root === 0 ? 0 : this.records.get(this.root)!.height; }

	public hasUnit(unit: LuaSourceUnit): boolean { return this.records.get(unit) !== undefined; }

	/** Random occurrence lookup: tree depth times the bounded hash-trie depth. */
	public unitOffset(unit: LuaSourceUnit): number {
		let child: number = unit;
		let record = this.records.get(child)!;
		let offset = 0;
		while (record.parent !== 0) {
			const parent = this.records.get(record.parent)! as Branch;
			if (parent.right === child) offset += this.records.get(parent.left)!.width;
			child = record.parent;
			record = parent;
		}
		return offset;
	}

	/** UTF-16 positions use the lexer convention: only LF starts a new line. */
	public positionAt(offset: number): LuaSourcePosition {
		let id = this.root;
		let line = 1, column = 1;
		while (id !== 0) {
			const node = this.records.get(id)!;
			if (node.kind === 'unit') break;
			if (node.kind === 'text') return positionInText(node.lineStarts, offset, line, column);
			const left = this.records.get(node.left)!;
			if (offset < left.width) id = node.left;
			else {
				offset -= left.width;
				line += left.breaks;
				column = left.breaks === 0 ? column + left.width : left.tail + 1;
				id = node.right;
			}
		}
		return { line, column };
	}

	public offsetAt(position: LuaSourcePosition): number {
		let breaks = position.line - 1;
		if (breaks === 0) return position.column - 1;
		let offset = 0, id = this.root;
		for (;;) {
			const node = this.records.get(id)!;
			if (node.kind === 'text') return offset + node.lineStarts[breaks - 1] + position.column - 1;
			const branch = node as Branch;
			const left = this.records.get(branch.left)!;
			if (breaks <= left.breaks) id = branch.left;
			else { offset += left.width; breaks -= left.breaks; id = branch.right; }
		}
	}

	public cursor(offset = 0): LuaSourceLayoutCursor {
		return new LuaSourceLayoutCursor(this.records, this.root, offset);
	}

	public read(offset: number, length: number): string {
		const pieces: string[] = [];
		readText(this.records, this.root, offset, length, pieces);
		return pieces.join('');
	}
}

/** One mutable editing frontier; publishing or forking never mutates an old layout. */
export class LuaSourceLayoutBuilder {
	private readonly textUnits: number[] = [];

	public constructor(private readonly records: HashMapBuilder<number, Record>, private root: number) {}

	public static create(source: string, units: readonly LuaSourceUnitPlacement[]): LuaSourceLayoutBuilder {
		const builder = new LuaSourceLayoutBuilder(new HashMapBuilder(hashLayoutId), 0);
		builder.initialize(source, units);
		return builder;
	}

	private initialize(source: string, units: readonly LuaSourceUnitPlacement[]): void {
		const leaves: number[] = [];
		let offset = 0;
		for (const placement of units) {
			this.appendText(source, offset, placement.offset, leaves);
			this.records.set(placement.unit, { kind: 'unit', unit: placement.unit, parent: 0, width: 0, breaks: 0, tail: 0, height: 1 });
			leaves.push(placement.unit);
			offset = placement.offset;
		}
		this.appendText(source, offset, source.length, leaves);
		this.root = this.build(leaves, 0, leaves.length);
	}

	public snapshot(): LuaSourceLayout {
		this.setParent(this.root, 0);
		return new LuaSourceLayout(this.records.snapshot(), this.root);
	}

	/** Inserted text precedes markers at its offset. Deleted text owns its start markers, not its end markers. */
	public replace(offset: number, deletedLength: number, text: string): void {
		if (deletedLength === 0 && text.length === 0) return;
		const [left, suffix] = this.split(this.root, offset, true);
		const [removed, right] = this.split(suffix, deletedLength, true);
		this.discard(removed);
		const leaves: number[] = [];
		this.appendText(text, 0, text.length, leaves);
		this.root = this.joinText(this.joinText(left, this.build(leaves, 0, leaves.length)), right);
		this.setParent(this.root, 0);
	}

	public insertUnit(offset: number, unit = createLuaSourceUnit()): LuaSourceUnit {
		const [left, right] = this.split(this.root, offset, false);
		this.records.set(unit, { kind: 'unit', unit, parent: 0, width: 0, breaks: 0, tail: 0, height: 1 });
		this.root = this.join(this.join(left, unit), right);
		this.setParent(this.root, 0);
		return unit;
	}

	/** Retiring a reparsed parent does not retire retained nested occurrences. */
	public removeUnit(unit: LuaSourceUnit): void {
		let child: number = unit;
		let parent = this.records.get(unit)!.parent;
		this.records.delete(unit);
		let left = 0, right = 0;
		while (parent !== 0) {
			const node = this.records.get(parent)! as Branch;
			this.records.delete(parent);
			if (node.left === child) right = this.join(right, node.right);
			else left = this.join(node.left, left);
			child = parent;
			parent = node.parent;
		}
		this.root = this.joinText(left, right);
		this.setParent(this.root, 0);
	}

	private appendText(source: string, start: number, end: number, leaves: number[]): void {
		for (let offset = start; offset < end; offset += TEXT_CHUNK_LENGTH) {
			leaves.push(this.textLeaf(source, offset, Math.min(offset + TEXT_CHUNK_LENGTH, end)));
		}
	}

	private textLeaf(source: string, start = 0, end = source.length): number {
		const lineStarts: number[] = [];
		const units = this.textUnits;
		units.length = end - start;
		for (let index = start; index < end; index++) {
			const code = source.charCodeAt(index);
			units[index - start] = code;
			if (code === 10) lineStarts.push(index - start + 1);
		}
		// A substring may retain its entire original backing string. Construct
		// owned, bounded UTF-16 chunks; preserve even unpaired surrogate units.
		const text = String.fromCharCode(...units);
		const id = nextLayoutId++;
		this.records.set(id, { kind: 'text', parent: 0, width: text.length, breaks: lineStarts.length,
			tail: lineStarts.length === 0 ? text.length : text.length - lineStarts[lineStarts.length - 1],
			height: 1, text, lineStarts });
		return id;
	}

	/** Bulk construction visits each source leaf/branch once, with one parent assignment per edge. */
	private build(leaves: readonly number[], start: number, end: number): number {
		if (start === end) return 0;
		if (end - start === 1) return leaves[start];
		const middle = (start + end) >>> 1;
		return this.branch(this.build(leaves, start, middle), this.build(leaves, middle, end));
	}

	private setParent(id: number, parent: number): void {
		if (id === 0) return;
		const node = this.records.get(id)!;
		if (node.parent !== parent) this.records.set(id, { ...node, parent });
	}

	private branch(leftId: number, rightId: number): number {
		const left = this.records.get(leftId)!, right = this.records.get(rightId)!;
		const id = nextLayoutId++;
		this.records.set(id, { kind: 'branch', parent: 0, left: leftId, right: rightId,
			width: left.width + right.width, breaks: left.breaks + right.breaks,
			tail: right.breaks === 0 ? left.tail + right.width : right.tail,
			height: Math.max(left.height, right.height) + 1 });
		this.setParent(leftId, id);
		this.setParent(rightId, id);
		return id;
	}

	/** Coalesce at an edit boundary, not at every recursive balance operation. */
	private joinText(leftId: number, rightId: number): number {
		if (leftId === 0) return rightId;
		if (rightId === 0) return leftId;
		let left = this.records.get(leftId)!, right = this.records.get(rightId)!;
		while (left.kind === 'branch') left = this.records.get(left.right)!;
		while (right.kind === 'branch') right = this.records.get(right.left)!;
		if (left.kind !== 'text' || right.kind !== 'text' || left.width + right.width > TEXT_CHUNK_LENGTH) {
			return this.join(leftId, rightId);
		}
		const leftRest = this.removeBoundaryText(leftId, false);
		const rightRest = this.removeBoundaryText(rightId, true);
		return this.join(this.join(leftRest, this.textLeaf(left.text + right.text)), rightRest);
	}

	private removeBoundaryText(id: number, first: boolean): number {
		const node = this.records.get(id)!;
		this.records.delete(id);
		if (node.kind !== 'branch') return 0;
		return first
			? this.join(this.removeBoundaryText(node.left, first), node.right)
			: this.join(node.left, this.removeBoundaryText(node.right, first));
	}

	private join(leftId: number, rightId: number): number {
		if (leftId === 0) return rightId;
		if (rightId === 0) return leftId;
		const left = this.records.get(leftId)!, right = this.records.get(rightId)!;
		if (left.height > right.height + 1) {
			const branch = left as Branch;
			this.records.delete(leftId);
			return this.balance(branch.left, this.join(branch.right, rightId));
		}
		if (right.height > left.height + 1) {
			const branch = right as Branch;
			this.records.delete(rightId);
			return this.balance(this.join(leftId, branch.left), branch.right);
		}
		return this.branch(leftId, rightId);
	}

	private balance(leftId: number, rightId: number): number {
		const left = this.records.get(leftId)!, right = this.records.get(rightId)!;
		if (left.height > right.height + 1) {
			const branch = left as Branch;
			const inner = this.records.get(branch.right)!;
			this.records.delete(leftId);
			if (this.records.get(branch.left)!.height >= inner.height) {
				return this.branch(branch.left, this.branch(branch.right, rightId));
			}
			const pivot = inner as Branch;
			this.records.delete(branch.right);
			return this.branch(this.branch(branch.left, pivot.left), this.branch(pivot.right, rightId));
		}
		if (right.height > left.height + 1) {
			const branch = right as Branch;
			const inner = this.records.get(branch.left)!;
			this.records.delete(rightId);
			if (this.records.get(branch.right)!.height >= inner.height) {
				return this.branch(this.branch(leftId, branch.left), branch.right);
			}
			const pivot = inner as Branch;
			this.records.delete(branch.left);
			return this.branch(this.branch(leftId, pivot.left), this.branch(pivot.right, branch.right));
		}
		return this.branch(leftId, rightId);
	}

	private split(id: number, offset: number, beforeUnits: boolean): [number, number] {
		if (id === 0) return [0, 0];
		const node = this.records.get(id)!;
		if (node.kind === 'unit') return beforeUnits ? [0, id] : [id, 0];
		if (node.kind === 'text') {
			if (offset === 0) return [0, id];
			if (offset === node.width) return [id, 0];
			this.records.delete(id);
			return [this.textLeaf(node.text, 0, offset), this.textLeaf(node.text, offset)];
		}
		const width = this.records.get(node.left)!.width;
		this.records.delete(id);
		if (offset < width || (offset === width && beforeUnits)) {
			const [left, middle] = this.split(node.left, offset, beforeUnits);
			return [left, this.join(middle, node.right)];
		}
		const [middle, right] = this.split(node.right, offset - width, beforeUnits);
		return [this.join(node.left, middle), right];
	}

	private discard(id: number): void {
		if (id === 0) return;
		const node = this.records.get(id)!;
		if (node.kind === 'branch') { this.discard(node.left); this.discard(node.right); }
		this.records.delete(id);
	}
}

function readText(records: HashMapSnapshot<number, Record>, id: number, offset: number, length: number, pieces: string[]): void {
	if (id === 0 || length === 0) return;
	const node = records.get(id)!;
	if (node.kind === 'unit') return;
	if (node.kind === 'text') { pieces.push(node.text.slice(offset, offset + length)); return; }
	const width = records.get(node.left)!.width;
	if (offset < width) {
		const take = Math.min(length, width - offset);
		readText(records, node.left, offset, take, pieces);
		readText(records, node.right, 0, length - take, pieces);
	} else readText(records, node.right, offset - width, length, pieces);
}

/** Shared leaf-local projection for random lookups and sequential cursors. */
export function positionInText(lineStarts: readonly number[], offset: number, line: number, column: number): LuaSourcePosition {
	let low = 0, high = lineStarts.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (lineStarts[middle] <= offset) low = middle + 1;
		else high = middle;
	}
	return { line: line + low, column: low === 0 ? column + offset : offset - lineStarts[low - 1] + 1 };
}
