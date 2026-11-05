import { PointerClickSequence } from '../../../input/pointer/click_sequence';
import type { PointerSnapshot } from '../../../common/models';
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

export class ScenarioLabPointer {
	private readonly clicks = new PointerClickSequence<ScenarioLabTestRow | ScenarioLabResultRow>();
	public clear(): void { this.clicks.clear(); }
	public handle(
		state: ScenarioLabViewState,
		snapshot: PointerSnapshot,
		justPressed: boolean,
		currentTimeMs: number,
	): ScenarioLabPointerResult {
		const layout = state.layout;
		const inside = snapshot.valid
			&& snapshot.insideViewport
			&& snapshot.viewportX >= layout.left
			&& snapshot.viewportX < layout.right
			&& snapshot.viewportY >= layout.top
			&& snapshot.viewportY < layout.bottom;
		if (!inside) {
			if (snapshot.justPressedButtons !== 0 || !snapshot.valid) this.clear();
			state.testPane.hoverIndex = -1;
			state.resultPane.hoverIndex = -1;
			return ScenarioLabPointerResult.Outside;
		}

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

		const testIndex = testPane.hoverIndex;
		if (testIndex >= 0) {
			const row = testPane.rows[testIndex];
			selectScenarioLabTestRow(state, testIndex);
			if (pointerHitsTwistie(snapshot, row)) {
				toggleScenarioLabTestRow(state, testIndex);
				this.clicks.clear();
				return ScenarioLabPointerResult.Handled;
			}
			return this.clicks.click(row, snapshot.viewportX, snapshot.viewportY, currentTimeMs)
				? ScenarioLabPointerResult.Activate
				: ScenarioLabPointerResult.Handled;
		}

		const resultIndex = resultPane.hoverIndex;
		if (resultIndex >= 0) {
			const row = resultPane.rows[resultIndex];
			selectScenarioLabResultRow(state, resultIndex);
			if (pointerHitsTwistie(snapshot, row)) {
				toggleScenarioLabResultRow(state, resultIndex);
				this.clicks.clear();
				return ScenarioLabPointerResult.Handled;
			}
			return this.clicks.click(row, snapshot.viewportX, snapshot.viewportY, currentTimeMs)
				? ScenarioLabPointerResult.Activate
				: ScenarioLabPointerResult.Handled;
		}

		state.focus = snapshot.viewportX < testPane.layout.contentRight ? 'tests' : 'results';
		updateScenarioLabStatus(state);
		this.clicks.clear();
		return ScenarioLabPointerResult.Handled;
	}
}
