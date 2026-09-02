import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { selectBehaviorLensRow, toggleBehaviorLensRow } from './navigation';
import type { BehaviorLensViewState } from './view_model';

export const enum BehaviorLensPointerResult {
	Outside,
	Handled,
	Activate,
}

export function handleBehaviorLensPointerInput(
	state: BehaviorLensViewState,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	currentTimeMs: number,
): BehaviorLensPointerResult {
	const layout = state.layout;
	const inside = snapshot.valid
		&& snapshot.insideViewport
		&& snapshot.viewportX >= layout.left
		&& snapshot.viewportX < layout.right
		&& snapshot.viewportY >= layout.top
		&& snapshot.viewportY < layout.bottom;
	if (!inside) {
		state.hoverIndex = -1;
		return BehaviorLensPointerResult.Outside;
	}
	const rowIndex = workbenchListRowIndexAtPosition(state, snapshot.viewportX, snapshot.viewportY);
	state.hoverIndex = rowIndex;
	if (!justPressed || rowIndex < 0) {
		return BehaviorLensPointerResult.Handled;
	}

	const row = state.rows[rowIndex];
	if (row.expandable
		&& snapshot.viewportX >= row.twistieLeft
		&& snapshot.viewportX < row.twistieRight) {
		toggleBehaviorLensRow(state, rowIndex);
		state.lastPointerClickTimeMs = 0;
		state.lastPointerClickRowKey = null;
		return BehaviorLensPointerResult.Handled;
	}
	selectBehaviorLensRow(state, rowIndex);

	const doubleClick = state.lastPointerClickRowKey === row.node.rowKey
		&& currentTimeMs - state.lastPointerClickTimeMs <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS;
	if (doubleClick) {
		state.lastPointerClickTimeMs = 0;
		state.lastPointerClickRowKey = null;
		return BehaviorLensPointerResult.Activate;
	}
	state.lastPointerClickTimeMs = currentTimeMs;
	state.lastPointerClickRowKey = row.node.rowKey;
	return BehaviorLensPointerResult.Handled;
}
