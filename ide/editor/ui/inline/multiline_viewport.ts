import { writeWrappedSourceLine, type TextRangeMeasure } from '../../../common/text';
import { getCursorOffset } from './text_field';
import type { TextField } from './text_field_model';

export type MultilineFieldRow = { readonly text: string; readonly offset: number; readonly advances: readonly number[] };

/** Retained soft-wrap geometry for small multiline inputs, independent of document views. */
export class MultilineFieldViewport {
	public readonly rows: MultilineFieldRow[] = [];
	public firstRow = 0;
	public cursorRow = 0;
	private text: string | undefined;
	private cursorLogicalRow = -1;
	private cursorColumn = -1;
	private visibleRows = -1;
	private width = -1;
	private font: object | undefined;

	public update(field: TextField, width: number, visibleRows: number, measure: TextRangeMeasure, font: object): void {
		const changed = this.text !== field.text || this.width !== width || this.font !== font;
		if (!changed && this.cursorLogicalRow === field.cursorRow && this.cursorColumn === field.cursorColumn && this.visibleRows === visibleRows) return;
		this.cursorLogicalRow = field.cursorRow; this.cursorColumn = field.cursorColumn; this.visibleRows = visibleRows;
		if (changed) {
			this.text = field.text; this.width = width; this.font = font;
			this.rows.length = 0;
			let offset = 0;
			const wrapped: string[] = [];
			for (const line of field.lines) {
				wrapped.length = 0;
				writeWrappedSourceLine(wrapped, line, width, measure);
				for (const text of wrapped) {
					const advances = [0];
					for (let index = 0; index < text.length; index++) advances.push(advances[index] + measure(text, index, index + 1));
					this.rows.push({ text, offset, advances });
					offset += text.length;
				}
				offset++;
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
