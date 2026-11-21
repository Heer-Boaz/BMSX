import { COMPILED_BLOCK_MAX_INSTRUCTIONS, type CompiledBlock, type CompiledBlockExitSite } from './compiled_block';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type DecodedInstructionPage } from './execution_image';
import type { CompiledRegion } from './compiled_region';

/**
 * Generated source code units, not executable bytes or an upfront allocation.
 * Retiring every region is a last resort, so the budget holds the hot code of
 * a full game with room to spare.
 */
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
	public entryCount = 0;
	// Each translation is charged only on the page of its first entry.
	public sourceUnits = 0;
}

/** Owns executable-cache accounting, including replaced execution images. */
export class CompiledCodeCache {
	private readonly regions = new Set<CompiledRegion>();
	private sourceUnits = 0;

	public atCapacity(): boolean { return this.sourceUnits >= COMPILED_SOURCE_BUDGET; }

	public install(region: CompiledRegion): void {
		for (const block of region.entries) {
			const page = block.page, cache = page.compiledBlocks!;
			cache.entries[block.firstWord] = block;
			++cache.entryCount;
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.Compiled;
		}
		region.entries[0].page.compiledBlocks!.sourceUnits += region.sourceUnits;
		this.sourceUnits += region.sourceUnits;
		this.regions.add(region);
	}

	public retireRegion(region: CompiledRegion): void {
		for (const block of region.entries) {
			const page = block.page, cache = page.compiledBlocks!;
			for (const exit of block.exits) unlinkCompiledExit(exit);
			while (block.incoming !== null) unlinkCompiledExit(block.incoming);
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.CompiledWarm;
			cache.entries[block.firstWord] = null;
			cache.visits[block.firstWord] = 0;
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
		for (let word = firstEntry; word < endEntry; ++word) {
			const block = cache.entries[word];
			if (block !== null && word + block.sourceWords > firstWord) this.retireRegion(block.region);
		}
	}

	public retireAll(): void {
		for (const region of this.regions) this.retireRegion(region);
	}
}
