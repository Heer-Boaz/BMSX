import type { MutableTextPosition, TextBuffer } from './text_buffer';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

type PieceBufferBlock = {
	value: string;
	lineStarts: ArrayLike<number>;
};

class BufferBlock implements PieceBufferBlock {
	public readonly value: string;
	public readonly lineStarts: Int32Array;

	constructor(value: string, precomputedLineStarts?: Int32Array) {
		this.value = value;
		if (precomputedLineStarts) {
			assert(precomputedLineStarts.length > 0 && precomputedLineStarts[0] === 0, '[BufferBlock] lineStarts must start at 0');
			assert(precomputedLineStarts[precomputedLineStarts.length - 1] <= value.length, '[BufferBlock] lineStarts out of range');
			this.lineStarts = precomputedLineStarts;
			return;
		}
		let lineCount = 1;
		for (let index = 0; index < value.length; index += 1) {
			if (value.charCodeAt(index) === 10) {
				lineCount += 1;
			}
		}
		const lineStarts = new Int32Array(lineCount);
		let write = 0;
		lineStarts[write++] = 0;
		for (let index = 0; index < value.length; index += 1) {
			if (value.charCodeAt(index) === 10) {
				lineStarts[write++] = index + 1;
			}
		}
		this.lineStarts = lineStarts;
	}
}

class AddedBufferBlock implements PieceBufferBlock {
	public value = '';
	public lineStarts: number[] = [0];

	public appendStart = 0;
	public appendStartLine = 0;
	public appendLF = 0;

	public append(text: string): void {
		const start = this.value.length;
		const startLine = this.lineStarts.length - 1;
		let lf = 0;
		for (let index = 0; index < text.length; index += 1) {
			if (text.charCodeAt(index) === 10) {
				this.lineStarts.push(start + index + 1);
				lf += 1;
			}
		}
		this.value += text;
		this.appendStart = start;
		this.appendStartLine = startLine;
		this.appendLF = lf;
	}
}

const ADDED_BUFFER_FLUSH_THRESHOLD = 1 << 20;

function upperBound(values: ArrayLike<number>, x: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (values[mid] <= x) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

function lineIndexAt(block: PieceBufferBlock, offset: number): number {
	return upperBound(block.lineStarts, offset) - 1;
}

export class PieceTreeNode {
	public buf = 0;
	public start = 0;
	public len = 0;
	public startLine = 0;
	public lf = 0;

	public prio = 0;
	public left: PieceTreeNode | null = null;
	public right: PieceTreeNode | null = null;

	public sumLen = 0;
	public sumLF = 0;
	public sumNodes = 1;

	public setPiece(buf: number, start: number, len: number, startLine: number, lf: number, prio: number): void {
		this.buf = buf;
		this.start = start;
		this.len = len;
		this.startLine = startLine;
		this.lf = lf;
		this.prio = prio;
	}

	public resetLinks(): void {
		this.left = null;
		this.right = null;
	}
}

class SplitResult {
	public left: PieceTreeNode | null = null;
	public right: PieceTreeNode | null = null;
}

export class PieceTreeBuffer implements TextBuffer {
	public version = 0;

	private root: PieceTreeNode | null = null;
	private buffers: PieceBufferBlock[] = [];
	private original: BufferBlock = null;
	private added: AddedBufferBlock = null;
	private addedIndex = 1;

	private readonly free: PieceTreeNode[] = [];

	private rngState = 0x12345678;

	private readonly split1 = new SplitResult();
	private readonly split2 = new SplitResult();
	private readonly mergeSplit1 = new SplitResult();
	private readonly mergeSplit2 = new SplitResult();

	private readonly parts: string[] = [];
	private readonly stackN: PieceTreeNode[] = [];
	private readonly stackB: number[] = [];
	private readonly stackS: number[] = [];

	public constructor(text = '') {
		this.original = new BufferBlock(text);
		this.added = new AddedBufferBlock();
		this.buffers.push(this.original);
		this.buffers.push(this.added);
		this.addedIndex = 1;
		if (text.length > 0) {
			const node = this.allocNode();
			const lf = this.original.lineStarts.length - 1;
			node.setPiece(0, 0, text.length, 0, lf, this.nextPrio());
			this.recalc(node);
			this.root = node;
		}
	}

	public get length(): number {
		const root = this.root;
		return root ? root.sumLen : 0;
	}

	public charCodeAt(offset: number): number {
		if (offset < 0 || offset >= this.length) {
			return NaN;
		}
		let node = this.root;
		let pos = offset;
		while (node) {
			const left = node.left;
			const leftLen = left ? left.sumLen : 0;
			if (pos < leftLen) {
				node = left;
				continue;
			}
			pos -= leftLen;
			if (pos < node.len) {
				return this.buffers[node.buf].value.charCodeAt(node.start + pos);
			}
			pos -= node.len;
			node = node.right;
		}
		throw new Error('[PieceTreeBuffer] charCodeAt offset traversal failed');
	}

	public getNodeCount(): number {
		const root = this.root;
		return root ? root.sumNodes : 0;
	}

	public getBufferCount(): number {
		return this.buffers.length;
	}

	public compact(): void {
		const oldRoot = this.root;
		const text = this.getText();
		this.root = null;
		this.buffers.length = 0;
		this.releaseSubtree(oldRoot);

		this.original = new BufferBlock(text);
		this.added = new AddedBufferBlock();
		this.buffers.push(this.original);
		this.buffers.push(this.added);
		this.addedIndex = 1;
		if (text.length > 0) {
			const node = this.allocNode();
			const lf = this.original.lineStarts.length - 1;
			node.setPiece(0, 0, text.length, 0, lf, this.nextPrio());
			this.recalc(node);
			this.root = node;
		}
		this.version += 1;
	}

	public insert(offset: number, text: string): void {
		if (text.length === 0) {
			return;
		}
		assert(offset >= 0 && offset <= this.length, `[PieceTreeBuffer] insert offset out of range: ${offset}`);

		const node = this.allocNode();
		if (text.length > ADDED_BUFFER_FLUSH_THRESHOLD) {
			const bufIndex = this.buffers.length;
			const block = new BufferBlock(text);
			this.buffers.push(block);
			const lf = block.lineStarts.length - 1;
			node.setPiece(bufIndex, 0, text.length, 0, lf, this.nextPrio());
		} else {
			this.flushAddedBufferIfNeeded(text.length);
			this.added.append(text);
			node.setPiece(this.addedIndex, this.added.appendStart, text.length, this.added.appendStartLine, this.added.appendLF, this.nextPrio());
		}
		this.recalc(node);

		this.split(this.root, offset, this.split1);
		const mergedLeft = this.mergeAdjacent(this.split1.left, node);
		this.root = this.mergeAdjacent(mergedLeft, this.split1.right);
		this.version += 1;
	}

	public delete(offset: number, length: number): void {
		const deleted = this.deleteToSubtree(offset, length);
		this.releaseDetachedSubtree(deleted);
	}

	public replace(offset: number, length: number, text: string): void {
		const deleted = this.replaceToSubtree(offset, length, text);
		this.releaseDetachedSubtree(deleted);
	}

	public releaseDetachedSubtree(subtree: PieceTreeNode | null): void {
		this.releaseSubtree(subtree);
	}

	public deleteToSubtree(offset: number, length: number): PieceTreeNode | null {
		if (length === 0) {
			return null;
		}
		assert(offset >= 0 && length >= 0 && offset + length <= this.length, `[PieceTreeBuffer] delete range out of bounds: ${offset}+${length}`);
		this.split(this.root, offset, this.split1);
		this.split(this.split1.right, length, this.split2);
		const deleted = this.split2.left;
		this.root = this.mergeAdjacent(this.split1.left, this.split2.right);
		this.version += 1;
		return deleted;
	}

	public replaceToSubtree(offset: number, length: number, text: string): PieceTreeNode | null {
		assert(offset >= 0 && length >= 0 && offset + length <= this.length, `[PieceTreeBuffer] replace range out of bounds: ${offset}+${length}`);
		this.split(this.root, offset, this.split1);
		this.split(this.split1.right, length, this.split2);
		const deleted = this.split2.left;
		const inserted = this.buildInsertedTree(text);
		const mergedLeft = this.mergeAdjacent(this.split1.left, inserted);
		this.root = this.mergeAdjacent(mergedLeft, this.split2.right);
		this.version += 1;
		return deleted;
	}

	public insertSubtree(offset: number, subtree: PieceTreeNode | null): void {
		if (!subtree) {
			return;
		}
		assert(offset >= 0 && offset <= this.length, `[PieceTreeBuffer] insertSubtree offset out of range: ${offset}`);
		this.split(this.root, offset, this.split1);
		const mergedLeft = this.mergeAdjacent(this.split1.left, subtree);
		this.root = this.mergeAdjacent(mergedLeft, this.split1.right);
		this.version += 1;
	}

	public getLineCount(): number {
		const root = this.root;
		return root ? root.sumLF + 1 : 1;
	}

	public getLineStartOffset(row: number): number {
		if (row <= 0) {
			return 0;
		}
		return this.findOffsetOfNthLF(row - 1) + 1;
	}

	public getLineEndOffset(row: number): number {
		const lineCount = this.getLineCount();
		if (row >= lineCount - 1) {
			return this.length;
		}
		return this.findOffsetOfNthLF(row);
	}

	public getLineContent(row: number): string {
		const start = this.getLineStartOffset(row);
		const end = this.getLineEndOffset(row);
		return this.getTextRange(start, end);
	}

	public getLineSignature(row: number): number {
		const start = this.getLineStartOffset(row);
		const end = this.getLineEndOffset(row);
		return this.computeRangeSignature(start, end);
	}

	public offsetAt(row: number, column: number): number {
		return this.getLineStartOffset(row) + column;
	}

	public positionAt(offset: number, out: MutableTextPosition): void {
		assert(offset >= 0 && offset <= this.length, `[PieceTreeBuffer] positionAt offset out of range: ${offset}`);
		const row = this.countLFBefore(offset);
		let rowStart = 0;
		if (row > 0) {
			rowStart = this.findOffsetOfNthLF(row - 1) + 1;
		}
		out.row = row;
		out.column = offset - rowStart;
	}

	public getTextRange(start: number, end: number): string {
		assert(start >= 0 && end >= start && end <= this.length, `[PieceTreeBuffer] getTextRange out of range: ${start}..${end}`);
		if (start === end) {
			return '';
		}
		const parts = this.parts;
		parts.length = 0;
		this.appendRangeToParts(start, end, parts);
		assert(parts.length > 0, `[PieceTreeBuffer] getTextRange expected parts for ${start}..${end}`);
		if (parts.length === 1) {
			return parts[0];
		}
		return parts.join('');
	}

	public getText(): string {
		return this.getTextRange(0, this.length);
	}

	private computeRangeSignature(start: number, end: number): number {
		const root = this.root;
		if (!root || start === end) {
			return 0;
		}
		const stackN = this.stackN;
		const stackB = this.stackB;
		const stackS = this.stackS;
		stackN.length = 0;
		stackB.length = 0;
		stackS.length = 0;

		stackN.push(root);
		stackB.push(0);
		stackS.push(0);

		let hash = 2166136261;
		while (stackN.length > 0) {
			const state = stackS.pop()!;
			const base = stackB.pop()!;
			const node = stackN.pop()!;
			if (state === 0) {
				const subtreeEnd = base + node.sumLen;
				if (subtreeEnd <= start) {
					continue;
				}
				if (base >= end) {
					continue;
				}

				const left = node.left;
				const leftLen = left ? left.sumLen : 0;
				const nodeStart = base + leftLen;
				const rightBase = nodeStart + node.len;

				const right = node.right;
				if (right) {
					stackN.push(right);
					stackB.push(rightBase);
					stackS.push(0);
				}
				stackN.push(node);
				stackB.push(base);
				stackS.push(1);
				if (left) {
					stackN.push(left);
					stackB.push(base);
					stackS.push(0);
				}
				continue;
			}

			const left = node.left;
			const leftLen = left ? left.sumLen : 0;
			const nodeStart = base + leftLen;
			const nodeEnd = nodeStart + node.len;
			if (nodeEnd <= start) {
				continue;
			}
			if (nodeStart >= end) {
				continue;
			}
			const segStart = start > nodeStart ? start - nodeStart : 0;
			const segEnd = end < nodeEnd ? end - nodeStart : node.len;
			const bufStart = node.start + segStart;
			const segLen = segEnd - segStart;
			hash = Math.imul(hash ^ node.buf, 16777619) >>> 0;
			hash = Math.imul(hash ^ bufStart, 16777619) >>> 0;
			hash = Math.imul(hash ^ segLen, 16777619) >>> 0;
		}
		return hash;
	}

	private buildInsertedTree(text: string): PieceTreeNode | null {
		if (text.length === 0) {
			return null;
		}
		const node = this.allocNode();
		if (text.length > ADDED_BUFFER_FLUSH_THRESHOLD) {
			const bufIndex = this.buffers.length;
			const block = new BufferBlock(text);
			this.buffers.push(block);
			const lf = block.lineStarts.length - 1;
			node.setPiece(bufIndex, 0, text.length, 0, lf, this.nextPrio());
		} else {
			this.flushAddedBufferIfNeeded(text.length);
			this.added.append(text);
			node.setPiece(this.addedIndex, this.added.appendStart, text.length, this.added.appendStartLine, this.added.appendLF, this.nextPrio());
		}
		this.recalc(node);
		return node;
	}

	private flushAddedBufferIfNeeded(appendLength: number): void {
		if (this.added.value.length + appendLength <= ADDED_BUFFER_FLUSH_THRESHOLD) {
			return;
		}
		if (this.added.value.length > 0) {
			this.buffers[this.addedIndex] = new BufferBlock(this.added.value, new Int32Array(this.added.lineStarts));
		}
		this.added = new AddedBufferBlock();
		this.addedIndex = this.buffers.length;
		this.buffers.push(this.added);
	}

	private nextPrio(): number {
		let x = this.rngState | 0;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.rngState = x;
		return x >>> 0;
	}

	private allocNode(): PieceTreeNode {
		const free = this.free;
		if (free.length > 0) {
			const node = free.pop()!;
			node.resetLinks();
			return node;
		}
		return new PieceTreeNode();
	}

	private releaseSubtree(root: PieceTreeNode | null): void {
		if (!root) {
			return;
		}
		const stack = this.stackN;
		stack.length = 0;
		stack.push(root);
		const free = this.free;
		while (stack.length > 0) {
			const node = stack.pop()!;
			const left = node.left;
			const right = node.right;
			if (left) {
				stack.push(left);
			}
			if (right) {
				stack.push(right);
			}
			node.left = null;
			node.right = null;
			free.push(node);
			}
		}

	private recalc(node: PieceTreeNode): void {
		const left = node.left;
		const right = node.right;
		node.sumLen = node.len + (left ? left.sumLen : 0) + (right ? right.sumLen : 0);
		node.sumLF = node.lf + (left ? left.sumLF : 0) + (right ? right.sumLF : 0);
		node.sumNodes = 1 + (left ? left.sumNodes : 0) + (right ? right.sumNodes : 0);
	}

	private split(root: PieceTreeNode | null, leftLen: number, out: SplitResult): void {
		if (!root) {
			out.left = null;
			out.right = null;
			return;
		}
		assert(leftLen >= 0 && leftLen <= root.sumLen, `[PieceTreeBuffer] split out of range: ${leftLen}/${root.sumLen}`);
		const left = root.left;
		const leftSize = left ? left.sumLen : 0;

		if (leftLen <= leftSize) {
			this.split(left, leftLen, out);
			root.left = out.right;
			this.recalc(root);
			out.right = root;
			return;
		}

		const right = root.right;
		const rightInputOffset = leftLen - leftSize - root.len;
		if (leftLen >= leftSize + root.len) {
			this.split(right, rightInputOffset, out);
			root.right = out.left;
			this.recalc(root);
			out.left = root;
			return;
		}

		const localCut = leftLen - leftSize;
		const originalRight = root.right;
		root.right = null;

		const originalLen = root.len;
		const originalLf = root.lf;
		const splitPos = root.start + localCut;
		const block = this.buffers[root.buf];
		const splitLine = lineIndexAt(block, splitPos);
		const leftLf = splitLine - root.startLine;
		const rightLf = originalLf - leftLf;

		root.len = localCut;
		root.lf = leftLf;
		this.recalc(root);

		const rightFrag = this.allocNode();
		rightFrag.setPiece(root.buf, splitPos, originalLen - localCut, splitLine, rightLf, this.nextPrio());
		this.recalc(rightFrag);

		const rightTree = this.merge(rightFrag, originalRight);
		out.left = root;
		out.right = rightTree;
	}

	private merge(a: PieceTreeNode | null, b: PieceTreeNode | null): PieceTreeNode | null {
		if (!a) {
			return b;
		}
		if (!b) {
			return a;
		}
		if (a.prio < b.prio) {
			a.right = this.merge(a.right, b);
			this.recalc(a);
			return a;
		}
		b.left = this.merge(a, b.left);
		this.recalc(b);
		return b;
	}

	private leftmostNode(root: PieceTreeNode): PieceTreeNode {
		let node = root;
		while (node.left) {
			node = node.left;
		}
		return node;
	}

	private rightmostNode(root: PieceTreeNode): PieceTreeNode {
		let node = root;
		while (node.right) {
			node = node.right;
		}
		return node;
	}

	private mergeAdjacent(a: PieceTreeNode | null, b: PieceTreeNode | null): PieceTreeNode | null {
		if (!a) {
			return b;
		}
		if (!b) {
			return a;
		}

		let left = a;
		let right = b;
		while (left && right) {
			const last = this.rightmostNode(left);
			const first = this.leftmostNode(right);
			if (last.buf !== first.buf || last.start + last.len !== first.start) {
				break;
			}

			const leftCut = left.sumLen - last.len;
			this.split(left, leftCut, this.mergeSplit1);
			this.split(right, first.len, this.mergeSplit2);
			const leftRest = this.mergeSplit1.left;
			const lastNode = this.mergeSplit1.right!;
			const firstNode = this.mergeSplit2.left!;
			const rightRest = this.mergeSplit2.right;

			assert(!lastNode.left && !lastNode.right, '[PieceTreeBuffer] mergeAdjacent expected isolated lastNode');
			assert(!firstNode.left && !firstNode.right, '[PieceTreeBuffer] mergeAdjacent expected isolated firstNode');
			assert(lastNode.startLine + lastNode.lf === firstNode.startLine, '[PieceTreeBuffer] mergeAdjacent startLine mismatch');

			lastNode.len += firstNode.len;
			lastNode.lf += firstNode.lf;
			this.recalc(lastNode);
			firstNode.left = null;
			firstNode.right = null;
			this.free.push(firstNode);

			left = this.merge(leftRest, lastNode);
			right = rightRest;
			if (!right) {
				return left;
			}
		}
		return this.merge(left, right);
	}

	private findOffsetOfNthLF(nth: number): number {
		let node = this.root;
		let base = 0;
		while (node) {
			const left = node.left;
			const leftLF = left ? left.sumLF : 0;
			if (nth < leftLF) {
				node = left;
				continue;
			}
			base += left ? left.sumLen : 0;
			nth -= leftLF;

			if (nth < node.lf) {
				const block = this.buffers[node.buf];
				const absLine = node.startLine + nth;
				const newlinePosInBuf = block.lineStarts[absLine + 1] - 1;
				return base + (newlinePosInBuf - node.start);
			}

			base += node.len;
			nth -= node.lf;
			node = node.right;
		}
		throw new Error('[PieceTreeBuffer] nth LF out of range');
	}

	private countLFBefore(offset: number): number {
		let node = this.root;
		let pos = offset;
		let accLF = 0;
		while (node) {
			const left = node.left;
			const leftLen = left ? left.sumLen : 0;
			if (pos < leftLen) {
				node = left;
				continue;
			}
			pos -= leftLen;
			accLF += left ? left.sumLF : 0;
			if (pos < node.len) {
				const block = this.buffers[node.buf];
				const lineAtPos = lineIndexAt(block, node.start + pos);
				accLF += lineAtPos - node.startLine;
				return accLF;
			}
			pos -= node.len;
			accLF += node.lf;
			node = node.right;
		}
		return accLF;
	}

	private appendRangeToParts(start: number, end: number, parts: string[]): void {
		const root = this.root;
		if (!root) {
			return;
		}
		const stackN = this.stackN;
		const stackB = this.stackB;
		const stackS = this.stackS;
		stackN.length = 0;
		stackB.length = 0;
		stackS.length = 0;

		stackN.push(root);
		stackB.push(0);
		stackS.push(0);

		while (stackN.length > 0) {
			const state = stackS.pop()!;
			const base = stackB.pop()!;
			const node = stackN.pop()!;
			if (state === 0) {
				const subtreeEnd = base + node.sumLen;
				if (subtreeEnd <= start) {
					continue;
				}
				if (base >= end) {
					continue;
				}

				const left = node.left;
				const leftLen = left ? left.sumLen : 0;
				const nodeStart = base + leftLen;
				const rightBase = nodeStart + node.len;

				const right = node.right;
				if (right) {
					stackN.push(right);
					stackB.push(rightBase);
					stackS.push(0);
				}
				stackN.push(node);
				stackB.push(base);
				stackS.push(1);
				if (left) {
					stackN.push(left);
					stackB.push(base);
					stackS.push(0);
				}
				continue;
			}

			const left = node.left;
			const leftLen = left ? left.sumLen : 0;
			const nodeStart = base + leftLen;
			const nodeEnd = nodeStart + node.len;
			if (nodeEnd <= start) {
				continue;
			}
			if (nodeStart >= end) {
				continue;
			}
			const segStart = start > nodeStart ? start - nodeStart : 0;
			const segEnd = end < nodeEnd ? end - nodeStart : node.len;
			const block = this.buffers[node.buf].value;
			parts.push(block.slice(node.start + segStart, node.start + segEnd));
		}
	}
}
