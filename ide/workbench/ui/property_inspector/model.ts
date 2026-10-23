import { clamp } from '../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { ELLIPSIS, truncateMeasuredText, writeWrappedMeasuredLine, type TextRangeMeasure } from '../../../common/text';
import type { WorkbenchPropertyElement } from '../property_tree';
import { WorkbenchScrollViewport } from '../scroll_viewport';
import { WORKBENCH_ICON_SIZE } from '../icon';

/** Same property display contract as the compact tree, without its truncated columns. */
export type InspectedProperty = Pick<WorkbenchPropertyElement, 'label' | 'value' | 'description' | 'warning'> & {
	/** The inspecting owner compares observations; painting never advances that baseline. */
	readonly valueChanged?: boolean;
	/** Field/value rows are compact; source excerpts remain full readable documents. */
	readonly compact?: boolean;
	/** Scalar annotations may be explicitly disclosed; interpretation-critical context remains inline. */
	readonly descriptionDisplay?: 'inline' | 'disclosure';
	readonly depth?: number;
	readonly group?: boolean;
	readonly expansion?: {
		readonly expanded: boolean;
		setExpanded(expanded: boolean): void;
	};
};
export type InspectedPropertyRow<Element> = {
	element: Element;
	readonly label: string[];
	readonly value: string[];
	readonly description: string[];
	top: number;
	bottom: number;
	labelLeft: number;
	valueLeft: number;
	disclosureLeft: number;
	textExpandable: boolean;
	textExpanded: boolean;
	headerHeight: number;
	measured: { label: string; value: string; description: string; depth: number; compact: boolean; group: boolean; descriptionDisplay: InspectedProperty['descriptionDisplay'] };
};
/** A document-relative reading position survives client detachment and changed row metrics. */
export type PropertyInspectorViewState = {
	selectionIndex: number;
	selectionVisible: boolean;
	anchorIndex: number;
	anchorOffset: number;
};
export const INSPECTOR_PADDING = 4;
export const INSPECTOR_COMPACT_PADDING = 2;

/** One compact row fits the active typeface and its font-independent disclosure icon. */
export function compactPropertyRowHeight(font: BFont): number {
	return Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + INSPECTOR_COMPACT_PADDING * 2;
}

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
	private revealElement: Element | undefined;
	private restoreSelectionVisible = false;
	private readonly expandedText = new WeakSet<Element>();

	public setItems(items: readonly Element[]): void {
		for (let index = 0; index < items.length; index++) {
			const row = this.rows[index];
			if (row === undefined) this.rows.push(this.createRow(items[index]));
			else row.element = items[index];
		}
		this.rows.length = items.length;
		this.selectionIndex = items.length === 0 ? -1 : 0;
		this.hoverIndex = -1;
		this.viewport.scrollbar.setScroll(0);
		this.anchorIndex = -1;
		this.revealElement = undefined;
		this.restoreSelectionVisible = false;
		this.dirty = true;
	}

	/** Write into the input-owned memento; no per-frame snapshot allocations. */
	public saveViewState(state: PropertyInspectorViewState): void {
		state.selectionIndex = this.selectionIndex;
		const selected = this.rows[this.selectionIndex];
		state.selectionVisible = selected !== undefined && selected.top < this.viewport.scrollTop + this.viewport.height && selected.bottom > this.viewport.scrollTop;
		state.anchorIndex = this.rowAt(this.viewport.bounds.top);
		state.anchorOffset = state.anchorIndex < 0 ? 0 : this.viewport.scrollTop - this.rows[state.anchorIndex].top;
	}

	/** The owner restores only the same document; its next actual layout resolves the anchor. */
	public restoreViewState(state: Readonly<PropertyInspectorViewState>): void {
		this.selectionIndex = state.selectionIndex;
		this.restoreSelectionVisible = state.selectionVisible;
		this.anchorIndex = state.anchorIndex;
		this.anchorOffset = state.anchorOffset;
	}

	/** Refresh a property document by owner-supplied identity, without reopening its control. */
	public updateItems(items: readonly Element[], equals: (left: Element, right: Element) => boolean): void {
		const selected = this.rows[this.selectionIndex]?.element;
		this.captureScrollAnchor();
		const anchor = this.rows[this.anchorIndex]?.element;
		let selection = -1;
		this.anchorIndex = -1;
		for (let index = 0; index < items.length; index++) {
			const element = items[index], row = this.rows[index];
			if (row === undefined) this.rows.push(this.createRow(element));
			else row.element = element;
			if (selected !== undefined && equals(element, selected)) selection = index;
			if (anchor !== undefined && equals(element, anchor)) this.anchorIndex = index;
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
		return { element, label: [], value: [], description: [], top: 0, bottom: 0, labelLeft: 0, valueLeft: 0, disclosureLeft: 0,
			textExpandable: false, textExpanded: false, headerHeight: 0,
			measured: { label: '', value: '', description: '', depth: -1, compact: false, group: false, descriptionDisplay: undefined } };
	}

	public layout(font: BFont, measure: TextRangeMeasure, bounds: RectBounds): void {
		const width = bounds.right - bounds.left - SCROLLBAR_WIDTH;
		let height = this.viewport.contentHeight;
		if (this.dirty || this.width !== width || this.font !== font) {
			this.captureScrollAnchor();
			const remeasure = this.width !== width || this.font !== font;
			this.width = width;
			this.font = font;
			const compactHeight = compactPropertyRowHeight(font), indentWidth = font.advance(' ') * 2;
			height = 0;
			for (const row of this.rows) {
				row.top = height;
				const compact = row.element.compact === true, depth = row.element.depth ?? 0, group = row.element.group === true;
				const padding = compact ? INSPECTOR_COMPACT_PADDING : INSPECTOR_PADDING;
				const rowChanged = remeasure || row.measured.depth !== depth || row.measured.compact !== compact || row.measured.group !== group
					|| row.measured.descriptionDisplay !== row.element.descriptionDisplay;
				row.measured.depth = depth; row.measured.compact = compact; row.measured.group = group;
				row.measured.descriptionDisplay = row.element.descriptionDisplay;
				const textExpanded = compact && row.element.expansion === undefined && this.expandedText.has(row.element);
				const textExpansionChanged = row.textExpanded !== textExpanded;
				row.textExpanded = textExpanded;
				if (compact) {
					row.disclosureLeft = padding + depth * indentWidth;
					row.labelLeft = row.disclosureLeft + 10;
					row.valueLeft = group || row.element.label.length === 0 ? row.labelLeft : Math.max(row.labelLeft + 8, width * 0.46 | 0);
					row.headerHeight = compactHeight;
				} else row.textExpandable = false;
				if (compact && !textExpanded) {
					if (rowChanged || textExpansionChanged || row.measured.label !== row.element.label) {
						row.label.length = 1;
						const end = row.element.label.indexOf('\n');
						const label = end === -1 ? row.element.label : row.element.label.slice(0, end) + ELLIPSIS;
						row.label[0] = truncateMeasuredText(label, (group ? width - padding : row.valueLeft - 4) - row.labelLeft, measure);
						row.measured.label = row.element.label;
					}
					if (rowChanged || textExpansionChanged || row.measured.value !== row.element.value) {
						row.value.length = 1;
						const end = row.element.value.indexOf('\n');
						const value = end === -1 ? row.element.value : row.element.value.slice(0, end) + ELLIPSIS;
						row.value[0] = group ? '' : truncateMeasuredText(value, width - row.valueLeft - padding, measure);
						row.measured.value = row.element.value;
					}
					row.textExpandable = row.label[0] !== row.element.label || !group && row.value[0] !== row.element.value
						|| row.element.descriptionDisplay === 'disclosure' && row.element.description.length !== 0;
					if (rowChanged || textExpansionChanged || row.measured.description !== row.element.description) {
						row.description.length = 0;
						if (row.element.descriptionDisplay !== 'disclosure' && row.element.description.length !== 0)
							for (const line of row.element.description.split('\n')) writeWrappedMeasuredLine(row.description, line,
								width - row.labelLeft - padding, measure);
						row.measured.description = row.element.description;
					}
					height += row.headerHeight;
					if (row.description.length !== 0) height += row.description.length * font.lineHeight + padding;
					row.bottom = height;
					continue;
				}
				for (const field of PROPERTY_FIELDS) {
					const lines = row[field];
					const text = row.element[field];
					if (rowChanged || textExpansionChanged || row.measured[field] !== text) {
						lines.length = 0;
						if (text.length > 0) for (const line of text.split('\n')) writeWrappedMeasuredLine(lines, line,
							width - (compact ? row.labelLeft : padding) - padding, measure);
						row.measured[field] = text;
					}
					if (text.length === 0) continue;
					height += lines.length * font.lineHeight + padding;
				}
				height += padding;
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
		if (this.restoreSelectionVisible) {
			this.restoreSelectionVisible = false;
			const selected = this.rows[this.selectionIndex];
			if (selected.top >= this.viewport.scrollTop + this.viewport.height || selected.bottom <= this.viewport.scrollTop)
				this.viewport.scrollbar.reveal(selected.top, selected.bottom, INSPECTOR_PADDING);
		}
		// Explicit disclosure reveals the newly measured extent once; ordinary layout preserves its scroll anchor.
		if (this.revealElement !== undefined) {
			const element = this.revealElement; this.revealElement = undefined;
			for (const row of this.rows) if (row.element === element) {
				this.viewport.scrollbar.reveal(row.top, row.bottom, INSPECTOR_PADDING); break;
			}
		}
	}

	public select(index: number): void {
		if (this.rows.length === 0) return;
		this.selectionIndex = clamp(index, 0, this.rows.length - 1);
		this.hoverIndex = -1;
		const row = this.rows[this.selectionIndex];
		if (this.dirty) this.revealElement = row.element;
		// Reveal the value as well as its label. The scrollbar lead-aligns oversized
		// rows, so a long callback is still read from its beginning, not its last line.
		this.viewport.scrollbar.reveal(row.top, row.bottom, INSPECTOR_PADDING);
	}

	/** Text expansion is a local presentation change, not a request to inspect the guest again. */
	public setValueExpanded(index: number, expanded: boolean): boolean {
		const row = this.rows[index];
		if (row?.element.compact !== true || !row.textExpandable || row.textExpanded === expanded) return false;
		if (expanded) this.expandedText.add(row.element); else this.expandedText.delete(row.element);
		this.captureScrollAnchor(); this.revealElement = row.element; this.dirty = true;
		return true;
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
