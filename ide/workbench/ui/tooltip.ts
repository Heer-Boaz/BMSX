import { clamp } from '../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { writeWrappedMeasuredLine, type TextRangeMeasure } from '../../common/text';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';
import { drawWorkbenchTooltip } from '../render/tooltip';

/** Retained passive feedback: its owner controls content; the surface owns paint order and admission. */
export class WorkbenchTooltip {
	public readonly bounds = create_rect_bounds();
	private readonly scope = Symbol('tooltip');
	private readonly anchor = create_rect_bounds();
	private readonly area = create_rect_bounds();
	private surface: WorkbenchSurface | undefined;
	private showing = false;
	private title = '';
	private readonly lines: string[] = [];
	private visibleLines = 0;
	private textWidth = 0;
	private font: BFont | undefined;
	private measure: TextRangeMeasure | undefined;
	private measureText: ((text: string) => number) | undefined;

	public attach(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>): void {
		if (this.surface !== undefined) return;
		this.surface = surfaces.attach({ role: 'feedback', lifetimeOwner: owner, captureScope: this.scope,
			getBounds: () => this.bounds, getClip: () => workArea,
			isVisible: () => this.showing && surfaces.isAdmitted(owner),
			draw: () => drawWorkbenchTooltip(this.lines, this.visibleLines, this.bounds, this.font!),
			onRetire: () => { this.surface = undefined; this.showing = false; } });
	}

	public detach(): void { this.surface?.dispose(); }
	public hide(): void { this.showing = false; }

	public show(title: string, anchor: Readonly<RectBounds>, font: BFont, measure: TextRangeMeasure,
		measureText: (text: string) => number, area: Readonly<RectBounds>): void {
		this.showing = true;
		if (this.title === title && this.font === font && this.measure === measure && this.measureText === measureText
			&& this.anchor.left === anchor.left && this.anchor.top === anchor.top && this.anchor.right === anchor.right && this.anchor.bottom === anchor.bottom
			&& this.area.left === area.left && this.area.top === area.top && this.area.right === area.right && this.area.bottom === area.bottom) return;
		const remeasure = this.title !== title || this.font !== font || this.measure !== measure || this.measureText !== measureText
			|| this.area.right - this.area.left !== area.right - area.left;
		this.title = title; this.font = font; this.measure = measure; this.measureText = measureText;
		copy_rect_bounds(this.anchor, anchor); copy_rect_bounds(this.area, area);
		if (remeasure) {
			this.lines.length = 0;
			for (const line of title.split('\n')) writeWrappedMeasuredLine(this.lines, line, area.right - area.left - 8, measure);
			this.textWidth = 0;
			for (const line of this.lines) this.textWidth = Math.max(this.textWidth, measureText(line));
		}
		this.visibleLines = Math.min(this.lines.length, Math.max(0, ((area.bottom - area.top - 6) / font.lineHeight) | 0));
		const width = Math.min(area.right - area.left, this.textWidth + 8);
		const height = Math.min(area.bottom - area.top, this.visibleLines * font.lineHeight + 6);
		const left = clamp(anchor.right - width, area.left, area.right - width);
		const requestedTop = anchor.bottom + height + 2 <= area.bottom ? anchor.bottom + 2 : anchor.top - height - 2;
		const top = clamp(requestedTop, area.top, area.bottom - height);
		write_rect_bounds(this.bounds, left, top, left + width, top + height);
	}
}
