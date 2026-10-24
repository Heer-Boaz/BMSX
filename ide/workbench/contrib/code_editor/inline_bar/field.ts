import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import { SingleLineFieldViewport } from '../../../../editor/ui/inline/single_line_viewport';
import { getCursorOffset } from '../../../../editor/ui/inline/text_field';
import type { TextField } from '../../../../editor/ui/inline/text_field_model';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { editorViewState } from '../../../../editor/ui/view/state';

/** Editor-local line edit geometry shared by paint, pointer selection and native input. */
export class InlineBarFieldLayout {
	public readonly bounds = create_rect_bounds();
	public readonly viewport = new SingleLineFieldViewport();
	public label = '';
	public detail = '';
	public labelX = 0;
	public detailX = 0;
	private font: EditorFont | null = null;
	private left = -1;
	private top = -1;
	private right = -1;
	private bottom = -1;
	private marginY = -1;
	private requestedLabel = '';
	private requestedDetail = '';
	private visible = false;

	public constructor(public readonly field: TextField) {}

	public hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.field.focusTarget.cancelInput();
		this.field.nativeCaret.width = 0; this.field.nativeCaret.height = 0;
	}

	public layout(bar: Readonly<RectBounds>, label: string, detail: string, marginY: number): void {
		this.visible = true;
		const font = editorViewState.font;
		if (this.font !== font || this.left !== bar.left || this.right !== bar.right || this.top !== bar.top
			|| this.bottom !== bar.bottom || this.marginY !== marginY || this.requestedLabel !== label || this.requestedDetail !== detail) {
			this.font = font; this.left = bar.left; this.right = bar.right; this.top = bar.top; this.bottom = bar.bottom;
			this.marginY = marginY;
			this.requestedLabel = label; this.requestedDetail = detail;
			this.labelX = bar.left + 4;
			const gap = editorViewState.spaceAdvance;
			const minimumFieldWidth = 10 * editorViewState.charAdvance;
			const width = bar.right - bar.left - 8;
			const labelWidth = font.measure(label) + gap;
			this.label = width >= labelWidth + minimumFieldWidth ? label : '';
			const textLeft = this.labelX + (this.label.length > 0 ? labelWidth : 0);
			const detailWidth = font.measure(detail);
			this.detail = detail.length > 0 && bar.right - 4 - textLeft >= detailWidth + gap + minimumFieldWidth ? detail : '';
			this.detailX = bar.right - 4 - detailWidth;
			const textRight = this.detail.length > 0 ? this.detailX - gap : bar.right - 4;
			write_rect_bounds(this.bounds, textLeft - 3, bar.top + marginY - 2, textRight + 3,
				Math.min(bar.bottom, bar.top + marginY + editorViewState.lineHeight + 2));
		}
		this.viewport.update(this.field, Math.max(0, this.bounds.right - this.bounds.left - 6),
			editorViewState.inlineFieldMetricsRef, font.renderFont());
		const caret = this.field.nativeCaret;
		caret.x = this.bounds.left + 3 + this.viewport.advances[getCursorOffset(this.field)] - this.viewport.offset;
		caret.y = this.bounds.top + 2;
		caret.width = this.viewport.caretWidth;
		caret.height = editorViewState.lineHeight;
	}
}
