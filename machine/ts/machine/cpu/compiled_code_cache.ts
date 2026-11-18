import { COMPILED_BLOCK_MAX_INSTRUCTIONS, type CompiledBlock, type CompiledBlockExitSite } from './compiled_block';
import { DECODED_PAGE_WORDS, DecodedDispatchOp, type DecodedInstructionPage } from './execution_image';
import type { CompiledRegion } from './compiled_region';

/** Generated source code units, not executable bytes or an upfront allocation. */
const COMPILED_SOURCE_BUDGET = 4 * 1024 * 1024;

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
	public sourceUnits = 0;

	public retireRegion(page: DecodedInstructionPage, region: CompiledRegion): number {
		for (const block of region.entries) {
			for (const exit of block.exits) unlinkCompiledExit(exit);
			while (block.incoming !== null) unlinkCompiledExit(block.incoming);
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.CompiledWarm;
			this.entries[block.firstWord] = null;
			this.visits[block.firstWord] = 0;
		}
		this.sourceUnits -= region.sourceUnits;
		return region.sourceUnits;
	}

	public retire(page: DecodedInstructionPage, firstWord: number, endWord: number): number {
		let released = 0;
		const firstEntry = Math.max(0, firstWord - 2 * (COMPILED_BLOCK_MAX_INSTRUCTIONS + 1));
		const endEntry = Math.min(DECODED_PAGE_WORDS, endWord);
		for (let word = firstEntry; word < endEntry; ++word) {
			const block = this.entries[word];
			if (block === null || word + block.sourceWords <= firstWord) continue;
			// Every local label belongs to the same executable owner.
			released += this.retireRegion(page, block.region);
		}
		return released;
	}
}

/** Owns executable-cache accounting, including replaced execution images. */
export class CompiledCodeCache {
	private readonly pages = new Set<DecodedInstructionPage>();
	private sourceUnits = 0;

	public atCapacity(): boolean { return this.sourceUnits >= COMPILED_SOURCE_BUDGET; }

	public install(page: DecodedInstructionPage, region: CompiledRegion): void {
		const cache = page.compiledBlocks!;
		for (const block of region.entries) {
			cache.entries[block.firstWord] = block;
			page.dispatchOps[block.firstWord] = DecodedDispatchOp.Compiled;
		}
		cache.sourceUnits += region.sourceUnits;
		this.sourceUnits += region.sourceUnits;
		this.pages.add(page);
	}

	public retireRegion(page: DecodedInstructionPage, region: CompiledRegion): void {
		this.sourceUnits -= page.compiledBlocks!.retireRegion(page, region);
		if (page.compiledBlocks!.sourceUnits === 0) this.pages.delete(page);
	}

	public retirePage(page: DecodedInstructionPage, firstWord = 0, endWord = DECODED_PAGE_WORDS + 1): void {
		if (page.compiledBlocks === null || page.compiledBlocks.sourceUnits === 0) return;
		this.sourceUnits -= page.compiledBlocks.retire(page, firstWord, endWord);
		if (page.compiledBlocks.sourceUnits === 0) this.pages.delete(page);
	}

	public retireAll(): void {
		for (const page of this.pages) this.retirePage(page);
	}
}
