import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as colors from '../../../common/constants';
import { writeWrappedMeasuredLine } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { GpuDebuggerInput } from './editor_input';
import type { GpuDebugPresentation } from './presentation';

export type GpuOperationRow = { sequence: number; top: number; label: string };
export type GpuWordRow = { index: number; top: number; label: string };

/** Selected 2D geometry only; no framebuffer, texture sampling or alternate GPU execution. */
export class GpuDebugCanvas {
	public readonly points: { x: number; y: number }[] = [];
	private readonly pointStorage = Array.from({ length: 4 }, () => ({ x: 0, y: 0 }));
	private readonly segments: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0]);
	private segmentCount = 0;
	private readonly plot = create_rect_bounds();
	private readonly clipArea = create_rect_bounds();
	private readonly note: string[] = [];
	private axisLabel = '';
	private areaLabel = '';
	public layout(input: GpuDebuggerInput, view: GpuDebugPresentation, font: BFont): void {
		const bounds = input.visualBounds, width = bounds.right - bounds.left - 8;
		this.note.length = 0; this.points.length = 0; this.segmentCount = 0; this.axisLabel = ''; this.areaLabel = '';
		if (view.explanation !== '') writeWrappedMeasuredLine(this.note, view.explanation, width, measureTextRange);
		const top = bounds.top + font.lineHeight + 6;
		write_rect_bounds(this.plot, bounds.left + 4, top, bounds.right - 4,
			Math.max(top + 16, bounds.bottom - (view.points.length + this.note.length) * font.lineHeight - 12));
		if (view.points.length === 0 || input.view === 'color') return;
		let minX = view.points[0].x, maxX = minX, minY = view.points[0].y, maxY = minY;
		for (const point of view.points) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
		this.axisLabel = `${input.view === 'uv' ? 'U' : 'X'} ${minX}..${maxX}  ${input.view === 'uv' ? 'V' : 'Y'} ${minY}..${maxY}`;
		const scale = Math.min(Math.max(1, width - 32) / Math.max(1, maxX - minX), Math.max(1, this.plot.bottom - top - font.lineHeight - 24) / Math.max(1, maxY - minY));
		const offsetX = (bounds.left + bounds.right) / 2 - (minX + maxX) / 2 * scale;
		const offsetY = (top + font.lineHeight + this.plot.bottom) / 2 - (minY + maxY) / 2 * scale;
		for (const point of view.points) {
			const target = this.pointStorage[this.points.length]; target.x = point.x * scale + offsetX; target.y = point.y * scale + offsetY; this.points.push(target);
		}
		for (let index = 0; index < view.edges.length; index += 2) {
			const start = this.points[view.edges[index]], end = this.points[view.edges[index + 1]], segment = this.segments[this.segmentCount++];
			segment[0] = start.x; segment[1] = start.y; segment[2] = end.x; segment[3] = end.y;
		}
		if (input.view === 'geometry' && view.drawingArea !== undefined) {
			const area = view.drawingArea;
			write_rect_bounds(this.clipArea, area.left * scale + offsetX, area.top * scale + offsetY, area.right * scale + offsetX, area.bottom * scale + offsetY);
			this.areaLabel = `Clip ${area.left},${area.top}..${area.right},${area.bottom} excl.`;
		}
	}
	public hit(x: number, y: number): number {
		for (let index = this.points.length - 1; index >= 0; index--) if (Math.abs(this.points[index].x - x) <= 6 && Math.abs(this.points[index].y - y) <= 6) return index;
		return -1;
	}
	public draw(input: GpuDebuggerInput, view: GpuDebugPresentation, font: BFont): void {
		const bounds = input.visualBounds, line = font.lineHeight, left = bounds.left + 4;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(view.heading, left, bounds.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		if (input.selected.sequence < 0) {
			api.blit_text_inline_with_font(input.filter === '' ? 'No GPU operations observed.' : 'No matching operations.', left, this.plot.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			if (input.filter === '') api.blit_text_inline_with_font('Play or step the existing runtime.', left, this.plot.top + line + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		} else {
			api.blit_rect(this.plot.left, this.plot.top, this.plot.right, this.plot.bottom, 0, colors.COLOR_TAB_BORDER);
			api.pushClipRect(this.plot.left + 1, this.plot.top + line + 2, this.plot.right - 1, this.plot.bottom - 1);
			if (this.areaLabel !== '') api.blit_rect(this.clipArea.left, this.clipArea.top, this.clipArea.right, this.clipArea.bottom, 0, colors.COLOR_FOCUS_BORDER);
			for (let index = 0; index < this.segmentCount; index++) api.polyline(this.segments[index], 0, 0, 0, 1, colors.COLOR_RESOURCE_VIEWER_TEXT);
			for (let index = 0; index < this.points.length; index++) {
				const point = this.points[index];
				if (index === input.selectedPoint) api.blit_rect(point.x - 5, point.y - 5, point.x + 6, point.y + 6, 0, colors.COLOR_FOCUS_BORDER);
				api.fill_rect(point.x - 2, point.y - 2, point.x + 3, point.y + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
				api.blit_text_inline_with_font(view.points[index].label, point.x + 5, point.y - line, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			if (input.view === 'color') for (let index = 0; index < view.points.length; index++) {
				api.fill_rect_color(left + 4, this.plot.top + line + 4 + index * (line + 4), this.plot.right - 4, this.plot.top + line * 2 + 4 + index * (line + 4), 0, view.vertices[index].argb);
			}
			api.popClipRect();
			if (this.axisLabel !== '') api.blit_text_inline_with_font(this.axisLabel, left + 2, this.plot.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			let y = this.plot.bottom + 4;
			for (let index = 0; index < view.points.length; index++, y += line) {
				if (index === input.selectedPoint) api.fill_rect(left, y, bounds.right - 4, y + line, 0, colors.SELECTION_OVERLAY);
				api.blit_text_inline_with_font(view.points[index].value, left, y, 0, index === input.selectedPoint ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			for (const text of this.note) { api.blit_text_inline_with_font(text, left, y, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font); y += line; }
			if (this.areaLabel !== '') api.blit_text_inline_with_font(this.areaLabel, left, this.plot.bottom - line - 2, 0, colors.COLOR_STATUS_TEXT, font);
		}
		api.popClipRect();
	}
}

export function drawGpuDebugger(input: GpuDebuggerInput, view: GpuDebugPresentation, canvas: GpuDebugCanvas,
	rows: readonly GpuOperationRow[], words: readonly GpuWordRow[], diagramFocused: boolean): void {
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
	if (input.view !== 'words') {
		canvas.draw(input, view, font);
		if (diagramFocused) {
			const bounds = input.visualBounds;
			api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
		}
	}
	else {
		api.blit_text_inline_with_font(view.heading, input.visualBounds.left + 4, input.visualBounds.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		const bounds = input.words.bounds;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		for (const row of words) {
			const selected = row.index === input.selectedWord;
			if (selected) api.fill_rect(bounds.left, row.top, bounds.right, row.top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(row.label, bounds.left + 2, row.top, 0, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect(); input.words.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}
