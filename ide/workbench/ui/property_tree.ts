import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { truncateMeasuredText, writeWrappedMeasuredText, type TextRangeMeasure } from '../../common/text';
import { clampWorkbenchListScroll, layoutWorkbenchList } from './list_view';
import { WORKBENCH_ICON_SIZE } from './icon';
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
	readonly layout: WorkbenchTreeLayout & { valueLeft: number; bottom: number; font: BFont | null; measure: TextRangeMeasure | undefined };
	textDirty: boolean;
	readonly descriptionLines: string[];
	descriptionElement: Element | undefined;
	descriptionClipped: boolean;
};

export function createWorkbenchPropertyTree<Element extends WorkbenchPropertyElement>(): WorkbenchPropertyTree<Element> {
	return { roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0, textDirty: true,
		descriptionLines: [], descriptionElement: undefined, descriptionClipped: false,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0,
			indentWidth: 0, twistieWidth: 0, valueLeft: 0, bottom: 0, font: null, measure: undefined } };
}

let minimumFont: BFont | undefined;
let minimumAdvance = 0, minimumIndent = 0;

/** Root-property reading budgets include both branches of the retained 40/60 partition. */
export function measureWorkbenchPropertyTreeMinimumWidth(font: BFont, labelColumns: number, valueColumns: number): number {
	if (minimumFont !== font) {
		minimumFont = font;
		minimumAdvance = font.advance('M');
		minimumIndent = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 4);
	}
	const labelLeft = minimumIndent + 2;
	const label = minimumAdvance * labelColumns, value = minimumAdvance * valueColumns;
	// The root value starts after BOTH the global and the indented local split.
	return Math.max(Math.trunc(((label + labelLeft + 4) * 5 + 1) / 2),
		Math.trunc(((value + 8) * 5 + 2) / 3), labelLeft + 8 + Math.trunc((value * 5 + 2) / 3));
}

/** Layout and text are retained across scrolling, hover and unchanged frames. */
export function layoutWorkbenchPropertyTree<Element extends WorkbenchPropertyElement>(
	state: WorkbenchPropertyTree<Element>, font: BFont, measure: TextRangeMeasure,
	left: number, top: number, right: number, bottom: number,
): void {
	const layout = state.layout;
	if (right <= left || bottom <= top) {
		layout.font = font;
		layout.bottom = Math.max(top, bottom);
		layoutWorkbenchList(layout, left, top, right, layout.bottom, Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4);
		return;
	}
	const changed = state.textDirty || layout.font !== font || layout.contentLeft !== left || layout.contentTop !== top
		|| layout.contentRight !== right || layout.bottom !== bottom;
	if (changed) {
		layout.font = font;
		layout.measure = measure;
		layout.bottom = bottom;
		layout.valueLeft = left + ((right - left) * 0.4 | 0);
		layout.indentWidth = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 4);
		layout.twistieWidth = layout.indentWidth;
		layout.contentLeft = left; layout.contentRight = right;
		// Source descriptions keep a stable footer across selection and gestures. Trees without descriptions reclaim it.
		const footerHeight = writePropertyText(state.roots, layout, measure) ? font.lineHeight * 3 + 8 : 0;
		layoutWorkbenchList(layout, left, top, right, bottom - footerHeight, Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4);
		// The description owns the remainder; every hittable list row is actually painted.
		layout.contentBottom = top + layout.visibleRowCount * layout.rowHeight;
		clampWorkbenchListScroll(state);
		state.textDirty = false;
	}
	const selected = state.rows[state.selectionIndex]?.element;
	if (changed || state.descriptionElement !== selected) {
		state.descriptionElement = selected;
		const text = selected === undefined ? '' : selected.description;
		state.descriptionClipped = writeWrappedMeasuredText(state.descriptionLines, text, right - left - 8, right - left - 8, 3, measure);
	}
}

function writePropertyText<Element extends WorkbenchPropertyElement>(
	nodes: readonly WorkbenchTreeNode<Element>[], layout: WorkbenchPropertyTree<Element>['layout'], measure: TextRangeMeasure,
): boolean {
	let hasDescription = false;
	for (const node of nodes) {
		const element = node.element;
		const labelLeft = layout.contentLeft + node.depth * layout.indentWidth + layout.twistieWidth + 2;
		// Deep names partition their remaining row, rather than disappearing behind the root's value column.
		element.displayValueLeft = element.label.length === 0 ? labelLeft
			: Math.max(layout.valueLeft + 4, labelLeft + ((layout.contentRight - labelLeft - 8) * 0.4 | 0) + 4);
		element.displayLabel = truncateMeasuredText(element.label,
			(element.kind === 'group' && element.value.length === 0 ? layout.contentRight : element.displayValueLeft - 4) - labelLeft - 4, measure);
		element.displayValue = truncateMeasuredText(element.value, layout.contentRight - element.displayValueLeft - 4, measure);
		const childrenHaveDescription = writePropertyText(node.children, layout, measure);
		hasDescription = hasDescription || element.description.length > 0 || childrenHaveDescription;
	}
	return hasDescription;
}
