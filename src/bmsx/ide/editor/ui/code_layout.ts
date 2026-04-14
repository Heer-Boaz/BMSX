import type { TimerHandle } from '../../../platform/platform';
import { clamp } from '../../../utils/clamp';
import { ScratchBuffer } from '../../../utils/scratchbuffer';
import { highlightTextLine as highlightTextLineExternal } from '../../language/lua/syntax_highlight';
import { highlightAemTextLine } from '../../language/aem/aem_syntax_highlight';
import { type LuaSemanticModel, type SemanticAnnotations, type SymbolKind, type TokenAnnotation } from '../contrib/intellisense/semantic_model';
import type { LuaDefinitionInfo } from '../../../lua/syntax/lua_ast';
import type { CachedHighlight, CodeTabMode, HighlightLine, VisualLineSegment } from '../../common/types';
import { scheduleIdeOnce } from '../../common/background_tasks';
import { EditorFont } from './view/editor_font';
import { getTextSnapshot, splitText } from '../text/source_text';
import { syncSemanticWorkspacePaths } from '../contrib/intellisense/semantic_workspace_sync';
import type { TextBuffer } from '../text/text_buffer';
import type { Position } from '../../common/types';

interface VisualLinesContext {
	buffer: TextBuffer;
	wordWrapEnabled: boolean;
	scrollRow: number;
	documentVersion: number;
	path: string;
	computeWrapWidth(): number;
	estimatedVisibleRowCount?: number;
}

interface SliceResult {
	startDisplay: number;
	endDisplay: number;
}

class FenwickPrefix {
	private tree: number[] = [];
	private treeSize = 0;

	public reset(size: number): void {
		this.treeSize = Math.max(0, size);
		this.tree.length = this.treeSize + 1;
		for (let i = 0; i < this.tree.length; i += 1) {
			this.tree[i] = 0;
		}
	}

	public resizeOrClear(size: number): void {
		if (this.treeSize !== size) {
			this.reset(size);
			return;
		}
		this.clear();
	}

	public clear(): void {
		for (let i = 0; i < this.tree.length; i += 1) {
			this.tree[i] = 0;
		}
	}

	public get length(): number {
		return this.treeSize;
	}

	public add(index: number, delta: number): void {
		let i = index + 1;
		while (i <= this.treeSize) {
			this.tree[i] += delta;
			i += i & -i;
		}
	}

	public set(index: number, value: number): void {
		const current = this.prefixSum(index + 1) - this.prefixSum(index);
		this.add(index, value - current);
	}

	public prefixSum(endExclusive: number): number {
		const clamped = clamp(endExclusive, 0, this.treeSize);
		let i = clamped;
		let sum = 0;
		while (i > 0) {
			sum += this.tree[i];
			i -= i & -i;
		}
		return sum;
	}

	public getTotal(): number {
		return this.prefixSum(this.treeSize);
	}
}

type VisualLineSegmentTarget = VisualLineSegment[] | ScratchBuffer<VisualLineSegment>;

type BuiltinIdentifierSnapshot = { epoch: number; ids: Iterable<string> };

type PendingSemanticUpdate = {
	version: number;
	path: string;
	requestId: number;
	buffer: TextBuffer;
	source?: string;
	lines?: readonly string[];
};

const createVisualLineSegment = (): VisualLineSegment => ({
	row: 0,
	startColumn: 0,
	endColumn: 0,
});

function ensureVisualLineSegment(target: VisualLineSegmentTarget, index: number): VisualLineSegment {
	if (target instanceof ScratchBuffer) {
		return target.get(index);
	}
	const existing = target[index];
	if (existing) {
		return existing;
	}
	const created = createVisualLineSegment();
	target[index] = created;
	return created;
}

/**
 * CodeLayout owns syntax highlight caching and visual line layout for the cart editor.
 * CartEditor delegates expensive computations here so the orchestrator stays lean.
 */
export class CodeLayout {
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache: number;
	private visualLines: VisualLineSegment[] = [];
	private visualLinesDirty = true;
	private semanticModel: LuaSemanticModel = null;
	private semanticVersion = -1;
	private semanticPath: string = null;
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
	private lastHotRowStart = 0;
	private lastHotRowEnd = -1;
	private lastHotGuardRows = 0;
	private readonly viewportRowMargin = 64;
	private readonly averageCharAdvance: number;
	private rowVisualLineCounts: number[] = [];
	private readonly rowVisualLinePrefix = new FenwickPrefix();
	private dirtyVisualStartRow = 0;
	private dirtyVisualEndRow = -1;
	private visualLinesDirtyByViewport = false;
	private readonly rowSegmentsScratch: ScratchBuffer<VisualLineSegment> = new ScratchBuffer<VisualLineSegment>(createVisualLineSegment, 8);
	private readonly sliceScratch: SliceResult = {
		startDisplay: 0,
		endDisplay: 0,
	};
	private lastViewportRowEstimate = 120;
	private semanticTimer: TimerHandle = null;
	private lastSemanticError: string = null;
	private lastSemanticErrorVersion = -1;
	private lastSemanticErrorChunk: string = null;
	private builtinEpoch = 0;
	private builtinIdentifiers: Iterable<string> = null;
	private codeTabMode: CodeTabMode = 'lua';

	constructor(
		private readonly font: EditorFont,
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

	public setCodeTabMode(mode: CodeTabMode): void {
		this.codeTabMode = mode;
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
		this.markVisualLinesDirtyForRows(row, row);
	}

	public invalidateHighlightsFromRow(row: number): void {
		if (this.highlightCache.size === 0) {
			return;
		}
		const threshold = Math.max(0, row);
		for (const key of this.highlightCache.keys()) {
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
		this.semanticPath = null;
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
		this.lastHotRowStart = 0;
		this.lastHotRowEnd = -1;
		this.lastHotGuardRows = 0;
		this.visualLines.length = 0;
		this.rowVisualLineCounts.length = 0;
		this.rowVisualLinePrefix.reset(0);
		this.rowSegmentsScratch.clear();
	}

	public requestSemanticUpdate(buffer: TextBuffer, documentVersion: number, path: string): void {
		if (this.codeTabMode !== 'lua') {
			this.pendingSemantic = null;
			this.semanticDueAtMs = null;
			this.semanticModel = null;
			this.annotationRowSig = null;
			return;
		}
		this.ensureSemanticModel(buffer, documentVersion, path, 'background');
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
		const highlight = this.codeTabMode === 'lua'
			? highlightTextLineExternal(source, lineAnnotations, builtinIdentifiers)
			: highlightAemTextLine(source);
		const cachedEntry = cached;
		if (cachedEntry) {
			const displayToColumn = cachedEntry.displayToColumn;
			displayToColumn.length = highlight.text.length + 1;
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
			const advancePrefix = cachedEntry.advancePrefix;
			advancePrefix.length = highlight.text.length + 1;
			advancePrefix[0] = 0;
			for (let i = 0; i < highlight.text.length; i += 1) {
				advancePrefix[i + 1] = advancePrefix[i] + this.font.advance(highlight.text.charAt(i));
			}
			cachedEntry.src = source;
			cachedEntry.hi = highlight;
			cachedEntry.textVersion = textVersion;
			cachedEntry.lineSignature = lineSignature;
			cachedEntry.builtinEpoch = builtinEpoch;
			cachedEntry.rowSignature = rowSignature;
			return cachedEntry;
		}
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
			this.sliceScratch.startDisplay = 0;
			this.sliceScratch.endDisplay = 0;
			return this.sliceScratch;
		}
		const columnToDisplay = highlight.columnToDisplay;
		const clampedStart = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const startDisplay = columnToDisplay[clampedStart];
		const endDisplay = columnToDisplay[clampedEndColumn];
		this.sliceScratch.startDisplay = startDisplay;
		this.sliceScratch.endDisplay = endDisplay;
		return this.sliceScratch;
	}

	public markVisualLinesDirty(): void {
		this.visualLinesDirty = true;
		this.visualLinesDirtyByViewport = true;
		this.dirtyVisualStartRow = 0;
		this.dirtyVisualEndRow = -1;
	}

	public clampBufferRow(buffer: TextBuffer, row: number): number {
		return clamp(row, 0, Math.max(0, buffer.getLineCount() - 1));
	}

	public clampBufferPosition(buffer: TextBuffer, position: Position): Position {
		const row = this.clampBufferRow(buffer, position.row);
		const lineLength = buffer.getLineEndOffset(row) - buffer.getLineStartOffset(row);
		const column = this.clampLineLength(lineLength, position.column);
		return { row, column };
	}

	public clampLineLength(lineLength: number, value: number): number {
		return clamp(value, 0, Math.max(0, lineLength));
	}

	public clampBufferColumn(buffer: TextBuffer, row: number, column: number): number {
		const safeRow = this.clampBufferRow(buffer, row);
		return this.clampLineLength(buffer.getLineEndOffset(safeRow) - buffer.getLineStartOffset(safeRow), column);
	}

	public clampBufferOffset(buffer: TextBuffer, offset: number): number {
		return clamp(offset, 0, Math.max(0, buffer.length));
	}

	public clampVisualIndex(visualLineCount: number, index: number): number {
		return clamp(index, 0, Math.max(0, visualLineCount - 1));
	}

	public clampSegmentStart(lineLength: number, segmentStartColumn: number): number {
		return this.clampLineLength(lineLength, segmentStartColumn);
	}

	public clampSegmentEnd(lineLength: number, segmentStartColumn: number, segmentEndColumn: number): number {
		return clamp(Math.max(segmentEndColumn, segmentStartColumn), segmentStartColumn, Math.max(0, lineLength));
	}

	public clampVisualScroll(scrollRow: number, visualLineCount: number, visibleRows: number): number {
		const maxScrollRow = Math.max(0, visualLineCount - Math.max(1, visibleRows));
		return clamp(scrollRow, 0, maxScrollRow);
	}

	public clampHorizontalScroll(scrollColumn: number, maxScrollColumn: number): number {
		return clamp(scrollColumn, 0, Math.max(0, maxScrollColumn));
	}

	public markVisualLinesDirtyForRows(startRow: number, endRow: number): void {
		const safeStart = Number.isFinite(startRow) ? Math.floor(startRow) : 0;
		const safeEnd = Number.isFinite(endRow) ? Math.floor(endRow) : safeStart;
		const clampedStart = clamp(safeStart, 0, Number.MAX_SAFE_INTEGER);
		const clampedEnd = clamp(safeEnd, clampedStart, Number.MAX_SAFE_INTEGER);
		if (this.visualLinesDirty) {
			if (this.visualLinesDirtyByViewport) {
				return;
			}
			this.dirtyVisualStartRow = Math.min(this.dirtyVisualStartRow, clampedStart);
			this.dirtyVisualEndRow = Math.max(this.dirtyVisualEndRow, clampedEnd);
			return;
		}
		this.visualLinesDirty = true;
		this.visualLinesDirtyByViewport = false;
		this.dirtyVisualStartRow = clampedStart;
		this.dirtyVisualEndRow = clampedEnd;
	}

	public ensureVisualLinesDirty(): void {
		if (!this.visualLinesDirty) {
			this.markVisualLinesDirty();
		}
	}

	public ensureVisualLines(context: VisualLinesContext): number {
		this.refreshBuiltinIdentifiers();
		const visibleRows = Math.max(1, context.estimatedVisibleRowCount ?? this.lastViewportRowEstimate);
		this.lastViewportRowEstimate = visibleRows;
		if (!this.visualLinesDirty && !this.viewportWithinHotWindow(context, visibleRows)) {
			this.markVisualLinesDirtyForRows(0, context.buffer.getLineCount() - 1);
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
			this.visualLinesDirtyByViewport = false;
			this.dirtyVisualStartRow = 0;
			this.dirtyVisualEndRow = -1;
		}
		return this.clampScrollRow(context.scrollRow);
	}

	public getVisualLineCount(): number {
		const total = this.rowVisualLinePrefix.getTotal();
		return total > 0 ? total : this.visualLines.length;
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
		const baseIndex = this.getRowStartIndex(safeRow);
		if (baseIndex < 0) {
			return 0;
		}
		const rowSegmentCount = this.rowVisualLineCounts[safeRow] ?? 0;
		if (rowSegmentCount <= 0) {
			return Math.min(baseIndex, this.visualLines.length - 1);
		}
		const endIndex = Math.min(this.visualLines.length, baseIndex + rowSegmentCount);
		const targetColumn = Math.max(0, column);
		let low = baseIndex;
		let high = endIndex;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (this.visualLines[mid].startColumn <= targetColumn) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		const segmentIndex = Math.min(endIndex - 1, Math.max(baseIndex, low - 1));
		return clamp(segmentIndex, 0, this.visualLines.length - 1);
	}

	public getVisualLines(): readonly VisualLineSegment[] {
		return this.visualLines;
	}

	public getLastSemanticError(): string {
		return this.lastSemanticError;
	}

	public getSemanticDefinitions(buffer: TextBuffer, documentVersion: number, path: string): readonly LuaDefinitionInfo[] {
		this.ensureSemanticModel(buffer, documentVersion, path, 'background');
		if (!this.semanticModel) {
			return null;
		}
		if (this.semanticVersion !== documentVersion || this.semanticPath !== path) {
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
			const segment = this.visualLines[0];
			if (segment) {
				segment.row = 0;
				segment.startColumn = 0;
				segment.endColumn = 0;
			} else {
				this.visualLines[0] = { row: 0, startColumn: 0, endColumn: 0 };
			}
			this.visualLines.length = 1;
			this.rowVisualLineCounts[0] = 1;
			this.rowVisualLineCounts.length = 1;
			this.rowVisualLinePrefix.reset(1);
			this.rowVisualLinePrefix.set(0, 1);
			this.lastHotRowStart = 0;
			this.lastHotRowEnd = -1;
			this.lastHotGuardRows = 0;
			return;
		}
		const needsFullRebuild = this.visualLines.length === 0
			|| this.rowVisualLinePrefix.length !== lineCount
			|| this.rowVisualLineCounts.length !== lineCount
			|| this.visualLinesDirtyByViewport;
		if (needsFullRebuild) {
			this.rebuildAllVisualLines(buffer, wordWrapEnabled, wrapWidth);
			this.lastHotRowStart = 0;
			this.lastHotRowEnd = lineCount - 1;
			this.lastHotGuardRows = Math.max(8, Math.floor(visibleRowEstimate / 2));
			return;
		}
		let hotStart = 0;
		let hotEnd = lineCount - 1;
		const totalVisual = this.visualLines.length;
		if (totalVisual > 0) {
			const hotStartVisual = this.getRowForVisualIndex(clamp(scrollRow, 0, totalVisual - 1));
			const hotEndVisual = this.getRowForVisualIndex(clamp(scrollRow + Math.max(1, visibleRowEstimate), 0, totalVisual - 1));
			if (hotStartVisual >= 0) {
				hotStart = hotStartVisual;
			}
			if (hotEndVisual >= 0) {
				hotEnd = hotEndVisual;
			}
		}
		const margin = Math.max(this.viewportRowMargin, visibleRowEstimate * 2);
		hotStart = clamp(hotStart - margin, 0, lineCount - 1);
		hotEnd = clamp(hotEnd + margin, 0, lineCount - 1);
		let rebuildStart = hotStart;
		let rebuildEnd = hotEnd;
		if (this.visualLinesDirty && !this.visualLinesDirtyByViewport && this.dirtyVisualEndRow >= this.dirtyVisualStartRow) {
			const dirtyStart = clamp(this.dirtyVisualStartRow, 0, lineCount - 1);
			const dirtyEnd = clamp(this.dirtyVisualEndRow, dirtyStart, lineCount - 1);
			rebuildStart = Math.min(rebuildStart, dirtyStart);
			rebuildEnd = Math.max(rebuildEnd, dirtyEnd);
		}
		this.rebuildRowRange(buffer, wordWrapEnabled, wrapWidth, rebuildStart, rebuildEnd);
		this.lastHotRowStart = hotStart;
		this.lastHotRowEnd = hotEnd;
		this.lastHotGuardRows = Math.max(8, Math.floor(visibleRowEstimate / 2));
	}

	private rebuildAllVisualLines(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		wrapWidth: number,
	): void {
		const lineCount = buffer.getLineCount();
		const segments = this.visualLines;
		const counts = this.rowVisualLineCounts;
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		const approxWrapColumns = !wordWrapEnabled || wrapWidth === Number.POSITIVE_INFINITY
			? Number.POSITIVE_INFINITY
			: Math.max(1, Math.floor(wrapWidth / Math.max(1, this.averageCharAdvance)));
		this.rowVisualLinePrefix.resizeOrClear(lineCount);
		let writeIndex = 0;
		for (let row = 0; row < lineCount; row += 1) {
			const entry = this.getCachedHighlight(buffer, row);
			const segmentStart = writeIndex;
			writeIndex = this.appendSegmentsForRow(segments, writeIndex, entry.src, row, entry, wordWrapEnabled, effectiveWrapWidth, approxWrapColumns);
			const rowCount = writeIndex - segmentStart;
			counts[row] = rowCount;
			this.rowVisualLinePrefix.add(row, rowCount);
		}
		segments.length = writeIndex;
		counts.length = lineCount;
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
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		const approxWrapColumns = !wordWrapEnabled || wrapWidth === Number.POSITIVE_INFINITY
			? Number.POSITIVE_INFINITY
			: Math.max(1, Math.floor(wrapWidth / Math.max(1, this.averageCharAdvance)));
		for (let row = startRow; row <= endRow; row += 1) {
			const startIndex = this.getRowStartIndex(row);
			const oldCount = this.rowVisualLineCounts[row] ?? 0;
			const entry = this.getCachedHighlight(buffer, row);
			this.rowSegmentsScratch.clear();
			const newEnd = this.appendSegmentsForRow(this.rowSegmentsScratch, 0, entry.src, row, entry, wordWrapEnabled, effectiveWrapWidth, approxWrapColumns);
			this.replaceScratchSegmentsIntoVisualLines(startIndex, oldCount);
			this.rowSegmentsScratch.clear();
			const newCount = newEnd;
			this.rowVisualLineCounts[row] = newCount;
			const delta = newCount - oldCount;
			if (delta !== 0) {
				this.rowVisualLinePrefix.add(row, delta);
			}
		}
	}

	private replaceScratchSegmentsIntoVisualLines(startIndex: number, deleteCount: number): void {
		const insertCount = this.rowSegmentsScratch.size;
		const oldLength = this.visualLines.length;
		const shift = insertCount - deleteCount;
		const newLength = oldLength + shift;
		if (shift > 0) {
			this.visualLines.length = newLength;
			for (let index = oldLength; index-- > startIndex + deleteCount; ) {
				this.visualLines[index + shift] = this.visualLines[index];
			}
		} else if (shift < 0) {
			for (let index = startIndex + deleteCount; index < oldLength; index += 1) {
				this.visualLines[index + shift] = this.visualLines[index];
			}
			this.visualLines.length = newLength;
		}
		for (let index = 0; index < insertCount; index += 1) {
			const source = this.rowSegmentsScratch.peek(index);
			const target = ensureVisualLineSegment(this.visualLines, startIndex + index);
			target.row = source.row;
			target.startColumn = source.startColumn;
			target.endColumn = source.endColumn;
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
		const length = highlight.text.length;
		if (length === 0) {
			return 0;
		}
		const clampedStart = clamp(startDisplay, 0, length);
		const clampedEnd = clamp(endDisplay, clampedStart, length);
		return entry.advancePrefix[clampedEnd] - entry.advancePrefix[clampedStart];
	}

	private findApproximateWrapBreak(lineLength: number, startColumn: number, approxColumns: number): number {
		if (approxColumns === Number.POSITIVE_INFINITY) {
			return lineLength;
		}
		return Math.min(lineLength, startColumn + approxColumns);
	}

	private appendSegment(target: VisualLineSegmentTarget, index: number, row: number, startColumn: number, endColumn: number): void {
		const segment = ensureVisualLineSegment(target, index);
		segment.row = row;
		segment.startColumn = startColumn;
		segment.endColumn = endColumn;
	}

	private appendSegmentsForRow(
		target: VisualLineSegmentTarget,
		writeIndex: number,
		line: string,
		row: number,
		entry: CachedHighlight,
		wordWrapEnabled: boolean,
		effectiveWrapWidth: number,
		approxWrapColumns: number,
	): number {
		if (!line || line.length === 0) {
			this.appendSegment(target, writeIndex, row, 0, 0);
			return writeIndex + 1;
		}
		const length = line.length;
		let column = 0;
		while (column < length) {
			const nextBreak = wordWrapEnabled
				? (entry ? this.findWrapBreak(line, entry, column, effectiveWrapWidth)
					: this.findApproximateWrapBreak(length, column, approxWrapColumns))
				: length;
			const endColumn = Math.max(column + 1, Math.min(length, nextBreak));
			this.appendSegment(target, writeIndex, row, column, endColumn);
			writeIndex += 1;
			column = endColumn;
		}
		return writeIndex;
	}

	public getSemanticModel(buffer: TextBuffer, documentVersion: number, path: string): LuaSemanticModel {
		this.ensureSemanticModel(buffer, documentVersion, path, 'background');
		return this.semanticModel;
	}

	private ensureSemanticModel(
		buffer: TextBuffer,
		version: number,
		path: string,
		_mode: 'background',
	): void {
		if (this.semanticBuffer === buffer && this.semanticVersion === version && this.semanticPath === path) {
			if (this.semanticModel) {
				return;
			}
			if (this.lastSemanticError && this.lastSemanticErrorVersion === version && this.lastSemanticErrorChunk === path) {
				return;
			}
		}
		if (this.pendingSemantic && this.pendingSemantic.buffer === buffer && this.pendingSemantic.version === version && this.pendingSemantic.path === path) {
			return;
		}
		const pending = this.updatePendingSemantic(buffer, version, path);
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
		path: string,
	): PendingSemanticUpdate {
		this.lastSemanticError = null;
		this.lastSemanticErrorVersion = -1;
		this.lastSemanticErrorChunk = null;
		const current = this.pendingSemantic;
		if (current && current.buffer === buffer && current.version === version && current.path === path) {
			return current;
		}
		const pending: PendingSemanticUpdate = {
			version,
			path,
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
			const snapshot = syncSemanticWorkspacePaths([{
				path: pending.path,
				source,
				lines: pending.lines,
				version: pending.version,
			}]);
			model = snapshot.getFileData(pending.path).model;
		} catch (error) {
			model = null;
			errorMessage = error instanceof Error ? error.message : String(error);
		}
		const annotations = model ? model.annotations : null;
		this.finalizeSemanticUpdate(pending.buffer, model, pending.version, pending.path, annotations, errorMessage);
	}

	private finalizeSemanticUpdate(
		buffer: TextBuffer,
		model: LuaSemanticModel,
		version: number,
		path: string,
		annotations: SemanticAnnotations,
		errorMessage?: string,
	): void {
		this.semanticBuffer = buffer;
		this.semanticModel = model;
		this.semanticVersion = version;
		this.semanticPath = path;
		this.semanticDueAtMs = null;
		this.pendingSemantic = null;
		if (errorMessage) {
			this.lastSemanticError = errorMessage;
			this.lastSemanticErrorVersion = version;
			this.lastSemanticErrorChunk = path;
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
			case 'constant':
				return 3;
			case 'function':
				return 4;
			case 'global':
				return 5;
			case 'tableField':
				return 6;
			case 'module':
				return 7;
			case 'type':
				return 8;
			case 'label':
				return 9;
			case 'keyword':
				return 10;
			default:
				return 0;
		}
	}

	private viewportWithinHotWindow(context: VisualLinesContext, visibleRows: number): boolean {
		if (this.lastHotRowEnd < this.lastHotRowStart || this.visualLines.length === 0) {
			return false;
		}
		const totalVisual = this.visualLines.length;
		const startRow = this.getRowForVisualIndex(clamp(context.scrollRow, 0, totalVisual - 1));
		const endVisual = clamp(context.scrollRow + Math.max(1, visibleRows) - 1, 0, totalVisual - 1);
		const endRow = this.getRowForVisualIndex(endVisual);
		if (startRow < 0 || endRow < 0) {
			return false;
		}
		const viewportStartRow = Math.min(startRow, endRow);
		const viewportEndRow = Math.max(startRow, endRow);
		const lineCount = context.buffer.getLineCount();
		const maxRow = Math.max(0, lineCount - 1);
		const guardStart = this.lastHotRowStart === 0 ? 0 : this.lastHotGuardRows;
		const guardEnd = this.lastHotRowEnd >= maxRow ? 0 : this.lastHotGuardRows;
		const guardedStart = Math.max(0, this.lastHotRowStart + guardStart);
		const guardedEnd = Math.max(guardedStart, this.lastHotRowEnd - guardEnd);
		if (viewportStartRow < guardedStart) return false;
		if (viewportEndRow > guardedEnd) return false;
		return true;
	}

	private getRowStartIndex(row: number): number {
		if (row <= 0) {
			return 0;
		}
		return this.rowVisualLinePrefix.prefixSum(row);
	}

	private getRowForVisualIndex(visualIndex: number): number {
		const total = this.getVisualLineCount();
		if (total <= 0) {
			return this.visualLines.length === 0 ? -1 : 0;
		}
		const clampedVisual = clamp(Math.floor(visualIndex), 0, this.visualLines.length - 1);
		const clampedByTotal = clamp(clampedVisual, 0, total - 1);
		const rowCount = this.rowVisualLinePrefix.length;
		if (rowCount === 0) {
			const fallback = this.visualLines[clampedByTotal];
			return fallback ? fallback.row : -1;
		}
		let low = 0;
		let high = rowCount;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (this.rowVisualLinePrefix.prefixSum(mid + 1) <= clampedByTotal) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		if (low >= rowCount) {
			return rowCount - 1;
		}
		return low;
	}
}
