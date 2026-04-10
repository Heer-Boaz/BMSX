import { PieceTreeBuffer } from '../src/bmsx/ide/text/piece_tree_buffer';

type MutablePos = { row: number; column: number };

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

class XorShift32 {
	private state: number;

	public constructor(seed: number) {
		this.state = seed | 0;
	}

	public nextU32(): number {
		let x = this.state | 0;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.state = x;
		return x >>> 0;
	}

	public nextInt(maxExclusive: number): number {
		return this.nextU32() % maxExclusive;
	}

	public nextBool(trueEvery: number): boolean {
		return (this.nextU32() % trueEvery) === 0;
	}
}

function countNewlines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text.charCodeAt(i) === 10) {
			count += 1;
		}
	}
	return count;
}

function randomChunk(rng: XorShift32, maxLen: number): string {
	const len = rng.nextInt(maxLen + 1);
	if (len === 0) {
		return '';
	}
	const chars: string[] = new Array(len);
	for (let i = 0; i < len; i += 1) {
		if (rng.nextBool(12)) {
			chars[i] = '\n';
			continue;
		}
		const v = rng.nextU32();
		const which = v & 7;
		if (which === 0) {
			chars[i] = '\t';
			continue;
		}
		if (which === 1) {
			chars[i] = ' ';
			continue;
		}
		const alpha = (v >>> 3) % 52;
		chars[i] = alpha < 26
			? String.fromCharCode(97 + alpha)
			: String.fromCharCode(65 + (alpha - 26));
	}
	return chars.join('');
}

function verifyBuffer(buf: PieceTreeBuffer, baseline: string, rng: XorShift32, tmpPos: MutablePos): void {
	const text = buf.getText();
	assert(text === baseline, `getText mismatch (got=${text.length}, expected=${baseline.length})`);

	const expectedLineCount = countNewlines(baseline) + 1;
	assert(buf.getLineCount() === expectedLineCount, `lineCount mismatch (got=${buf.getLineCount()}, expected=${expectedLineCount})`);

	const expectedLines = baseline.split('\n');
	assert(expectedLines.length === expectedLineCount, 'baseline split lineCount mismatch');

	const lineSamples = Math.min(200, expectedLineCount);
	for (let i = 0; i < lineSamples; i += 1) {
		const row = rng.nextInt(expectedLineCount);
		const expected = expectedLines[row];
		const got = buf.getLineContent(row);
		assert(got === expected, `getLineContent mismatch at row=${row}`);
	}

	const rangeSamples = Math.min(200, Math.max(1, baseline.length + 1));
	for (let i = 0; i < rangeSamples; i += 1) {
		const a = rng.nextInt(baseline.length + 1);
		const b = rng.nextInt(baseline.length + 1);
		const start = a < b ? a : b;
		const end = a < b ? b : a;
		const expected = baseline.slice(start, end);
		const got = buf.getTextRange(start, end);
		assert(got === expected, `getTextRange mismatch at ${start}..${end}`);
	}

	const offsetSamples = Math.min(200, Math.max(1, baseline.length + 1));
	for (let i = 0; i < offsetSamples; i += 1) {
		const offset = rng.nextInt(baseline.length + 1);
		buf.positionAt(offset, tmpPos);
		const resolved = buf.offsetAt(tmpPos.row, tmpPos.column);
		assert(resolved === offset, `offsetAt/positionAt mismatch at offset=${formatNumberAsHex(offset)} row=${tmpPos.row} column=${tmpPos.column} (got ${formatNumberAsHex(resolved)})`);
	}

	if (expectedLineCount > 1) {
		const newlineSamples = Math.min(200, expectedLineCount - 1);
		for (let i = 0; i < newlineSamples; i += 1) {
			const row = rng.nextInt(expectedLineCount - 1);
			const newlineOffset = buf.getLineEndOffset(row);
			assert(baseline.charCodeAt(newlineOffset) === 10, `expected newline at row=${row} offset=${newlineOffset}`);
		}
	}
}

function runSanity(): void {
	const rng = new XorShift32(0xC0FFEE);
	const buf = new PieceTreeBuffer('');
	let baseline = '';
	const tmpPos: MutablePos = { row: 0, column: 0 };

	const opCount = 10_000;
	for (let i = 0; i < opCount; i += 1) {
		const kind = baseline.length === 0 ? 0 : rng.nextInt(3);

		if (kind === 0) {
			const text = randomChunk(rng, 12);
			const offset = rng.nextInt(baseline.length + 1);
			buf.insert(offset, text);
			baseline = baseline.slice(0, offset) + text + baseline.slice(offset);
		} else if (kind === 1) {
			const offset = rng.nextInt(baseline.length);
			const maxLen = Math.min(24, baseline.length - offset);
			const len = 1 + rng.nextInt(maxLen);
			buf.delete(offset, len);
			baseline = baseline.slice(0, offset) + baseline.slice(offset + len);
		} else {
			const offset = rng.nextInt(baseline.length);
			const maxLen = Math.min(24, baseline.length - offset);
			const len = rng.nextInt(maxLen + 1);
			const text = randomChunk(rng, 12);
			buf.replace(offset, len, text);
			baseline = baseline.slice(0, offset) + text + baseline.slice(offset + len);
		}

		if (i % 100 === 0) {
			verifyBuffer(buf, baseline, rng, tmpPos);
		}
	}

	verifyBuffer(buf, baseline, rng, tmpPos);
	console.log(`[piece_tree_sanity] OK (${opCount} ops, len=${baseline.length}, lines=${buf.getLineCount()})`);
}

function runBench(): void {
	const rng = new XorShift32(0xBADC0DE);
	const buf = new PieceTreeBuffer('');
	let len = 0;
	const insertCount = 100_000;
	const deleteCount = 100_000;

	const start = process.hrtime.bigint();
	for (let i = 0; i < insertCount; i += 1) {
		const offset = len === 0 ? 0 : rng.nextInt(len + 1);
		const textLen = 1 + rng.nextInt(8);
		let text = '';
		for (let j = 0; j < textLen; j += 1) {
			text += String.fromCharCode(97 + (rng.nextU32() % 26));
		}
		buf.insert(offset, text);
		len += text.length;
	}
	const mid = process.hrtime.bigint();
	for (let i = 0; i < deleteCount; i += 1) {
		if (len === 0) {
			break;
		}
		const offset = rng.nextInt(len);
		const maxLen = Math.min(16, len - offset);
		const deleteLen = 1 + rng.nextInt(maxLen);
		buf.delete(offset, deleteLen);
		len -= deleteLen;
	}
	const end = process.hrtime.bigint();

	const insertMs = Number(mid - start) / 1_000_000;
	const deleteMs = Number(end - mid) / 1_000_000;
	console.log(`[piece_tree_bench] insert ${insertCount}: ${insertMs.toFixed(1)}ms`);
	console.log(`[piece_tree_bench] delete ${deleteCount}: ${deleteMs.toFixed(1)}ms`);
	console.log(`[piece_tree_bench] final len=${len}, nodes=${buf.getNodeCount()}, buffers=${buf.getBufferCount()}`);
}

const args = process.argv.slice(2);
if (args.includes('--bench')) {
	runBench();
} else {
	runSanity();
}

function formatNumberAsHex(resolved: any) {
	throw new Error('Function not implemented.');
}

