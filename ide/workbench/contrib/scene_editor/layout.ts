import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { uppercaseOutsideStrings, writeWrappedMeasuredText } from '../../../common/text';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode } from '../../ui/tree_view';
import type { SceneEditorInput } from './editor_input';
import type { SceneOutlineElement } from './outline';

const PADDING = 4;

/** Measure content on invalidation; a scroll only projects the retained field rectangles. */
export function layoutSceneEditor(input: SceneEditorInput, contentChanged: boolean, selectionChanged = false): boolean {
	const changed = updateFullWidthWorkbenchLayout(input.layout);
	const measured = changed || contentChanged || selectionChanged;
	const layout = input.layout;
	if (measured) {
		const rowHeight = layout.rowHeight + PADDING;
		layout.detailsLeft = (layout.right * 0.52) | 0;
		const contentTop = Math.min(layout.bottom, layout.top + rowHeight * 2);
		const treeLayout = input.outline.layout;
		layoutWorkbenchList(treeLayout, PADDING, contentTop, layout.detailsLeft - PADDING, layout.bottom, rowHeight);
		// The row-based tree draws whole rows; its hit area excludes a partial last row.
		treeLayout.contentBottom = treeLayout.contentTop + treeLayout.visibleRowCount * rowHeight;
		treeLayout.indentWidth = editorViewState.font.advance(' ') * 2;
		treeLayout.twistieWidth = treeLayout.indentWidth;
		clampWorkbenchListScroll(input.outline);
		if (changed || contentChanged) layoutSceneOutlineNodes(input.outline.roots, treeLayout);
		layoutWorkbenchActionBar(input.actionBar, layout.right - PADDING, layout.top, layout.top + rowHeight, measureText);
		input.sourceText = truncateTextToWidth(input.workingCopy.resource.path, input.actionBar.items[0].bounds.left - PADDING * 2);
		const width = layout.right - constants.SCROLLBAR_WIDTH - layout.detailsLeft;
		const height = measureSceneDetails(input, width);
		input.details.layout(layout.detailsLeft, contentTop, layout.right, layout.bottom, height);
	}
	if (measured || layout.projectedOffsetTop !== input.details.offsetTop) {
		for (const property of input.properties) input.details.project(property.contentBounds, property.bounds);
		layout.projectedOffsetTop = input.details.offsetTop;
	}
	return measured;
}

/** Scene composition chooses content, not screen rows. All text, including notes, contributes height. */
function measureSceneDetails(input: SceneEditorInput, width: number): number {
	input.detailsText.length = 0;
	const node = input.outline.rows[input.outline.selectionIndex];
	if (node === undefined) return 0;
	const textWidth = width - PADDING * 2;
	let top = appendDetailsText(input, uppercaseOutsideStrings(node.parent === null ? node.element.label : node.parent.element.label), textWidth, PADDING);
	top = appendDetailsText(input, uppercaseOutsideStrings(node.element.detail), textWidth, top);
	if (node.element.kind === 'scene') return top;
	top = appendDetailsText(input, 'POSITION / WORLD UNITS', textWidth, top);
	const fieldHeight = input.layout.rowHeight + PADDING;
	const fieldLeft = PADDING * 2 + editorViewState.font.advance('X');
	for (const property of input.properties) {
		write_rect_bounds(property.contentBounds, fieldLeft, top, width - PADDING, top + fieldHeight);
		property.text = truncateTextToWidth(uppercaseOutsideStrings(property.sourceText), width - PADDING - fieldLeft - 6);
		top += fieldHeight + PADDING;
	}
	top = appendDetailsText(input, node.element.scene.resolution === 'partial' ? 'PARTIAL DEFINITION' : 'DEFINITION ONLY',
		textWidth, top, true);
	return appendDetailsText(input, 'AFFECTS NEW INSTANCES', textWidth, top);
}

function appendDetailsText(input: SceneEditorInput, text: string, width: number, top: number, warning = false): number {
	writeWrappedMeasuredText(input.wrappedLines, text, width, width, text.length, measureTextRange);
	for (const line of input.wrappedLines) {
		input.detailsText.push({ text: line, top, warning });
		top += input.layout.rowHeight;
	}
	return top + PADDING;
}

function layoutSceneOutlineNodes(nodes: readonly WorkbenchTreeNode<SceneOutlineElement>[], layout: WorkbenchTreeLayout): void {
	for (const node of nodes) {
		const badge = node.element.kind === 'scene' && node.element.scene.resolution === 'partial' ? '* ' : '';
		node.element.displayLabel = truncateTextToWidth(badge + uppercaseOutsideStrings(node.element.label),
			layout.contentRight - layout.contentLeft - node.depth * layout.indentWidth - layout.twistieWidth);
		layoutSceneOutlineNodes(node.children, layout);
	}
}
