import { write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandEnablement } from '../../../common/commands';
import * as constants from '../../../common/constants';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { uppercaseOutsideStrings } from '../../../common/text';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IntegerInput } from '../../../editor/ui/inline/integer_input';
import { drawIntegerInput } from '../../../editor/ui/inline/integer_input_render';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode } from '../../ui/tree_view';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { SceneEditorInput } from './editor_input';
import type { SceneOutlineElement } from './outline';

export function layoutSceneEditor(input: SceneEditorInput, contentChanged: boolean, selectionChanged = false): void {
	const changed = updateFullWidthWorkbenchLayout(input.layout);
	if (!changed && !contentChanged && !selectionChanged) return;
	const layout = input.layout;
	const rowHeight = layout.rowHeight + 4;
	if (changed || contentChanged) {
		layout.detailsLeft = (layout.right * 0.52) | 0;
		layoutWorkbenchList(input.outline.layout, 4, layout.top + rowHeight * 2,
			layout.detailsLeft - 4, layout.bottom, rowHeight);
		const treeLayout = input.outline.layout;
		treeLayout.indentWidth = editorViewState.font.advance(' ') * 2;
		treeLayout.twistieWidth = treeLayout.indentWidth;
		clampWorkbenchListScroll(input.outline);
		layoutSceneOutlineNodes(input.outline.roots, treeLayout);
		layoutWorkbenchActionBar(input.actionBar, layout.right - 4, layout.top, layout.top + rowHeight, measureText);
		input.sourceText = truncateTextToWidth(input.workingCopy.resource.path, input.actionBar.items[0].bounds.left - 8);
		for (let index = 0; index < input.properties.length; index += 1) {
			write_rect_bounds(input.properties[index].bounds, layout.detailsLeft + 18,
				layout.top + rowHeight * (5 + index * 2), layout.right - 8, layout.top + rowHeight * (6 + index * 2));
		}
	}
	const node = input.outline.rows[input.outline.selectionIndex];
	input.sceneText = node === undefined ? '' : truncateTextToWidth(uppercaseOutsideStrings(
		node.parent === null ? node.element.label : node.parent.element.label), layout.right - layout.detailsLeft - 8);
	input.definitionText = node === undefined ? '' : truncateTextToWidth(uppercaseOutsideStrings(node.element.detail), layout.right - layout.detailsLeft - 8);
	for (const property of input.properties) property.text = truncateTextToWidth(uppercaseOutsideStrings(property.sourceText), layout.right - layout.detailsLeft - 26);
}

/** Collapse and selection reuse labels, including children changed while hidden. */
function layoutSceneOutlineNodes(nodes: readonly WorkbenchTreeNode<SceneOutlineElement>[], layout: WorkbenchTreeLayout): void {
	for (const node of nodes) {
		const badge = node.element.kind === 'scene' && node.element.scene.resolution === 'partial' ? '* ' : '';
		node.element.displayLabel = truncateTextToWidth(badge + uppercaseOutsideStrings(node.element.label),
			layout.contentRight - layout.contentLeft - node.depth * layout.indentWidth - layout.twistieWidth);
		layoutSceneOutlineNodes(node.children, layout);
	}
}

export function drawSceneEditor(input: SceneEditorInput, controls: readonly IntegerInput[], commands: EditorCommandEnablement): void {
	const { layout, outline } = input;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	const rowHeight = outline.layout.rowHeight;
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_text_inline_with_font(input.sourceText, 4, layout.top + 2, 0, color, font);
	renderWorkbenchActionBar(input.actionBar, commands, font);
	api.blit_text_inline_with_font('SCENES / MEMBERS', 4, layout.top + rowHeight + 2, 0, color, font);
	api.fill_rect(layout.detailsLeft - 1, layout.top + rowHeight, layout.detailsLeft, layout.bottom, 0, constants.COLOR_HEADER_BUTTON_BORDER);
	if (outline.roots.length === 0) api.blit_text_inline_with_font('NO DIRECT SCENE DEFINITIONS', 4, outline.layout.contentTop + 2, 0, color, font);
	const end = Math.min(outline.rows.length, outline.scroll + outline.layout.visibleRowCount);
	for (let index = outline.scroll; index < end; index += 1) {
		const node = outline.rows[index];
		const y = outline.layout.contentTop + (index - outline.scroll) * rowHeight;
		const x = outline.layout.contentLeft + node.depth * outline.layout.indentWidth;
		if (index === outline.selectionIndex) api.fill_rect(outline.layout.contentLeft, y,
			outline.layout.contentRight, y + rowHeight, 0, constants.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		if (node.children.length > 0) api.blit_text_inline_with_font(node.collapsed ? '+' : '-', x, y + 2, 0, color, font);
		api.blit_text_inline_with_font(node.element.displayLabel, x + outline.layout.twistieWidth, y + 2, 0, color, font);
	}
	if (outline.selectionIndex === -1) return;
	const x = layout.detailsLeft + 4;
	api.blit_text_inline_with_font(input.sceneText, x, layout.top + rowHeight * 2 + 2, 0, color, font);
	api.blit_text_inline_with_font(input.definitionText, x, layout.top + rowHeight * 3 + 2, 0, color, font);
	if (outline.rows[outline.selectionIndex].element.kind === 'scene') return;
	api.blit_text_inline_with_font('POSITION / WORLD UNITS', x, layout.top + rowHeight * 4 + 2, 0, color, font);
	for (let index = 0; index < controls.length; index += 1) {
		const property = input.properties[index];
		api.blit_text_inline_with_font(property.label, x, property.bounds.top + 2, 0, color, font);
		if (property.value !== null && !input.workingCopy.readOnly) drawIntegerInput(controls[index], property.bounds);
		else api.blit_text_inline_with_font(property.text, property.bounds.left + 3, property.bounds.top + 2, 0, constants.COLOR_STATUS_TEXT, font);
	}
	api.blit_text_inline_with_font(outline.rows[outline.selectionIndex].element.scene.resolution === 'partial' ? 'PARTIAL DEFINITION' : 'DEFINITION ONLY',
		x, layout.top + rowHeight * 12, 0, constants.COLOR_STATUS_WARNING, font);
	api.blit_text_inline_with_font('AFFECTS NEW INSTANCES', x, layout.top + rowHeight * 13, 0, color, font);
}
