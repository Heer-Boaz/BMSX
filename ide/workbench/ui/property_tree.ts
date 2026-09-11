import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { truncateMeasuredText, writeWrappedMeasuredText, type TextRangeMeasure } from '../../common/text';
import { clampWorkbenchListScroll, layoutWorkbenchList } from './list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode, WorkbenchTreeState } from './tree_view';

/** Display data only. Contributions retain their own property/source bindings. */
export type WorkbenchPropertyElement = {
	readonly kind: 'group' | 'property';
	readonly label: string;
	readonly value: string;
	readonly description: string;
	readonly warning: boolean;
	displayLabel: string;
	displayValue: string;
	displayValueLeft: number;
};

export type WorkbenchPropertyTree<Element extends WorkbenchPropertyElement> = WorkbenchTreeState<Element> & {
	readonly layout: WorkbenchTreeLayout & { valueLeft: number; bottom: number; font: BFont | null };
	textDirty: boolean;
	readonly descriptionLines: string[];
	descriptionElement: Element | undefined;
};

export function createWorkbenchPropertyTree<Element extends WorkbenchPropertyElement>(): WorkbenchPropertyTree<Element> {
	return { roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0, textDirty: true,
		descriptionLines: [], descriptionElement: undefined,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0,
			indentWidth: 0, twistieWidth: 0, valueLeft: 0, bottom: 0, font: null } };
}

/** Layout and text are retained across scrolling, hover and unchanged frames. */
export function layoutWorkbenchPropertyTree<Element extends WorkbenchPropertyElement>(
	state: WorkbenchPropertyTree<Element>, font: BFont, measure: TextRangeMeasure,
	left: number, top: number, right: number, bottom: number,
): void {
	const layout = state.layout;
	const changed = state.textDirty || layout.font !== font || layout.contentLeft !== left || layout.contentTop !== top
		|| layout.contentRight !== right || layout.bottom !== bottom;
	if (changed) {
		layout.font = font;
		layout.bottom = bottom;
		layout.valueLeft = left + ((right - left) * 0.4 | 0);
		layout.indentWidth = font.advance(' ') * 2;
		layout.twistieWidth = layout.indentWidth;
		layoutWorkbenchList(layout, left, top, right, bottom - font.lineHeight * 3 - 8, font.lineHeight + 4);
		// The description owns the remainder; every hittable list row is actually painted.
		layout.contentBottom = top + layout.visibleRowCount * layout.rowHeight;
		writePropertyText(state.roots, layout, measure);
		clampWorkbenchListScroll(state);
		state.textDirty = false;
	}
	const selected = state.rows[state.selectionIndex]?.element;
	if (changed || state.descriptionElement !== selected) {
		state.descriptionElement = selected;
		const text = selected === undefined ? '' : selected.description;
		writeWrappedMeasuredText(state.descriptionLines, text, right - left - 8, right - left - 8, 3, measure);
	}
}

function writePropertyText<Element extends WorkbenchPropertyElement>(
	nodes: readonly WorkbenchTreeNode<Element>[], layout: WorkbenchPropertyTree<Element>['layout'], measure: TextRangeMeasure,
): void {
	for (const node of nodes) {
		const element = node.element;
		const labelLeft = layout.contentLeft + node.depth * layout.indentWidth + layout.twistieWidth + 2;
		element.displayValueLeft = element.label.length === 0 ? labelLeft : layout.valueLeft + 4;
		element.displayLabel = truncateMeasuredText(element.label,
			(element.kind === 'group' ? layout.contentRight : layout.valueLeft) - labelLeft - 4, measure);
		element.displayValue = truncateMeasuredText(element.value, layout.contentRight - element.displayValueLeft - 4, measure);
		writePropertyText(node.children, layout, measure);
	}
}
