import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { HostOverlayTransform } from '../../../../machine/ts/render/host_overlay/transform';
import * as colors from '../../../common/constants';
import { forEachWrappedMeasuredRange } from '../../../common/text';
import { measureTextRange } from '../../../editor/common/text/layout';
import { api } from '../../../runtime/overlay_api';
import type { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { GteDebugPresentation } from './presentation';

export type GteDiagramAnchor = { section: string; offset: number; fraction: number; end: boolean; projectedScroll: number | undefined };
type DiagramLine = { text: string; section: string; start: number; end: number; top: number; point: number };
type DiagramSection = { id: string; top: number; bottom: number };

/** Retained content geometry; scrolling changes only the viewport transform, never text measurement. */
export class GteDebugDiagram {
	public readonly points: { x: number; y: number }[] = [];
	public readonly lines: DiagramLine[] = [];
	public contentHeight = 0;
	private readonly sections: DiagramSection[] = [];
	private readonly lineStorage = new ScratchBuffer<DiagramLine>(() => ({ text: '', section: '', start: 0, end: 0, top: 0, point: -1 }));
	private readonly sectionStorage = new ScratchBuffer<DiagramSection>(() => ({ id: '', top: 0, bottom: 0 }));
	private readonly pointStorage = Array.from({ length: 3 }, () => ({ x: 0, y: 0 }));
	private readonly outline: number[] = [];
	private readonly transform: HostOverlayTransform = { scale: 1, offsetX: 0, offsetY: 0 };
	private width = 0;
	private lineHeight = 0;
	private plotTop = 0;
	private plotBottom = 0;
	private connectPoints = false;
	private hasPlot = false;
	private wrappingText = '';
	private wrappingSection = '';
	private wrappingPoint = -1;
	private wrappingTop = 0;
	private readonly emitRange = (start: number, end: number): void => {
		const line = this.lineStorage.get(this.lines.length);
		line.text = this.wrappingText.slice(start, end); line.section = this.wrappingSection;
		line.start = start; line.end = end; line.top = this.wrappingTop; line.point = this.wrappingPoint;
		this.lines.push(line); this.wrappingTop += this.lineHeight;
	};

	public reset(): void {
		this.lines.length = 0; this.sections.length = 0; this.points.length = 0; this.outline.length = 0;
		this.lineStorage.clear(); this.sectionStorage.clear();
		this.hasPlot = false; this.connectPoints = false; this.contentHeight = 0;
	}

	public captureAnchor(view: WorkbenchScrollViewport, anchor: GteDiagramAnchor): void {
		if (this.sections.length === 0 || anchor.projectedScroll === view.scrollTop) return;
		const top = view.scrollTop;
		anchor.projectedScroll = top;
		if (top === 0) { anchor.section = 'origin'; anchor.offset = 0; anchor.fraction = 0; anchor.end = false; return; }
		anchor.end = view.contentHeight > view.height && top + view.height >= view.contentHeight;
		const section = this.sections.find(section => top < section.bottom)!;
		anchor.section = section.id;
		anchor.offset = 0;
		anchor.fraction = (top - section.top) / (section.bottom - section.top);
		if (section.id === 'plot') return;
		const line = this.lines.find(line => line.section === section.id && top < line.top + this.lineHeight);
		if (line !== undefined) { anchor.offset = line.start; anchor.fraction = (top - line.top) / this.lineHeight; }
	}

	public scrollForAnchor(anchor: GteDiagramAnchor, view: WorkbenchScrollViewport): number {
		if (anchor.end) return view.contentHeight - view.height;
		if (anchor.section === 'origin') return 0;
		const section = this.sections.find(section => section.id === anchor.section)!;
		if (section.id === 'plot') return section.top + anchor.fraction * (section.bottom - section.top);
		const line = this.lines.find(line => line.section === anchor.section && (line.end > anchor.offset || line.start === anchor.offset))!;
		return line.top + anchor.fraction * this.lineHeight;
	}

	private appendText(text: string, id: string, top: number, point = -1): number {
		this.wrappingText = text; this.wrappingSection = id; this.wrappingPoint = point; this.wrappingTop = top;
		forEachWrappedMeasuredRange(text, this.width - 8, measureTextRange, this.emitRange);
		const section = this.sectionStorage.get(this.sections.length);
		section.id = id; section.top = top; section.bottom = this.wrappingTop; this.sections.push(section);
		return this.wrappingTop;
	}
	public layout(view: GteDebugPresentation, width: number, font: BFont, height: number): void {
		this.width = width; this.lineHeight = font.lineHeight;
		this.lineStorage.clear(); this.sectionStorage.clear();
		this.lines.length = 0; this.sections.length = 0; this.points.length = 0; this.outline.length = 0;
		let y = this.appendText(view.heading, 'heading', 4);
		this.hasPlot = view.points.length > 0 || view.colors.length > 0;
		this.connectPoints = view.connectPoints;
		if (!this.hasPlot) {
			y = this.appendText(view.explanation, 'explanation', y + 4);
			if (view.flags !== '') y = this.appendText(view.flags, 'flags', y + 4);
			this.contentHeight = y + 4; this.sections[this.sections.length - 1].bottom = this.contentHeight;
			return;
		}
		this.plotTop = y + 4;
		this.plotBottom = this.plotTop + Math.max(font.lineHeight * 6, Math.min(112, height - this.plotTop - 4));
		this.sections[this.sections.length - 1].bottom = this.plotTop;
		const plot = this.sectionStorage.get(this.sections.length);
		plot.id = 'plot'; plot.top = this.plotTop; plot.bottom = this.plotBottom + 4; this.sections.push(plot);
		if (view.points.length > 0) {
			let left = view.points[0].x, right = left, top = view.points[0].y, bottom = top;
			for (const point of view.points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
			this.wrappingText = `${view.horizontalAxis} ${left}..${right}  ${view.verticalAxis} ${top}..${bottom}`;
			this.wrappingSection = 'axis'; this.wrappingPoint = -1; this.wrappingTop = this.plotTop + 2;
			forEachWrappedMeasuredRange(this.wrappingText, width - 16, measureTextRange, this.emitRange);
			const scale = Math.min(Math.max(1, width - 48) / Math.max(1, right - left), Math.max(1, this.plotBottom - this.wrappingTop - 24) / Math.max(1, bottom - top));
			const centerX = width / 2, centerY = (this.wrappingTop + this.plotBottom) / 2;
			for (const point of view.points) {
				const target = this.pointStorage[this.points.length];
				target.x = centerX + (point.x - (left + right) / 2) * scale;
				target.y = centerY + (point.y - (top + bottom) / 2) * scale;
				this.points.push(target); this.outline.push(target.x, target.y);
			}
			if (this.connectPoints) this.outline.push(this.points[0].x, this.points[0].y);
		}
		y = this.plotBottom + 4;
		for (let index = 0; index < view.points.length; index++) y = this.appendText(view.points[index].value, `point:${index}`, y, index);
		for (let index = 0; index < view.colors.length; index++) y = this.appendText(view.colors[index].value, `color:${index}`, y);
		y = this.appendText(view.flags, 'flags', y);
		y = this.appendText(view.explanation, 'explanation', y + 4);
		this.contentHeight = y + 4; this.sections[this.sections.length - 1].bottom = this.contentHeight;
	}

	public hit(x: number, y: number, viewport: WorkbenchScrollViewport): number {
		x -= viewport.bounds.left; y -= viewport.offsetTop;
		for (let index = this.points.length - 1; index >= 0; index--)
			if (Math.abs(this.points[index].x - x) <= 6 && Math.abs(this.points[index].y - y) <= 6) return index;
		return -1;
	}

	public draw(viewport: WorkbenchScrollViewport, view: GteDebugPresentation, selectedPoint: number, font: BFont): void {
		const bounds = viewport.bounds;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.transform.offsetX = bounds.left; this.transform.offsetY = viewport.offsetTop;
		api.pushTransform(this.transform);
		const visibleTop = bounds.top - viewport.offsetTop, visibleBottom = bounds.bottom - viewport.offsetTop;
		if (this.hasPlot && this.plotBottom > visibleTop && this.plotTop < visibleBottom) {
			api.blit_rect(4, this.plotTop, this.width - 4, this.plotBottom, 0, colors.COLOR_TAB_BORDER);
			if (this.connectPoints) api.polyline(this.outline, 0, 0, 0, 1, colors.COLOR_RESOURCE_VIEWER_TEXT);
			for (let index = 0; index < this.points.length; index++) {
				const point = this.points[index];
				if (index === selectedPoint) api.blit_rect(point.x - 5, point.y - 5, point.x + 6, point.y + 6, 0, colors.COLOR_FOCUS_BORDER);
				api.fill_rect(point.x - 2, point.y - 2, point.x + 3, point.y + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
				api.blit_text_inline_with_font(view.points[index].label, point.x + 5, point.y - font.lineHeight, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			}
			for (let index = 0; index < view.colors.length; index++) api.fill_rect_color(8, this.plotTop + index * (font.lineHeight + 6) + 4,
				this.width - 8, this.plotTop + index * (font.lineHeight + 6) + font.lineHeight + 6, 0, view.colors[index].argb);
		}
		for (const line of this.lines) {
			if (line.top + font.lineHeight <= visibleTop) continue;
			if (line.top >= visibleBottom) break;
			if (line.point === selectedPoint && line.point >= 0) api.fill_rect(4, line.top, this.width - 4, line.top + font.lineHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(line.text, line.section === 'axis' ? 6 : 4, line.top, 0,
				line.point === selectedPoint && line.point >= 0 ? colors.COLOR_SELECTION_TEXT : line.section === 'flags' ? colors.COLOR_DESCRIPTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popTransform(); api.popClipRect();
		viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}
