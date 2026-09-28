import { forEachWrappedMeasuredRange, writeWrappedSourceLine } from '../../../common/text';
import { TextStyle, type SourceTextStyle } from '../../../common/markdown/model';
import type { StyledMeasure } from '../../../common/markdown/layout';
import { getCursorOffset } from './text_field';
import type { TextField } from './text_field_model';

export type MultilineFieldRow = { readonly text: string; readonly offset: number; readonly advances: readonly number[]; readonly styles?: readonly SourceTextStyle[] };

/** Retained soft-wrap geometry for small multiline inputs, independent of document views. */
export class MultilineFieldViewport {
	public constructor(private readonly wordWrap = false) {}
	public readonly rows: MultilineFieldRow[] = [];
	public firstRow = 0;
	public cursorRow = 0;
	private text: string | undefined;
	private cursorLogicalRow = -1;
	private cursorColumn = -1;
	private visibleRows = -1;
	private width = -1;
	private font: object | undefined;
	private styles: readonly SourceTextStyle[] | undefined;

	public update(field: TextField, width: number, visibleRows: number, measure: StyledMeasure, font: object, styles?: readonly SourceTextStyle[]): void {
		const changed = this.text !== field.text || this.width !== width || this.font !== font || this.styles !== styles;
		if (!changed && this.cursorLogicalRow === field.cursorRow && this.cursorColumn === field.cursorColumn && this.visibleRows === visibleRows) return;
		this.cursorLogicalRow = field.cursorRow; this.cursorColumn = field.cursorColumn; this.visibleRows = visibleRows;
		if (changed) {
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
		const cursor = getCursorOffset(field);
		this.cursorRow = this.rows.length - 1;
		while (this.cursorRow > 0 && this.rows[this.cursorRow].offset > cursor) this.cursorRow--;
		this.firstRow = Math.max(0, Math.min(this.firstRow, this.rows.length - visibleRows, this.cursorRow));
		if (this.cursorRow >= this.firstRow + visibleRows) this.firstRow = this.cursorRow - visibleRows + 1;
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
