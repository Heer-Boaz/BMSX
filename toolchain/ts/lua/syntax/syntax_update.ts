import type { SourceChangeMap, SourceChangedSpan } from '../../text/source_changes';
import type { LuaChunk } from './ast';
import type { LuaLexicalUpdate } from './lexical_update';
import type { LuaSourceUnit, LuaSourceUnitPlacement } from './source_layout';
import { LuaSourceLocations } from './source_locations';
import type { LuaStatementSequence } from './statement_sequence';
import { LuaStatementReuse } from './statement_reuse';

/** One edited generation: lexical provenance, reused syntax and new placements. */
export class LuaSyntaxUpdate {
	public readonly origins = new Map<LuaSourceUnit, number>();
	public readonly statements: LuaStatementReuse;
	private readonly changes: readonly SourceChangedSpan[];
	private replacementIndex = 0;

	public constructor(
		private readonly previous: LuaChunk,
		private readonly source: string,
		changes: SourceChangeMap,
		private readonly lexical: LuaLexicalUpdate,
	) {
		this.changes = Array.from(changes.changes());
		this.statements = new LuaStatementReuse(previous);
		for (const replacement of lexical.replacements) {
			let offset = replacement.newStart;
			for (const block of replacement.blocks) {
				this.origins.set(block.unit, offset);
				for (const token of block.items) offset += token.width;
			}
		}
	}

	/** Only retained occurrences use the old owner; replaced occurrences are new. */
	public origin(unit: LuaSourceUnit): number {
		let origin = this.origins.get(unit);
		if (origin !== undefined) return origin;
		const old = this.previous.locations.offset(unit, 0);
		let low = 0, high = this.changes.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.changes[middle].oldEnd <= old) low = middle + 1;
			else high = middle;
		}
		const preceding = low === 0 ? undefined : this.changes[low - 1];
		origin = old + (preceding === undefined ? 0 : preceding.newEnd - preceding.oldEnd);
		this.origins.set(unit, origin);
		return origin;
	}

	/** Reads and consumed text must both fit inside retained lexical blocks. */
	public takeStatements(offset: number, context: number): LuaStatementSequence | undefined {
		const replacements = this.lexical.replacements;
		while (this.replacementIndex < replacements.length && offset >= replacements[this.replacementIndex].newEnd) this.replacementIndex++;
		const next = replacements[this.replacementIndex];
		if (next !== undefined && offset >= next.newStart) return undefined;
		const previous = this.replacementIndex === 0 ? undefined : replacements[this.replacementIndex - 1];
		const delta = previous === undefined ? 0 : previous.newEnd - previous.oldEnd;
		// An unchanged EOF is an observed point one beyond the final text unit.
		const readLimit = next === undefined ? this.previous.source.length + 1 : next.oldStart;
		return this.statements.take(offset - delta, readLimit, context);
	}

	public publish(units: readonly LuaSourceUnitPlacement[]): LuaSourceLocations {
		const builder = this.previous.locations.layout.edit();
		// Retire before text replacement: deletion owns its start markers, so
		// afterwards an occurrence might no longer be present in the layout.
		this.statements.retire(unit => builder.removeUnit(unit));
		for (const replacement of this.lexical.replacements) {
			const blocks = this.previous.tokens.blocks(replacement.oldBlockStart);
			for (let index = 0; index < replacement.oldBlockCount; index++) builder.removeUnit(blocks.next().value!.block.unit);
		}
		for (const change of this.changes) builder.replace(change.newStart, change.oldEnd - change.oldStart, this.source.slice(change.newStart, change.newEnd));
		for (const replacement of this.lexical.replacements) {
			for (const block of replacement.blocks) builder.insertUnit(this.origins.get(block.unit)!, block.unit);
		}
		for (const { unit, offset } of units) builder.insertUnit(offset, unit);
		return LuaSourceLocations.fromLayout(this.previous.locations.path, builder.snapshot());
	}
}
