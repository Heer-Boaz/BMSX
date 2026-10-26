import type { CodeLineView } from '../../../common/models';
import type { EditorFont } from '../view/font';
import type { CodeDocumentProjection } from './document_projection';

type MeasuredLine = CodeLineView & { tokenGeneration: number };

/** Shared glyph geometry for one actual document/font generation. */
export class CodeDocumentMeasurements {
	private readonly lines = new Map<number, MeasuredLine>();
	private readonly sourceWidths: number[];
	private dirtyStartRow = 0;
	private dirtyEndRow: number;
	private sourceMaxDirty = false;
	private maxSourceWidth = 0;
	private maxSourceRow = -1;
	private secondSourceWidth = 0;
	private secondSourceRow = -1;

	public constructor(public readonly document: CodeDocumentProjection, public readonly font: EditorFont,
		private readonly maxHighlightCache: number) {
		this.sourceWidths = new Array(document.model.buffer.getLineCount()).fill(-1);
		this.dirtyEndRow = this.sourceWidths.length - 1;
	}

	public invalidateSource(startRow: number, endRow: number, lineCount: number): void {
		const widths = this.sourceWidths, lineCountChanged = widths.length !== lineCount;
		if (lineCountChanged) {
			widths.length = lineCount;
			endRow = lineCount - 1;
			this.sourceMaxDirty = true;
		}
		widths.fill(-1, startRow, endRow + 1);
		this.dirtyStartRow = Math.min(this.dirtyStartRow, startRow);
		this.dirtyEndRow = Math.min(lineCount - 1, Math.max(this.dirtyEndRow, endRow));
		for (const row of this.lines.keys()) {
			if (row >= startRow && (lineCountChanged || row <= endRow)) this.lines.delete(row);
		}
	}

	public getLine(row: number): CodeLineView {
		const document = this.document, cached = this.lines.get(row);
		if (cached !== undefined && cached.tokenGeneration === document.tokenGeneration) return cached;
		const source = document.getSourceLine(row), highlight = source.hi;
		// Source edits remove affected rows; a retained row only needs new token colors.
		if (cached !== undefined) {
			cached.hi = highlight;
			cached.viewColumnToDisplay = highlight.columnToDisplay;
			cached.tokenGeneration = document.tokenGeneration;
			return cached;
		}
		const inverse = new Array<number>(highlight.text.length + 1);
		for (let column = 0; column < source.src.length; column++) {
			const end = highlight.columnToDisplay[column + 1];
			for (let display = highlight.columnToDisplay[column]; display < end; display++) inverse[display] = column;
		}
		inverse[highlight.text.length] = source.src.length;
		const advances = new Array<number>(highlight.text.length + 1);
		advances[0] = 0;
		for (let display = 0; display < highlight.text.length; display++) advances[display + 1] = advances[display] + this.font.advance(highlight.text.charAt(display));
		const line: MeasuredLine = {
			src: source.src, viewText: source.src, hi: highlight, viewColumnToDisplay: highlight.columnToDisplay,
			displayToColumn: inverse, advancePrefix: advances, inline: null, tokenGeneration: document.tokenGeneration,
		};
		this.lines.set(row, line);
		if (this.lines.size > this.maxHighlightCache) this.lines.delete(this.lines.keys().next().value!);
		this.recordSourceWidth(row, advances[advances.length - 1]);
		return line;
	}

	private recordSourceWidth(row: number, width: number): void {
		if (this.sourceWidths[row] === width) return;
		this.sourceWidths[row] = width;
		if (this.sourceMaxDirty) return;
		if (row === this.maxSourceRow) {
			if (width < this.maxSourceWidth) this.sourceMaxDirty = true;
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

	/** Widths are scalar source data; projected text never enters this index. */
	public maxSourceWidthExcluding(excludedRow = -1): number {
		const widths = this.sourceWidths;
		for (let row = this.dirtyStartRow; row <= this.dirtyEndRow; row++) if (widths[row] === -1) this.getLine(row);
		this.dirtyStartRow = widths.length;
		this.dirtyEndRow = -1;
		if (this.sourceMaxDirty) {
			this.maxSourceWidth = this.secondSourceWidth = 0;
			this.maxSourceRow = this.secondSourceRow = -1;
			for (let row = 0; row < widths.length; row++) {
				const width = widths[row];
				if (width > this.maxSourceWidth) {
					this.secondSourceWidth = this.maxSourceWidth; this.secondSourceRow = this.maxSourceRow;
					this.maxSourceWidth = width; this.maxSourceRow = row;
				} else if (width > this.secondSourceWidth) { this.secondSourceWidth = width; this.secondSourceRow = row; }
			}
			this.sourceMaxDirty = false;
		}
		return excludedRow === this.maxSourceRow ? this.secondSourceWidth : this.maxSourceWidth;
	}

	public dispose(): void {
		this.lines.clear();
		this.sourceWidths.length = 0;
	}
}
