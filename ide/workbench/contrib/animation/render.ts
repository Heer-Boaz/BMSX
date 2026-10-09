import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import * as colors from '../../../common/constants';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import type { AnimationEditorInput } from './editor_input';

export function drawAnimationEditor(input: AnimationEditorInput, bounds: Readonly<RectBounds>, keysFocused: boolean): void {
	const { font } = editorViewState;
	const text = colors.COLOR_RESOURCE_VIEWER_TEXT;
	drawEditorText(font, 'ANIMATION', bounds.left + 4, bounds.top + 2, 0, text);
	renderWorkbenchActionBar(input.actionBar, font.renderFont());
	const list = input.tracks;
	const layout = list.layout;
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	for (let index = list.scroll; index < Math.min(list.rows.length, list.scroll + layout.visibleRowCount); index++) {
		const top = layout.contentTop + (index - list.scroll) * layout.rowHeight;
		const selected = index === list.selectionIndex;
		if (selected) api.fill_rect(layout.contentLeft, top, layout.contentRight, top + layout.rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
		drawEditorText(font, list.rows[index].text, layout.contentLeft + 2, top + 2, 0, selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT : text);
	}
	api.popClipRect();
	const viewport = input.keys, keyBounds = viewport.range.bounds;
	drawEditorText(font, viewport.caption, keyBounds.left, keyBounds.top - layout.rowHeight, 0, text);
	if (viewport.track !== undefined) {
		const middle = Math.round((keyBounds.top + keyBounds.bottom) / 2);
		api.fill_rect(keyBounds.left + 3, middle, keyBounds.right - 3, middle + 1, 0, colors.COLOR_STATUS_TEXT);
		api.pushClipRect(keyBounds.left, keyBounds.top, keyBounds.right, keyBounds.bottom);
		const cursorX = viewport.xAt(viewport.cursor);
		api.fill_rect(cursorX, keyBounds.top, cursorX + 1, keyBounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
		for (let index = 0; index < viewport.positions.length; index++) {
			const value = index === viewport.selected && viewport.dragValue !== undefined ? viewport.dragValue : viewport.positions[index];
			if (value === null) continue;
			const x = viewport.xAt(value), selected = index === viewport.selected;
			api.fill_rect(x - 2, middle - 3, x + 3, middle + 4, 0, selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT : text);
			if (selected) api.blit_rect(x - 4, middle - 5, x + 4, middle + 5, 0, colors.COLOR_FOCUS_BORDER);
		}
		api.popClipRect();
		drawEditorText(font, viewport.startLabel, keyBounds.left, keyBounds.bottom + 2, 0, text);
		drawEditorText(font, viewport.endLabel, keyBounds.right - viewport.endLabelWidth, keyBounds.bottom + 2, 0, text);
		drawEditorText(font, viewport.selectionLabel, keyBounds.left + 4, keyBounds.bottom + layout.rowHeight + 2, 0, text);
		if (keysFocused) api.blit_rect(keyBounds.left - 1, keyBounds.top - 1, keyBounds.right, keyBounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	}
	drawWorkbenchPropertyTree(input.details);
}
