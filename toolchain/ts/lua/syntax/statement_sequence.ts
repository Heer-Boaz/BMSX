import type { LuaStatement } from './ast';
import type { LuaSourceUnit } from './source_layout';

export const LUA_STATEMENT_LEAF_CAPACITY = 32;

/** A parser-owned source occurrence, including trivia and skipped recovery text. */
export type LuaStatementPart = {
	readonly statement: LuaStatement | null;
	readonly width: number;
	readonly readWidth: number;
	readonly recovery: boolean;
	readonly endsNewLine: boolean;
	readonly units: readonly LuaSourceUnit[];
};

type Summary = {
	readonly length: number;
	readonly partCount: number;
	readonly width: number;
	readonly readWidth: number;
	readonly hasRecovery: boolean;
	readonly height: number;
};
type Leaf = Summary & { readonly kind: 'leaf'; readonly parts: readonly LuaStatementPart[] };
type Branch = Summary & { readonly kind: 'branch'; readonly left: Node; readonly right: Node };
type Node = Leaf | Branch;

/** Immutable source-order syntax parts with bounded leaves and balanced splices. */
export class LuaStatementSequence implements Iterable<LuaStatement> {
	private constructor(public readonly context: number, private readonly root: Node | null) {}

	public static empty(context: number): LuaStatementSequence { return new LuaStatementSequence(context, null); }
	public static fromParts(context: number, parts: readonly LuaStatementPart[]): LuaStatementSequence {
		return new LuaStatementSequence(context, build(parts, 0, parts.length));
	}
	public get length(): number { return this.root === null ? 0 : this.root.length; }
	public get partCount(): number { return this.root === null ? 0 : this.root.partCount; }
	public get width(): number { return this.root === null ? 0 : this.root.width; }
	public get readWidth(): number { return this.root === null ? 0 : this.root.readWidth; }
	public get hasRecovery(): boolean { return this.root !== null && this.root.hasRecovery; }
	public get height(): number { return this.root === null ? 0 : this.root.height; }

	public get(index: number): LuaStatement {
		let node = this.root!;
		while (node.kind === 'branch') {
			if (index < node.left.length) node = node.left;
			else { index -= node.left.length; node = node.right; }
		}
		let localIndex = 0;
		for (;;) {
			const part = node.parts[localIndex++];
			if (part.statement !== null && index-- === 0) return part.statement;
		}
	}
	public cursor(index = 0): LuaStatementCursor { return new LuaStatementCursor(this.root, index); }
	public sliceParts(from: number, to: number): LuaStatementSequence {
		const [, suffix] = split(this.root, from);
		const [result] = split(suffix, to - from);
		return new LuaStatementSequence(this.context, result);
	}
	/** Both operands have the same parser context. */
	public concat(other: LuaStatementSequence): LuaStatementSequence {
		return new LuaStatementSequence(this.context, join(this.root, other.root));
	}
	public replaceParts(from: number, count: number, replacement: LuaStatementSequence): LuaStatementSequence {
		const [left, suffix] = split(this.root, from);
		const [, right] = split(suffix, count);
		return new LuaStatementSequence(this.context, join(join(left, replacement.root), right));
	}
	/** Maximal clean prefix from a part boundary; readLimit is sequence-relative. */
	public reusableParts(from: number, readLimit: number): LuaStatementSequence {
		const to = this.root === null ? 0 : reusableEnd(this.root, from, readLimit);
		return this.sliceParts(from, to);
	}
	public *parts(): IterableIterator<LuaStatementPart> {
		const cursor = new LuaStatementCursor(this.root);
		cursor.seekPart(0);
		while (cursor.part !== undefined) { yield cursor.part; cursor.advancePart(); }
	}
	public *[Symbol.iterator](): IterableIterator<LuaStatement> {
		const cursor = this.cursor();
		while (cursor.statement !== undefined) { yield cursor.statement; cursor.advance(); }
	}
}

/** One reusable frontier supports both statement-rank and full-fidelity part walks. */
export class LuaStatementCursor {
	private readonly path: Branch[] = [];
	private readonly right: boolean[] = [];
	private leaf: Leaf | null = null;
	private localIndex = 0;
	private statementIndex = 0;
	private sourcePartIndex = 0;
	private sourceOffset = 0;

	public constructor(private readonly root: Node | null, index = 0) { this.seek(index); }
	public get statement(): LuaStatement | undefined { return this.part?.statement ?? undefined; }
	public get part(): LuaStatementPart | undefined { return this.leaf === null ? undefined : this.leaf.parts[this.localIndex]; }
	public get index(): number { return this.statementIndex; }
	public get partIndex(): number { return this.sourcePartIndex; }
	public get offset(): number { return this.sourceOffset; }

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
		for (const part of node.parts) {
			if (part.statement !== null && index-- === 0) return;
			this.skipPart(part);
			this.localIndex++;
		}
	}

	public seekPart(index: number): void {
		this.reset();
		let node = this.root;
		if (node === null) return;
		if (index === node.partCount) { this.skip(node); return; }
		while (node.kind === 'branch') {
			this.path.push(node);
			this.right.push(index >= node.left.partCount);
			if (index < node.left.partCount) node = node.left;
			else { index -= node.left.partCount; this.skip(node.left); node = node.right; }
		}
		this.leaf = node;
		this.localIndex = index;
		for (let i = 0; i < index; i++) this.skipPart(node.parts[i]);
	}

	/** Right-biased at boundaries; a terminal zero-width part is retained. */
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
		for (const part of node.parts) {
			if (offset < part.width || (part.width === 0 && this.sourcePartIndex === this.root!.partCount - 1)) return;
			offset -= part.width;
			this.skipPart(part);
			this.localIndex++;
		}
		this.leaf = null;
	}

	public advancePart(): boolean {
		if (this.leaf === null) return false;
		this.skipPart(this.leaf.parts[this.localIndex]);
		if (++this.localIndex < this.leaf.partCount) return true;
		return this.nextLeaf(false);
	}

	public advance(): boolean {
		if (this.leaf === null) return false;
		for (;;) {
			this.skipPart(this.leaf.parts[this.localIndex]);
			if (++this.localIndex === this.leaf.partCount && !this.nextLeaf(true)) return false;
			if (this.leaf!.parts[this.localIndex].statement !== null) return true;
		}
	}

	public retreatPart(): boolean {
		if (this.sourcePartIndex === 0) return false;
		if (this.leaf === null) { this.seekPart(this.sourcePartIndex - 1); return true; }
		if (this.localIndex === 0) this.previousLeaf(false);
		this.unskipPart(this.leaf!.parts[--this.localIndex]);
		return true;
	}

	public retreat(): boolean {
		if (this.statementIndex === 0) return false;
		if (this.leaf === null) { this.seek(this.statementIndex - 1); return true; }
		for (;;) {
			if (this.localIndex === 0) this.previousLeaf(true);
			const part = this.leaf!.parts[--this.localIndex];
			this.unskipPart(part);
			if (part.statement !== null) return true;
		}
	}

	private reset(): void {
		this.path.length = this.right.length = 0;
		this.leaf = null;
		this.localIndex = this.statementIndex = this.sourcePartIndex = this.sourceOffset = 0;
	}
	private skip(node: Node): void {
		this.statementIndex += node.length;
		this.sourcePartIndex += node.partCount;
		this.sourceOffset += node.width;
	}
	private skipPart(part: LuaStatementPart): void {
		if (part.statement !== null) this.statementIndex++;
		this.sourcePartIndex++;
		this.sourceOffset += part.width;
	}
	private unskipPart(part: LuaStatementPart): void {
		if (part.statement !== null) this.statementIndex--;
		this.sourcePartIndex--;
		this.sourceOffset -= part.width;
	}
	private nextLeaf(statements: boolean): boolean {
		this.leaf = null;
		while (this.path.length > 0) {
			const parent = this.path.pop()!;
			if (this.right.pop()) continue;
			this.path.push(parent);
			this.right.push(true);
			let node = parent.right;
			if (statements && node.length === 0) { this.skip(node); continue; }
			while (node.kind === 'branch') {
				this.path.push(node);
				const skipLeft = statements && node.left.length === 0;
				this.right.push(skipLeft);
				if (skipLeft) { this.skip(node.left); node = node.right; }
				else node = node.left;
			}
			this.leaf = node;
			this.localIndex = 0;
			return true;
		}
		return false;
	}
	private previousLeaf(statements: boolean): void {
		for (;;) {
			const parent = this.path.pop()!;
			if (!this.right.pop()) continue;
			this.path.push(parent);
			this.right.push(false);
			let node = parent.left;
			if (statements && node.length === 0) {
				this.sourcePartIndex -= node.partCount;
				this.sourceOffset -= node.width;
				continue;
			}
			while (node.kind === 'branch') {
				this.path.push(node);
				const skipRight = statements && node.right.length === 0;
				this.right.push(!skipRight);
				if (skipRight) {
					this.sourcePartIndex -= node.right.partCount;
					this.sourceOffset -= node.right.width;
					node = node.left;
				} else node = node.right;
			}
			this.leaf = node;
			this.localIndex = node.partCount;
			return;
		}
	}
}

function leaf(parts: readonly LuaStatementPart[]): Leaf {
	let length = 0, width = 0, readWidth = 0, hasRecovery = false;
	for (const part of parts) {
		if (part.statement !== null) length++;
		readWidth = Math.max(readWidth, width + part.readWidth);
		width += part.width;
		hasRecovery ||= part.recovery;
	}
	return { kind: 'leaf', parts, length, partCount: parts.length, width, readWidth, hasRecovery, height: 1 };
}
function branch(left: Node, right: Node): Branch {
	return { kind: 'branch', left, right, length: left.length + right.length, partCount: left.partCount + right.partCount,
		width: left.width + right.width, readWidth: Math.max(left.readWidth, left.width + right.readWidth),
		hasRecovery: left.hasRecovery || right.hasRecovery, height: Math.max(left.height, right.height) + 1 };
}
function build(parts: readonly LuaStatementPart[], from: number, to: number): Node | null {
	if (from === to) return null;
	if (to - from <= LUA_STATEMENT_LEAF_CAPACITY) return leaf(from === 0 && to === parts.length ? parts : parts.slice(from, to));
	const middle = (from + to) >>> 1;
	return branch(build(parts, from, middle)!, build(parts, middle, to)!);
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
	if (index === node.partCount) return [node, null];
	if (node.kind === 'leaf') return [leaf(node.parts.slice(0, index)), leaf(node.parts.slice(index))];
	if (index < node.left.partCount) {
		const [left, right] = split(node.left, index);
		return [left, join(right, node.right)];
	}
	const [left, right] = split(node.right, index - node.left.partCount);
	return [join(node.left, left), right];
}

function reusableEnd(node: Node, from: number, readLimit: number): number {
	if (from === node.partCount) return from;
	if (!node.hasRecovery && node.width <= readLimit && node.readWidth <= readLimit) return node.partCount;
	if (node.kind === 'leaf') {
		let offset = 0;
		for (let i = 0; i < node.partCount; i++) {
			const part = node.parts[i];
			if (i >= from && (part.recovery || offset + part.width > readLimit || offset + part.readWidth > readLimit)) return i;
			offset += part.width;
		}
		return node.partCount;
	}
	if (from < node.left.partCount) {
		const end = reusableEnd(node.left, from, readLimit);
		if (end < node.left.partCount) return end;
	}
	return node.left.partCount + reusableEnd(node.right, Math.max(0, from - node.left.partCount), readLimit - node.left.width);
}
