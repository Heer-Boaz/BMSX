import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { selectBehaviorLensRow, toggleBehaviorLensRow } from './navigation';
import type { BehaviorSourceNode } from './model';
import type { BehaviorLensViewState } from './view_model';

export const enum BehaviorLensPointerResult {
	Outside,
	Handled,
	Activate,
}

/** A pane gesture targets one occurrence in one source generation, not a reusable row key. */
export class BehaviorLensPointer {
	private lastClickTimeMs = 0;
	private lastClickNode: BehaviorSourceNode | null = null;

	public cancel(): void {
		this.lastClickNode = null;
	}

	public handle(
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
			this.cancel();
			return BehaviorLensPointerResult.Handled;
		}
		selectBehaviorLensRow(state, rowIndex);

		const doubleClick = this.lastClickNode === row.node
			&& currentTimeMs - this.lastClickTimeMs <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS;
		this.lastClickNode = doubleClick ? null : row.node;
		this.lastClickTimeMs = currentTimeMs;
		return doubleClick ? BehaviorLensPointerResult.Activate : BehaviorLensPointerResult.Handled;
	}
}
