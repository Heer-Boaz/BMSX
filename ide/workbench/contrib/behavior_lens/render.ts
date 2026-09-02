import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { prepareBehaviorLensLayout } from './layout';
import type { BehaviorLensViewState } from './view_model';

const EMPTY_LENS_TEXT = 'NO STATIC BEHAVIOR REGISTRATIONS';

/** Draws only retained rows; source recognition and row formatting run elsewhere. */
export function drawBehaviorLens(state: BehaviorLensViewState): void {
	const layout = prepareBehaviorLensLayout(state);
	api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);
	api.fill_rect(layout.left, layout.top, layout.right, layout.headerBottom, 0, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.fill_rect(layout.left, layout.headerBottom, layout.right, layout.headerBottom + 1, 0, constants.COLOR_TAB_BORDER);
	const renderFont = editorViewState.font.renderFont();
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
	if (state.rows.length === 0) {
		api.blit_text_inline_span_with_font(
			EMPTY_LENS_TEXT,
			0,
			EMPTY_LENS_TEXT.length,
			layout.contentLeft,
			layout.contentTop,
			0,
			constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM,
			renderFont,
		);
		return;
	}

	const endCandidate = state.scroll + layout.visibleRowCount;
	const end = endCandidate < state.rows.length ? endCandidate : state.rows.length;
	for (let rowIndex = state.scroll; rowIndex < end; rowIndex += 1) {
		const row = state.rows[rowIndex];
		const y = layout.contentTop + (rowIndex - state.scroll) * layout.rowHeight;
		if (state.sourceMatchRowKeys.has(row.node.rowKey)) {
			api.fill_rect(layout.left, y, layout.right, y + layout.rowHeight, 0, constants.REFERENCES_MATCH_OVERLAY);
		}
		if (rowIndex === state.hoverIndex) {
			api.fill_rect(layout.left, y, layout.right, y + layout.rowHeight, 0, constants.HIGHLIGHT_OVERLAY);
		}
		if (rowIndex === state.selectionIndex) {
			api.fill_rect(layout.left, y, layout.right, y + layout.rowHeight, 0, constants.SELECTION_OVERLAY);
		}
		const textColor = rowIndex === state.selectionIndex
			? constants.COLOR_SELECTION_TEXT
			: (row.node.resolution !== 'complete'
				? constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM
				: constants.COLOR_RESOURCE_VIEWER_TEXT);
		api.blit_text_inline_span_with_font(
			row.text,
			0,
			row.text.length,
			layout.contentLeft,
			y,
			0,
			textColor,
			renderFont,
		);
	}
}
