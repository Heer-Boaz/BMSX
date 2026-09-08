import { charAdvance, getCursorOffset, type InlineFieldMetrics } from './text_field';
import type { TextField } from './text_field_model';

/** Whole-glyph viewport for a canvas line edit. Text and its history stay intact. */
export class SingleLineFieldViewport {
	public start = 0;
	public end = 0;
	public offset = 0;
	public caretWidth = 0;
	public readonly advances = [0];
	private text = '';
	private font: object | null = null;
	private width = -1;
	private cursor = -1;

	public update(field: TextField, width: number, metrics: InlineFieldMetrics, font: object): void {
		const cursor = getCursorOffset(field);
		const contentChanged = this.text !== field.text || this.font !== font;
		if (!contentChanged && this.width === width && this.cursor === cursor) return;
		if (contentChanged) {
			this.advances.length = field.text.length + 1;
			this.advances[0] = 0;
			for (let index = 0; index < field.text.length; index += 1) {
				this.advances[index + 1] = this.advances[index] + charAdvance(metrics, field.text.charAt(index));
			}
			this.text = field.text;
			this.font = font;
		}
		this.width = width;
		this.cursor = cursor;
		this.caretWidth = charAdvance(metrics, cursor < field.text.length ? field.text.charAt(cursor) : ' ');
		this.start = Math.min(this.start, cursor);
		while (this.start < cursor && this.advances[cursor] + this.caretWidth - this.advances[this.start] > width) this.start += 1;
		while (this.start > 0 && this.advances[field.text.length] + charAdvance(metrics, ' ') - this.advances[this.start - 1] <= width) this.start -= 1;
		this.offset = this.advances[this.start];
		this.end = this.start;
		while (this.end < field.text.length && this.advances[this.end + 1] - this.offset <= width) this.end += 1;
	}
}
