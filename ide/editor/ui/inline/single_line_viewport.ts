import { charAdvance, getCursorOffset, type InlineFieldMetrics } from './text_field';
import type { InlineFieldCaretView, TextField } from './text_field_model';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorFont } from '../view/font';

/** Whole-glyph viewport for a canvas line edit. Text and its history stay intact. */
export class SingleLineFieldViewport implements InlineFieldCaretView {
	public start = 0;
	public end = 0;
	public offset = 0;
	public caretWidth = 0;
	public readonly advances = [0];
	public readonly caretBounds = create_rect_bounds();
	public readonly clipBounds = create_rect_bounds();
	public textLeft = 0;
	public textTop = 0;
	public lineHeight = 0;
	public renderFont!: EditorFont;
	private text = '';
	private font: object | null = null;
	private width = -1;
	private cursor = -1;
	private bounds!: Readonly<RectBounds>;
	private clip!: Readonly<RectBounds>;
	private metrics!: InlineFieldMetrics;

	public layout(field: TextField, bounds: Readonly<RectBounds>, metrics: InlineFieldMetrics, font: EditorFont, clip: Readonly<RectBounds> = bounds): void {
		this.bounds = bounds; this.clip = clip; this.metrics = metrics; this.renderFont = font;
		field.caretView = this;
		this.updateNativeCaret(field);
	}

	public updateNativeCaret(field: TextField): void {
		const bounds = this.bounds, clip = this.clip, metrics = this.metrics, font = this.renderFont;
		const width = Math.max(0, bounds.right - bounds.left - 6);
		const cursor = getCursorOffset(field);
		const contentChanged = this.text !== field.text || this.font !== font;
		if (contentChanged) {
			this.advances.length = field.text.length + 1;
			this.advances[0] = 0;
			for (let index = 0; index < field.text.length; index += 1) {
				this.advances[index + 1] = this.advances[index] + charAdvance(metrics, field.text.charAt(index));
			}
			this.text = field.text;
			this.font = font;
		}
		if (contentChanged || this.width !== width || this.cursor !== cursor) {
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
		this.lineHeight = font.lineHeight;
		this.textLeft = bounds.left + 3; this.textTop = bounds.top + 2;
		const left = this.textLeft + this.advances[cursor] - this.offset;
		write_rect_bounds(this.caretBounds, left, this.textTop, left + this.caretWidth, this.textTop + this.lineHeight);
		const clipLeft = Math.max(this.textLeft, clip.left), clipTop = Math.max(this.textTop, clip.top);
		write_rect_bounds(this.clipBounds, clipLeft, clipTop,
			Math.max(clipLeft, Math.min(bounds.right - 3, clip.right)), Math.max(clipTop, Math.min(bounds.bottom, clip.bottom)));
		const caret = field.nativeCaret;
		caret.x = Math.max(left, this.clipBounds.left); caret.y = Math.max(this.textTop, this.clipBounds.top);
		caret.width = Math.max(0, Math.min(left + this.caretWidth, this.clipBounds.right) - caret.x);
		caret.height = Math.max(0, Math.min(this.textTop + this.lineHeight, this.clipBounds.bottom) - caret.y);
		if (caret.width === 0 || caret.height === 0) caret.width = caret.height = 0;
	}
}
