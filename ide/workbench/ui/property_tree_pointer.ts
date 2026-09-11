import { PointerButton } from '../../input/pointer/buttons';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../common/constants';
import type { PointerSnapshot } from '../../common/models';
import { workbenchListRowIndexAtPosition } from './list_view';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from './property_tree';
import { setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, type WorkbenchTreeNode } from './tree_view';

export const enum WorkbenchPropertyPointerResult { Outside, Handled, Selection, Collapse, Activate, ContextMenu }

/** A gesture belongs to one retained tree node. Reprojection and detach cannot transfer a double-click. */
export class WorkbenchPropertyTreePointer {
	private lastClickNode: WorkbenchTreeNode<WorkbenchPropertyElement> | null = null;
	private lastClickTime = 0;

	public cancel(): void { this.lastClickNode = null; }

	public handle<Element extends WorkbenchPropertyElement>(
		state: WorkbenchPropertyTree<Element>, snapshot: PointerSnapshot, justPressed: boolean, now: number,
	): WorkbenchPropertyPointerResult {
		const layout = state.layout;
		if (!snapshot.valid || !snapshot.insideViewport || snapshot.viewportX < layout.contentLeft || snapshot.viewportX >= layout.contentRight
			|| snapshot.viewportY < layout.contentTop || snapshot.viewportY >= layout.bottom) {
			if (justPressed || !snapshot.valid || !snapshot.insideViewport) this.cancel();
			state.hoverIndex = -1;
			return WorkbenchPropertyPointerResult.Outside;
		}
		const index = workbenchListRowIndexAtPosition(state, snapshot.viewportX, snapshot.viewportY);
		state.hoverIndex = index;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.cancel();
			state.selectionIndex = index;
			return WorkbenchPropertyPointerResult.ContextMenu;
		}
		if (!justPressed) return WorkbenchPropertyPointerResult.Handled;
		if (index < 0) {
			this.cancel();
			return WorkbenchPropertyPointerResult.Handled;
		}
		const node = state.rows[index];
		state.selectionIndex = index;
		const twice = this.lastClickNode === node && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
		if (workbenchTreeTwistieContainsPosition(state, index, snapshot.viewportX) || twice && node.element.kind === 'group') {
			setWorkbenchTreeCollapsed(state, index, !node.collapsed);
			this.cancel();
			return WorkbenchPropertyPointerResult.Collapse;
		}
		this.lastClickNode = twice ? null : node;
		this.lastClickTime = now;
		return twice ? WorkbenchPropertyPointerResult.Activate : WorkbenchPropertyPointerResult.Selection;
	}
}
