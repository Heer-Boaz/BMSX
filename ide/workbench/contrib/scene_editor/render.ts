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
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { SceneEditorInput } from './editor_input';

export function layoutSceneEditor(input: SceneEditorInput, contentChanged: boolean): void {
	const changed = updateFullWidthWorkbenchLayout(input.layout);
	if (!changed && !contentChanged) return;
	const layout = input.layout;
	const rowHeight = layout.rowHeight + 4;
	layout.detailsLeft = (layout.right * 0.52) | 0;
	layoutWorkbenchList(input.members.layout, 4, layout.top + rowHeight * 2,
		layout.detailsLeft - 4, layout.bottom, rowHeight);
	clampWorkbenchListScroll(input.members);
	for (const row of input.members.rows) row.displayLabel = truncateTextToWidth(uppercaseOutsideStrings(row.label), layout.detailsLeft - 12);
	layoutWorkbenchActionBar(input.actionBar, layout.right - 4, layout.top, layout.top + rowHeight, measureText);
	for (let index = 0; index < input.properties.length; index += 1) {
		write_rect_bounds(input.properties[index].bounds, layout.detailsLeft + 18,
			layout.top + rowHeight * (5 + index * 2), layout.right - 8, layout.top + rowHeight * (6 + index * 2));
	}
	const row = input.members.rows[input.members.selectionIndex];
	input.sceneText = row === undefined ? '' : truncateTextToWidth(uppercaseOutsideStrings(row.sceneLabel), layout.right - layout.detailsLeft - 8);
	input.definitionText = row === undefined ? '' : truncateTextToWidth(uppercaseOutsideStrings(row.definition), layout.right - layout.detailsLeft - 8);
	for (const property of input.properties) property.text = truncateTextToWidth(uppercaseOutsideStrings(property.sourceText), layout.right - layout.detailsLeft - 26);
}

export function drawSceneEditor(input: SceneEditorInput, controls: readonly IntegerInput[], commands: EditorCommandEnablement): void {
	const { layout, members } = input;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	const rowHeight = members.layout.rowHeight;
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_text_inline_with_font('SCENE DEFINITIONS', 4, layout.top + 2, 0, color, font);
	renderWorkbenchActionBar(input.actionBar, commands, font);
	api.blit_text_inline_with_font(input.partial ? 'MEMBERS (PARTIAL)' : 'MEMBERS', 4, layout.top + rowHeight + 2, 0, color, font);
	api.fill_rect(layout.detailsLeft - 1, layout.top + rowHeight, layout.detailsLeft, layout.bottom, 0, constants.COLOR_HEADER_BUTTON_BORDER);
	if (members.rows.length === 0) api.blit_text_inline_with_font('NO DIRECT SCENE DEFINITIONS', 4, members.layout.contentTop + 2, 0, color, font);
	const end = Math.min(members.rows.length, members.scroll + members.layout.visibleRowCount);
	for (let index = members.scroll; index < end; index += 1) {
		const y = members.layout.contentTop + (index - members.scroll) * rowHeight;
		if (index === members.selectionIndex) api.fill_rect(members.layout.contentLeft, y,
			members.layout.contentRight, y + rowHeight, 0, constants.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		api.blit_text_inline_with_font(members.rows[index].displayLabel, 4, y + 2, 0, color, font);
	}
	const x = layout.detailsLeft + 4;
	api.blit_text_inline_with_font(input.sceneText, x, layout.top + rowHeight * 2 + 2, 0, color, font);
	api.blit_text_inline_with_font(input.definitionText, x, layout.top + rowHeight * 3 + 2, 0, color, font);
	api.blit_text_inline_with_font('POSITION / WORLD UNITS', x, layout.top + rowHeight * 4 + 2, 0, color, font);
	for (let index = 0; index < controls.length; index += 1) {
		const property = input.properties[index];
		api.blit_text_inline_with_font(property.label, x, property.bounds.top + 2, 0, color, font);
		if (property.value !== null && !input.workingCopy.readOnly) drawIntegerInput(controls[index], property.bounds);
		else api.blit_text_inline_with_font(property.text, property.bounds.left + 3, property.bounds.top + 2, 0, constants.COLOR_STATUS_TEXT, font);
	}
	api.blit_text_inline_with_font('DEFINITION ONLY', x, layout.top + rowHeight * 12, 0, constants.COLOR_STATUS_WARNING, font);
	api.blit_text_inline_with_font('AFFECTS NEW INSTANCES', x, layout.top + rowHeight * 13, 0, color, font);
}
