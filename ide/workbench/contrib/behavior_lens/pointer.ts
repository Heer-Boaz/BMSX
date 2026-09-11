import type { PointerHoverService, PointerHoverTarget } from '../../../input/pointer/hover';
import { PointerButton } from '../../../input/pointer/buttons';
import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { selectBehaviorLensRow, toggleBehaviorLensRow } from './navigation';
import type { BehaviorSourceNode } from './model';
import type { BehaviorLensOutline, BehaviorLensViewState } from './view_model';

export const enum BehaviorLensPointerResult {
	Outside,
	Handled,
	Activate,
	ContextMenu,
}

/** A pane gesture targets one occurrence in one source generation, not a reusable row key. */
export class BehaviorLensPointer implements PointerHoverTarget {
	private hoveredOutline: BehaviorLensOutline | undefined;

	public constructor(private readonly hover: PointerHoverService) {}

	public onPointerLeave(): void {
		this.hoveredOutline!.hoverIndex = -1;
		this.hoveredOutline = undefined;
	}

	public clear(): void { this.hover.release(this); this.cancel(); }
	private lastClickTimeMs = 0;
	private lastClickNode: BehaviorSourceNode | null = null;

	public cancel(): void {
		this.lastClickNode = null;
	}

	public handle(
		state: BehaviorLensViewState,
		outline: BehaviorLensOutline,
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
			this.hover.release(this);
			return BehaviorLensPointerResult.Outside;
		}
		if (this.hoveredOutline !== outline) this.hover.release(this);
		this.hoveredOutline = outline;
		this.hover.visit(this);
		const rowIndex = workbenchListRowIndexAtPosition(outline, snapshot.viewportX, snapshot.viewportY);
		outline.hoverIndex = rowIndex;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.cancel();
			if (rowIndex >= 0) selectBehaviorLensRow(state, outline, rowIndex);
			else state.selection = null;
			return BehaviorLensPointerResult.ContextMenu;
		}
		if (!justPressed || rowIndex < 0) {
			return BehaviorLensPointerResult.Handled;
		}

		const row = outline.rows[rowIndex];
		if (row.expandable
			&& snapshot.viewportX >= row.twistieLeft
			&& snapshot.viewportX < row.twistieRight) {
			toggleBehaviorLensRow(state, outline, rowIndex);
			this.cancel();
			return BehaviorLensPointerResult.Handled;
		}
		selectBehaviorLensRow(state, outline, rowIndex);

		const doubleClick = this.lastClickNode === row.node
			&& currentTimeMs - this.lastClickTimeMs <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS;
		this.lastClickNode = doubleClick ? null : row.node;
		this.lastClickTimeMs = currentTimeMs;
		return doubleClick ? BehaviorLensPointerResult.Activate : BehaviorLensPointerResult.Handled;
	}
}
