import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { uppercaseOutsideStrings, writeWrappedMeasuredText } from '../../../common/text';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { getWorkbenchEditorBounds, updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, WORKBENCH_ACTION_BAR_ITEM_SPACING } from '../../ui/action_bar';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode } from '../../ui/tree_view';
import type { SceneEditorInput } from './editor_input';
import type { SceneOutlineElement } from './outline';

const PADDING = 4;

/** Measure content on invalidation; a scroll only projects the retained field rectangles. */
export function layoutSceneEditor(input: SceneEditorInput, contentChanged: boolean, selectionChanged = false, bounds: Readonly<RectBounds> = getWorkbenchEditorBounds()): boolean {
	const changed = updateFullWidthWorkbenchLayout(input.layout, bounds);
	const layout = input.layout;
	// Each split column needs usable text width; font changes can cross this boundary.
	if (changed) layout.splitMinimumWidth = 2 * (editorViewState.font.advance('M') * 24 + PADDING * 2 + constants.SCROLLBAR_WIDTH) + 1;
	const mode = layout.right - layout.left >= layout.splitMinimumWidth ? 'split' : input.section;
	const measured = changed || contentChanged || selectionChanged || mode !== layout.mode;
	layout.mode = mode;
	if (measured) {
		const rowHeight = layout.rowHeight + PADDING;
		layout.detailsLeft = mode === 'split' ? layout.left + ((layout.right - layout.left) >> 1) : layout.left;
		const contentTop = Math.min(layout.bottom, layout.top + rowHeight * 2);
		const treeLayout = input.outline.layout;
		layoutWorkbenchList(treeLayout, layout.left + PADDING, contentTop,
			mode === 'details' ? layout.left + PADDING : (mode === 'split' ? layout.detailsLeft : layout.right) - PADDING,
			mode === 'details' ? contentTop : layout.bottom, rowHeight);
		// The row-based tree draws whole rows; its hit area excludes a partial last row.
		treeLayout.contentBottom = treeLayout.contentTop + treeLayout.visibleRowCount * rowHeight;
		treeLayout.indentWidth = Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		treeLayout.twistieWidth = treeLayout.indentWidth;
		if (mode !== 'details') {
			clampWorkbenchListScroll(input.outline);
			layoutSceneOutlineNodes(input.outline.roots, treeLayout);
		}
		for (const item of input.actionBar.items) {
			if (item.command === 'sceneEditor.details') item.visible = mode === 'outline';
			else if (item.command === 'sceneEditor.outline') item.visible = mode === 'details';
		}
		const caption = input.sourceCaption;
		const iconWidth = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, rowHeight);
		const actionWidth = mode === 'split' ? iconWidth : iconWidth * 2 + WORKBENCH_ACTION_BAR_ITEM_SPACING;
		const actionLeft = Math.min(layout.left + measureText(caption) + PADDING * 3, layout.right - PADDING - actionWidth);
		layoutWorkbenchActionBar(input.actionBar, layout.right - PADDING, layout.top, layout.top + rowHeight, measureText, editorViewState.font.renderFont(), actionLeft);
		input.sourceText = truncateTextToWidth(caption, input.actionBar.bounds.left - layout.left - PADDING * 2);
		write_rect_bounds(layout.sourceBounds, layout.left + PADDING, layout.top, input.actionBar.bounds.left - PADDING, layout.top + rowHeight);
		layout.outlineTitle = mode === 'details' ? '' : 'Scenes';
		layout.detailsTitle = mode === 'outline' ? '' : 'Details';
		if (mode === 'outline') input.details.layout(layout.left, contentTop, layout.left, contentTop, input.details.contentHeight);
		else {
			const width = layout.right - constants.SCROLLBAR_WIDTH - layout.detailsLeft;
			const height = measureSceneDetails(input, width);
			input.details.layout(layout.detailsLeft, contentTop, layout.right, layout.bottom, height);
		}
	}
	const position = input.position;
	if (position !== undefined) {
		if (position.outlineScroll !== undefined) {
			input.outline.scroll = position.outlineScroll;
			if (mode !== 'details') clampWorkbenchListScroll(input.outline);
			position.outlineScroll = undefined;
		}
		// A hidden client has no measured range yet. Its bookmark belongs to
		// the first visible layout, not the empty viewport's zero range.
		if (mode !== 'outline') {
			input.details.scrollbar.setScroll(position.detailsScroll);
			input.position = undefined;
		}
	}

	if (measured || layout.projectedOffsetTop !== input.details.offsetTop) {
		for (const property of input.properties) {
			if (mode === 'outline') write_rect_bounds(property.bounds, 0, 0, 0, 0);
			else input.details.project(property.contentBounds, property.bounds);
		}
		for (const property of input.optionProperties) {
			if (mode === 'outline') write_rect_bounds(property.bounds, 0, 0, 0, 0);
			else input.details.project(property.contentBounds, property.bounds);
		}
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
	let top = appendDetailsText(input, uppercaseOutsideStrings(node.element.label), textWidth, PADDING);
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
	if (input.optionProperties.length > 0) top = appendDetailsText(input, 'OPTIONS / LUA VALUES', textWidth, top);
	for (const property of input.optionProperties) {
		top = appendDetailsText(input, uppercaseOutsideStrings(property.label), textWidth, top);
		write_rect_bounds(property.contentBounds, PADDING, top, width - PADDING, top + fieldHeight);
		property.text = truncateTextToWidth(uppercaseOutsideStrings(property.preview), textWidth - 6);
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
		const label = badge + uppercaseOutsideStrings(node.element.label);
		node.element.displayLabel = truncateTextToWidth(label,
			layout.contentRight - layout.contentLeft - node.depth * layout.indentWidth - layout.twistieWidth);
		node.element.labelClipped = node.element.displayLabel !== label;
		layoutSceneOutlineNodes(node.children, layout);
	}
}
