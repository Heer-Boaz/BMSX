import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { ELLIPSIS, firstLineTextPreview, truncateMeasuredText } from '../../common/text';
import { measureTextRange } from '../../editor/common/text/layout';
import { editorViewState } from '../../editor/ui/view/state';
import { api } from '../../runtime/overlay_api';
import { ARTWORK_COLORS } from '../../theme/artwork_colors';

type CaptionLine = { source: string; preview: string; font: BFont; natural: number; available: number; text: string; width: number };
const PADDING = 4;

/** Prepared single-line annotations over arbitrary artwork. Paint consumes
 * retained text/metrics; moving an overlay never remeasures its contents. */
export class WorkbenchCanvasCaption {
	public readonly lines: string[] = [];
	public warningLine = -1;
	private readonly prepared: CaptionLine[] = [];
	private font: BFont | undefined;
	private available = -1;
	private count = 0;
	private width = 0;
	private height = 0;
	public layout(available: number): void {
		const font = editorViewState.font.renderFont(), remeasure = this.font !== font || this.available !== available;
		if (!remeasure && this.count === this.lines.length) {
			let changed = false;
			for (let index = 0; index < this.lines.length; index++) if (this.prepared[index].source !== this.lines[index]) { changed = true; break; }
			if (!changed) return;
		}
		this.font = font; this.available = available;
		let widest = 0;
		for (let index = 0; index < this.lines.length; index++) {
			const source = this.lines[index];
			let line = this.prepared[index];
			if (line === undefined) {
				const preview = firstLineTextPreview(source);
				line = { source, preview, font, natural: font.measure(preview), available: -1, text: '', width: 0 };
				this.prepared[index] = line;
			} else if (line.source !== source || line.font !== font) {
				if (line.source !== source) { line.source = source; line.preview = firstLineTextPreview(source); }
				line.font = font; line.natural = font.measure(line.preview); line.available = -1;
			}
			if (line.available !== available) {
				const text = truncateMeasuredText(line.preview, Math.max(0, available - PADDING * 2), measureTextRange, ELLIPSIS, 'end', line.natural);
				line.text = text; line.width = text === line.preview ? line.natural : font.measure(text); line.available = available;
			}
			widest = Math.max(widest, line.width);
		}
		this.count = this.lines.length;
		this.width = Math.min(available, widest + PADDING * 2);
		this.height = this.lines.length * font.lineHeight + PADDING * 2;
	}
	public draw(left: number, top: number): void {
		if (this.count === 0) return;
		const font = this.font!, ink = ARTWORK_COLORS.annotation;
		api.fill_rect(left, top, left + this.width, top + this.height, 0, ink.background);
		for (let index = 0; index < this.count; index++)
			api.blit_text_inline_with_font(this.prepared[index].text, left + PADDING, top + PADDING + index * font.lineHeight,
				0, index === this.warningLine ? ink.warning : ink.foreground, font);
	}
}
