import { ScratchBuffer } from '../../../machine/ts/common/scratchbuffer';
import { findMeasuredPrefixEnd } from '../../common/text';
import { api } from '../../runtime/overlay_api';
import { measureTextRange } from '../common/text/layout';
import { editorViewState } from './view/state';

type LabelRun = { start: number; end: number; x: number; highlighted: boolean };
const ELLIPSIS = '...';

/** Retained bitmap label geometry; source spans arrive from the query owner. */
export class HighlightedLabel {
	public text = '';
	public visibleEnd = 0;
	public marker = '';
	public readonly runs = new ScratchBuffer<LabelRun>(() => ({ start: 0, end: 0, x: 0, highlighted: false }));
	private markerX = 0;
	private position = 0;
	private readonly advances: number[] = [];

	public layout(text: string, maxWidth: number): void {
		this.text = text;
		this.visibleEnd = text.length;
		this.marker = '';
		if (measureTextRange(text, 0, text.length) > maxWidth) {
			const markerWidth = measureTextRange(ELLIPSIS, 0, ELLIPSIS.length);
			this.visibleEnd = markerWidth <= maxWidth ? findMeasuredPrefixEnd(text, maxWidth - markerWidth, measureTextRange) : 0;
			this.marker = markerWidth <= maxWidth ? ELLIPSIS : '';
		}
		this.advances[0] = 0;
		for (let index = 0; index < this.visibleEnd; index += 1) {
			this.advances[index + 1] = this.advances[index] + measureTextRange(text, index, index + 1);
		}
		this.markerX = this.advances[this.visibleEnd];
	}

	public beginHighlights(): void {
		this.runs.clear(); this.position = 0;
	}

	/** Sorted, non-overlapping source ranges; clipping is presentation, not repair. */
	public addHighlight(start: number, end: number): void {
		if (start >= this.visibleEnd) return;
		this.appendRun(start, false);
		this.appendRun(Math.min(end, this.visibleEnd), true);
	}

	public endHighlights(): void { this.appendRun(this.visibleEnd, false); }

	private appendRun(end: number, highlighted: boolean): void {
		if (this.position === end) return;
		const run = this.runs.get(this.runs.length);
		run.start = this.position; run.end = end; run.x = this.advances[this.position]; run.highlighted = highlighted;
		this.position = end;
	}

	public draw(x: number, y: number, color: number, highlightColor: number): void {
		const font = editorViewState.font.renderFont();
		for (let index = 0; index < this.runs.length; index += 1) {
			const run = this.runs.peek(index);
			api.blit_text_inline_span_with_font(this.text, run.start, run.end, x + run.x, y, 0,
				run.highlighted ? highlightColor : color, font);
		}
		if (this.marker.length > 0) api.blit_text_inline_with_font(this.marker, x + this.markerX, y, 0, color, font);
	}
}
