import { FenwickPrefix } from '../../../common/fenwick';
import { clamp } from '../../../../machine/ts/common/clamp';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { CodeLineView, DisplayRange, HighlightLine, VisualLineSegment } from '../../../common/models';
import type { EditorFont } from '../view/font';
import type { InlineEditState } from '../code_editor_state';
import { CodeLineProjection } from './line_projection';
import type { CodeDocumentProjection } from './document_projection';
import type { CodeDocumentMeasurements } from './document_measurements';

type VisualLineSegmentTarget = VisualLineSegment[] | ScratchBuffer<VisualLineSegment>;

export type CodeLineViewport = {
	readonly startDisplay: number;
	readonly endDisplay: number;
	readonly pixelOffset: number;
};

const createVisualLineSegment = (): VisualLineSegment => ({
	row: 0,
	startColumn: 0,
	endColumn: 0,
	startDisplay: 0,
	endDisplay: 0,
	indentPixels: 0,
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

/** One control's wrapping, injected text and coordinate projection over a shared document. */
export class CodeLayout {
	private documentValue: CodeDocumentProjection | null = null;
	private measurementsValue: CodeDocumentMeasurements | null = null;
	private unbindDocumentChange: (() => void) | undefined;
	private unbindDocumentDisposal: (() => void) | undefined;
	private readonly inlineEdit: Readonly<InlineEditState>;
	private readonly inlineProjection: CodeLineProjection;
	private readonly computeWrapWidth: () => number;
	private readonly endCaretWidth: number;
	private readonly lineViewport = { startDisplay: 0, endDisplay: 0, pixelOffset: 0 };
	private inlineWrapVersion = -1;
	private inlineWrapRow = -1;
	private readonly rangeOne: DisplayRange = { startDisplay: 0, endDisplay: 0 };
	private readonly rangeTwo: DisplayRange = { startDisplay: 0, endDisplay: 0 };
	private readonly rangeScratch: DisplayRange[] = [];
	private visualLines: VisualLineSegment[] = [];
	private visualLinesDirty = true;
	private lastHotRowStart = 0;
	private lastHotRowEnd = -1;
	private lastHotGuardRows = 0;
	private readonly viewportRowMargin = 64;
	private rowVisualLineCounts: number[] = [];
	private readonly rowVisualLinePrefix = new FenwickPrefix();
	private dirtyVisualStartRow = 0;
	private dirtyVisualEndRow = -1;
	private visualLinesDirtyByViewport = false;
	private readonly rowSegmentsScratch = new ScratchBuffer<VisualLineSegment>(createVisualLineSegment, 8);
	private readonly replacedSegments: VisualLineSegment[] = [];
	private readonly freeSegments: VisualLineSegment[] = [];

	public constructor(private readonly font: EditorFont,
		options: { inlineEdit: Readonly<InlineEditState>; computeWrapWidth: () => number }) {
		this.inlineEdit = options.inlineEdit;
		this.inlineProjection = new CodeLineProjection(font);
		this.computeWrapWidth = options.computeWrapWidth;
		this.endCaretWidth = font.advance(' ');
	}

	public get document(): CodeDocumentProjection { return this.documentValue!; }
	public get measurements(): CodeDocumentMeasurements { return this.measurementsValue!; }

	public attach(document: CodeDocumentProjection): void {
		if (this.documentValue === document) return;
		this.clearDocument();
		this.documentValue = document;
		this.measurementsValue = document.acquireMeasurements(this.font);
		this.unbindDocumentChange = document.onDidChange(event => {
			if (event.kind === 'source') this.markVisualLinesDirtyForRows(event.startRow, event.endRow);
		});
		this.unbindDocumentDisposal = document.onWillDispose(() => this.clearDocument());
	}

	public clearDocument(): void {
		this.unbindDocumentChange?.(); this.unbindDocumentDisposal?.();
		this.unbindDocumentChange = this.unbindDocumentDisposal = undefined;
		if (this.documentValue !== null) this.documentValue.releaseMeasurements(this.measurementsValue!);
		this.documentValue = null;
		this.measurementsValue = null;
		this.visualLines.length = 0;
		this.rowVisualLineCounts.length = 0;
		this.rowVisualLinePrefix.reset(0);
		this.rowSegmentsScratch.clear();
		this.inlineWrapVersion = this.inlineWrapRow = -1;
		this.lastHotRowStart = 0; this.lastHotRowEnd = -1; this.lastHotGuardRows = 0;
		this.markVisualLinesDirty();
	}

	public dispose(): void { this.clearDocument(); }

	public getViewLine(row: number): CodeLineView {
		const source = this.measurements.getLine(row);
		return this.inlineEdit.active && this.inlineEdit.row === row
			? this.inlineProjection.update(source, this.inlineEdit) : source;
	}

	public maxViewWidth(): number {
		const edit = this.inlineEdit;
		const line = edit.active ? this.getViewLine(edit.row) : null;
		const projected = line === null ? 0 : line.advancePrefix[line.hi.text.length];
		return Math.max(this.measurements.maxSourceWidthExcluding(edit.active ? edit.row : -1), projected) + this.endCaretWidth;
	}

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
		result.pixelOffset = this.segmentPixelOffset(line, segment, scrollLeft, wrapEnabled);
		result.startDisplay = wrapEnabled ? segment.startDisplay : this.displayAtPixel(line, scrollLeft);
		if (wrapEnabled) result.endDisplay = segment.endDisplay;
		else {
			const right = scrollLeft + width, end = this.displayAtPixel(line, right, result.startDisplay);
			result.endDisplay = end < line.hi.text.length && line.advancePrefix[end] < right ? end + 1 : end;
		}
		return result;
	}

	/** Source-display pixels translated into this visual segment's viewport coordinates. */
	public segmentPixelOffset(line: CodeLineView, segment: VisualLineSegment, scrollLeft: number, wrapEnabled: boolean): number {
		return wrapEnabled ? line.advancePrefix[segment.startDisplay] - segment.indentPixels : scrollLeft;
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

	public clampLineLength(lineLength: number, value: number): number {
		return clamp(value, 0, lineLength);
	}

	public clampVisualIndex(visualLineCount: number, index: number): number {
		return clamp(index | 0, 0, Math.max(0, visualLineCount - 1));
	}

	public clampSegmentStart(lineLength: number, segmentStartColumn: number): number {
		return this.clampLineLength(lineLength, segmentStartColumn);
	}

	public clampSegmentEnd(lineLength: number, segmentStartColumn: number, segmentEndColumn: number): number {
		return clamp(Math.max(segmentEndColumn, segmentStartColumn), segmentStartColumn, lineLength);
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
		wordWrapEnabled: boolean,
		scrollRow: number,
		estimatedVisibleRowCount: number,
	): number {
		const buffer = this.document.model.buffer;
		this.document.refreshBuiltinIdentifiers();
		const inlineChanged = this.inlineWrapVersion !== this.inlineEdit.version;
		const nextInlineRow = this.inlineEdit.active ? this.inlineEdit.row : -1;
		if (inlineChanged && this.visualLinesDirty && !this.visualLinesDirtyByViewport) {
			if (this.inlineWrapRow >= 0) this.markVisualLinesDirtyForRows(this.inlineWrapRow, this.inlineWrapRow);
			if (nextInlineRow >= 0) this.markVisualLinesDirtyForRows(nextInlineRow, nextInlineRow);
		}
		const visibleRows = Math.max(1, estimatedVisibleRowCount);
		if (!this.visualLinesDirty && !this.viewportWithinHotWindow(scrollRow, visibleRows)) {
			this.markVisualLinesDirtyForRows(0, buffer.getLineCount() - 1);
		}
		if (this.visualLinesDirty) {
			this.rebuildVisualLines(
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
			if (this.inlineWrapRow >= 0) this.rebuildRowRange(wordWrapEnabled, width, this.inlineWrapRow, this.inlineWrapRow);
			if (nextInlineRow >= 0 && nextInlineRow !== this.inlineWrapRow) this.rebuildRowRange(wordWrapEnabled, width, nextInlineRow, nextInlineRow);
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

	public positionToVisualIndex(row: number, column: number): number {
		return this.displayToVisualIndex(row, this.columnToDisplay(this.getViewLine(row).hi, column));
	}

	public displayToVisualIndex(row: number, targetDisplay: number): number {
		const baseIndex = this.rowVisualLinePrefix.prefixSum(row);
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

	private clampScrollRow(scrollRow: number): number {
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		return clamp(scrollRow, 0, maxScrollRow);
	}

	private rebuildVisualLines(
		wordWrapEnabled: boolean,
		wrapWidth: number,
		scrollRow: number,
		visibleRowEstimate: number,
	): void {
		const buffer = this.document.model.buffer;
		const lineCount = buffer.getLineCount();
		const needsFullRebuild = this.visualLines.length === 0
			|| this.rowVisualLinePrefix.length !== lineCount
			|| this.rowVisualLineCounts.length !== lineCount
			|| this.visualLinesDirtyByViewport;
		if (needsFullRebuild) {
			this.rebuildAllVisualLines(wordWrapEnabled, wrapWidth);
			this.lastHotRowStart = 0;
			this.lastHotRowEnd = lineCount - 1;
			this.lastHotGuardRows = this.computeHotGuardRows(visibleRowEstimate);
			return;
		}
		const totalVisual = this.visualLines.length;
		let hotStart = this.getRowForVisualIndex(clamp(scrollRow, 0, totalVisual - 1));
		let hotEnd = this.getRowForVisualIndex(clamp(scrollRow + Math.max(1, visibleRowEstimate), 0, totalVisual - 1));
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
		this.rebuildRowRange(wordWrapEnabled, wrapWidth, rebuildStart, rebuildEnd);
		this.lastHotRowStart = hotStart;
		this.lastHotRowEnd = hotEnd;
		this.lastHotGuardRows = this.computeHotGuardRows(visibleRowEstimate);
	}

	private rebuildAllVisualLines(
		wordWrapEnabled: boolean,
		wrapWidth: number,
	): void {
		const buffer = this.document.model.buffer;
		const lineCount = buffer.getLineCount();
		const segments = this.visualLines;
		const counts = this.rowVisualLineCounts;
		const effectiveWrapWidth = wordWrapEnabled ? wrapWidth : Number.POSITIVE_INFINITY;
		this.rowVisualLinePrefix.resizeOrClear(lineCount);
		let writeIndex = 0;
		for (let row = 0; row < lineCount; row += 1) {
			const entry = this.getViewLine(row);
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
			const startIndex = this.rowVisualLinePrefix.prefixSum(row);
			const oldCount = this.rowVisualLineCounts[row];
			const entry = this.getViewLine(row);
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
			target.indentPixels = source.indentPixels;
		}
		for (let index = insertCount; index < deleteCount; index++) this.freeSegments.push(replaced[index]);
		replaced.length = 0;
	}

	private findWrapBreak(line: string, entry: CodeLineView, startColumn: number, wrapWidth: number, continuationWidth: number): number {
		if (wrapWidth === Number.POSITIVE_INFINITY) {
			return line.length;
		}
		let column = startColumn + 1;
		let lastBreakEnd = startColumn;
		while (column <= line.length) {
			const width = this.measureColumns(entry, startColumn, column);
			if (width > wrapWidth) {
				if (lastBreakEnd > startColumn && this.measureColumns(entry, lastBreakEnd, column) <= continuationWidth) {
					return lastBreakEnd;
				}
				return column - 1;
			}
			const ch = line.charAt(column - 1);
			if (ch === ' ' || ch === '\t' || ch === '-') lastBreakEnd = column;
			column += 1;
		}
		return line.length;
	}

	private measureColumns(entry: CodeLineView, startColumn: number, endColumn: number): number {
		return entry.advancePrefix[entry.viewColumnToDisplay[endColumn]] - entry.advancePrefix[entry.viewColumnToDisplay[startColumn]];
	}

	private appendSegment(target: VisualLineSegmentTarget, index: number, row: number, entry: CodeLineView,
		startColumn: number, endColumn: number, indentPixels: number): void {
		const segment = ensureVisualLineSegment(target, index, this.freeSegments);
		segment.row = row;
		segment.startDisplay = entry.viewColumnToDisplay[startColumn];
		segment.endDisplay = entry.viewColumnToDisplay[endColumn];
		segment.startColumn = this.sourceColumnAtDisplay(entry, segment.startDisplay, false);
		segment.endColumn = this.sourceColumnAtDisplay(entry, segment.endDisplay, true);
		segment.indentPixels = indentPixels;
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
			this.appendSegment(target, writeIndex, row, entry, 0, 0, 0);
			return writeIndex + 1;
		}
		const length = line.length;
		let indentPixels = 0;
		if (wordWrapEnabled) {
			let firstContent = 0;
			while (firstContent < entry.src.length && (entry.src.charAt(firstContent) === ' ' || entry.src.charAt(firstContent) === '\t')) firstContent++;
			if (firstContent < entry.src.length) {
				const source = this.measurements.getLine(row);
				const authoredIndent = source.advancePrefix[source.hi.columnToDisplay[firstContent]];
				if (effectiveWrapWidth - authoredIndent >= this.font.charAdvance) indentPixels = authoredIndent;
			}
		}
		const continuationWidth = effectiveWrapWidth - indentPixels;
		let column = 0;
		while (column < length) {
			const segmentIndent = column === 0 ? 0 : indentPixels;
			const nextBreak = wordWrapEnabled
				? this.findWrapBreak(line, entry, column, effectiveWrapWidth - segmentIndent, continuationWidth)
				: length;
			const endColumn = Math.max(column + 1, Math.min(length, nextBreak));
			this.appendSegment(target, writeIndex, row, entry, column, endColumn, segmentIndent);
			writeIndex += 1;
			column = endColumn;
		}
		return writeIndex;
	}

	private computeHotGuardRows(visibleRowEstimate: number): number {
		const guardRows = visibleRowEstimate >> 1;
		return guardRows > 8 ? guardRows : 8;
	}

	private viewportWithinHotWindow(scrollRow: number, visibleRows: number): boolean {
		const buffer = this.document.model.buffer;
		if (this.lastHotRowEnd < this.lastHotRowStart || this.visualLines.length === 0) {
			return false;
		}
		const totalVisual = this.visualLines.length;
		const startRow = this.getRowForVisualIndex(clamp(scrollRow, 0, totalVisual - 1));
		const endVisual = clamp(scrollRow + Math.max(1, visibleRows) - 1, 0, totalVisual - 1);
		const endRow = this.getRowForVisualIndex(endVisual);
		const viewportStartRow = Math.min(startRow, endRow);
		const viewportEndRow = Math.max(startRow, endRow);
		const lineCount = buffer.getLineCount();
		const maxRow = lineCount - 1;
		const guardStart = this.lastHotRowStart === 0 ? 0 : this.lastHotGuardRows;
		const guardEnd = this.lastHotRowEnd >= maxRow ? 0 : this.lastHotGuardRows;
		const guardedStart = Math.max(0, this.lastHotRowStart + guardStart);
		const guardedEnd = Math.max(guardedStart, this.lastHotRowEnd - guardEnd);
		if (viewportStartRow < guardedStart) return false;
		if (viewportEndRow > guardedEnd) return false;
		return true;
	}

	private getRowForVisualIndex(visualIndex: number): number {
		return this.rowVisualLinePrefix.indexAt(clamp(visualIndex, 0, this.visualLines.length - 1));
	}
}
