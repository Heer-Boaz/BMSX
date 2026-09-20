import type { LuaSourcePosition, LuaSourceRange } from './ast';
import { LuaSourceLayout, positionInText, type LuaSourceUnit, type LuaSourceUnitPlacement } from './source_layout';
import type { LuaSourceLayoutCursor } from './source_layout_cursor';
import type { LuaTokenSequence } from './token_sequence';

/**
 * UTF-16 endpoints relative to one syntax occurrence. End is inclusive, as in
 * LuaSourceRange; a missing node or EOF can name a point at the source end.
 */
export type LuaSyntaxSpan = {
	readonly unit: LuaSourceUnit;
	readonly start: number;
	readonly end: number;
};

type LocationBacking = {
	readonly kind: 'source';
	readonly source: string;
	readonly units: readonly LuaSourceUnitPlacement[];
	lineStarts: readonly number[] | undefined;
	layout: LuaSourceLayout | undefined;
} | {
	readonly kind: 'layout';
	readonly layout: LuaSourceLayout;
	cursor: LuaSourceLayoutCursor | undefined;
};

/** Presentation belongs to a source generation, never to a reusable node. */
export class LuaSourceLocations {
	private readonly ranges = new WeakMap<LuaSyntaxSpan, LuaSourceRange>();

	private constructor(
		public readonly path: string,
		private readonly backing: LocationBacking,
		private readonly origins: Map<LuaSourceUnit, number>,
	) {}

	/** Takes the fresh parser's origins directly; no suffix copy or AST conversion. */
	public static fromSource(path: string, source: string, units: readonly LuaSourceUnitPlacement[], origins: Map<LuaSourceUnit, number>): LuaSourceLocations {
		return new LuaSourceLocations(path, { kind: 'source', source, units, lineStarts: undefined, layout: undefined }, origins);
	}

	/** Standalone lexical consumers own the same relative blocks without an AST. */
	public static fromLexical(path: string, source: string, tokens: LuaTokenSequence): LuaSourceLocations {
		const units = [...tokens.placements()];
		const origins = new Map<LuaSourceUnit, number>();
		for (const placement of units) origins.set(placement.unit, placement.offset);
		return LuaSourceLocations.fromSource(path, source, units, origins);
	}

	/** An edited generation owns only its new layout, never old absolute caches. */
	public static fromLayout(path: string, layout: LuaSourceLayout): LuaSourceLocations {
		return new LuaSourceLocations(path, { kind: 'layout', layout, cursor: undefined }, new Map());
	}

	/** The persistent edit index is not required by one-shot parse/bind/compile. */
	public get layout(): LuaSourceLayout {
		const backing = this.backing;
		if (backing.kind === 'layout') return backing.layout;
		if (backing.layout === undefined) backing.layout = LuaSourceLayout.create(backing.source, backing.units);
		return backing.layout;
	}

	/** Source-ordered occurrences, including skipped recovery units, at the storage boundary. */
	public *unitPlacements(): Iterable<LuaSourceUnitPlacement> {
		if (this.backing.kind === 'source') {
			yield* this.backing.units;
			return;
		}
		for (const cursor = this.backing.layout.cursor(); cursor.current !== undefined; cursor.next()) {
			if (cursor.current.kind === 'unit') yield { unit: cursor.current.unit, offset: cursor.offset };
		}
	}

	public offset(unit: LuaSourceUnit, relativeOffset: number): number {
		if (this.backing.kind === 'source') return this.origins.get(unit)! + relativeOffset;
		let origin = this.origins.get(unit);
		if (origin === undefined) {
			origin = this.backing.layout.unitOffset(unit);
			this.origins.set(unit, origin);
		}
		return origin + relativeOffset;
	}

	public position(unit: LuaSourceUnit, relativeOffset: number): LuaSourcePosition {
		return this.positionAt(this.offset(unit, relativeOffset));
	}

	public offsetAt(position: LuaSourcePosition): number {
		const backing = this.backing;
		if (backing.kind === 'layout') return backing.layout.offsetAt(position);
		return (position.line === 1 ? 0 : this.sourceLineStarts(backing)[position.line - 2]) + position.column - 1;
	}

	private sourceLineStarts(backing: Extract<LocationBacking, { kind: 'source' }>): readonly number[] {
		if (backing.lineStarts === undefined) {
			const starts: number[] = [];
			for (let index = backing.source.indexOf('\n'); index !== -1; index = backing.source.indexOf('\n', index + 1)) starts.push(index + 1);
			backing.lineStarts = starts;
		}
		return backing.lineStarts;
	}

	public positionAt(offset: number): LuaSourcePosition {
		const backing = this.backing;
		if (backing.kind === 'source') {
			return positionInText(this.sourceLineStarts(backing), offset, 1, 1);
		}
		if (backing.cursor === undefined || offset < backing.cursor.offset) backing.cursor = backing.layout.cursor(offset);
		return backing.cursor.positionAt(offset);
	}

	/** Compiler execution-point grouping relies on range identity within a generation. */
	public range(span: LuaSyntaxSpan): LuaSourceRange {
		let range = this.ranges.get(span);
		if (range === undefined) {
			const origin = this.offset(span.unit, 0);
			range = { path: this.path, start: this.positionAt(origin + span.start), end: this.positionAt(origin + span.end) };
			this.ranges.set(span, range);
		}
		return range;
	}
}
