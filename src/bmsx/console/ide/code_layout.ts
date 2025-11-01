import { clamp } from '../../utils/utils.ts';
import type { ConsoleEditorFont } from '../editor_font';
import { highlightLine as highlightLineExternal } from './syntax_highlight';
import { type LuaSemanticModel } from './semantic_model.ts';
import { LuaSemanticWorkspace } from './semantic_workspace.ts';
import type { LuaDefinitionInfo } from '../../lua/ast.ts';
import type { CachedHighlight, HighlightLine, VisualLineSegment } from './types.ts';

interface VisualLinesContext {
	lines: readonly string[];
	wordWrapEnabled: boolean;
	scrollRow: number;
	documentVersion: number;
	chunkName: string;
	computeWrapWidth(): number;
}

interface SliceResult {
	text: string;
	colors: number[];
	startDisplay: number;
	endDisplay: number;
}

type PendingSemanticUpdate = {
	lines: readonly string[];
	version: number;
	chunkName: string;
	requestedAt: number;
};

/**
 * ConsoleCodeLayout owns syntax highlight caching and visual line layout for the cart editor.
 * ConsoleCartEditor delegates expensive computations here so the orchestrator stays lean.
 */
export class ConsoleCodeLayout {
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache: number;
	private visualLines: VisualLineSegment[] = [];
	private rowToFirstVisualLine: number[] = [];
	private visualLinesDirty = true;
	private semanticModel: LuaSemanticModel | null = null;
	private semanticLinesRef: readonly string[] | null = null;
	private semanticVersion = -1;
	private semanticChunkName: string | null = null;
	private semanticSignature = 0;
	private nextSemanticSignature = 1;
	private readonly semanticDebounceMs: number;
	private pendingSemantic: PendingSemanticUpdate | null = null;
	private lastSemanticUpdateMs = 0;

	constructor(
		private readonly font: ConsoleEditorFont,
		private readonly workspace: LuaSemanticWorkspace,
		options?: { maxHighlightCache?: number; semanticDebounceMs?: number },
	) {
		this.maxHighlightCache = options?.maxHighlightCache ?? 2048;
		this.semanticDebounceMs = Math.max(0, options?.semanticDebounceMs ?? 120);
	}

	public invalidateHighlight(row: number): void {
		this.highlightCache.delete(row);
	}

	public invalidateAllHighlights(): void {
		this.highlightCache.clear();
		this.semanticModel = null;
		this.semanticLinesRef = null;
		this.semanticVersion = -1;
		this.semanticChunkName = null;
		this.semanticSignature = 0;
		this.pendingSemantic = null;
		this.lastSemanticUpdateMs = 0;
	}

	public getCachedHighlight(lines: readonly string[], row: number, documentVersion: number, chunkName: string): CachedHighlight {
		this.ensureSemanticModel(lines, documentVersion, chunkName, false);
		const annotations = this.semanticModel?.annotations ?? null;
		const semanticSignature = this.semanticSignature;
		const source = lines[row] ?? '';
		const cached = this.highlightCache.get(row);
		if (cached && cached.src === source && cached.semanticSignature === semanticSignature) {
			return cached;
		}
		const highlight = highlightLineExternal(lines, row, annotations);
		const displayToColumn = new Array<number>(highlight.chars.length + 1).fill(0);
		for (let column = 0; column < source.length; column += 1) {
			const startDisplay = highlight.columnToDisplay[column];
			const endDisplay = highlight.columnToDisplay[column + 1];
			for (let display = startDisplay; display < endDisplay; display += 1) {
				displayToColumn[display] = column;
			}
		}
		displayToColumn[highlight.chars.length] = source.length;
		const advancePrefix: number[] = new Array(highlight.chars.length + 1);
		advancePrefix[0] = 0;
		for (let i = 0; i < highlight.chars.length; i += 1) {
			advancePrefix[i + 1] = advancePrefix[i] + this.font.advance(highlight.chars[i]);
		}
		const entry: CachedHighlight = {
			src: source,
			hi: highlight,
			displayToColumn,
			advancePrefix,
			semanticSignature,
		};
		this.highlightCache.set(row, entry);
		while (this.highlightCache.size > this.maxHighlightCache) {
			const firstKey = this.highlightCache.keys().next().value as number | undefined;
			if (firstKey === undefined) {
				break;
			}
			this.highlightCache.delete(firstKey);
		}
		return entry;
	}

	public measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		const length = entry.hi.chars.length;
		if (length === 0) {
			return 0;
		}
		const clampedStart = clamp(startDisplay, 0, length);
		const clampedEnd = clamp(endDisplay, clampedStart, length);
		return entry.advancePrefix[clampedEnd] - entry.advancePrefix[clampedStart];
	}

	public columnToDisplay(highlight: HighlightLine, column: number): number {
		if (column <= 0) {
			return 0;
		}
		if (column >= highlight.columnToDisplay.length) {
			return highlight.chars.length;
		}
		return highlight.columnToDisplay[column];
	}

	public sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): SliceResult {
		if (highlight.chars.length === 0) {
			return { text: '', colors: [], startDisplay: 0, endDisplay: 0 };
		}
		const columnToDisplay = highlight.columnToDisplay;
		const clampedStart = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const startDisplay = columnToDisplay[clampedStart];
		const endDisplay = columnToDisplay[clampedEndColumn];
		const sliceChars = highlight.chars.slice(startDisplay, endDisplay);
		const sliceColors = highlight.colors.slice(startDisplay, endDisplay);
		return {
			text: sliceChars.join(''),
			colors: sliceColors,
			startDisplay,
			endDisplay,
		};
	}

	public markVisualLinesDirty(): void {
		this.visualLinesDirty = true;
	}

	public ensureVisualLines(context: VisualLinesContext): number {
		if (this.visualLinesDirty) {
			this.rebuildVisualLines(context.lines, context.wordWrapEnabled, context.computeWrapWidth(), context.documentVersion, context.chunkName);
			this.visualLinesDirty = false;
		}
		return this.clampScrollRow(context.scrollRow);
	}

	public getVisualLineCount(): number {
		return this.visualLines.length;
	}

	public visualIndexToSegment(index: number): VisualLineSegment | null {
		if (index < 0 || index >= this.visualLines.length) {
			return null;
		}
		return this.visualLines[index];
	}

	public positionToVisualIndex(lines: readonly string[], row: number, column: number): number {
		if (this.visualLines.length === 0) {
			return 0;
		}
		const safeRow = clamp(row, 0, lines.length - 1);
		const baseIndex = this.rowToFirstVisualLine[safeRow];
		if (!Number.isFinite(baseIndex) || baseIndex === undefined || baseIndex === -1) {
			return 0;
		}
		let index = baseIndex;
		while (index < this.visualLines.length) {
			const segment = this.visualLines[index];
			if (segment.row !== safeRow) {
				break;
			}
			if (column < segment.endColumn || segment.startColumn === segment.endColumn) {
				return index;
			}
			index += 1;
		}
		return Math.min(this.visualLines.length - 1, index - 1);
	}

	public getVisualLines(): readonly VisualLineSegment[] {
		return this.visualLines;
	}

	public getSemanticDefinitions(lines: readonly string[], documentVersion: number, chunkName: string): readonly LuaDefinitionInfo[] | null {
		this.ensureSemanticModel(lines, documentVersion, chunkName, true);
		if (!this.semanticModel) {
			return null;
		}
		return this.semanticModel.definitions;
	}

	private clampScrollRow(scrollRow: number): number {
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		return clamp(scrollRow, 0, maxScrollRow);
	}

	private rebuildVisualLines(lines: readonly string[], wordWrapEnabled: boolean, wrapWidth: number, documentVersion: number, chunkName: string): void {
		const lineCount = lines.length;
		if (lineCount === 0) {
			this.visualLines = [{
				row: 0,
				startColumn: 0,
				endColumn: 0,
			}];
			this.rowToFirstVisualLine = [0];
			return;
		}
		const segments: VisualLineSegment[] = [];
		const rowIndexLookup: number[] = new Array(lineCount).fill(-1);
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		for (let row = 0; row < lineCount; row += 1) {
			const line = lines[row];
			const entry = this.getCachedHighlight(lines, row, documentVersion, chunkName);
			const lineLength = line.length;
			if (rowIndexLookup[row] === -1) {
				rowIndexLookup[row] = segments.length;
			}
			if (lineLength === 0) {
				segments.push({ row, startColumn: 0, endColumn: 0 });
				continue;
			}
			let column = 0;
			while (column < lineLength) {
				const nextBreak = wordWrapEnabled
					? this.findWrapBreak(line, entry, column, effectiveWrapWidth)
					: lineLength;
				const endColumn = Math.max(column + 1, Math.min(lineLength, nextBreak));
				segments.push({ row, startColumn: column, endColumn });
				column = endColumn;
			}
		}
		if (segments.length === 0) {
			segments.push({ row: 0, startColumn: 0, endColumn: 0 });
		}
		this.visualLines = segments;
		this.rowToFirstVisualLine = rowIndexLookup;
	}

	private findWrapBreak(line: string, entry: CachedHighlight, startColumn: number, wrapWidth: number): number {
		if (wrapWidth === Number.POSITIVE_INFINITY) {
			return line.length;
		}
		let column = startColumn + 1;
		let lastBreak = startColumn;
		let lastBreakEnd = startColumn + 1;
		while (column <= line.length) {
			const width = this.measureColumns(entry, startColumn, column);
			if (width > wrapWidth) {
				if (lastBreak > startColumn) {
					return lastBreakEnd;
				}
				return column - 1;
			}
			if (column < line.length) {
				const ch = line.charAt(column);
				if (ch === ' ' || ch === '\t' || ch === '-') {
					lastBreak = column;
					let skip = column + 1;
					while (skip < line.length && line.charAt(skip) === ' ') {
						skip += 1;
					}
					lastBreakEnd = skip;
				}
			}
			column += 1;
		}
		return line.length;
	}

	private measureColumns(entry: CachedHighlight, startColumn: number, endColumn: number): number {
		const highlight = entry.hi;
		const startDisplay = this.columnToDisplay(highlight, startColumn);
		const endDisplay = this.columnToDisplay(highlight, endColumn);
		return this.measureRangeFast(entry, startDisplay, endDisplay);
	}

	public getSemanticModel(lines: readonly string[], documentVersion: number, chunkName: string): LuaSemanticModel | null {
		this.ensureSemanticModel(lines, documentVersion, chunkName, true);
		return this.semanticModel;
	}

	private ensureSemanticModel(
		lines: readonly string[],
		version: number,
		chunkName: string,
		force: boolean,
	): void {
		const sameChunk = this.semanticChunkName === chunkName;
		const sameVersion = this.semanticVersion === version;
		const sameLines = this.semanticLinesRef === lines;
		if (sameChunk && sameVersion && sameLines && this.semanticModel) {
			return;
		}
		const now = Date.now();
		const pending = this.updatePendingSemantic(lines, version, chunkName, now);
		const requireImmediate = force || !this.semanticModel || !sameChunk || !sameLines;
		if (!requireImmediate && this.semanticDebounceMs > 0) {
			const elapsedSinceRequest = now - pending.requestedAt;
			const elapsedSinceUpdate = this.lastSemanticUpdateMs > 0 ? now - this.lastSemanticUpdateMs : Number.POSITIVE_INFINITY;
			if (elapsedSinceRequest < this.semanticDebounceMs || elapsedSinceUpdate < this.semanticDebounceMs) {
				return;
			}
		}
		this.applySemanticUpdate(pending, now);
	}

	private updatePendingSemantic(
		lines: readonly string[],
		version: number,
		chunkName: string,
		now: number,
	): PendingSemanticUpdate {
		const current = this.pendingSemantic;
		if (
			current
			&& current.lines === lines
			&& current.version === version
			&& current.chunkName === chunkName
		) {
			return current;
		}
		const pending: PendingSemanticUpdate = {
			lines,
			version,
			chunkName,
			requestedAt: now,
		};
		this.pendingSemantic = pending;
		return pending;
	}

	private applySemanticUpdate(pending: PendingSemanticUpdate, timestampMs: number): void {
		const source = pending.lines.join('\n');
		let model: LuaSemanticModel | null = null;
		try {
			model = this.workspace.updateFile(pending.chunkName, source);
		} catch {
			model = null;
		}
		this.semanticModel = model;
		this.semanticLinesRef = pending.lines;
		this.semanticVersion = pending.version;
		this.semanticChunkName = pending.chunkName;
		this.semanticSignature = this.nextSemanticSignature;
		this.nextSemanticSignature += 1;
		this.highlightCache.clear();
		this.pendingSemantic = null;
		this.lastSemanticUpdateMs = timestampMs;
	}
}
