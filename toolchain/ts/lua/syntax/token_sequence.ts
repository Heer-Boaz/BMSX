import type { LuaSourceUnit, LuaSourceUnitPlacement } from './source_layout';
import { isLuaTrivia, type LuaToken } from './token';

/** The lexer closes a block at this item count, never inside a token. */
export const LUA_LEXICAL_BLOCK_CAPACITY = 32;
export type LuaTokenBlock = { readonly unit: LuaSourceUnit; readonly items: readonly LuaToken[] };
export type LuaTokenBlockPlacement = {
	readonly block: LuaTokenBlock;
	readonly index: number;
	readonly offset: number;
	readonly itemIndex: number;
};

type Summary = {
	readonly width: number;
	readonly readWidth: number;
	readonly length: number;
	readonly significantCount: number;
	readonly blockCount: number;
	readonly height: number;
};
type Leaf = Summary & { readonly kind: 'leaf'; readonly block: LuaTokenBlock };
type Branch = Summary & { readonly kind: 'branch'; readonly left: Node; readonly right: Node };
type Node = Leaf | Branch;

/** Immutable relative lexical blocks. Edits rebuild only balanced ancestor paths. */
export class LuaTokenSequence {
	private constructor(private readonly root: Node | null) {}

	public static fromBlocks(blocks: readonly LuaTokenBlock[]): LuaTokenSequence {
		return new LuaTokenSequence(build(blocks, 0, blocks.length));
	}

	public get length(): number { return this.root === null ? 0 : this.root.length; }
	public get significantCount(): number { return this.root === null ? 0 : this.root.significantCount; }
	public get width(): number { return this.root === null ? 0 : this.root.width; }
	public get readWidth(): number { return this.root === null ? 0 : this.root.readWidth; }
	public get blockCount(): number { return this.root === null ? 0 : this.root.blockCount; }
	public get height(): number { return this.root === null ? 0 : this.root.height; }

	public get(index: number): LuaToken {
		let node = this.root!;
		while (node.kind === 'branch') {
			if (index < node.left.length) node = node.left;
			else { index -= node.left.length; node = node.right; }
		}
		return node.block.items[index];
	}

	public getSignificant(index: number): LuaToken {
		let node = this.root!;
		while (node.kind === 'branch') {
			if (index < node.left.significantCount) node = node.left;
			else { index -= node.left.significantCount; node = node.right; }
		}
		let item = 0;
		for (;;) {
			const token = node.block.items[item++];
			if (!isLuaTrivia(token.type) && index-- === 0) return token;
		}
	}

	public blockAt(index: number): LuaTokenBlock {
		let node = this.root!;
		while (node.kind === 'branch') {
			if (index < node.left.blockCount) node = node.left;
			else { index -= node.left.blockCount; node = node.right; }
		}
		return node.block;
	}

	public cursor(index = 0): LuaTokenCursor { return new LuaTokenCursor(this.root, index); }

	public replaceBlocks(fromBlockIndex: number, deleteBlocks: number, blocks: readonly LuaTokenBlock[]): LuaTokenSequence {
		const [left, suffix] = split(this.root, fromBlockIndex);
		const [, right] = split(suffix, deleteBlocks);
		return new LuaTokenSequence(join(join(left, build(blocks, 0, blocks.length)), right));
	}

	/**
	 * Earliest item that observed the edited UTF-16 position, including failed
	 * long-bracket probes and EOF observations. Returns length when none did.
	 * Subtrees whose maximum read end precedes the edit are skipped wholesale.
	 */
	public firstDependency(offset: number): number {
		let node = this.root;
		if (node === null || offset >= node.readWidth) return this.length;
		let index = 0;
		while (node.kind === 'branch') {
			if (offset < node.left.readWidth) node = node.left;
			else {
				offset -= node.left.width;
				index += node.left.length;
				node = node.right;
			}
		}
		for (const item of node.block.items) {
			if (offset < item.readWidth) return index;
			offset -= item.width;
			index++;
		}
		return this.length;
	}

	/** Source-ordered block walk beginning with one logarithmic seek. */
	public *blocks(fromBlockIndex = 0): IterableIterator<LuaTokenBlockPlacement> {
		if (fromBlockIndex === this.blockCount) return;
		const pending: Node[] = [];
		let node = this.root!, remaining = fromBlockIndex, offset = 0, itemIndex = 0;
		while (node.kind === 'branch') {
			if (remaining < node.left.blockCount) { pending.push(node.right); node = node.left; }
			else {
				remaining -= node.left.blockCount;
				offset += node.left.width;
				itemIndex += node.left.length;
				node = node.right;
			}
		}
		let index = fromBlockIndex;
		for (;;) {
			yield { block: node.block, index, offset, itemIndex };
			index++;
			offset += node.width;
			itemIndex += node.length;
			if (pending.length === 0) return;
			node = pending.pop()!;
			while (node.kind === 'branch') { pending.push(node.right); node = node.left; }
		}
	}

	public *placements(): IterableIterator<LuaSourceUnitPlacement> {
		for (const placement of this.blocks()) yield { unit: placement.block.unit, offset: placement.offset };
	}

	public *[Symbol.iterator](): IterableIterator<LuaToken> {
		for (const placement of this.blocks()) yield* placement.block.items;
	}
}

/** A mutable traversal frontier over one immutable sequence, not a copied suffix. */
export class LuaTokenCursor {
	private readonly path: Branch[] = [];
	private readonly right: boolean[] = [];
	private leaf: Leaf | null = null;
	private localIndex = 0;
	private itemIndex = 0;
	private sourceOffset = 0;
	private leafIndex = 0;
	private leafOffset = 0;

	public constructor(private readonly root: Node | null, index = 0) { this.seek(index); }
	public get token(): LuaToken | undefined { return this.leaf === null ? undefined : this.leaf.block.items[this.localIndex]; }
	public get index(): number { return this.itemIndex; }
	public get offset(): number { return this.sourceOffset; }
	public get blockIndex(): number { return this.leafIndex; }
	public get blockOffset(): number { return this.leafOffset; }

	public seek(index: number): void {
		this.reset();
		let node = this.root;
		if (node === null) return;
		if (index === node.length) { this.skip(node); return; }
		while (node.kind === 'branch') {
			this.path.push(node);
			this.right.push(index >= node.left.length);
			if (index < node.left.length) node = node.left;
			else { index -= node.left.length; this.skip(node.left); node = node.right; }
		}
		this.leaf = node;
		this.leafOffset = this.sourceOffset;
		this.localIndex = index;
		this.itemIndex += index;
		for (let i = 0; i < index; i++) this.sourceOffset += node.block.items[i].width;
	}

	/** Significant-token rank; trivia at the cursor is not itself counted. */
	public get significantIndex(): number {
		if (this.leaf === null) return this.root === null ? 0 : this.root.significantCount;
		let index = 0;
		for (let depth = 0; depth < this.path.length; depth++) {
			if (this.right[depth]) index += this.path[depth].left.significantCount;
		}
		for (let i = 0; i < this.localIndex; i++) {
			if (!isLuaTrivia(this.leaf.block.items[i].type)) index++;
		}
		return index;
	}

	public seekSignificant(index: number): void {
		this.reset();
		let node = this.root;
		if (node === null) return;
		if (index === node.significantCount) { this.skip(node); return; }
		while (node.kind === 'branch') {
			this.path.push(node);
			this.right.push(index >= node.left.significantCount);
			if (index < node.left.significantCount) node = node.left;
			else { index -= node.left.significantCount; this.skip(node.left); node = node.right; }
		}
		this.leaf = node;
		this.leafOffset = this.sourceOffset;
		for (const item of node.block.items) {
			if (!isLuaTrivia(item.type) && index-- === 0) return;
			this.sourceOffset += item.width;
			this.localIndex++;
			this.itemIndex++;
		}
	}

	/** Right-biased at token boundaries; a zero-width terminal EOF is retained. */
	public seekOffset(offset: number): void {
		this.reset();
		let node = this.root;
		if (node === null) return;
		while (node.kind === 'branch') {
			this.path.push(node);
			this.right.push(offset >= node.left.width);
			if (offset < node.left.width) node = node.left;
			else { offset -= node.left.width; this.skip(node.left); node = node.right; }
		}
		this.leaf = node;
		this.leafOffset = this.sourceOffset;
		while (this.localIndex < node.length) {
			const item = node.block.items[this.localIndex];
			if (offset < item.width || item.width === 0) return;
			offset -= item.width;
			this.sourceOffset += item.width;
			this.localIndex++;
			this.itemIndex++;
		}
		this.leaf = null;
		this.leafIndex++;
	}

	public advance(): boolean {
		if (this.leaf === null) return false;
		this.sourceOffset += this.leaf.block.items[this.localIndex].width;
		this.itemIndex++;
		if (++this.localIndex < this.leaf.length) return true;
		this.leafIndex++;
		return this.nextLeaf(false);
	}

	/** Advance at least once, skipping trivia-only subtrees by their summary. */
	public advanceSignificant(): boolean {
		if (this.leaf === null) return false;
		do {
			this.sourceOffset += this.leaf.block.items[this.localIndex].width;
			this.itemIndex++;
			this.localIndex++;
		} while (this.localIndex < this.leaf.length && isLuaTrivia(this.leaf.block.items[this.localIndex].type));
		if (this.localIndex < this.leaf.length) return true;
		this.leafIndex++;
		if (!this.nextLeaf(true)) return false;
		while (isLuaTrivia(this.leaf!.block.items[this.localIndex].type)) {
			this.sourceOffset += this.leaf!.block.items[this.localIndex].width;
			this.itemIndex++;
			this.localIndex++;
		}
		return true;
	}

	/** Non-mutating lookahead, counting only significant tokens from this point. */
	public peekSignificant(distance = 0): LuaToken | undefined {
		if (this.leaf === null) return undefined;
		for (let i = this.localIndex; i < this.leaf.length; i++) {
			const item = this.leaf.block.items[i];
			if (!isLuaTrivia(item.type) && distance-- === 0) return item;
		}
		for (let i = this.path.length - 1; i >= 0; i--) {
			if (this.right[i]) continue;
			let node = this.path[i].right;
			if (distance >= node.significantCount) { distance -= node.significantCount; continue; }
			while (node.kind === 'branch') {
				if (distance < node.left.significantCount) node = node.left;
				else { distance -= node.left.significantCount; node = node.right; }
			}
			for (const item of node.block.items) if (!isLuaTrivia(item.type) && distance-- === 0) return item;
		}
		return undefined;
	}

	private reset(): void {
		this.path.length = 0;
		this.right.length = 0;
		this.leaf = null;
		this.localIndex = this.itemIndex = this.sourceOffset = this.leafIndex = this.leafOffset = 0;
	}

	private skip(node: Node): void {
		this.sourceOffset += node.width;
		this.itemIndex += node.length;
		this.leafIndex += node.blockCount;
	}

	private nextLeaf(significant: boolean): boolean {
		this.leaf = null;
		while (this.path.length > 0) {
			const parent = this.path.pop()!;
			if (this.right.pop()) continue;
			this.path.push(parent);
			this.right.push(true);
			let node = parent.right;
			if (significant && node.significantCount === 0) { this.skip(node); continue; }
			while (node.kind === 'branch') {
				this.path.push(node);
				const skipLeft = significant && node.left.significantCount === 0;
				this.right.push(skipLeft);
				if (skipLeft) { this.skip(node.left); node = node.right; }
				else node = node.left;
			}
			this.leaf = node;
			this.leafOffset = this.sourceOffset;
			this.localIndex = 0;
			return true;
		}
		return false;
	}

	/** Reverse traversal uses the same bounded ancestor frontier as advance. */
	public retreat(): boolean {
		if (this.itemIndex === 0) return false;
		if (this.leaf === null) { this.seek(this.itemIndex - 1); return true; }
		this.itemIndex--;
		if (this.localIndex > 0) {
			this.sourceOffset -= this.leaf.block.items[--this.localIndex].width;
			return true;
		}
		for (;;) {
			const parent = this.path.pop()!;
			if (!this.right.pop()) continue;
			this.path.push(parent);
			this.right.push(false);
			let node = parent.left;
			while (node.kind === 'branch') {
				this.path.push(node);
				this.right.push(true);
				node = node.right;
			}
			this.leaf = node;
			this.leafIndex--;
			this.leafOffset -= node.width;
			this.localIndex = node.length - 1;
			this.sourceOffset -= node.block.items[this.localIndex].width;
			return true;
		}
	}
}

function leaf(block: LuaTokenBlock): Leaf {
	let width = 0, readWidth = 0, significantCount = 0;
	for (const item of block.items) {
		readWidth = Math.max(readWidth, width + item.readWidth);
		width += item.width;
		if (!isLuaTrivia(item.type)) significantCount++;
	}
	return { kind: 'leaf', block, width, readWidth, length: block.items.length, significantCount, blockCount: 1, height: 1 };
}

function branch(left: Node, right: Node): Branch {
	return { kind: 'branch', left, right, width: left.width + right.width,
		readWidth: Math.max(left.readWidth, left.width + right.readWidth), length: left.length + right.length,
		significantCount: left.significantCount + right.significantCount, blockCount: left.blockCount + right.blockCount,
		height: Math.max(left.height, right.height) + 1 };
}

function build(blocks: readonly LuaTokenBlock[], from: number, to: number): Node | null {
	if (from === to) return null;
	if (to - from === 1) return leaf(blocks[from]);
	const middle = (from + to) >>> 1;
	return branch(build(blocks, from, middle)!, build(blocks, middle, to)!);
}

function balance(left: Node, right: Node): Node {
	if (left.height > right.height + 1) {
		const l = left as Branch;
		if (l.left.height >= l.right.height) return branch(l.left, branch(l.right, right));
		const lr = l.right as Branch;
		return branch(branch(l.left, lr.left), branch(lr.right, right));
	}
	if (right.height > left.height + 1) {
		const r = right as Branch;
		if (r.right.height >= r.left.height) return branch(branch(left, r.left), r.right);
		const rl = r.left as Branch;
		return branch(branch(left, rl.left), branch(rl.right, r.right));
	}
	return branch(left, right);
}

function join(left: Node | null, right: Node | null): Node | null {
	if (left === null) return right;
	if (right === null) return left;
	if (left.height > right.height + 1) {
		const l = left as Branch;
		return balance(l.left, join(l.right, right)!);
	}
	if (right.height > left.height + 1) {
		const r = right as Branch;
		return balance(join(left, r.left)!, r.right);
	}
	return branch(left, right);
}

function split(node: Node | null, index: number): [Node | null, Node | null] {
	if (node === null || index === 0) return [null, node];
	if (index === node.blockCount) return [node, null];
	const b = node as Branch;
	if (index < b.left.blockCount) {
		const [left, right] = split(b.left, index);
		return [left, join(right, b.right)];
	}
	const [left, right] = split(b.right, index - b.left.blockCount);
	return [join(b.left, left), right];
}
