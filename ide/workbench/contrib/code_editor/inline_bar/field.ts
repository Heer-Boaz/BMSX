import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import { SingleLineFieldViewport } from '../../../../editor/ui/inline/single_line_viewport';
import type { TextField } from '../../../../editor/ui/inline/text_field_model';
import type { EditorFont } from '../../../../editor/ui/view/font';
import type { CodeEditorControl } from '../../../../editor/ui/code_editor_control';

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

	public constructor(public readonly code: CodeEditorControl, public readonly field: TextField) {}

	public get visible(): boolean {
		const clip = this.viewport.clipBounds;
		return this.bounds.left + 3 < this.bounds.right - 3 && this.bounds.top + 2 < this.bounds.bottom
			&& clip.left < clip.right && clip.top < clip.bottom;
	}

	public hide(): void {
		if (this.bounds.left === this.bounds.right && this.bounds.top === this.bounds.bottom) return;
		this.font = null;
		write_rect_bounds(this.bounds, 0, 0, 0, 0);
		this.field.nativeCaret.width = 0; this.field.nativeCaret.height = 0;
		const target = this.field.focusTarget;
		if (target.hasFocus) target.release();
		else target.cancelInput();
	}

	public layout(bar: Readonly<RectBounds>, label: string, detail: string, marginY: number, clip: Readonly<RectBounds> = bar): void {
		const font = this.code.font;
		if (this.font !== font || this.left !== bar.left || this.right !== bar.right || this.top !== bar.top
			|| this.bottom !== bar.bottom || this.marginY !== marginY || this.requestedLabel !== label || this.requestedDetail !== detail) {
			this.font = font; this.left = bar.left; this.right = bar.right; this.top = bar.top; this.bottom = bar.bottom;
			this.marginY = marginY;
			this.requestedLabel = label; this.requestedDetail = detail;
			this.labelX = bar.left + 4;
			const gap = this.code.spaceAdvance;
			const minimumFieldWidth = 10 * this.code.charAdvance;
			const width = bar.right - bar.left - 8;
			const labelWidth = font.measure(label) + gap;
			this.label = width >= labelWidth + minimumFieldWidth ? label : '';
			const textLeft = this.labelX + (this.label.length > 0 ? labelWidth : 0);
			const detailWidth = font.measure(detail);
			this.detail = detail.length > 0 && bar.right - 4 - textLeft >= detailWidth + gap + minimumFieldWidth ? detail : '';
			this.detailX = bar.right - 4 - detailWidth;
			const textRight = this.detail.length > 0 ? this.detailX - gap : bar.right - 4;
			write_rect_bounds(this.bounds, textLeft - 3, bar.top + marginY - 2, textRight + 3,
				Math.min(bar.bottom, bar.top + marginY + this.code.lineHeight + 2));
		}
		this.viewport.layout(this.field, this.bounds, this.code.inlineFieldMetrics, font, clip);
		if (!this.visible) this.hide();
	}
}
