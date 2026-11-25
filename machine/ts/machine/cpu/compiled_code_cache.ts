import { COMPILED_BLOCK_MAX_INSTRUCTIONS, type CompiledBlock, type CompiledBlockExitSite } from './compiled_block';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type DecodedInstructionPage } from './execution_image';
import type { CompiledRegion } from './compiled_region';

// Measured in generated JavaScript source units, not executable bytes.
const COMPILED_SOURCE_BUDGET = 16 * 1024 * 1024;

function unlinkCompiledExit(exit: CompiledBlockExitSite): void {
	const target = exit.linkedBlock;
	if (target === null) return;
	if (exit.previousIncoming === null) target.incoming = exit.nextIncoming;
	else exit.previousIncoming.nextIncoming = exit.nextIncoming;
	if (exit.nextIncoming !== null) exit.nextIncoming.previousIncoming = exit.previousIncoming;
	exit.linkedBlock = exit.previousIncoming = exit.nextIncoming = null;
}

export function linkCompiledBlock(source: CompiledBlockExitSite, target: CompiledBlock): void {
	unlinkCompiledExit(source);
	source.linkedBlock = target;
	source.nextIncoming = target.incoming;
	if (target.incoming !== null) target.incoming.previousIncoming = source;
	target.incoming = source;
}

export class CompiledBlockPage {
	public readonly entries = new Array<CompiledBlock | null>(DECODED_PAGE_WORDS).fill(null);
	public readonly visits = new Uint8Array(DECODED_PAGE_WORDS);
	public readonly occupied = new Uint32Array(DECODED_PAGE_WORDS >>> 5);
	public entryCount = 0;
	// Each translation is charged only on the page of its first entry.
	public sourceUnits = 0;
}

/** Owns executable-cache accounting, including replaced execution images. */
export class CompiledCodeCache {
	private readonly regions = new Set<CompiledRegion>();
	private sourceUnits = 0;

	public constructor(private readonly capacity = COMPILED_SOURCE_BUDGET) {}

	public install(region: CompiledRegion, replaced: ReadonlySet<CompiledRegion>): boolean {
		if (region.sourceUnits > this.capacity) return false;
		for (const old of replaced) this.retireRegion(old);
		const retainedBudget = this.capacity - region.sourceUnits;
		if (this.sourceUnits > retainedBudget) {
			// Set iteration is publication order, including when its current item is deleted.
			for (const oldest of this.regions) {
				this.retireRegion(oldest);
				if (this.sourceUnits <= retainedBudget) break;
			}
		}
		for (const block of region.entries) {
			const page = block.page, cache = page.compiledBlocks!;
			cache.entries[block.firstWord] = block;
			cache.occupied[block.firstWord >>> 5] |= 1 << (block.firstWord & 31);
			++cache.entryCount;
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.Compiled;
		}
		region.entries[0].page.compiledBlocks!.sourceUnits += region.sourceUnits;
		this.sourceUnits += region.sourceUnits;
		this.regions.add(region);
		return true;
	}

	private retireRegion(region: CompiledRegion): void {
		for (const block of region.entries) {
			const page = block.page, cache = page.compiledBlocks!;
			for (const exit of block.exits) unlinkCompiledExit(exit);
			while (block.incoming !== null) unlinkCompiledExit(block.incoming);
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.CompiledWarm;
			cache.entries[block.firstWord] = null;
			cache.visits[block.firstWord] = 0;
			cache.occupied[block.firstWord >>> 5] &= ~(1 << (block.firstWord & 31));
			--cache.entryCount;
		}
		region.entries[0].page.compiledBlocks!.sourceUnits -= region.sourceUnits;
		this.sourceUnits -= region.sourceUnits;
		this.regions.delete(region);
	}

	public retirePage(page: DecodedInstructionPage, firstWord = 0, endWord = DECODED_PAGE_WORDS + 1): void {
		const cache = page.compiledBlocks;
		if (cache === null || cache.entryCount === 0) return;
		const firstEntry = Math.max(0, firstWord - 2 * (COMPILED_BLOCK_MAX_INSTRUCTIONS + 1));
		const endEntry = Math.min(DECODED_PAGE_WORDS, endWord);
		for (let group = firstEntry >>> 5; group * 32 < endEntry; ++group) {
			let mask = group === (firstEntry >>> 5) ? -1 << (firstEntry & 31) : -1;
			for (let bits = cache.occupied[group] & mask; bits !== 0; bits = cache.occupied[group] & mask) {
				const low = bits & -bits, word = group * 32 + 31 - Math.clz32(low);
				if (word >= endEntry) return;
				const block = cache.entries[word]!;
				if (word + block.sourceWords > firstWord) this.retireRegion(block.region);
				mask &= ~low;
			}
		}
	}

	public retireAll(): void {
		for (const region of this.regions) this.retireRegion(region);
	}
}
