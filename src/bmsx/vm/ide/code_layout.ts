import type { TimerHandle } from '../../platform/platform';
import { clamp } from '../../utils/clamp';
import { highlightTextLine as highlightTextLineExternal } from './syntax_highlight';
import { type LuaSemanticModel, type SemanticAnnotations, type SymbolKind, type TokenAnnotation } from './semantic_model';
import { LuaSemanticWorkspace } from './semantic_model';
import type { LuaDefinitionInfo } from '../../lua/lua_ast';
import type { CachedHighlight, HighlightLine, VisualLineSegment } from './types';
import { scheduleIdeOnce } from './background_tasks';
import { VMEditorFont } from '../editor_font';
import { getTextSnapshot, splitText } from './source_text';
import type { TextBuffer } from './text_buffer';

interface VisualLinesContext {
	buffer: TextBuffer;
	wordWrapEnabled: boolean;
	scrollRow: number;
	documentVersion: number;
	chunkName: string;
	computeWrapWidth(): number;
	estimatedVisibleRowCount?: number;
}

interface SliceResult {
	text: string;
	colors: number[];
	startDisplay: number;
	endDisplay: number;
}

type BuiltinIdentifierSnapshot = { epoch: number; ids: Iterable<string> };

type PendingSemanticUpdate = {
	version: number;
	chunkName: string;
	requestId: number;
	buffer: TextBuffer;
	source?: string;
	lines?: readonly string[];
};

/**
 * VMCodeLayout owns syntax highlight caching and visual line layout for the cart editor.
 * VMCartEditor delegates expensive computations here so the orchestrator stays lean.
 */
export class VMCodeLayout {
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache: number;
	private visualLines: VisualLineSegment[] = [];
	private rowToFirstVisualLine: number[] = [];
	private visualLinesDirty = true;
	private semanticModel: LuaSemanticModel = null;
	private semanticVersion = -1;
	private semanticChunkName: string = null;
	private semanticBuffer: TextBuffer = null;
	private readonly semanticDebounceMs: number;
	private readonly clockNow: () => number;
	private readonly getBuiltinIdentifiers: () => BuiltinIdentifierSnapshot;
	private pendingSemantic: PendingSemanticUpdate = null;
	// private inFlightSemantic: PendingSemanticUpdate = null;
	private semanticDueAtMs: number = null;
	private semanticUpdateScheduled = false;
	private annotationRowSig: Uint32Array = null;
	private nextSemanticRequestId = 1;
	private semanticDispatchHandle: TimerHandle = null;
	private lastHotRowRange: { start: number; end: number } = null;
	private lastHotGuardRows = 0;
	private readonly viewportRowMargin = 64;
	private readonly averageCharAdvance: number;
	private rowVisualLineCounts: number[] = [];
	private lastViewportRowEstimate = 120;
	private semanticTimer: TimerHandle = null;
	private lastSemanticError: string = null;
	private lastSemanticErrorVersion = -1;
	private lastSemanticErrorChunk: string = null;
	private builtinEpoch = 0;
	private builtinIdentifiers: Iterable<string> = null;

	constructor(
		private readonly font: VMEditorFont,
		private readonly workspace: LuaSemanticWorkspace,
		options: { maxHighlightCache: number; semanticDebounceMs: number; clockNow: () => number; getBuiltinIdentifiers: () => BuiltinIdentifierSnapshot },
	) {
		this.maxHighlightCache = options.maxHighlightCache;
		this.semanticDebounceMs = Math.max(0, options.semanticDebounceMs);
		this.clockNow = options.clockNow;
		this.getBuiltinIdentifiers = options.getBuiltinIdentifiers;
		this.refreshBuiltinIdentifiers();
		const probeAdvance = this.font.advance('M');
		const fallbackAdvance = this.font.advance(' ');
		this.averageCharAdvance = Math.max(1, Number.isFinite(probeAdvance) && probeAdvance > 0 ? probeAdvance : (Number.isFinite(fallbackAdvance) && fallbackAdvance > 0 ? fallbackAdvance : 1));
	}

	private refreshBuiltinIdentifiers(): void {
		const snapshot = this.getBuiltinIdentifiers();
		if (snapshot.epoch !== this.builtinEpoch) {
			this.builtinEpoch = snapshot.epoch;
			this.builtinIdentifiers = snapshot.ids;

			// Force rebuikd: builtins influence highlight → thus segments too
			this.highlightCache.clear(); // Optional optimization (we could keep rows without builtin highlights)
			this.markVisualLinesDirty();
		} else {
			// ids can be the same; yet assigning is ok
			this.builtinIdentifiers = snapshot.ids;
		}
	}

	private scheduleSemanticUpdate(): void {
		if (this.semanticUpdateScheduled) {
			return;
		}
		const now = this.clockNow();
		const delay = this.semanticDueAtMs !== null ? clamp(this.semanticDueAtMs - now, 0, this.semanticDebounceMs) : 0;
		if (this.semanticTimer) {
			this.semanticTimer.cancel();
			this.semanticTimer = null;
		}
		this.semanticUpdateScheduled = true;
		this.semanticTimer = scheduleIdeOnce(delay, () => {
			this.semanticTimer = null;
			this.semanticUpdateScheduled = false;
			const pending = this.pendingSemantic;
			if (!pending) {
				return;
			}
			if (this.semanticDueAtMs !== null) {
				const current = this.clockNow();
				if (current < this.semanticDueAtMs) {
					this.scheduleSemanticUpdate();
					return;
				}
				this.semanticDueAtMs = null;
			}
			this.dispatchSemanticUpdate(pending, 'background');
		});
	}

	public invalidateLine(row: number): void {
		this.highlightCache.delete(row);
	}

	public invalidateHighlightsFromRow(row: number): void {
		if (this.highlightCache.size === 0) {
			return;
		}
		const threshold = Math.max(0, row);
		for (const key of Array.from(this.highlightCache.keys())) {
			if (key >= threshold) {
				this.highlightCache.delete(key);
			}
		}
	}

	public invalidateAllHighlights(): void {
		this.highlightCache.clear();
		this.semanticBuffer = null;
		this.semanticModel = null;
		this.semanticVersion = -1;
		this.semanticChunkName = null;
		this.lastSemanticError = null;
		this.lastSemanticErrorVersion = -1;
		this.lastSemanticErrorChunk = null;
		this.pendingSemantic = null;
		// this.inFlightSemantic = null;
		this.semanticDueAtMs = null;
		this.semanticUpdateScheduled = false;
		if (this.semanticTimer) {
			this.semanticTimer.cancel();
			this.semanticTimer = null;
		}
		this.annotationRowSig = null;
		this.lastHotRowRange = null;
		this.lastHotGuardRows = 0;
		this.rowVisualLineCounts = [];
	}

	public requestSemanticUpdate(buffer: TextBuffer, documentVersion: number, chunkName: string): void {
		this.ensureSemanticModel(buffer, documentVersion, chunkName, 'background');
	}

	public getCachedHighlight(buffer: TextBuffer, row: number): CachedHighlight {
		const annotations = this.semanticModel ? this.semanticModel.annotations : null;
		const builtinEpoch = this.builtinEpoch;
		const builtinIdentifiers = this.builtinIdentifiers;
		const textVersion = buffer.version;
		let rowSignature = 0;
		const signatures = this.annotationRowSig;
		if (signatures && row >= 0 && row < signatures.length) {
			rowSignature = signatures[row];
		}
		const cached = this.highlightCache.get(row);
		let lineSignature = -1;
		if (cached && cached.rowSignature === rowSignature && cached.builtinEpoch === builtinEpoch) {
			if (cached.textVersion === textVersion) {
				return cached;
			}
			lineSignature = buffer.getLineSignature(row);
			if (cached.lineSignature === lineSignature) {
				cached.textVersion = textVersion;
				return cached;
			}
		}
		const source = buffer.getLineContent(row);
		if (lineSignature === -1) {
			lineSignature = buffer.getLineSignature(row);
		}
		const lineAnnotations = annotations ? annotations[row] : undefined;
		const highlight = highlightTextLineExternal(source, lineAnnotations, builtinIdentifiers);
		const displayToColumn: number[] = new Array(highlight.text.length + 1);
		for (let index = 0; index < displayToColumn.length; index += 1) {
			displayToColumn[index] = 0;
		}
		for (let column = 0; column < source.length; column += 1) {
			const startDisplay = highlight.columnToDisplay[column];
			const endDisplay = highlight.columnToDisplay[column + 1];
			for (let display = startDisplay; display < endDisplay; display += 1) {
				displayToColumn[display] = column;
			}
		}
		displayToColumn[highlight.text.length] = source.length;
		const advancePrefix: number[] = new Array(highlight.text.length + 1);
		advancePrefix[0] = 0;
		for (let i = 0; i < highlight.text.length; i += 1) {
			advancePrefix[i + 1] = advancePrefix[i] + this.font.advance(highlight.text.charAt(i));
		}
		const entry: CachedHighlight = {
			src: source,
			hi: highlight,
			displayToColumn,
			advancePrefix,
			textVersion,
			lineSignature,
			builtinEpoch,
			rowSignature,
		};
		this.highlightCache.set(row, entry);
		while (this.highlightCache.size > this.maxHighlightCache) {
			const iterator = this.highlightCache.keys().next();
			if (iterator.done) {
				break;
			}
			const firstKey = iterator.value as number;
			this.highlightCache.delete(firstKey);
		}
		return entry;
	}

	public measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		const length = entry.hi.text.length;
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
			return highlight.text.length;
		}
		return highlight.columnToDisplay[column];
	}

	public sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): SliceResult {
		if (highlight.text.length === 0) {
			return { text: '', colors: [], startDisplay: 0, endDisplay: 0 };
		}
		const columnToDisplay = highlight.columnToDisplay;
		const clampedStart = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const startDisplay = columnToDisplay[clampedStart];
		const endDisplay = columnToDisplay[clampedEndColumn];
		const sliceColors = highlight.colors.slice(startDisplay, endDisplay);
		return {
			text: highlight.text.slice(startDisplay, endDisplay),
			colors: sliceColors,
			startDisplay,
			endDisplay,
		};
	}

	public markVisualLinesDirty(): void {
		this.visualLinesDirty = true;
	}

	public ensureVisualLines(context: VisualLinesContext): number {
		this.refreshBuiltinIdentifiers();
		const visibleRows = Math.max(1, context.estimatedVisibleRowCount ?? this.lastViewportRowEstimate);
		this.lastViewportRowEstimate = visibleRows;
		if (!this.visualLinesDirty && !this.viewportWithinHotWindow(context, visibleRows)) {
			this.visualLinesDirty = true;
		}
		if (this.visualLinesDirty) {
			this.rebuildVisualLines(
				context.buffer,
				context.wordWrapEnabled,
				context.computeWrapWidth(),
				context.scrollRow,
				visibleRows,
			);
			this.visualLinesDirty = false;
		}
		return this.clampScrollRow(context.scrollRow);
	}

	public getVisualLineCount(): number {
		return this.visualLines.length;
	}

	public visualIndexToSegment(index: number): VisualLineSegment {
		if (index < 0 || index >= this.visualLines.length) {
			return null;
		}
		return this.visualLines[index];
	}

	public positionToVisualIndex(buffer: TextBuffer, row: number, column: number): number {
		if (this.visualLines.length === 0) {
			return 0;
		}
		const safeRow = clamp(row, 0, buffer.getLineCount() - 1);
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

	public getLastSemanticError(): string {
		return this.lastSemanticError;
	}

	public getSemanticDefinitions(buffer: TextBuffer, documentVersion: number, chunkName: string): readonly LuaDefinitionInfo[] {
		this.ensureSemanticModel(buffer, documentVersion, chunkName, 'background');
		if (!this.semanticModel) {
			return null;
		}
		if (this.semanticVersion !== documentVersion || this.semanticChunkName !== chunkName) {
			return null;
		}
		return this.semanticModel.definitions;
	}

	private clampScrollRow(scrollRow: number): number {
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		return clamp(scrollRow, 0, maxScrollRow);
	}

	private rebuildVisualLines(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		wrapWidth: number,
		scrollRow: number,
		visibleRowEstimate: number,
	): void {
		const lineCount = buffer.getLineCount();
		if (lineCount === 0) {
			this.visualLines = [{
				row: 0,
				startColumn: 0,
				endColumn: 0,
			}];
			this.rowToFirstVisualLine = [0];
			this.rowVisualLineCounts = [1];
			this.lastHotRowRange = null;
			this.lastHotGuardRows = 0;
			return;
		}
		const needsFullRebuild = this.visualLines.length === 0
			|| this.rowToFirstVisualLine.length !== lineCount
			|| this.rowVisualLineCounts.length !== lineCount;
		if (needsFullRebuild) {
			this.rebuildAllVisualLines(buffer, wordWrapEnabled, wrapWidth);
			this.lastHotRowRange = { start: 0, end: lineCount - 1 };
			this.lastHotGuardRows = Math.max(8, Math.floor(visibleRowEstimate / 2));
			return;
		}
		const hotRows = this.computeHotRowWindow(lineCount, scrollRow, visibleRowEstimate);
		this.rebuildRowRange(buffer, wordWrapEnabled, wrapWidth, hotRows.start, hotRows.end);
		this.lastHotRowRange = hotRows;
		this.lastHotGuardRows = Math.max(8, Math.floor(visibleRowEstimate / 2));
	}

	private rebuildAllVisualLines(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		wrapWidth: number,
	): void {
		const lineCount = buffer.getLineCount();
		const segments: VisualLineSegment[] = [];
		const rowIndexLookup: number[] = new Array(lineCount).fill(-1);
		const counts: number[] = new Array(lineCount).fill(0);
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		const approxWrapColumns = !wordWrapEnabled || wrapWidth === Number.POSITIVE_INFINITY
			? Number.POSITIVE_INFINITY
			: Math.max(1, Math.floor(wrapWidth / Math.max(1, this.averageCharAdvance)));
		for (let row = 0; row < lineCount; row += 1) {
			rowIndexLookup[row] = segments.length;
			const entry = this.getCachedHighlight(buffer, row);
			const rowSegments = this.buildSegmentsForRow(entry.src, row, entry, wordWrapEnabled, effectiveWrapWidth, approxWrapColumns);
			segments.push(...rowSegments);
			counts[row] = rowSegments.length;
		}
		if (segments.length === 0) {
			segments.push({ row: 0, startColumn: 0, endColumn: 0 });
		}
		this.visualLines = segments;
		this.rowToFirstVisualLine = rowIndexLookup;
		this.rowVisualLineCounts = counts;
	}

	private rebuildRowRange(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		wrapWidth: number,
		startRow: number,
		endRow: number,
	): void {
		if (startRow > endRow) {
			return;
		}
		const lineCount = buffer.getLineCount();
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		const approxWrapColumns = !wordWrapEnabled || wrapWidth === Number.POSITIVE_INFINITY
			? Number.POSITIVE_INFINITY
			: Math.max(1, Math.floor(wrapWidth / Math.max(1, this.averageCharAdvance)));
		for (let row = startRow; row <= endRow; row += 1) {
			const startIndex = this.rowToFirstVisualLine[row];
			const oldCount = this.rowVisualLineCounts[row] ?? 0;
			const entry = this.getCachedHighlight(buffer, row);
			const rowSegments = this.buildSegmentsForRow(entry.src, row, entry, wordWrapEnabled, effectiveWrapWidth, approxWrapColumns);
			this.visualLines.splice(startIndex, oldCount, ...rowSegments);
			const newCount = rowSegments.length;
			this.rowVisualLineCounts[row] = newCount;
			this.rowToFirstVisualLine[row] = startIndex;
			const delta = newCount - oldCount;
			if (delta !== 0) {
				for (let adjust = row + 1; adjust < lineCount; adjust += 1) {
					this.rowToFirstVisualLine[adjust] = (this.rowToFirstVisualLine[adjust] ?? 0) + delta;
				}
			}
		}
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

	private findApproximateWrapBreak(lineLength: number, startColumn: number, approxColumns: number): number {
		if (approxColumns === Number.POSITIVE_INFINITY) {
			return lineLength;
		}
		return Math.min(lineLength, startColumn + approxColumns);
	}

	private buildSegmentsForRow(
		line: string,
		row: number,
		entry: CachedHighlight,
		wordWrapEnabled: boolean,
		effectiveWrapWidth: number,
		approxWrapColumns: number,
	): VisualLineSegment[] {
		if (!line || line.length === 0) {
			return [{ row, startColumn: 0, endColumn: 0 }];
		}
		const segments: VisualLineSegment[] = [];
		const length = line.length;
		let column = 0;
		while (column < length) {
			const nextBreak = wordWrapEnabled
				? (entry ? this.findWrapBreak(line, entry, column, effectiveWrapWidth)
					: this.findApproximateWrapBreak(length, column, approxWrapColumns))
				: length;
			const endColumn = Math.max(column + 1, Math.min(length, nextBreak));
			segments.push({ row, startColumn: column, endColumn });
			column = endColumn;
		}
		return segments;
	}

	public getSemanticModel(buffer: TextBuffer, documentVersion: number, chunkName: string): LuaSemanticModel {
		this.ensureSemanticModel(buffer, documentVersion, chunkName, 'background');
		return this.semanticModel;
	}

	private ensureSemanticModel(
		buffer: TextBuffer,
		version: number,
		chunkName: string,
		_mode: 'background',
	): void {
		if (this.semanticBuffer === buffer && this.semanticVersion === version && this.semanticChunkName === chunkName) {
			if (this.semanticModel) {
				return;
			}
			if (this.lastSemanticError && this.lastSemanticErrorVersion === version && this.lastSemanticErrorChunk === chunkName) {
				return;
			}
		}
		if (this.pendingSemantic && this.pendingSemantic.buffer === buffer && this.pendingSemantic.version === version && this.pendingSemantic.chunkName === chunkName) {
			return;
		}
		const pending = this.updatePendingSemantic(buffer, version, chunkName);
		// if (mode === 'force') {
		// 	this.semanticDueAtMs = null;
		// 	if (this.semanticTimer) {
		// 		this.semanticTimer.cancel();
		// 		this.semanticTimer = null;
		// 	}
		// 	this.semanticUpdateScheduled = false;
		// 	this.dispatchSemanticUpdate(pending, 'force');
		// 	return;
		// }
		if (this.semanticDebounceMs === 0) {
			this.semanticDueAtMs = null;
			if (this.semanticTimer) {
				this.semanticTimer.cancel();
				this.semanticTimer = null;
			}
			this.semanticUpdateScheduled = false;
			this.dispatchSemanticUpdate(pending, 'background');
			return;
		}
		const now = this.clockNow();
		if (this.semanticDueAtMs === null || this.semanticDueAtMs < now + this.semanticDebounceMs) {
			this.semanticDueAtMs = now + this.semanticDebounceMs;
		}
		if (this.semanticDueAtMs <= now) {
			this.semanticDueAtMs = null;
			if (this.semanticTimer) {
				this.semanticTimer.cancel();
				this.semanticTimer = null;
			}
			this.semanticUpdateScheduled = false;
			this.dispatchSemanticUpdate(pending, 'background');
			return;
		}
		this.scheduleSemanticUpdate();
	}

	private updatePendingSemantic(
		buffer: TextBuffer,
		version: number,
		chunkName: string,
	): PendingSemanticUpdate {
		this.lastSemanticError = null;
		this.lastSemanticErrorVersion = -1;
		this.lastSemanticErrorChunk = null;
		const current = this.pendingSemantic;
		if (current && current.buffer === buffer && current.version === version && current.chunkName === chunkName) {
			return current;
		}
		const pending: PendingSemanticUpdate = {
			version,
			chunkName,
			requestId: this.nextSemanticRequestId,
			buffer,
		};
		this.nextSemanticRequestId += 1;
		this.pendingSemantic = pending;
		return pending;
	}

	private materializeSemanticSource(pending: PendingSemanticUpdate): string {
		if (pending.source === undefined) {
			pending.source = getTextSnapshot(pending.buffer);
			pending.lines = splitText(pending.source);
		}
		return pending.source;
	}

	private dispatchSemanticUpdate(pending: PendingSemanticUpdate, strategy: 'background' | 'force'): void {
		this.semanticDueAtMs = null;
		this.materializeSemanticSource(pending);
		if (strategy === 'force') {
			this.pendingSemantic = null;
			this.applySemanticUpdateSync(pending);
			return;
		}
		this.pendingSemantic = pending;
		if (this.semanticDispatchHandle) {
			this.semanticDispatchHandle.cancel();
		}
		this.semanticDispatchHandle = scheduleIdeOnce(0, () => {
			this.semanticDispatchHandle = null;
			if (!this.pendingSemantic || this.pendingSemantic.requestId !== pending.requestId) {
				return;
			}
			this.pendingSemantic = null;
			this.applySemanticUpdateSync(pending);
		});
	}

	private applySemanticUpdateSync(pending: PendingSemanticUpdate): void {
		let model: LuaSemanticModel = null;
		let errorMessage: string = null;
		try {
			const source = this.materializeSemanticSource(pending);
			model = this.workspace.updateFile(pending.chunkName, source, pending.lines, null, pending.version);
		} catch (error) {
			model = null;
			errorMessage = error instanceof Error ? error.message : String(error);
		}
		const annotations = model ? model.annotations : null;
		this.finalizeSemanticUpdate(pending.buffer, model, pending.version, pending.chunkName, annotations, errorMessage);
	}

	private finalizeSemanticUpdate(
		buffer: TextBuffer,
		model: LuaSemanticModel,
		version: number,
		chunkName: string,
		annotations: SemanticAnnotations,
		errorMessage?: string,
	): void {
		this.semanticBuffer = buffer;
		this.semanticModel = model;
		this.semanticVersion = version;
		this.semanticChunkName = chunkName;
		this.semanticDueAtMs = null;
		this.pendingSemantic = null;
		if (errorMessage) {
			this.lastSemanticError = errorMessage;
			this.lastSemanticErrorVersion = version;
			this.lastSemanticErrorChunk = chunkName;
		} else {
			this.lastSemanticError = null;
			this.lastSemanticErrorVersion = -1;
			this.lastSemanticErrorChunk = null;
		}
		this.updateAnnotationSignatures(buffer, annotations);
		this.markVisualLinesDirty();
	}

	private updateAnnotationSignatures(buffer: TextBuffer, annotations: SemanticAnnotations): void {
		const lineCount = buffer.getLineCount();
		const previous = this.annotationRowSig;
		const next = new Uint32Array(lineCount);
		const annotationCount = annotations ? annotations.length : 0;
		for (let row = 0; row < lineCount; row += 1) {
			const hash = row < annotationCount ? this.hashAnnotationRow(annotations[row]) : 0;
			next[row] = hash;
			const cached = this.highlightCache.get(row);
			if (!cached) {
				continue;
			}
			if (previous && row < previous.length && previous[row] === hash) {
				cached.rowSignature = hash;
				continue;
			}
			this.highlightCache.delete(row);
		}
		if (previous && previous.length > lineCount) {
			for (const [row] of this.highlightCache) {
				if (row >= lineCount) {
					this.highlightCache.delete(row);
				}
			}
		}
		this.annotationRowSig = next;
	}

	private hashAnnotationRow(rowAnnotations: TokenAnnotation[]): number {
		if (!rowAnnotations || rowAnnotations.length === 0) {
			return 0;
		}
		let hash = rowAnnotations.length | 0;
		for (let index = 0; index < rowAnnotations.length; index += 1) {
			const annotation = rowAnnotations[index];
			let value = annotation.start | 0;
			value = (value * 31 + annotation.end) | 0;
			value = (value * 131 + this.hashSymbolKind(annotation.kind)) | 0;
			value ^= annotation.role === 'definition' ? 0x9e3779b9 : 0x7f4a7c15;
			hash ^= value;
			hash = (hash << 5) - hash;
		}
		return hash >>> 0;
	}

	private hashSymbolKind(kind: SymbolKind): number {
		switch (kind) {
			case 'parameter':
				return 1;
			case 'local':
				return 2;
			case 'function':
				return 3;
			case 'global':
				return 4;
			case 'tableField':
				return 5;
			case 'module':
				return 6;
			case 'type':
				return 7;
			case 'label':
				return 8;
			case 'keyword':
				return 9;
			default:
				return 0;
		}
	}

	private computeHotRowWindow(lineCount: number, scrollRow: number, visibleRows: number): { start: number; end: number } {
		if (lineCount === 0) {
			return { start: 0, end: -1 };
		}
		let startRow = 0;
		let endRow = lineCount - 1;
		const totalVisual = this.visualLines.length;
		if (totalVisual > 0) {
			const startSegment = this.visualIndexToSegment(clamp(scrollRow, 0, totalVisual - 1));
			const endSegment = this.visualIndexToSegment(clamp(scrollRow + Math.max(1, visibleRows), 0, totalVisual - 1));
			if (startSegment) {
				startRow = startSegment.row;
			}
			if (endSegment) {
				endRow = endSegment.row;
			}
		}
		const margin = Math.max(this.viewportRowMargin, visibleRows * 2);
		startRow = clamp(startRow - margin, 0, lineCount - 1);
		endRow = clamp(endRow + margin, 0, lineCount - 1);
		return { start: startRow, end: endRow };
	}

	private viewportWithinHotWindow(context: VisualLinesContext, visibleRows: number): boolean {
		const hot = this.lastHotRowRange;
		if (!hot || this.visualLines.length === 0) {
			return false;
		}
		const startSegment = this.visualLines[clamp(context.scrollRow, 0, this.visualLines.length - 1)];
		if (!startSegment) {
			return false;
		}
		const endVisual = clamp(context.scrollRow + Math.max(1, visibleRows) - 1, 0, this.visualLines.length - 1);
		const endSegment = this.visualLines[endVisual] ?? startSegment;
		const viewportStartRow = Math.min(startSegment.row, endSegment.row);
		const viewportEndRow = Math.max(startSegment.row, endSegment.row);
		const maxRow = this.rowToFirstVisualLine.length > 0 ? this.rowToFirstVisualLine.length - 1 : 0;
		const guardStart = hot.start === 0 ? 0 : this.lastHotGuardRows;
		const guardEnd = hot.end >= maxRow ? 0 : this.lastHotGuardRows;
		const guardedStart = Math.max(0, hot.start + guardStart);
		const guardedEnd = Math.max(guardedStart, hot.end - guardEnd);
		if (viewportStartRow < guardedStart) return false;
		if (viewportEndRow > guardedEnd) return false;
		return true;
	}
}
