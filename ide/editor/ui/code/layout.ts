import { FenwickPrefix } from '../../../common/fenwick';
import { editorTextModelService } from '../../model/model_service';
// start hot-path -- visual line layout and syntax highlight caching are editor-frame hot paths.
// start required-state activeCodeEditor,editorViewState -- editor model/view and layout roots are owned singletons in their modules.
import type { HostClock, TimerHandle } from '../../../../hosts/common/clock';
import { clamp } from '../../../../machine/ts/common/clamp';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { highlightTextLine as highlightTextLineExternal } from '../../../language/lua/syntax_highlight';
import { highlightAemTextLine } from '../../../language/aem/syntax_highlight';
import { highlightYamlTextLine } from '../../../language/yaml/syntax/highlight';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { SemanticSymbolKind } from '../../../../toolchain/ts/lua/semantic/symbols';
import { getLuaSemanticAnnotations, type SemanticAnnotations, type TokenAnnotation } from '../../../../toolchain/ts/lua/semantic/tokens';
import type { CachedHighlight, CodeLineView, DisplayRange, HighlightLine, VisualLineSegment } from '../../../common/models';
import type { EditorDocumentMode, EditorTextModelContentChangeEvent } from '../../model/text_model';
import { textChangesEndOffset } from '../../text/text_change';
import { EditorFont } from '../view/font';
import { getOrCreateSemanticProject } from '../../contrib/intellisense/semantic/workspace/state';
import type { TextBuffer } from '../../text/text_buffer';
import type { Position } from '../../../common/models';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import type { InlineEditState } from '../code_editor_state';
import { CodeLineProjection } from './line_projection';

type VisualLineSegmentTarget = VisualLineSegment[] | ScratchBuffer<VisualLineSegment>;

export type CodeLineViewport = {
	readonly startDisplay: number;
	readonly endDisplay: number;
	/** Full-line pixel coordinate displayed at the text viewport's left edge. */
	readonly pixelOffset: number;
};

type BuiltinIdentifierSnapshot = { epoch: number; ids: Iterable<string> };

type PendingSemanticUpdate = {
	version: number;
	domain: ResourceDomain;
	path: string;
	requestId: number;
	buffer: TextBuffer;
};

const createVisualLineSegment = (): VisualLineSegment => ({
	row: 0,
	startColumn: 0,
	endColumn: 0,
	startDisplay: 0,
	endDisplay: 0,
});

function ensureVisualLineSegment(target: VisualLineSegmentTarget, index: number, free: VisualLineSegment[]): VisualLineSegment {
	if (target instanceof ScratchBuffer) {
		return target.get(index);
	}
	const existing = target[index];
	if (existing) {
		return existing;
	}
	const created = free.length !== 0 ? free.pop()! : createVisualLineSegment();
	target[index] = created;
	return created;
}

/**
 * CodeLayout owns syntax highlight caching and visual line layout for the cart editor.
 * CartEditor delegates expensive computations here so the orchestrator stays lean.
 */
export class CodeLayout {
	private readonly inlineEdit: Readonly<InlineEditState>;
	private readonly inlineProjection: CodeLineProjection;
	private readonly endCaretWidth: number;
	private readonly lineViewport = { startDisplay: 0, endDisplay: 0, pixelOffset: 0 };
	private inlineWrapVersion = -1;
	private inlineWrapRow = -1;
	private readonly sourceWidths: number[] = [];
	private sourceWidthsReady = false;
	private maxSourceWidth = 0;
	private maxSourceRow = -1;
	private secondSourceWidth = 0;
	private secondSourceRow = -1;
	private sourceMaxDirty = false;
	private readonly rangeOne: DisplayRange = { startDisplay: 0, endDisplay: 0 };
	private readonly rangeTwo: DisplayRange = { startDisplay: 0, endDisplay: 0 };
	private readonly rangeScratch: DisplayRange[] = [];
	private readonly changedEndPosition: Position = { row: 0, column: 0 };
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache: number;
	private visualLines: VisualLineSegment[] = [];
	private visualLinesDirty = true;
	private semanticFileData: FileSemanticData = null;
	private semanticVersion = -1;
	private semanticDomain: ResourceDomain = null;
	private semanticPath: string = null;
	private semanticBuffer: TextBuffer = null;
	private readonly semanticDebounceMs: number;
	private readonly clock: HostClock;
	private readonly getBuiltinIdentifiers: () => BuiltinIdentifierSnapshot;
	private readonly computeWrapWidth: () => number;
	private pendingSemantic: PendingSemanticUpdate = null;
	private semanticDueAtMs: number = null;
	private semanticUpdateScheduled = false;
	private annotationRowSig: Uint32Array = null;
	private nextSemanticRequestId = 1;
	private semanticDispatchHandle: TimerHandle = null;
	private lastHotRowStart = 0;
	private lastHotRowEnd = -1;
	private lastHotGuardRows = 0;
	private readonly viewportRowMargin = 64;
	private rowVisualLineCounts: number[] = [];
	private readonly rowVisualLinePrefix = new FenwickPrefix();
	private dirtyVisualStartRow = 0;
	private dirtyVisualEndRow = -1;
	private visualLinesDirtyByViewport = false;
	private readonly rowSegmentsScratch: ScratchBuffer<VisualLineSegment> = new ScratchBuffer<VisualLineSegment>(createVisualLineSegment, 8);
	private readonly replacedSegments: VisualLineSegment[] = [];
	private readonly freeSegments: VisualLineSegment[] = [];
	private semanticTimer: TimerHandle = null;
	private lastSemanticError: string = null;
	private lastSemanticErrorVersion = -1;
	private lastSemanticErrorChunk: string = null;
	private builtinEpoch = 0;
	private builtinIdentifiers: Iterable<string> = null;
	private documentMode: EditorDocumentMode = 'lua';

	constructor(
		private readonly font: EditorFont,
		options: { maxHighlightCache: number; semanticDebounceMs: number; clock: HostClock; getBuiltinIdentifiers: () => BuiltinIdentifierSnapshot; computeWrapWidth: () => number; inlineEdit: Readonly<InlineEditState> },
	) {
		this.inlineEdit = options.inlineEdit;
		this.inlineProjection = new CodeLineProjection(font);
		this.endCaretWidth = font.advance(' ');
		this.maxHighlightCache = options.maxHighlightCache;
		this.semanticDebounceMs = options.semanticDebounceMs;
		this.clock = options.clock;
		this.getBuiltinIdentifiers = options.getBuiltinIdentifiers;
		this.computeWrapWidth = options.computeWrapWidth;
		this.refreshBuiltinIdentifiers();
	}

	public dispose(): void {
		this.semanticTimer?.cancel();
		this.semanticDispatchHandle?.cancel();
		this.semanticTimer = null;
		this.semanticDispatchHandle = null;
		this.pendingSemantic = null;
	}

	public setDocumentMode(mode: EditorDocumentMode): void {
		this.documentMode = mode;
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
		const now = this.clock.now();
		const delay = this.semanticDueAtMs !== null ? clamp(this.semanticDueAtMs - now, 0, this.semanticDebounceMs) : 0;
		if (this.semanticTimer) {
			this.semanticTimer.cancel();
			this.semanticTimer = null;
		}
		this.semanticUpdateScheduled = true;
		this.semanticTimer = this.clock.scheduleOnce(delay, () => {
			this.semanticTimer = null;
			this.semanticUpdateScheduled = false;
			const pending = this.pendingSemantic;
			if (!pending) {
				return;
			}
			if (this.semanticDueAtMs !== null) {
				const current = this.clock.now();
				if (current < this.semanticDueAtMs) {
					this.scheduleSemanticUpdate();
					return;
				}
				this.semanticDueAtMs = null;
			}
			this.dispatchSemanticUpdate(pending);
		});
	}

	public invalidateLine(row: number): void {
		this.highlightCache.delete(row);
		this.markVisualLinesDirtyForRows(row, row);
	}

	/** Model events invalidate the projection regardless of which editor produced the edit. */
	public onDidChangeContent(buffer: TextBuffer, event: EditorTextModelContentChangeEvent): void {
		if (buffer.getLineCount() !== this.sourceWidths.length) this.sourceWidthsReady = false;
		if (this.pendingSemantic?.buffer === buffer) this.pendingSemantic = null;
		buffer.positionAt(textChangesEndOffset(event.changes), this.changedEndPosition);
		this.invalidateHighlightsFromRow(event.startRow);
		this.markVisualLinesDirtyForRows(event.startRow, this.changedEndPosition.row);
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
		this.sourceWidthsReady = false;
		this.sourceWidths.length = 0;
		this.inlineWrapVersion = -1;
		this.inlineWrapRow = -1;
		this.highlightCache.clear();
		this.semanticBuffer = null;
		this.semanticFileData = null;
		this.semanticVersion = -1;
		this.semanticDomain = null;
		this.semanticPath = null;
		this.lastSemanticError = null;
		this.lastSemanticErrorVersion = -1;
		this.lastSemanticErrorChunk = null;
		this.pendingSemantic = null;
		this.semanticDueAtMs = null;
		this.semanticUpdateScheduled = false;
		if (this.semanticTimer) {
			this.semanticTimer.cancel();
			this.semanticTimer = null;
		}
		if (this.semanticDispatchHandle) {
			this.semanticDispatchHandle.cancel();
			this.semanticDispatchHandle = null;
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

	public requestSemanticUpdate(buffer: TextBuffer, documentVersion: number, identity: ResourceIdentity): void {
		switch (this.documentMode) {
			case 'lua':
				this.ensureSemanticAnalysis(buffer, documentVersion, identity);
				return;
			case 'yaml':
			case 'aem':
				this.pendingSemantic = null;
				this.semanticDueAtMs = null;
				this.semanticFileData = null;
				this.annotationRowSig = null;
				return;
		}
	}

	public getCachedHighlight(buffer: TextBuffer, row: number): CachedHighlight {
		const annotations = this.semanticFileData ? getLuaSemanticAnnotations(this.semanticFileData) : null;
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
		let highlight: HighlightLine;
		switch (this.documentMode) {
			case 'lua':
				highlight = highlightTextLineExternal(source, lineAnnotations, builtinIdentifiers);
				break;
			case 'yaml':
				highlight = highlightYamlTextLine(source);
				break;
			case 'aem':
				highlight = highlightAemTextLine(source);
				break;
		}
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
			cachedEntry.viewText = source;
			cachedEntry.viewColumnToDisplay = highlight.columnToDisplay;
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
			viewText: source,
			viewColumnToDisplay: highlight.columnToDisplay,
			inline: null,
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

	public getViewLine(buffer: TextBuffer, row: number): CodeLineView {
		const source = this.getCachedHighlight(buffer, row);
		if (this.sourceWidthsReady) this.recordSourceWidth(row, source.advancePrefix[source.hi.text.length]);
		return this.inlineEdit.active && this.inlineEdit.row === row
			? this.inlineProjection.update(source, this.inlineEdit) : source;
	}

	/** Borrowed until the next call; authored ranges can have two fragments separated by unaccepted text. */
	public projectSourceRange(line: CodeLineView, startColumn: number, endColumn: number): readonly DisplayRange[] {
		const result = this.rangeScratch;
		result.length = 0;
		if (endColumn <= startColumn) return result;
		const inline = line.inline;
		if (inline === null) {
			this.rangeOne.startDisplay = this.columnToDisplay(line.hi, startColumn);
			this.rangeOne.endDisplay = this.columnToDisplay(line.hi, endColumn);
			result.push(this.rangeOne);
			return result;
		}
		const prefixEnd = Math.min(endColumn, inline.startColumn);
		if (startColumn < prefixEnd) {
			this.rangeOne.startDisplay = this.columnToDisplay(line.hi, startColumn);
			this.rangeOne.endDisplay = this.columnToDisplay(line.hi, prefixEnd);
			result.push(this.rangeOne);
		}
		const tailStart = Math.max(startColumn, inline.endColumn);
		if (tailStart < endColumn) {
			this.rangeTwo.startDisplay = tailStart === inline.endColumn ? inline.endDisplay : this.columnToDisplay(line.hi, tailStart);
			this.rangeTwo.endDisplay = this.columnToDisplay(line.hi, endColumn);
			result.push(this.rangeTwo);
		}
		return result;
	}

	/** Pointer positions choose real source stops; injected glyphs have left affinity. */
	public hitTestColumn(line: CodeLineView, startDisplay: number, endDisplay: number, offset: number): number {
		const advances = line.advancePrefix, target = advances[startDisplay] + offset;
		if (target <= advances[startDisplay]) return this.sourceColumnAtDisplay(line, startDisplay, false);
		if (target >= advances[endDisplay]) return this.sourceColumnAtDisplay(line, endDisplay, true);
		const display = this.displayAtPixel(line, target, startDisplay, endDisplay), inline = line.inline;
		if (inline !== null && display >= inline.startDisplay && display < inline.endDisplay) return inline.startColumn;
		const column = line.displayToColumn[display];
		const begin = inline !== null && column === inline.endColumn ? inline.endDisplay : this.columnToDisplay(line.hi, column);
		const end = this.columnToDisplay(line.hi, column + 1);
		return target >= (advances[begin] + advances[end]) * 0.5 ? column + 1 : column;
	}

	/** Expanded glyph containing a measured pixel; exact boundaries choose the following glyph. */
	public displayAtPixel(line: CodeLineView, pixel: number, startDisplay = 0, endDisplay = line.hi.text.length): number {
		let low = startDisplay, high = endDisplay + 1;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (line.advancePrefix[mid] <= pixel) low = mid + 1; else high = mid;
		}
		return Math.max(startDisplay, low - 1);
	}

	/** Borrowed until the next call; partial edge glyphs retain the same unaligned pixel origin. */
	public resolveLineViewport(line: CodeLineView, segment: VisualLineSegment, scrollLeft: number, width: number,
		wrapEnabled: boolean): CodeLineViewport {
		const result = this.lineViewport;
		result.pixelOffset = wrapEnabled ? line.advancePrefix[segment.startDisplay] : scrollLeft;
		result.startDisplay = wrapEnabled ? segment.startDisplay : this.displayAtPixel(line, scrollLeft);
		if (wrapEnabled) result.endDisplay = segment.endDisplay;
		else {
			const right = scrollLeft + width, end = this.displayAtPixel(line, right, result.startDisplay);
			result.endDisplay = end < line.hi.text.length && line.advancePrefix[end] < right ? end + 1 : end;
		}
		return result;
	}

	public cursorWidth(line: CodeLineView, display: number): number {
		if (display === line.hi.text.length) return this.endCaretWidth;
		const inline = line.inline, column = line.displayToColumn[display];
		const ghost = inline !== null && display >= inline.startDisplay && display < inline.endDisplay;
		const end = !ghost && line.src.charAt(column) === '\t' ? line.hi.columnToDisplay[column + 1] : display + 1;
		return line.advancePrefix[end] - line.advancePrefix[display];
	}

	private sourceColumnAtDisplay(line: CodeLineView, display: number, right: boolean): number {
		const inline = line.inline;
		if (inline !== null && display >= inline.startDisplay && display <= inline.endDisplay) {
			return right && display === inline.endDisplay ? inline.endColumn : inline.startColumn;
		}
		return line.displayToColumn[display];
	}

	private recordSourceWidth(row: number, width: number): void {
		if (this.sourceWidths[row] === width) return;
		this.sourceWidths[row] = width;
		if (this.sourceMaxDirty) return;
		if (row === this.maxSourceRow) {
			if (width < this.secondSourceWidth) this.sourceMaxDirty = true;
			else this.maxSourceWidth = width;
		} else if (row === this.secondSourceRow) {
			if (width < this.secondSourceWidth) this.sourceMaxDirty = true;
			else if (width > this.maxSourceWidth) {
				this.secondSourceRow = this.maxSourceRow; this.secondSourceWidth = this.maxSourceWidth;
				this.maxSourceRow = row; this.maxSourceWidth = width;
			} else this.secondSourceWidth = width;
		} else if (width > this.maxSourceWidth) {
			this.secondSourceRow = this.maxSourceRow; this.secondSourceWidth = this.maxSourceWidth;
			this.maxSourceRow = row; this.maxSourceWidth = width;
		} else if (width > this.secondSourceWidth) {
			this.secondSourceRow = row; this.secondSourceWidth = width;
		}
	}

	/** Pixel extents include an EOL caret and consume synchronized source widths and one projected row, not a rescan on suggestion changes. */
	public maxViewWidth(buffer: TextBuffer): number {
		const edit = this.inlineEdit;
		const line = edit.active ? this.getViewLine(buffer, edit.row) : null;
		const projected = line === null ? 0 : line.advancePrefix[line.hi.text.length];
		if (this.sourceMaxDirty) {
			this.maxSourceWidth = 0; this.maxSourceRow = -1;
			this.secondSourceWidth = 0; this.secondSourceRow = -1;
			for (let row = 0; row < this.sourceWidths.length; row++) {
				const width = this.sourceWidths[row];
				if (width > this.maxSourceWidth) {
					this.secondSourceWidth = this.maxSourceWidth; this.secondSourceRow = this.maxSourceRow;
					this.maxSourceWidth = width; this.maxSourceRow = row;
				} else if (width > this.secondSourceWidth) { this.secondSourceWidth = width; this.secondSourceRow = row; }
			}
			this.sourceMaxDirty = false;
		}
		const authored = edit.active && edit.row === this.maxSourceRow ? this.secondSourceWidth : this.maxSourceWidth;
		return Math.max(authored, projected) + this.endCaretWidth;
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
		return clamp(index | 0, 0, Math.max(0, visualLineCount - 1));
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

	public clampHorizontalScroll(scrollLeft: number, maxScrollLeft: number): number {
		return clamp(scrollLeft, 0, Math.max(0, maxScrollLeft));
	}

	public markVisualLinesDirtyForRows(startRow: number, endRow: number): void {
		const clampedStart = startRow > 0 ? startRow : 0;
		const clampedEnd = endRow > clampedStart ? endRow : clampedStart;
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

	public ensureVisualLines(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		scrollRow: number,
		estimatedVisibleRowCount: number,
	): number {
		this.refreshBuiltinIdentifiers();
		const inlineChanged = this.inlineWrapVersion !== this.inlineEdit.version;
		const nextInlineRow = this.inlineEdit.active ? this.inlineEdit.row : -1;
		if (inlineChanged && this.visualLinesDirty && !this.visualLinesDirtyByViewport) {
			if (this.inlineWrapRow >= 0) this.markVisualLinesDirtyForRows(this.inlineWrapRow, this.inlineWrapRow);
			if (nextInlineRow >= 0) this.markVisualLinesDirtyForRows(nextInlineRow, nextInlineRow);
		}
		const visibleRows = Math.max(1, estimatedVisibleRowCount);
		if (!this.visualLinesDirty && !this.viewportWithinHotWindow(buffer, scrollRow, visibleRows)) {
			this.markVisualLinesDirtyForRows(0, buffer.getLineCount() - 1);
		}
		if (this.visualLinesDirty) {
			this.rebuildVisualLines(
				buffer,
				wordWrapEnabled,
				this.computeWrapWidth(),
				scrollRow,
				visibleRows,
			);
			this.visualLinesDirty = false;
			this.visualLinesDirtyByViewport = false;
			this.dirtyVisualStartRow = 0;
			this.dirtyVisualEndRow = -1;
		} else if (inlineChanged) {
			const width = this.computeWrapWidth();
			if (this.inlineWrapRow >= 0) this.rebuildRowRange(buffer, wordWrapEnabled, width, this.inlineWrapRow, this.inlineWrapRow);
			if (nextInlineRow >= 0 && nextInlineRow !== this.inlineWrapRow) this.rebuildRowRange(buffer, wordWrapEnabled, width, nextInlineRow, nextInlineRow);
		}
		this.inlineWrapVersion = this.inlineEdit.version;
		this.inlineWrapRow = nextInlineRow;
		return this.clampScrollRow(scrollRow);
	}

	public getVisualLineCount(): number {
		return this.visualLines.length;
	}

	public visualIndexToSegment(index: number): VisualLineSegment {
		return this.visualLines[index];
	}

	public positionToVisualIndex(buffer: TextBuffer, row: number, column: number): number {
		return this.displayToVisualIndex(row, this.columnToDisplay(this.getViewLine(buffer, row).hi, column));
	}

	public displayToVisualIndex(row: number, targetDisplay: number): number {
		const baseIndex = this.getRowStartIndex(row);
		const rowSegmentCount = this.rowVisualLineCounts[row];
		const endCandidate = baseIndex + rowSegmentCount;
		const endIndex = endCandidate < this.visualLines.length ? endCandidate : this.visualLines.length;
		let low = baseIndex;
		let high = endIndex;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (this.visualLines[mid].startDisplay <= targetDisplay) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		const segmentIndex = low - 1;
		return segmentIndex > baseIndex ? segmentIndex : baseIndex;
	}

	public getVisualLines(): readonly VisualLineSegment[] {
		return this.visualLines;
	}

	public getLastSemanticError(): string {
		return this.lastSemanticError;
	}

	public getSemanticFileData(
		buffer: TextBuffer,
		documentVersion: number,
		identity: ResourceIdentity,
	): FileSemanticData {
		this.ensureSemanticAnalysis(buffer, documentVersion, identity);
		if (!this.semanticFileData) {
			return null;
		}
		if (this.semanticVersion !== documentVersion
			|| this.semanticDomain !== identity.domain
			|| this.semanticPath !== identity.path) {
			return null;
		}
		return this.semanticFileData;
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
				segment.startDisplay = 0;
				segment.endDisplay = 0;
			} else {
				this.visualLines[0] = { row: 0, startColumn: 0, endColumn: 0, startDisplay: 0, endDisplay: 0 };
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
			this.lastHotGuardRows = this.computeHotGuardRows(visibleRowEstimate);
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
		this.lastHotGuardRows = this.computeHotGuardRows(visibleRowEstimate);
	}

	private rebuildAllVisualLines(
		buffer: TextBuffer,
		wordWrapEnabled: boolean,
		wrapWidth: number,
	): void {
		const lineCount = buffer.getLineCount();
		this.sourceWidths.length = lineCount;
		this.sourceWidths.fill(0);
		this.sourceWidthsReady = true;
		this.maxSourceWidth = 0; this.maxSourceRow = -1;
		this.secondSourceWidth = 0; this.secondSourceRow = -1;
		this.sourceMaxDirty = false;
		const segments = this.visualLines;
		const counts = this.rowVisualLineCounts;
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		this.rowVisualLinePrefix.resizeOrClear(lineCount);
		let writeIndex = 0;
		for (let row = 0; row < lineCount; row += 1) {
			const entry = this.getViewLine(buffer, row);
			const segmentStart = writeIndex;
			writeIndex = this.appendSegmentsForRow(segments, writeIndex, entry.viewText, row, entry, wordWrapEnabled, effectiveWrapWidth);
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
		for (let row = startRow; row <= endRow; row += 1) {
			const startIndex = this.getRowStartIndex(row);
			const oldCount = this.rowVisualLineCounts[row];
			const entry = this.getViewLine(buffer, row);
			this.rowSegmentsScratch.clear();
			const newEnd = this.appendSegmentsForRow(this.rowSegmentsScratch, 0, entry.viewText, row, entry, wordWrapEnabled, effectiveWrapWidth);
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
		const replaced = this.replacedSegments;
		for (let index = 0; index < deleteCount; index++) replaced[index] = this.visualLines[startIndex + index];
		replaced.length = deleteCount;
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
			const target = index < deleteCount ? replaced[index]
				: this.freeSegments.length !== 0 ? this.freeSegments.pop()! : createVisualLineSegment();
			this.visualLines[startIndex + index] = target;
			target.row = source.row;
			target.startColumn = source.startColumn;
			target.endColumn = source.endColumn;
			target.startDisplay = source.startDisplay;
			target.endDisplay = source.endDisplay;
		}
		for (let index = insertCount; index < deleteCount; index++) this.freeSegments.push(replaced[index]);
		replaced.length = 0;
	}

	private findWrapBreak(line: string, entry: CodeLineView, startColumn: number, wrapWidth: number): number {
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

	private measureColumns(entry: CodeLineView, startColumn: number, endColumn: number): number {
		return entry.advancePrefix[entry.viewColumnToDisplay[endColumn]] - entry.advancePrefix[entry.viewColumnToDisplay[startColumn]];
	}

	private appendSegment(target: VisualLineSegmentTarget, index: number, row: number, entry: CodeLineView, startColumn: number, endColumn: number): void {
		const segment = ensureVisualLineSegment(target, index, this.freeSegments);
		segment.row = row;
		segment.startDisplay = entry.viewColumnToDisplay[startColumn];
		segment.endDisplay = entry.viewColumnToDisplay[endColumn];
		segment.startColumn = this.sourceColumnAtDisplay(entry, segment.startDisplay, false);
		segment.endColumn = this.sourceColumnAtDisplay(entry, segment.endDisplay, true);
	}

	private appendSegmentsForRow(
		target: VisualLineSegmentTarget,
		writeIndex: number,
		line: string,
		row: number,
		entry: CodeLineView,
		wordWrapEnabled: boolean,
		effectiveWrapWidth: number,
	): number {
		if (line.length === 0) {
			this.appendSegment(target, writeIndex, row, entry, 0, 0);
			return writeIndex + 1;
		}
		const length = line.length;
		let column = 0;
		while (column < length) {
			const nextBreak = wordWrapEnabled
				? this.findWrapBreak(line, entry, column, effectiveWrapWidth)
				: length;
			const endColumn = Math.max(column + 1, Math.min(length, nextBreak));
			this.appendSegment(target, writeIndex, row, entry, column, endColumn);
			writeIndex += 1;
			column = endColumn;
		}
		return writeIndex;
	}

	private computeHotGuardRows(visibleRowEstimate: number): number {
		const guardRows = visibleRowEstimate >> 1;
		return guardRows > 8 ? guardRows : 8;
	}

	private ensureSemanticAnalysis(
		buffer: TextBuffer,
		version: number,
		identity: ResourceIdentity,
	): void {
		if (this.semanticBuffer === buffer
			&& this.semanticVersion === version
			&& this.semanticDomain === identity.domain
			&& this.semanticPath === identity.path) {
			if (this.semanticFileData) {
				return;
			}
			if (this.lastSemanticError
				&& this.lastSemanticErrorVersion === version
				&& this.lastSemanticErrorChunk === identity.path) {
				return;
			}
		}
		if (this.pendingSemantic
			&& this.pendingSemantic.buffer === buffer
			&& this.pendingSemantic.version === version
			&& this.pendingSemantic.domain === identity.domain
			&& this.pendingSemantic.path === identity.path) {
			return;
		}
		const pending = this.updatePendingSemantic(buffer, version, identity);
		if (this.semanticDebounceMs === 0) {
			this.semanticDueAtMs = null;
			if (this.semanticTimer) {
				this.semanticTimer.cancel();
				this.semanticTimer = null;
			}
			this.semanticUpdateScheduled = false;
			this.dispatchSemanticUpdate(pending);
			return;
		}
		const now = this.clock.now();
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
			this.dispatchSemanticUpdate(pending);
			return;
		}
		this.scheduleSemanticUpdate();
	}

	private updatePendingSemantic(
		buffer: TextBuffer,
		version: number,
		identity: ResourceIdentity,
	): PendingSemanticUpdate {
		this.lastSemanticError = null;
		this.lastSemanticErrorVersion = -1;
		this.lastSemanticErrorChunk = null;
		const current = this.pendingSemantic;
		if (current
			&& current.buffer === buffer
			&& current.version === version
			&& current.domain === identity.domain
			&& current.path === identity.path) {
			return current;
		}
		const pending: PendingSemanticUpdate = {
			version,
			domain: identity.domain,
			path: identity.path,
			requestId: this.nextSemanticRequestId,
			buffer,
		};
		this.nextSemanticRequestId += 1;
		this.pendingSemantic = pending;
		return pending;
	}
	private dispatchSemanticUpdate(pending: PendingSemanticUpdate): void {
		this.semanticDueAtMs = null;
		this.pendingSemantic = pending;
		if (this.semanticDispatchHandle) {
			this.semanticDispatchHandle.cancel();
		}
		this.semanticDispatchHandle = this.clock.scheduleOnce(0, () => {
			this.semanticDispatchHandle = null;
			if (!this.pendingSemantic || this.pendingSemantic.requestId !== pending.requestId) {
				return;
			}
			this.pendingSemantic = null;
			this.applySemanticUpdateSync(pending);
		});
	}

	private applySemanticUpdateSync(pending: PendingSemanticUpdate): void {
		let fileData: FileSemanticData = null;
		let errorMessage: string = null;
		try {
			fileData = getOrCreateSemanticProject(editorTextModelService, pending.domain).analyzeDocument(pending.path, pending.buffer);
		} catch (error) {
			fileData = null;
			errorMessage = error instanceof Error ? error.message : String(error);
		}
		this.finalizeSemanticUpdate(
			pending.buffer,
			fileData,
			pending.version,
			pending.domain,
			pending.path,
			errorMessage,
		);
	}

	private finalizeSemanticUpdate(
		buffer: TextBuffer,
		fileData: FileSemanticData,
		version: number,
		domain: ResourceDomain,
		path: string,
		errorMessage?: string,
	): void {
		const annotations = fileData ? getLuaSemanticAnnotations(fileData) : null;
		this.semanticBuffer = buffer;
		this.semanticFileData = fileData;
		this.semanticVersion = version;
		this.semanticDomain = domain;
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

	private hashSymbolKind(kind: SemanticSymbolKind): number {
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
			case 'property':
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

	private viewportWithinHotWindow(buffer: TextBuffer, scrollRow: number, visibleRows: number): boolean {
		if (this.lastHotRowEnd < this.lastHotRowStart || this.visualLines.length === 0) {
			return false;
		}
		const totalVisual = this.visualLines.length;
		const startRow = this.getRowForVisualIndex(clamp(scrollRow, 0, totalVisual - 1));
		const endVisual = clamp(scrollRow + Math.max(1, visibleRows) - 1, 0, totalVisual - 1);
		const endRow = this.getRowForVisualIndex(endVisual);
		if (startRow < 0 || endRow < 0) {
			return false;
		}
		const viewportStartRow = Math.min(startRow, endRow);
		const viewportEndRow = Math.max(startRow, endRow);
		const lineCount = buffer.getLineCount();
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
		const clampedVisual = clamp(visualIndex, 0, this.visualLines.length - 1);
		const clampedByTotal = clamp(clampedVisual, 0, total - 1);
		const rowCount = this.rowVisualLinePrefix.length;
		if (rowCount === 0) {
			const fallback = this.visualLines[clampedByTotal | 0];
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
// end required-state
// end hot-path
