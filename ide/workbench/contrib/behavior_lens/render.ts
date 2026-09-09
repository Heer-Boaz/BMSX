import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawWorkbenchGraph } from '../../render/graph';
import type { WorkbenchGraphItem } from '../../ui/graph/model';
import { api } from '../../../runtime/overlay_api';
import { prepareBehaviorLensLayout } from './layout';
import type { BehaviorLensViewState } from './view_model';

import type { EditorCommandEnablement } from '../../../common/commands';
import { renderWorkbenchActionBar } from '../../render/action_bar';

const EMPTY_LENS_TEXT = 'NO STATIC BEHAVIOR REGISTRATIONS';

/** Draws the retained presentation; source recognition and layout generation run elsewhere. */
export function drawBehaviorLens(state: BehaviorLensViewState, commands: EditorCommandEnablement, hover: WorkbenchGraphItem | null, focused: boolean): void {
	const layout = prepareBehaviorLensLayout(state);
	if (state.presentation.kind === 'outline') api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.fill_rect(layout.left, layout.top, layout.right, layout.headerBottom, 0, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.fill_rect(layout.left, layout.headerBottom, layout.right, layout.headerBottom + 1, 0, constants.COLOR_TAB_BORDER);
	const renderFont = editorViewState.font.renderFont();
	renderWorkbenchActionBar(state.presentation.actionBar, commands, renderFont);
	api.blit_text_inline_span_with_font(
		layout.headerText,
		0,
		layout.headerText.length,
		layout.left + 4,
		layout.top + 2,
		0,
		constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT,
		renderFont,
	);
	const outline = state.presentation;
	if (outline.kind === 'graph') {
		drawWorkbenchGraph(outline.viewport, hover, focused);
		if (outline.viewport.model.nodes.length === 0) {
			api.blit_text_inline_with_font('DEFINITION REMOVED - CHOOSE A BEHAVIOR', layout.left + 4, layout.headerBottom + 8,
				0, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM, renderFont);
		}
		return;
	}
	const listLayout = outline.layout;
	if (outline.rows.length === 0) {
		api.blit_text_inline_span_with_font(
			EMPTY_LENS_TEXT,
			0,
			EMPTY_LENS_TEXT.length,
			listLayout.contentLeft,
			listLayout.contentTop,
			0,
			constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM,
			renderFont,
		);
		return;
	}

	const endCandidate = outline.scroll + listLayout.visibleRowCount;
	const end = endCandidate < outline.rows.length ? endCandidate : outline.rows.length;
	for (let rowIndex = outline.scroll; rowIndex < end; rowIndex += 1) {
		const row = outline.rows[rowIndex];
		const y = listLayout.contentTop + (rowIndex - outline.scroll) * listLayout.rowHeight;
		if (state.sourceMatchRowKeys.has(row.node.rowKey)) {
			api.fill_rect(layout.left, y, layout.right, y + listLayout.rowHeight, 0, constants.REFERENCES_MATCH_OVERLAY);
		}
		if (rowIndex === outline.hoverIndex) {
			api.fill_rect(layout.left, y, layout.right, y + listLayout.rowHeight, 0, constants.HIGHLIGHT_OVERLAY);
		}
		if (rowIndex === outline.selectionIndex) {
			api.fill_rect(layout.left, y, layout.right, y + listLayout.rowHeight, 0, constants.SELECTION_OVERLAY);
		}
		const textColor = rowIndex === outline.selectionIndex
			? constants.COLOR_SELECTION_TEXT
			: (row.node.resolution !== 'complete'
				? constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM
				: constants.COLOR_RESOURCE_VIEWER_TEXT);
		api.blit_text_inline_span_with_font(
			row.text,
			0,
			row.text.length,
			listLayout.contentLeft,
			y,
			0,
			textColor,
			renderFont,
		);
	}
}
