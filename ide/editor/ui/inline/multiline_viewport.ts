import { forEachWrappedMeasuredRange, writeWrappedSourceLine } from '../../../common/text';
import { TextStyle, type SourceTextStyle } from '../../../common/markdown/model';
import type { StyledMeasure } from '../../../common/markdown/layout';
import { getCursorOffset } from './text_field';
import type { InlineFieldCaretView, TextField } from './text_field_model';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorFont } from '../view/font';

export type MultilineFieldRow = { readonly text: string; readonly offset: number; readonly advances: readonly number[]; readonly styles?: readonly SourceTextStyle[] };

/** Retained soft-wrap geometry for small multiline inputs, independent of document views. */
export class MultilineFieldViewport implements InlineFieldCaretView {
	public constructor(private readonly wordWrap = false) {}
	public readonly rows: MultilineFieldRow[] = [];
	public firstRow = 0;
	public cursorRow = 0;
	public readonly caretBounds = create_rect_bounds();
	public readonly clipBounds = create_rect_bounds();
	public textLeft = 0;
	public textTop = 0;
	public lineHeight = 0;
	public renderFont!: EditorFont;
	private text: string | undefined;
	private width = -1;
	private font: object | undefined;
	private styles: readonly SourceTextStyle[] | undefined;
	private cursorLogicalRow = -1;
	private cursorColumn = -1;
	private cursorOffset = -1;
	private visibleRows = -1;
	private caretWidth = 0;
	private bounds!: Readonly<RectBounds>;
	private clip!: Readonly<RectBounds>;
	private measureText!: StyledMeasure;
	private measureFont!: object;
	private styleSource: { readonly styles: readonly SourceTextStyle[] } | undefined;

	public measure(field: TextField, width: number, measure: StyledMeasure, font: object, source?: { readonly styles: readonly SourceTextStyle[] }): void {
		this.measureText = measure; this.measureFont = font; this.styleSource = source;
		const styles = source?.styles;
		const changed = this.text !== field.text || this.width !== width || this.font !== font || this.styles !== styles;
		if (changed) {
			this.cursorOffset = -1;
			this.text = field.text; this.width = width; this.font = font; this.styles = styles;
			this.rows.length = 0;
			let offset = 0, measuringStyle = 0, rowStyle = 0;
			const wrapped: string[] = [];
			for (const line of field.lines) {
				// One glyph measurement pass feeds wrapping, pointer hits and the caret.
				const advances = [0];
				for (let index = 0; index < line.length;) {
					if (styles) while (styles[measuringStyle].to <= offset + index) measuringStyle++;
					const step = line.codePointAt(index)! > 0xffff ? 2 : 1;
					const next = advances[index] + measure(line, index, index + step, styles ? styles[measuringStyle].style : TextStyle.Plain);
					if (step === 2) advances.push(advances[index]);
					advances.push(next); index += step;
				}
				const measureRange = (_text: string, start: number, end: number) => advances[end] - advances[start];
				const emit = (from: number, to: number) => {
					const positions = advances.slice(from, to + 1);
					for (let index = 0; index < positions.length; index++) positions[index] -= advances[from];
					const rowStyles: SourceTextStyle[] | undefined = styles ? [] : undefined;
					if (styles) {
						while (rowStyle < styles.length && styles[rowStyle].to <= offset + from) rowStyle++;
						for (let index = rowStyle; index < styles.length && styles[index].from < offset + to; index++) {
							const span = styles[index];
							rowStyles!.push({ from: Math.max(from, span.from - offset) - from, to: Math.min(to, span.to - offset) - from, style: span.style });
						}
					}
					this.rows.push({ text: line.slice(from, to), offset: offset + from, advances: positions, styles: rowStyles });
				};
				if (this.wordWrap) forEachWrappedMeasuredRange(line, width, measureRange, emit, true);
				else {
					wrapped.length = 0; writeWrappedSourceLine(wrapped, line, width, measureRange);
					let from = 0;
					for (const text of wrapped) { emit(from, from + text.length); from += text.length; }
				}
				offset += line.length + 1;
			}
		}
	}

	/** Arrange the already measured rows in the actual client before native focus publication. */
	public layout(field: TextField, bounds: Readonly<RectBounds>, font: EditorFont, clip: Readonly<RectBounds> = bounds): void {
		if (this.renderFont !== font) { this.renderFont = font; this.lineHeight = font.lineHeight; this.caretWidth = font.advance(' '); }
		this.bounds = bounds; this.clip = clip;
		field.caretView = this;
		this.updateNativeCaret(field);
	}

	public updateNativeCaret(field: TextField): void {
		this.measure(field, this.width, this.measureText, this.measureFont, this.styleSource);
		const bounds = this.bounds, clip = this.clip;
		this.textLeft = bounds.left + 3; this.textTop = bounds.top + 2;
		const visibleRows = Math.max(0, Math.trunc((bounds.bottom - this.textTop) / this.lineHeight));
		const cursorChanged = this.cursorOffset < 0 || this.cursorLogicalRow !== field.cursorRow || this.cursorColumn !== field.cursorColumn;
		if (cursorChanged) {
			this.cursorLogicalRow = field.cursorRow; this.cursorColumn = field.cursorColumn;
			this.cursorOffset = getCursorOffset(field);
			this.cursorRow = this.rows.length - 1;
			while (this.cursorRow > 0 && this.rows[this.cursorRow].offset > this.cursorOffset) this.cursorRow--;
		}
		if (visibleRows > 0 && (cursorChanged || this.visibleRows !== visibleRows)) {
			this.firstRow = Math.max(0, Math.min(this.firstRow, this.rows.length - visibleRows, this.cursorRow));
			if (this.cursorRow >= this.firstRow + visibleRows) this.firstRow = this.cursorRow - visibleRows + 1;
		}
		this.visibleRows = visibleRows;
		const row = this.rows[this.cursorRow];
		const left = this.textLeft + row.advances[this.cursorOffset - row.offset];
		const top = this.textTop + (this.cursorRow - this.firstRow) * this.lineHeight;
		const width = this.caretWidth;
		write_rect_bounds(this.caretBounds, left, top, left + width, top + this.lineHeight);
		const clipLeft = Math.max(this.textLeft, clip.left), clipTop = Math.max(this.textTop, clip.top);
		write_rect_bounds(this.clipBounds, clipLeft, clipTop,
			Math.max(clipLeft, Math.min(bounds.right - 3, clip.right)), Math.max(clipTop, Math.min(bounds.bottom, clip.bottom)));
		const caret = field.nativeCaret;
		caret.x = Math.max(left, this.clipBounds.left); caret.y = Math.max(top, this.clipBounds.top);
		caret.width = Math.max(0, Math.min(left + width, this.clipBounds.right) - caret.x);
		caret.height = Math.max(0, Math.min(top + this.lineHeight, this.clipBounds.bottom) - caret.y);
		if (visibleRows === 0 || caret.width === 0 || caret.height === 0) caret.width = caret.height = 0;
	}

	public offsetAt(row: number, x: number): number {
		const target = this.rows[Math.max(0, Math.min(row, this.rows.length - 1))];
		let column = 0;
		while (column < target.text.length) {
			const step = target.text.codePointAt(column)! > 0xffff ? 2 : 1;
			if (x < (target.advances[column] + target.advances[column + step]) / 2) break;
			column += step;
		}
		return target.offset + column;
	}
}
