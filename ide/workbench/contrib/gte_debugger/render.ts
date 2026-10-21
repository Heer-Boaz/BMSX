import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as colors from '../../../common/constants';
import { writeWrappedMeasuredLine } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { GteDebuggerInput } from './editor_input';
import type { GteDebugPresentation } from './presentation';

export type GteCommandRow = { sequence: number; top: number; label: string };

/** Host diagram geometry. This does not execute or approximate the GTE datapath. */
export class GteDebugCanvas {
	public readonly points: { x: number; y: number }[] = [];
	private readonly pointStorage = Array.from({ length: 3 }, () => ({ x: 0, y: 0 }));
	private readonly outline: number[] = [];
	private readonly explanation: string[] = [];
	private readonly flagLines: string[] = [];
	private plotTop = 0;
	private plotBottom = 0;
	private axisLabel = '';
	public layout(view: GteDebugPresentation, bounds: RectBounds, font: BFont): void {
		const width = bounds.right - bounds.left - 8;
		this.explanation.length = 0; this.flagLines.length = 0;
		writeWrappedMeasuredLine(this.explanation, view.explanation, width, measureTextRange);
		writeWrappedMeasuredLine(this.flagLines, view.flags, width, measureTextRange);
		this.plotTop = bounds.top + font.lineHeight + 6;
		this.plotBottom = Math.max(this.plotTop + 16, bounds.bottom - (this.explanation.length + this.flagLines.length + Math.max(view.points.length, view.colors.length)) * font.lineHeight - 16);
		this.points.length = 0; this.outline.length = 0; this.axisLabel = '';
		if (view.points.length === 0) return;
		let left = view.points[0].x, right = left, top = view.points[0].y, bottom = top;
		for (const point of view.points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
		this.axisLabel = `X ${left}..${right}  Y ${top}..${bottom}`;
		const scale = Math.min(Math.max(1, width - 32) / Math.max(1, right - left), Math.max(1, this.plotBottom - this.plotTop - font.lineHeight - 24) / Math.max(1, bottom - top));
		const centerX = (bounds.left + bounds.right) / 2, centerY = (this.plotTop + font.lineHeight + this.plotBottom) / 2;
		for (const point of view.points) {
			const target = this.pointStorage[this.points.length];
			target.x = centerX + (point.x - (left + right) / 2) * scale; target.y = centerY + (point.y - (top + bottom) / 2) * scale;
			this.points.push(target); this.outline.push(target.x, target.y);
		}
		if (this.points.length === 3) this.outline.push(this.points[0].x, this.points[0].y);
	}
	public hit(x: number, y: number): number {
		for (let index = this.points.length - 1; index >= 0; index--) {
			const point = this.points[index];
			if (Math.abs(point.x - x) <= 6 && Math.abs(point.y - y) <= 6) return index;
		}
		return -1;
	}
	public draw(input: GteDebuggerInput, view: GteDebugPresentation, font: BFont): void {
		const bounds = input.visualBounds, line = font.lineHeight, left = bounds.left + 4;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(view.heading, left, bounds.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		if (input.selected.sequence < 0) {
			api.blit_text_inline_with_font('No normal GTE commands observed.', left, this.plotTop + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			api.blit_text_inline_with_font('Play or step the existing runtime.', left, this.plotTop + line + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		} else {
			api.blit_rect(left, this.plotTop, bounds.right - 4, this.plotBottom, 0, colors.COLOR_TAB_BORDER);
			if (this.axisLabel !== '') api.blit_text_inline_with_font(this.axisLabel, left + 2, this.plotTop + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			if (this.points.length === 3) api.polyline(this.outline, 0, 0, 0, 1, colors.COLOR_RESOURCE_VIEWER_TEXT);
			for (let index = 0; index < this.points.length; index++) {
				const point = this.points[index], selected = index === input.selectedPoint;
				if (selected) api.blit_rect(point.x - 5, point.y - 5, point.x + 6, point.y + 6, 0, colors.COLOR_FOCUS_BORDER);
				api.fill_rect(point.x - 2, point.y - 2, point.x + 3, point.y + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
				api.blit_text_inline_with_font(view.points[index].label, point.x + 5, point.y - line, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			let y = this.plotBottom + 4;
			for (let index = 0; index < view.points.length; index++, y += line) {
				if (index === input.selectedPoint) api.fill_rect(left, y, bounds.right - 4, y + line, 0, colors.SELECTION_OVERLAY);
				api.blit_text_inline_with_font(view.points[index].value, left, y, 0, index === input.selectedPoint ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			for (let index = 0; index < view.colors.length; index++, y += line) {
				const color = view.colors[index];
				api.fill_rect_color(left, this.plotTop + index * (line + 6) + 4, bounds.right - 8, this.plotTop + index * (line + 6) + line + 6, 0, color.argb);
				api.blit_text_inline_with_font(color.value, left, y, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			for (const text of this.flagLines) { api.blit_text_inline_with_font(text, left, y, 0, colors.COLOR_STATUS_TEXT, font); y += line; }
			y += 4;
			for (const text of this.explanation) { api.blit_text_inline_with_font(text, left, y, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font); y += line; }
		}
		api.popClipRect();
	}
}

export function drawGteDebugger(input: GteDebuggerInput, view: GteDebugPresentation, canvas: GteDebugCanvas, rows: readonly GteCommandRow[]): void {
	const { layout, list } = input, font = layout.font!.renderFont();
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
	renderWorkbenchActionBar(input.actions, font);
	api.pushClipRect(list.bounds.left, list.bounds.top, list.bounds.right, list.bounds.bottom);
	for (const row of rows) {
		const selected = row.sequence === input.selected.sequence;
		if (selected) api.fill_rect(list.bounds.left, row.top, list.bounds.right, row.top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
		api.blit_text_inline_with_font(row.label, list.bounds.left + 2, row.top, 0, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	}
	api.popClipRect(); list.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	canvas.draw(input, view, font);
}
