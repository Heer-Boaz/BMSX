import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { updateWorkbenchActionBarPointer } from '../../input/pointer/action_bar';
import { workbenchListRowIndexAtPosition } from '../../ui/list_view';
import {
	selectScenarioLabResultRow,
	selectScenarioLabTestRow,
	toggleScenarioLabResultRow,
	toggleScenarioLabTestRow,
	updateScenarioLabStatus,
} from './navigation';
import type {
	ScenarioLabResultRow,
	ScenarioLabTestRow,
	ScenarioLabViewState,
} from './view_model';

export const enum ScenarioLabPointerResult {
	Outside,
	Handled,
	Activate,
}

function pointerHitsTwistie(
	snapshot: PointerSnapshot,
	row: ScenarioLabTestRow | ScenarioLabResultRow,
): boolean {
	return row.expandable
		&& snapshot.viewportX >= row.twistieLeft
		&& snapshot.viewportX < row.twistieRight;
}

function recordPointerClick(
	state: ScenarioLabViewState,
	rowId: string,
	currentTimeMs: number,
): boolean {
	const doubleClick = state.lastPointerClickRowId === rowId
		&& currentTimeMs - state.lastPointerClickTimeMs <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS;
	state.lastPointerClickTimeMs = doubleClick ? 0 : currentTimeMs;
	state.lastPointerClickRowId = doubleClick ? null : rowId;
	return doubleClick;
}

export function handleScenarioLabPointerInput(
	state: ScenarioLabViewState,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	currentTimeMs: number,
	commands: IdeCommandController,
): ScenarioLabPointerResult {
	const layout = state.layout;
	const inside = snapshot.valid
		&& snapshot.insideViewport
		&& snapshot.viewportX >= layout.left
		&& snapshot.viewportX < layout.right
		&& snapshot.viewportY >= layout.top
		&& snapshot.viewportY < layout.bottom;
	if (!inside) {
		state.testPane.hoverIndex = -1;
		state.resultPane.hoverIndex = -1;
		state.actionBar.hoveredCommand = null;
		return ScenarioLabPointerResult.Outside;
	}

	const action = updateWorkbenchActionBarPointer(state.actionBar, snapshot);
	const testPane = state.testPane;
	const resultPane = state.resultPane;
	testPane.hoverIndex = workbenchListRowIndexAtPosition(
		testPane,
		snapshot.viewportX,
		snapshot.viewportY,
	);
	resultPane.hoverIndex = workbenchListRowIndexAtPosition(
		resultPane,
		snapshot.viewportX,
		snapshot.viewportY,
	);
	if (!justPressed) {
		return ScenarioLabPointerResult.Handled;
	}
	if (action !== null) {
		state.lastPointerClickTimeMs = 0;
		state.lastPointerClickRowId = null;
		if (commands.isEnabled(action)) {
			commands.execute(action);
		}
		return ScenarioLabPointerResult.Handled;
	}

	const testIndex = testPane.hoverIndex;
	if (testIndex >= 0) {
		const row = testPane.rows[testIndex];
		if (pointerHitsTwistie(snapshot, row)) {
			toggleScenarioLabTestRow(state, testIndex);
			state.lastPointerClickTimeMs = 0;
			state.lastPointerClickRowId = null;
			return ScenarioLabPointerResult.Handled;
		}
		selectScenarioLabTestRow(state, testIndex);
		return recordPointerClick(state, `test:${row.id}`, currentTimeMs)
			? ScenarioLabPointerResult.Activate
			: ScenarioLabPointerResult.Handled;
	}

	const resultIndex = resultPane.hoverIndex;
	if (resultIndex >= 0) {
		const row = resultPane.rows[resultIndex];
		if (pointerHitsTwistie(snapshot, row)) {
			toggleScenarioLabResultRow(state, resultIndex);
			state.lastPointerClickTimeMs = 0;
			state.lastPointerClickRowId = null;
			return ScenarioLabPointerResult.Handled;
		}
		selectScenarioLabResultRow(state, resultIndex);
		return recordPointerClick(state, `result:${row.id}`, currentTimeMs)
			? ScenarioLabPointerResult.Activate
			: ScenarioLabPointerResult.Handled;
	}

	state.focus = snapshot.viewportX < testPane.layout.contentRight ? 'tests' : 'results';
	updateScenarioLabStatus(state);
	state.lastPointerClickTimeMs = 0;
	state.lastPointerClickRowId = null;
	return ScenarioLabPointerResult.Handled;
}
