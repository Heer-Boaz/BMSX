import { uppercaseOutsideStrings } from '../../../common/text';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import {
	clampWorkbenchListScroll,
	layoutWorkbenchList,
} from '../../ui/list_view';
import {
	refreshScenarioLabProjection,
	updateScenarioTestResultStates,
} from './projection';
import type { ScenarioRunState } from '../../../testing/scenario/result_service';
import {
	type ScenarioLabLayout,
	type ScenarioLabPaneLayout,
	type ScenarioLabPaneState,
	type ScenarioLabResultRow,
	type ScenarioLabViewState,
} from './view_model';

const TOOLBAR_PADDING_X = 4;
const TOOLBAR_PADDING_Y = 2;
const PANE_PADDING_X = 4;
const PANE_HEADER_PADDING_Y = 2;
const TREE_INDENT_COLUMNS = 2;
const STATUS_PADDING_X = 4;

export function createScenarioLabLayout(): ScenarioLabLayout {
	return {
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		toolbarBottom: 0,
		rowHeight: 0,
		font: null,
		viewportWidth: -1,
		viewportHeight: -1,
		codeAreaTop: -1,
		codeAreaBottom: -1,
	};
}

export function createScenarioLabPaneLayout(): ScenarioLabPaneLayout {
	return {
		headerTop: 0,
		headerBottom: 0,
		contentLeft: 0,
		contentTop: 0,
		contentRight: 0,
		contentBottom: 0,
		rowHeight: 0,
		visibleRowCount: 0,
	};
}

function scenarioStateBadge(state: ScenarioRunState | null): string {
	if (state === null) {
		return '[ ]';
	}
	switch (state) {
		case 'preparing': return '[...]';
		case 'running': return '[RUN]';
		case 'passed': return '[OK]';
		case 'failed': return '[X]';
		case 'cancelled': return '[-]';
	}
}

function writeScenarioTestText(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	const layout = pane.layout;
	const availableWidth = layout.contentRight - layout.contentLeft - PANE_PADDING_X * 2;
	const indentWidth = editorViewState.charAdvance * TREE_INDENT_COLUMNS;
	updateScenarioTestResultStates(state);
	for (let index = 0; index < pane.rows.length; index += 1) {
		const row = pane.rows[index];
		let rawText: string;
		if (row.kind === 'root') {
			const marker = row.expanded ? '-' : '+';
			rawText = `${marker} ${row.root.label}  ${row.root.testCount}`;
		} else {
			rawText = `  ${scenarioStateBadge(row.latestState)} ${row.test.label}`;
		}
		row.text = truncateTextToWidth(
			uppercaseOutsideStrings(rawText),
			availableWidth,
		);
		row.twistieLeft = layout.contentLeft + PANE_PADDING_X + row.depth * indentWidth;
		row.twistieRight = row.twistieLeft + indentWidth;
	}
}

function resultSummaryText(row: ScenarioLabResultRow): string {
	const result = row.result;
	const endTick = result.endTick === null ? '...' : String(result.endTick);
	return `${row.expanded ? '-' : '+'} ${scenarioStateBadge(result.state)} RUN ${result.sequence}  REV ${result.sourceRevision}  T${result.startTick}-${endTick}`;
}

function resultDetailText(row: ScenarioLabResultRow): string {
	switch (row.kind) {
		case 'result':
			return resultSummaryText(row);
		case 'failure':
			return `  ERROR  ${row.failure.message}`;
		case 'log': {
			const log = row.log;
			return `  LOG T${log.tick}  ${log.text}`;
		}
		case 'capture': {
			const capture = row.capture;
			const frame = capture.presentedFrame === null ? '-' : String(capture.presentedFrame);
			return `  CAP T${capture.requestTick} F${frame}  ${capture.label}`;
		}
	}
}

function writeScenarioResultText(state: ScenarioLabViewState): void {
	const pane = state.resultPane;
	const layout = pane.layout;
	const availableWidth = layout.contentRight - layout.contentLeft - PANE_PADDING_X * 2;
	const markerWidth = editorViewState.charAdvance * TREE_INDENT_COLUMNS;
	for (let index = 0; index < pane.rows.length; index += 1) {
		const row = pane.rows[index];
		row.text = truncateTextToWidth(
			uppercaseOutsideStrings(resultDetailText(row)),
			availableWidth,
		);
		row.twistieLeft = layout.contentLeft + PANE_PADDING_X;
		row.twistieRight = row.twistieLeft + markerWidth;
	}
}

function writeScenarioLabStatusText(state: ScenarioLabViewState): void {
	const status = state.status;
	const availableWidthCandidate = editorViewState.viewportWidth - STATUS_PADDING_X * 2;
	const availableWidth = availableWidthCandidate > 0 ? availableWidthCandidate : 0;
	status.renderedInfo = truncateTextToWidth(status.info, availableWidth);
	status.dirty = false;
}

function layoutScenarioLabPane<Row>(
	pane: ScenarioLabPaneState<Row>,
	left: number,
	right: number,
	headerTop: number,
	headerBottom: number,
	bottom: number,
	rowHeight: number,
): void {
	pane.layout.headerTop = headerTop;
	pane.layout.headerBottom = headerBottom;
	layoutWorkbenchList(
		pane.layout,
		left,
		headerBottom + 1,
		right,
		bottom,
		rowHeight,
	);
}

/** Refreshes the retained projection and geometry only at owner revision boundaries. */
export function prepareScenarioLabLayout(state: ScenarioLabViewState): ScenarioLabLayout {
	refreshScenarioLabProjection(state);
	const layout = state.layout;
	if (updateFullWidthWorkbenchLayout(layout)) {
		layout.toolbarBottom = layout.top + editorViewState.lineHeight + TOOLBAR_PADDING_Y * 2;
		const paneWidth = (((layout.right - layout.left) * 5) / 12) | 0;
		const testPaneRight = layout.left + paneWidth;
		const headerTop = layout.toolbarBottom + 1;
		const headerBottom = headerTop
			+ editorViewState.lineHeight
			+ PANE_HEADER_PADDING_Y * 2;
		layoutScenarioLabPane(
			state.testPane,
			layout.left,
			testPaneRight,
			headerTop,
			headerBottom,
			layout.bottom,
			layout.rowHeight,
		);
		layoutScenarioLabPane(
			state.resultPane,
			testPaneRight + 1,
			layout.right,
			headerTop,
			headerBottom,
			layout.bottom,
			layout.rowHeight,
		);
		layoutWorkbenchActionBar(
			state.actionBar,
			layout.right - TOOLBAR_PADDING_X,
			layout.top + 1,
			layout.toolbarBottom - 1,
			measureText,
		);
		state.testPane.textDirty = true;
		state.resultPane.textDirty = true;
		state.status.dirty = true;
	}
	if (state.testPane.textDirty) {
		writeScenarioTestText(state);
		state.testPane.textDirty = false;
	}
	if (state.resultPane.textDirty) {
		writeScenarioResultText(state);
		state.resultPane.textDirty = false;
	}
	if (state.status.dirty) {
		writeScenarioLabStatusText(state);
	}
	clampWorkbenchListScroll(state.testPane);
	clampWorkbenchListScroll(state.resultPane);
	return layout;
}
