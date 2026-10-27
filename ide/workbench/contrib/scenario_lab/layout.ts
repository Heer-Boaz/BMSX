import type { RectBounds } from '../../../../machine/ts/common/rect';
import { uppercaseOutsideStrings } from '../../../common/text';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import {
	clampWorkbenchListScroll,
	layoutWorkbenchList,
	revealWorkbenchListSelection,
} from '../../ui/list_view';
import {
	refreshScenarioLabProjection,
	updateScenarioTestResultStates,
} from './projection';
import type { ScenarioResultState } from '../../../testing/scenario/result_service';
import { scenarioTestIdentity } from './labels';
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
// Tests retain suite/module/case lanes; results keep a readable failure summary beside them.
const TEST_READING_COLUMNS = 24;
const RESULT_READING_COLUMNS = 32;
let minimumFont: EditorFont | undefined;
let testsMinimumWidth = 0, resultsMinimumWidth = 0;

export function measureScenarioLabMinimumWidth(state: ScenarioLabViewState): number {
	const font = editorViewState.font;
	if (minimumFont !== font) {
		minimumFont = font;
		const indent = Math.max(editorViewState.charAdvance * TREE_INDENT_COLUMNS, WORKBENCH_ICON_SIZE + 2);
		testsMinimumWidth = editorViewState.charAdvance * TEST_READING_COLUMNS + indent * 3 + PANE_PADDING_X * 2 + 2;
		resultsMinimumWidth = editorViewState.charAdvance * RESULT_READING_COLUMNS + indent * 3 + PANE_PADDING_X * 2 + 2;
	}
	// The user-owned inner ratio remains intact; admission must fit both clients at that ratio.
	return Math.max(Math.ceil(testsMinimumWidth / state.split.ratio),
		Math.ceil((resultsMinimumWidth + 1) / (1 - state.split.ratio)));
}

export function createScenarioLabLayout(): ScenarioLabLayout {
	return {
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		toolbarBottom: 0,
		caption: '',
		rowHeight: 0,
		font: null,
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
		indentWidth: 0,
	};
}

function scenarioStateBadge(state: ScenarioResultState | null): string {
	if (state === null) {
		return '[ ]';
	}
	switch (state) {
		case 'queued': return '[ ]';
		case 'preparing': return '[…]';
		case 'running': return '[RUN]';
		case 'passed': return '[OK]';
		case 'failed': return '[X]';
		case 'cancelled': return '[-]';
		case 'skipped': return '[>]';
	}
}

function writeScenarioTestText(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	const layout = pane.layout;
	updateScenarioTestResultStates(state);
	for (let index = 0; index < pane.rows.length; index += 1) {
		const row = pane.rows[index];
		let rawText: string;
		if (row.kind === 'root') {
			rawText = `${row.caption} (${row.root.testCount})`;
		} else if (row.kind === 'module') {
			rawText = `${row.caption} (${row.module.children.length})${row.module.diagnostic === null ? '' : ' / INVALID'}`;
		} else {
			rawText = `${scenarioStateBadge(row.latestState)} ${row.caption}`;
		}
		if (row.fullText !== rawText) {
			row.fullText = rawText;
			row.feedbackText = row.kind === 'test' ? row.identity : rawText + '\n' + row.identity;
		}
		row.twistieLeft = layout.contentLeft + PANE_PADDING_X + row.depth * layout.indentWidth;
		row.twistieRight = row.twistieLeft + layout.indentWidth;
		row.textLeft = row.twistieRight + 2;
		row.text = truncateTextToWidth(
			uppercaseOutsideStrings(rawText),
			layout.contentRight - row.textLeft - PANE_PADDING_X,
		);
	}
}

function resultSummaryText(row: ScenarioLabResultRow): string {
	const result = row.result;
	if (result === null) {
		const run = row.run;
		return `${scenarioStateBadge(run.state)} ${run.mode.toUpperCase()} ${run.sequence}  ${run.completedCount}/${run.items.length}  OK ${run.passedCount} X ${run.failedCount} C ${run.cancelledCount} S ${run.skippedCount}`;
	}
	const startTick = result.startTick === null ? '…' : String(result.startTick);
	const endTick = result.endTick === null ? '…' : String(result.endTick);
	return `${scenarioStateBadge(result.state)} ${result.test.label}  REV ${result.sourceRevision}  T${startTick}-${endTick}`;
}

function semanticPathTail(defId: string): string {
	const separator = defId.lastIndexOf('/');
	return defId.slice(separator + 1);
}

function resultDetailText(row: ScenarioLabResultRow): string {
	switch (row.kind) {
		case 'run':
		case 'result':
			return resultSummaryText(row);
		case 'failure':
			return `ERROR  ${row.failure.message}`;
		case 'log': {
			const log = row.log;
			return `LOG T${log.tick}  ${log.text}`;
		}
		case 'capture': {
			const capture = row.capture;
			const frame = capture.presentedFrame === null ? '-' : String(capture.presentedFrame);
			return `CAP T${capture.requestTick} F${frame}  ${capture.label}`;
		}
		case 'fsm_transition': {
			const transition = row.transition;
			const outcome = transition.outcome === 'committed' ? 'OK' : 'NO';
			return `FSM [${outcome}] ${semanticPathTail(transition.fromDefId)} > ${semanticPathTail(transition.toDefId)}  @${transition.producerTimeMillisecondsWord}MS #${transition.producerSequence}`;
		}
		case 'actioneffect_fact': {
			const fact = row.fact;
			if (fact.kind === 'trigger') {
				const outcome = fact.outcome === 'accepted'
					? 'OK'
					: `NO:${fact.outcome}`;
				return `EFFECT TRIGGER [${outcome}] ${fact.effectId}  @${fact.producerTimeMillisecondsWord}MS #${fact.producerSequence}`;
			}
			return `EFFECT ${fact.kind} ${fact.effectId} x${fact.activeCount}  @${fact.producerTimeMillisecondsWord}MS #${fact.producerSequence}`;
		}
	}
}

function writeScenarioResultText(state: ScenarioLabViewState): void {
	const pane = state.resultPane;
	const layout = pane.layout;
	for (let index = 0; index < pane.rows.length; index += 1) {
		const row = pane.rows[index];
		const fullText = resultDetailText(row);
		if (row.fullText !== fullText) {
			row.fullText = fullText;
			row.feedbackText = fullText + (row.result === null ? '' : '\n' + scenarioTestIdentity(row.result.test));
		}
		row.twistieLeft = layout.contentLeft + PANE_PADDING_X + row.depth * layout.indentWidth;
		row.twistieRight = row.twistieLeft + layout.indentWidth;
		row.textLeft = row.twistieRight + 2;
		row.text = truncateTextToWidth(
			uppercaseOutsideStrings(row.fullText),
			layout.contentRight - row.textLeft - PANE_PADDING_X,
		);
	}
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
	pane.layout.indentWidth = Math.max(editorViewState.charAdvance * TREE_INDENT_COLUMNS, WORKBENCH_ICON_SIZE + 2);
	layoutWorkbenchList(
		pane.layout,
		left,
		headerBottom + 1,
		right,
		bottom,
		Math.max(rowHeight, WORKBENCH_ICON_SIZE) + 2,
	);
}

/** Refreshes the retained projection and geometry only at owner revision boundaries. */
export function prepareScenarioLabLayout(state: ScenarioLabViewState, bounds: Readonly<RectBounds>): ScenarioLabLayout {
	refreshScenarioLabProjection(state);
	const layout = state.layout;
	if (updateFullWidthWorkbenchLayout(layout, bounds) || state.splitRevision !== state.split.revision) {
		layout.toolbarBottom = layout.top + editorViewState.lineHeight + TOOLBAR_PADDING_Y * 2;
		state.split.layout(layout.left, layout.toolbarBottom + 1, layout.right, layout.bottom);
		state.splitRevision = state.split.revision;
		const testPaneRight = state.split.position;
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
		state.actionsDirty = true;
		state.testPane.textDirty = true;
		state.resultPane.textDirty = true;
		state.status.dirty = true;
	}
	if (state.actionsDirty) {
		layoutWorkbenchActionBar(
			state.actionBar,
			layout.right - TOOLBAR_PADDING_X,
			layout.top + 1,
			layout.toolbarBottom - 1,
			measureText,
			editorViewState.font.renderFont(), layout.left + measureText('SCENARIO LAB') + 12,
		);
		layout.caption = truncateTextToWidth('SCENARIO LAB', state.actionBar.bounds.left - layout.left - 8);
		state.actionsDirty = false;
	}
	if (state.testPane.textDirty) {
		writeScenarioTestText(state);
		state.testPane.textDirty = false;
	}
	if (state.resultPane.textDirty) {
		writeScenarioResultText(state);
		state.resultPane.textDirty = false;
	}
	clampWorkbenchListScroll(state.testPane);
	clampWorkbenchListScroll(state.resultPane);
	if (state.pendingReveal && state.testPane.layout.visibleRowCount !== 0 && state.resultPane.layout.visibleRowCount !== 0) {
		state.pendingReveal = false;
		revealWorkbenchListSelection(state.testPane);
		revealWorkbenchListSelection(state.resultPane);
	}
	return layout;
}
