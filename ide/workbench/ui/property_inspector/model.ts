import { clamp } from '../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';
import type { WorkbenchPropertyElement } from '../property_tree';
import { WorkbenchScrollViewport } from '../scroll_viewport';

/** Same property display contract as the compact tree, without its truncated columns. */
export type InspectedProperty = Pick<WorkbenchPropertyElement, 'label' | 'value' | 'description' | 'warning'>;
export type InspectedPropertyRow<Element> = {
	readonly element: Element;
	readonly label: string[];
	readonly value: string[];
	readonly description: string[];
	top: number;
	bottom: number;
};
export const INSPECTOR_PADDING = 4;

/** One fully readable document. Values are measured once, not fetched during paint. */
export class WorkbenchPropertyInspectorModel<Element extends InspectedProperty> {
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly rows: InspectedPropertyRow<Element>[] = [];
	public selectionIndex = -1;
	public hoverIndex = -1;
	public font: BFont | undefined;
	private width = 0;
	private dirty = true;

	public setItems(items: readonly Element[]): void {
		this.rows.length = 0;
		for (const element of items) this.rows.push({ element, label: [], value: [], description: [], top: 0, bottom: 0 });
		this.selectionIndex = items.length === 0 ? -1 : 0;
		this.hoverIndex = -1;
		this.viewport.scrollbar.setScroll(0);
		this.dirty = true;
	}

	public layout(font: BFont, measure: TextRangeMeasure, bounds: RectBounds): void {
		const width = bounds.right - bounds.left - SCROLLBAR_WIDTH;
		let height = this.viewport.contentHeight;
		if (this.dirty || this.width !== width || this.font !== font) {
			this.width = width;
			this.font = font;
			height = 0;
			for (const row of this.rows) {
				row.top = height;
				for (const field of PROPERTY_FIELDS) {
					const lines = row[field];
					lines.length = 0;
					const text = row.element[field];
					if (text.length === 0) continue;
					for (const line of text.split('\n')) writeWrappedMeasuredLine(lines, line, width - INSPECTOR_PADDING * 2, measure);
					height += lines.length * font.lineHeight + INSPECTOR_PADDING;
				}
				height += INSPECTOR_PADDING;
				row.bottom = height;
			}
			this.dirty = false;
		}
		this.viewport.layout(bounds.left, bounds.top, bounds.right, bounds.bottom, height);
	}

	public select(index: number): void {
		if (this.rows.length === 0) return;
		this.selectionIndex = clamp(index, 0, this.rows.length - 1);
		this.hoverIndex = -1;
		const row = this.rows[this.selectionIndex];
		// A long value is read with page/wheel scrolling, not skipped to its last line.
		this.viewport.scrollbar.reveal(row.top, row.top + this.font!.lineHeight + INSPECTOR_PADDING * 2, INSPECTOR_PADDING);
	}

	public rowAt(y: number): number {
		const offset = y - this.viewport.offsetTop;
		let low = 0, high = this.rows.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.rows[middle].bottom <= offset) low = middle + 1;
			else high = middle;
		}
		return low < this.rows.length && this.rows[low].top <= offset ? low : -1;
	}
}

const PROPERTY_FIELDS = ['label', 'value', 'description'] as const;
