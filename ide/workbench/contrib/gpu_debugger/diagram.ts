import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as colors from '../../../common/constants';
import { forEachWrappedMeasuredRange } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { api } from '../../../runtime/overlay_api';
import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { GpuDebuggerInput } from './editor_input';
import type { GpuDebugPresentation } from './presentation';

export type GpuDiagramViewState = { section: number; textOffset: number; fraction: number; atEnd: boolean };
const PLOT_SECTION = 9;
const SECTION_ORDER = [0, 1, 2, PLOT_SECTION, 3, 4, 5, 6, 7, 8] as const;

/** Retained local layout: scrolling translates paint/hits, never decodes or rewraps annotations. */
export class GpuDebugCanvas {
	public readonly points: { x: number; y: number }[] = [];
	public contentHeight = 0;
	private readonly pointStorage = Array.from({ length: 4 }, () => ({ x: 0, y: 0 }));
	private readonly segments = Array.from({ length: 5 }, () => [0, 0, 0, 0]);
	private segmentCount = 0;
	private showPlot = false;
	private readonly plot = create_rect_bounds();
	private readonly clipArea = create_rect_bounds();
	private readonly sections = Array.from({ length: 10 }, () => ({ text: '', lines: [] as string[], offsets: [] as number[], top: 0, bottom: 0 }));
	private wrappingSection = 0;
	private width = 0;
	private font: BFont | undefined;
	private readonly emitRange = (start: number, end: number): void => {
		const section = this.sections[this.wrappingSection];
		section.lines.push(section.text.slice(start, end)); section.offsets.push(start);
	};

	public layout(input: GpuDebuggerInput, view: GpuDebugPresentation, font: BFont, width: number, viewportHeight: number): void {
		this.font = font; this.width = width;
		const line = font.lineHeight, textWidth = width - 8, sections = this.sections;
		for (const section of sections) { section.text = ''; section.lines.length = 0; section.offsets.length = 0; }
		sections[0].text = input.selected.sequence < 0 ? 'No operation selected' : view.heading;
		sections[8].text = input.selected.sequence < 0 ? 'Select an observed operation in history.' : view.explanation;
		this.points.length = 0; this.segmentCount = 0; this.showPlot = view.points.length > 0;
		let minX = 0, maxX = 0, minY = 0, maxY = 0;
		if (view.points.length > 0 && input.view !== 'color') {
			minX = maxX = view.points[0].x; minY = maxY = view.points[0].y;
			for (const point of view.points) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
			sections[1].text = `${input.view === 'uv' ? 'U' : 'X'} ${minX}..${maxX}`;
			sections[2].text = `${input.view === 'uv' ? 'V' : 'Y'} ${minY}..${maxY}`;
		}
		if (input.view === 'geometry' && view.drawingArea !== undefined) {
			const area = view.drawingArea;
			sections[3].text = `Clip ${area.left},${area.top}..${area.right},${area.bottom} excl.`;
		}
		for (let index = 0; index < view.points.length; index++) sections[index + 4].text = view.points[index].value;
		for (let index = 0; index < sections.length; index++) {
			this.wrappingSection = index;
			if (sections[index].text !== '') forEachWrappedMeasuredRange(sections[index].text, textWidth, measureTextRange, this.emitRange);
		}
		let top = 0;
		for (let index = 0; index < 3; index++) {
			const section = sections[index]; section.top = top; top += section.lines.length * line; section.bottom = top;
		}
		top += 4;
		let annotationHeight = 0;
		for (let index = 3; index < 9; index++) annotationHeight += sections[index].lines.length * line;
		const minimumPlot = Math.max(line * 8, input.view === 'color' ? view.points.length * (line + 4) + 8 : 0);
		const plotHeight = this.showPlot ? Math.max(minimumPlot, viewportHeight - top - annotationHeight - 12) : 0;
		write_rect_bounds(this.plot, 4, top, width - 4, top + plotHeight);
		sections[PLOT_SECTION].top = top; sections[PLOT_SECTION].bottom = top + plotHeight;
		top += plotHeight + (this.showPlot ? 4 : 0);
		for (let index = 3; index < 9; index++) {
			const section = sections[index]; section.top = top; top += section.lines.length * line; section.bottom = top;
		}
		this.contentHeight = top + 4;
		if (view.points.length === 0 || input.view === 'color') return;
		const scale = Math.min(Math.max(1, textWidth - 32) / Math.max(1, maxX - minX), Math.max(1, plotHeight - line - 24) / Math.max(1, maxY - minY));
		const offsetX = width / 2 - (minX + maxX) / 2 * scale;
		const offsetY = (this.plot.top + this.plot.bottom) / 2 - (minY + maxY) / 2 * scale;
		for (const point of view.points) {
			const target = this.pointStorage[this.points.length]; target.x = point.x * scale + offsetX; target.y = point.y * scale + offsetY; this.points.push(target);
		}
		for (let index = 0; index < view.edges.length; index += 2) {
			const start = this.points[view.edges[index]], end = this.points[view.edges[index + 1]], segment = this.segments[this.segmentCount++];
			segment[0] = start.x; segment[1] = start.y; segment[2] = end.x; segment[3] = end.y;
		}
		if (sections[3].text !== '') {
			const area = view.drawingArea!;
			write_rect_bounds(this.clipArea, area.left * scale + offsetX, area.top * scale + offsetY, area.right * scale + offsetX, area.bottom * scale + offsetY);
		}
	}

	public saveViewState(view: WorkbenchScrollViewport, state: GpuDiagramViewState): void {
		const scroll = view.scrollTop, maximum = view.scrollbar.getMaximumScroll();
		state.atEnd = maximum > 0 && scroll >= maximum;
		for (const index of SECTION_ORDER) {
			const section = this.sections[index];
			if (section.bottom === section.top || section.bottom <= scroll) continue;
			state.section = index;
			const offset = Math.max(0, scroll - section.top);
			if (index === PLOT_SECTION) { state.textOffset = 0; state.fraction = offset / (section.bottom - section.top); }
			else {
				const line = Math.trunc(offset / this.font!.lineHeight);
				state.textOffset = section.offsets[line]; state.fraction = offset / this.font!.lineHeight - line;
			}
			return;
		}
	}

	public restoreViewState(view: WorkbenchScrollViewport, state: Readonly<GpuDiagramViewState>): void {
		if (state.atEnd) { view.scrollbar.setScroll(view.scrollbar.getMaximumScroll()); return; }
		const section = this.sections[state.section];
		if (state.section === PLOT_SECTION) view.scrollbar.setScroll(section.top + (section.bottom - section.top) * state.fraction);
		else {
			let line = 0;
			while (line + 1 < section.offsets.length && section.offsets[line + 1] <= state.textOffset) line++;
			view.scrollbar.setScroll(section.top + (line + state.fraction) * this.font!.lineHeight);
		}
	}

	public hit(x: number, y: number): number {
		if (x < 4 || x >= this.width - 4) return -1;
		for (let index = 0; index < 4; index++) {
			const section = this.sections[index + 4];
			if (y >= section.top && y < section.bottom) return index;
		}
		if (y < this.plot.top + 1 || y >= this.plot.bottom - 1) return -1;
		for (let index = this.points.length - 1; index >= 0; index--)
			if (Math.abs(this.points[index].x - x) <= 6 && Math.abs(this.points[index].y - y) <= 6) return index;
		return -1;
	}

	/** The caller establishes the viewport clip and local-to-screen transform once. */
	public draw(input: GpuDebuggerInput, view: GpuDebugPresentation, visibleTop: number, visibleBottom: number): void {
		const font = this.font!, line = font.lineHeight;
		if (this.showPlot && this.plot.bottom > visibleTop && this.plot.top < visibleBottom) {
			api.blit_rect(this.plot.left, this.plot.top, this.plot.right, this.plot.bottom, 0, colors.COLOR_TAB_BORDER);
			api.pushClipRect(this.plot.left + 1, this.plot.top + 1, this.plot.right - 1, this.plot.bottom - 1);
			if (this.sections[3].text !== '') api.blit_rect(this.clipArea.left, this.clipArea.top, this.clipArea.right, this.clipArea.bottom, 0, colors.COLOR_FOCUS_BORDER);
			for (let index = 0; index < this.segmentCount; index++) api.polyline(this.segments[index], 0, 0, 0, 1, colors.COLOR_RESOURCE_VIEWER_TEXT);
			for (let index = 0; index < this.points.length; index++) {
				const point = this.points[index];
				if (index === input.selectedPoint) api.blit_rect(point.x - 5, point.y - 5, point.x + 6, point.y + 6, 0, colors.COLOR_FOCUS_BORDER);
				api.fill_rect(point.x - 2, point.y - 2, point.x + 3, point.y + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
				api.blit_text_inline_with_font(view.points[index].label, point.x + 5, point.y - line, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			if (input.view === 'color') for (let index = 0; index < view.points.length; index++) {
				const top = this.plot.top + 4 + index * (line + 4);
				api.fill_rect_color(this.plot.left + 4, top, this.plot.right - 4, top + line, 0, view.vertices[index].argb);
			}
			api.popClipRect();
		}
		for (let index = 0; index < 9; index++) {
			const section = this.sections[index];
			if (section.bottom <= visibleTop || section.top >= visibleBottom) continue;
			const selected = index >= 4 && index < 8 && index - 4 === input.selectedPoint;
			if (selected && section.lines.length > 0) api.fill_rect(4, section.top, this.width - 4, section.bottom, 0, colors.SELECTION_OVERLAY);
			const first = Math.max(0, Math.trunc((visibleTop - section.top) / line));
			const end = Math.min(section.lines.length, Math.trunc((visibleBottom - section.top + line - 1) / line));
			for (let row = first; row < end; row++) api.blit_text_inline_with_font(section.lines[row], 4, section.top + row * line, 0,
				selected ? colors.COLOR_SELECTION_TEXT : index === 3 ? colors.COLOR_DESCRIPTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
	}
}
