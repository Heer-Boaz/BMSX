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
	element: Element;
	readonly label: string[];
	readonly value: string[];
	readonly description: string[];
	top: number;
	bottom: number;
	measured: { label: string; value: string; description: string };
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
	private anchorIndex = -1;
	private anchorOffset = 0;

	public setItems(items: readonly Element[]): void {
		this.rows.length = 0;
		for (const element of items) this.rows.push(this.createRow(element));
		this.selectionIndex = items.length === 0 ? -1 : 0;
		this.hoverIndex = -1;
		this.viewport.scrollbar.setScroll(0);
		this.anchorIndex = -1;
		this.dirty = true;
	}

	/** Refresh a property document by owner-supplied identity, without reopening its control. */
	public updateItems(items: readonly Element[], identity: (element: Element) => string): void {
		const selected = this.rows[this.selectionIndex];
		const selectedId = selected === undefined ? undefined : identity(selected.element);
		this.captureScrollAnchor();
		const anchor = this.rows[this.anchorIndex];
		const anchorId = anchor === undefined ? undefined : identity(anchor.element);
		let selection = -1;
		this.anchorIndex = -1;
		for (let index = 0; index < items.length; index++) {
			const element = items[index], row = this.rows[index];
			if (row === undefined) this.rows.push(this.createRow(element));
			else row.element = element;
			const id = identity(element);
			if (id === selectedId) selection = index;
			if (id === anchorId) this.anchorIndex = index;
		}
		this.rows.length = items.length;
		this.selectionIndex = selection >= 0 ? selection : items.length === 0 ? -1 : 0;
		this.hoverIndex = -1;
		this.dirty = true;
	}

	private captureScrollAnchor(): void {
		if (this.anchorIndex >= 0) return;
		this.anchorIndex = this.rowAt(this.viewport.bounds.top);
		if (this.anchorIndex >= 0) this.anchorOffset = this.viewport.scrollTop - this.rows[this.anchorIndex].top;
	}

	private createRow(element: Element): InspectedPropertyRow<Element> {
		return { element, label: [], value: [], description: [], top: 0, bottom: 0,
			measured: { label: '', value: '', description: '' } };
	}

	public layout(font: BFont, measure: TextRangeMeasure, bounds: RectBounds): void {
		const width = bounds.right - bounds.left - SCROLLBAR_WIDTH;
		let height = this.viewport.contentHeight;
		if (this.dirty || this.width !== width || this.font !== font) {
			this.captureScrollAnchor();
			const remeasure = this.width !== width || this.font !== font;
			this.width = width;
			this.font = font;
			height = 0;
			for (const row of this.rows) {
				row.top = height;
				for (const field of PROPERTY_FIELDS) {
					const lines = row[field];
					const text = row.element[field];
					if (remeasure || row.measured[field] !== text) {
						lines.length = 0;
						if (text.length > 0) for (const line of text.split('\n')) writeWrappedMeasuredLine(lines, line, width - INSPECTOR_PADDING * 2, measure);
						row.measured[field] = text;
					}
					if (text.length === 0) continue;
					height += lines.length * font.lineHeight + INSPECTOR_PADDING;
				}
				height += INSPECTOR_PADDING;
				row.bottom = height;
			}
			this.dirty = false;
		}
		this.viewport.layout(bounds.left, bounds.top, bounds.right, bounds.bottom, height);
		if (this.anchorIndex >= 0) {
			const anchor = this.rows[this.anchorIndex];
			this.viewport.scrollbar.setScroll(anchor.top + Math.min(this.anchorOffset, anchor.bottom - anchor.top - 1));
			this.anchorIndex = -1;
		}
	}

	public select(index: number): void {
		if (this.rows.length === 0) return;
		this.selectionIndex = clamp(index, 0, this.rows.length - 1);
		this.hoverIndex = -1;
		const row = this.rows[this.selectionIndex];
		// Reveal the value as well as its label. The scrollbar lead-aligns oversized
		// rows, so a long callback is still read from its beginning, not its last line.
		this.viewport.scrollbar.reveal(row.top, row.bottom, INSPECTOR_PADDING);
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
