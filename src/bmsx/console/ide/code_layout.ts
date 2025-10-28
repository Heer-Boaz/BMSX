import { clamp } from '../../utils/utils';
import type { ConsoleEditorFont } from '../editor_font';
import { analyzeLuaSemantics, highlightLine as highlightLineExternal } from './syntax_highlight';
import type { LuaSemanticDefinition } from './syntax_highlight';
import type {
	CachedHighlight,
	HighlightLine,
	VisualLineSegment,
} from './types';

interface VisualLinesContext {
	lines: readonly string[];
	wordWrapEnabled: boolean;
	scrollRow: number;
	documentVersion: number;
	computeWrapWidth(): number;
}

interface SliceResult {
	text: string;
	colors: number[];
	startDisplay: number;
	endDisplay: number;
}

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
	private semanticAnnotations: ReturnType<typeof analyzeLuaSemantics> | null = null;
	private semanticLinesRef: readonly string[] | null = null;
	private semanticVersion = -1;
	private semanticSignature = 0;
	private nextSemanticSignature = 1;

	constructor(private readonly font: ConsoleEditorFont, options?: { maxHighlightCache?: number }) {
		this.maxHighlightCache = options?.maxHighlightCache ?? 2048;
	}

	public invalidateHighlight(row: number): void {
		this.highlightCache.delete(row);
	}

	public invalidateAllHighlights(): void {
		this.highlightCache.clear();
		this.semanticAnnotations = null;
		this.semanticLinesRef = null;
		this.semanticVersion = -1;
		this.semanticSignature = 0;
	}

	public getCachedHighlight(lines: readonly string[], row: number, documentVersion: number): CachedHighlight {
		this.ensureSemanticAnnotations(lines, documentVersion);
		const semantics = this.semanticAnnotations;
		const semanticSignature = this.semanticSignature;
		const source = lines[row] ?? '';
		const cached = this.highlightCache.get(row);
		if (cached && cached.src === source && cached.semanticSignature === semanticSignature) {
			return cached;
		}
		const highlight = highlightLineExternal(lines, row, semantics);
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
			this.rebuildVisualLines(context.lines, context.wordWrapEnabled, context.computeWrapWidth(), context.documentVersion);
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

	public getSemanticDefinitions(lines: readonly string[], documentVersion: number): readonly LuaSemanticDefinition[] | null {
		this.ensureSemanticAnnotations(lines, documentVersion);
		if (!this.semanticAnnotations) {
			return null;
		}
		return this.semanticAnnotations.definitions;
	}

	private clampScrollRow(scrollRow: number): number {
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		return clamp(scrollRow, 0, maxScrollRow);
	}

	private rebuildVisualLines(lines: readonly string[], wordWrapEnabled: boolean, wrapWidth: number, documentVersion: number): void {
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
			const entry = this.getCachedHighlight(lines, row, documentVersion);
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

	private ensureSemanticAnnotations(lines: readonly string[], version: number): void {
		if (this.semanticLinesRef === lines && this.semanticVersion === version) {
			return;
		}
		const annotations = analyzeLuaSemantics(lines);
		this.semanticAnnotations = annotations;
		this.semanticLinesRef = lines;
		this.semanticVersion = version;
		this.semanticSignature = this.nextSemanticSignature;
		this.nextSemanticSignature += 1;
		this.highlightCache.clear();
	}
}
