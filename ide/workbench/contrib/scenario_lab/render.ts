import * as constants from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import {
	renderWorkbenchActionBar,
} from '../../render/action_bar';
import type { EditorCommandEnablement } from '../../../common/commands';
import { prepareScenarioLabLayout } from './layout';
import type { ScenarioRunState } from '../../../testing/scenario/result_service';
import {
	type ScenarioLabResultRow,
	type ScenarioLabViewState,
} from './view_model';

const TITLE = 'SCENARIO LAB';
const TESTS_HEADER = 'TESTS';
const RESULTS_HEADER = 'RESULTS';
const EMPTY_TESTS_TEXT = 'NO PACKAGED SCENARIO TESTS';
const EMPTY_RESULTS_TEXT = 'NO RESULTS FOR SELECTED TEST';
const TEXT_PADDING_X = 4;
const TEXT_PADDING_Y = 2;

function stateTextColor(state: ScenarioRunState | null): number {
	switch (state) {
		case 'preparing':
		case 'running':
			return constants.COLOR_STATUS_WARNING;
		case 'passed':
			return constants.COLOR_STATUS_SUCCESS;
		case 'failed':
			return constants.COLOR_STATUS_ERROR;
		case 'cancelled':
		case null:
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	}
}

function resultTextColor(row: ScenarioLabResultRow): number {
	if (row.kind === 'failure') {
		return constants.COLOR_STATUS_ERROR;
	}
	if (row.kind === 'fsm_transition') {
		return row.transition.outcome === 'committed'
			? constants.COLOR_STATUS_SUCCESS
			: constants.COLOR_STATUS_WARNING;
	}
	if (row.kind === 'log' || row.kind === 'capture') {
		return constants.COLOR_RESOURCE_VIEWER_TEXT;
	}
	return stateTextColor(row.result.state);
}

function drawToolbar(
	state: ScenarioLabViewState,
	commands: EditorCommandEnablement,
	renderFont: BFont,
): void {
	const layout = state.layout;
	api.fill_rect(
		layout.left,
		layout.top,
		layout.right,
		layout.toolbarBottom,
		0,
		constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND,
	);
	api.blit_text_inline_span_with_font(
		TITLE,
		0,
		TITLE.length,
		layout.left + TEXT_PADDING_X,
		layout.top + TEXT_PADDING_Y,
		0,
		constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT,
		renderFont,
	);
	renderWorkbenchActionBar(state.actionBar, commands, renderFont);
}

function drawPaneHeaders(state: ScenarioLabViewState, renderFont: BFont): void {
	const layout = state.layout;
	const testPaneLayout = state.testPane.layout;
	const resultPaneLayout = state.resultPane.layout;
	const inactiveTextColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	api.fill_rect(
		layout.left,
		testPaneLayout.headerTop,
		layout.right,
		testPaneLayout.headerBottom,
		0,
		constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND,
	);
	api.blit_text_inline_span_with_font(
		TESTS_HEADER,
		0,
		TESTS_HEADER.length,
		testPaneLayout.contentLeft + TEXT_PADDING_X,
		testPaneLayout.headerTop + TEXT_PADDING_Y,
		0,
		state.focus === 'tests'
			? constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT
			: inactiveTextColor,
		renderFont,
	);
	api.blit_text_inline_span_with_font(
		RESULTS_HEADER,
		0,
		RESULTS_HEADER.length,
		resultPaneLayout.contentLeft + TEXT_PADDING_X,
		resultPaneLayout.headerTop + TEXT_PADDING_Y,
		0,
		state.focus === 'results'
			? constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT
			: inactiveTextColor,
		renderFont,
	);
}

function drawTestRows(state: ScenarioLabViewState, renderFont: BFont): void {
	const pane = state.testPane;
	const layout = pane.layout;
	if (pane.rows.length === 0) {
		api.blit_text_inline_span_with_font(
			EMPTY_TESTS_TEXT,
			0,
			EMPTY_TESTS_TEXT.length,
			layout.contentLeft + TEXT_PADDING_X,
			layout.contentTop,
			0,
			constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM,
			renderFont,
		);
		return;
	}
	const endCandidate = pane.scroll + layout.visibleRowCount;
	const end = endCandidate < pane.rows.length ? endCandidate : pane.rows.length;
	for (let rowIndex = pane.scroll; rowIndex < end; rowIndex += 1) {
		const row = pane.rows[rowIndex];
		const y = layout.contentTop + (rowIndex - pane.scroll) * layout.rowHeight;
		const selected = state.focus === 'tests' && rowIndex === pane.selectionIndex;
		if (rowIndex === pane.hoverIndex) {
			api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, constants.HIGHLIGHT_OVERLAY);
		}
		if (selected) {
			api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, constants.SELECTION_OVERLAY);
		}
		api.blit_text_inline_span_with_font(
			row.text,
			0,
			row.text.length,
			layout.contentLeft + TEXT_PADDING_X,
			y,
			0,
			selected
				? constants.COLOR_SELECTION_TEXT
				: (row.kind === 'root'
					? constants.COLOR_RESOURCE_VIEWER_TEXT
					: stateTextColor(row.latestState)),
			renderFont,
		);
	}
}

function drawResultRows(state: ScenarioLabViewState, renderFont: BFont): void {
	const pane = state.resultPane;
	const layout = pane.layout;
	if (pane.rows.length === 0) {
		api.blit_text_inline_span_with_font(
			EMPTY_RESULTS_TEXT,
			0,
			EMPTY_RESULTS_TEXT.length,
			layout.contentLeft + TEXT_PADDING_X,
			layout.contentTop,
			0,
			constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM,
			renderFont,
		);
		return;
	}
	const endCandidate = pane.scroll + layout.visibleRowCount;
	const end = endCandidate < pane.rows.length ? endCandidate : pane.rows.length;
	for (let rowIndex = pane.scroll; rowIndex < end; rowIndex += 1) {
		const row = pane.rows[rowIndex];
		const y = layout.contentTop + (rowIndex - pane.scroll) * layout.rowHeight;
		const selected = state.focus === 'results' && rowIndex === pane.selectionIndex;
		if (rowIndex === pane.hoverIndex) {
			api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, constants.HIGHLIGHT_OVERLAY);
		}
		if (selected) {
			api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, constants.SELECTION_OVERLAY);
		}
		api.blit_text_inline_span_with_font(
			row.text,
			0,
			row.text.length,
			layout.contentLeft + TEXT_PADDING_X,
			y,
			0,
			selected
				? constants.COLOR_SELECTION_TEXT
				: resultTextColor(row),
			renderFont,
		);
	}
}

/** Draws the retained explorer/result projection using the active IDE font. */
export function drawScenarioLab(
	state: ScenarioLabViewState,
	commands: EditorCommandEnablement,
): void {
	const layout = prepareScenarioLabLayout(state);
	const renderFont = editorViewState.font.renderFont();
	api.fill_rect(
		layout.left,
		layout.top,
		layout.right,
		layout.bottom,
		0,
		constants.COLOR_RESOURCE_VIEWER_BACKGROUND,
	);
	drawToolbar(state, commands, renderFont);
	drawPaneHeaders(state, renderFont);
	const borderColor = constants.COLOR_TAB_BORDER;
	const testPaneLayout = state.testPane.layout;
	api.fill_rect(
		layout.left,
		layout.toolbarBottom,
		layout.right,
		layout.toolbarBottom + 1,
		0,
		borderColor,
	);
	api.fill_rect(
		layout.left,
		testPaneLayout.headerBottom,
		layout.right,
		testPaneLayout.headerBottom + 1,
		0,
		borderColor,
	);
	api.fill_rect(
		testPaneLayout.contentRight,
		layout.toolbarBottom + 1,
		testPaneLayout.contentRight + 1,
		layout.bottom,
		0,
		borderColor,
	);
	drawTestRows(state, renderFont);
	drawResultRows(state, renderFont);
}
