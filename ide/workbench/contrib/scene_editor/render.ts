import type { EditorCommandEnablement } from '../../../common/commands';
import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IntegerInput } from '../../../editor/ui/inline/integer_input';
import { drawIntegerInput } from '../../../editor/ui/inline/integer_input_render';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { SceneEditorInput } from './editor_input';

export function drawSceneEditor(input: SceneEditorInput, controls: readonly IntegerInput[], commands: EditorCommandEnablement, detailsFocused: boolean): void {
	const { layout, outline } = input;
	const font = editorViewState.font.renderFont();
	const color = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	const rowHeight = outline.layout.rowHeight;
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	api.blit_text_inline_with_font(input.sourceText, 4, layout.top + 2, 0, color, font);
	renderWorkbenchActionBar(input.actionBar, commands, font);
	api.blit_text_inline_with_font('SCENES / MEMBERS', 4, layout.top + rowHeight + 2, 0, color, font);
	api.fill_rect(layout.detailsLeft - 1, layout.top + rowHeight, layout.detailsLeft, layout.bottom, 0, constants.COLOR_HEADER_BUTTON_BORDER);
	api.blit_text_inline_with_font('PROPERTIES', layout.detailsLeft + 4, layout.top + rowHeight + 2, 0, color, font);
	api.pushClipRect(outline.layout.contentLeft, outline.layout.contentTop, outline.layout.contentRight, outline.layout.contentBottom);
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
	api.popClipRect();
	const details = input.details;
	const bounds = details.bounds;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	for (const line of input.detailsText) {
		const top = details.offsetTop + line.top;
		if (top + font.lineHeight <= bounds.top || top >= bounds.bottom) continue;
		api.blit_text_inline_with_font(line.text, bounds.left + 4, top, 0, line.warning ? constants.COLOR_STATUS_WARNING : color, font);
	}
	if (outline.rows[outline.selectionIndex]?.element.kind === 'member') {
		for (let index = 0; index < controls.length; index += 1) {
			const property = input.properties[index];
			if (property.bounds.bottom <= bounds.top || property.bounds.top >= bounds.bottom) continue;
			api.blit_text_inline_with_font(property.label, bounds.left + 4, property.bounds.top + 2, 0, color, font);
			if (property.value !== null && !input.workingCopy.readOnly) drawIntegerInput(controls[index], property.bounds);
			else api.blit_text_inline_with_font(property.text, property.bounds.left + 3, property.bounds.top + 2, 0, constants.COLOR_STATUS_TEXT, font);
		}
	}
	api.popClipRect();
	details.scrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	if (detailsFocused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
	api.popClipRect();
}
