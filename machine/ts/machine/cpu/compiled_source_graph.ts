import { nextSetBit } from '../../common/bitset';
import { INSTRUCTION_BYTES } from '../../spec/blua32/instruction_format';
import { COMPILED_BLOCK_MAX_INSTRUCTIONS, compiledBlockEndsBlock, compiledBlockHasContinuation, type CompiledBlockSource } from './compiled_block';
import { COMPILED_VERSION_MAX_PAGES, DECODED_PAGE_SHIFT, DECODED_PAGE_WORDS, type DecodedInstructionPage } from './execution_image';

export const enum SourceWord { Queued = 1, Root = 2, Available = 4 }
const WINDOW_WORDS = COMPILED_VERSION_MAX_PAGES * DECODED_PAGE_WORDS;

// CPU-local numeric workspace. No execution image, page or retired region is
// retained between compilations. The worklist contains each physical head once.
export class CompiledSourceGraph {
	public readonly flags = new Uint8Array(WINDOW_WORDS);
	public readonly pending = new Uint16Array(WINDOW_WORDS);
	public readonly skipWidths = new Uint8Array(WINDOW_WORDS);
	private readonly leaders = new Uint32Array(WINDOW_WORDS >>> 5);
	// Page-local entry word plus one. Zero means no resident source covers it.
	public readonly owners = new Uint16Array(WINDOW_WORDS);
	public pendingCount = 0;
	private basePc = 0;
	private first = 0;
	private end = 0;

	public begin(basePc: number, first: number, end: number): void {
		this.basePc = basePc;
		this.first = first;
		this.end = end;
		this.pendingCount = 0;
		this.flags.fill(0, first, end);
		this.leaders.fill(0, first >>> 5, (end + 31) >>> 5);
	}

	public enqueue(pc: number, leader: boolean, root = false): void {
		const word = (pc - this.basePc) / INSTRUCTION_BYTES;
		if (word < this.first || word >= this.end) return;
		const flags = this.flags[word];
		if (leader || flags & SourceWord.Queued) this.leaders[word >>> 5] |= 1 << (word & 31);
		this.flags[word] = flags | SourceWord.Queued | (root ? SourceWord.Root : 0);
		if (!(flags & SourceWord.Queued)) {
			this.skipWidths[word] = 0;
			this.pending[this.pendingCount++] = word;
		}
	}

	public indexOwners(pages: readonly DecodedInstructionPage[]): void {
		this.owners.fill(0, this.first, this.end);
		for (let index = 0; index < pages.length; ++index) {
			const cache = pages[index].compiledBlocks;
			if (cache === null) continue;
			const base = index * DECODED_PAGE_WORDS, end = Math.min(this.end - base, DECODED_PAGE_WORDS);
			for (let entry = nextSetBit(cache.occupied, 0, end); entry < end; entry = nextSetBit(cache.occupied, entry + 1, end)) {
				const block = cache.entries[entry]!;
				this.owners.fill(entry + 1, Math.max(this.first, base + entry), base + Math.min(entry + block.sourceWords, end));
			}
		}
	}

	public plan(pages: readonly DecodedInstructionPage[]): CompiledBlockSource[] {
		const plans: CompiledBlockSource[] = [];
		for (let head = nextSetBit(this.leaders, this.first, this.end); head < this.end;
			head = nextSetBit(this.leaders, head + 1, this.end)) {
			if (!(this.flags[head] & SourceWord.Available)) continue;
			const page = pages[head >>> DECODED_PAGE_SHIFT], first = head & (DECODED_PAGE_WORDS - 1), base = head - first;
			let cursor = first, count = 0;
			for (;;) {
				++count;
				const successor = cursor + page.widths[cursor], index = base + successor;
				if (compiledBlockEndsBlock(page.ops[cursor], page.b[cursor]) || successor >= DECODED_PAGE_WORDS
					|| index >= this.end || !(this.flags[index] & SourceWord.Available)
					|| (this.leaders[index >>> 5] & (1 << (index & 31)))) break;
				if (count === COMPILED_BLOCK_MAX_INSTRUCTIONS) {
					this.leaders[index >>> 5] |= 1 << (index & 31);
					break;
				}
				cursor = successor;
			}
			const end = cursor + page.widths[cursor];
			let segment = first;
			for (let word = first; word < end; word += page.widths[word]) {
				const next = word + page.widths[word], final = next === end;
				if (!final && !compiledBlockHasContinuation(page.ops[word], page.b[word])) continue;
				plans.push({ page, firstWord: segment, endWord: next, pc: (this.basePc + (base + segment) * INSTRUCTION_BYTES) >>> 0,
					skippedInstructionWidth: final ? this.skipWidths[base + cursor] : 0, fallthrough: !final });
				segment = next;
			}
		}
		return plans;
	}
}
