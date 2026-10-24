import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../common/constants';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusTarget } from '../../input/focus';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';
import { WorkbenchTooltip } from './tooltip';
import { workbenchListRowIndexAtPosition } from './list_view';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from './property_tree';
import { setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, type WorkbenchTreeNode } from './tree_view';

export const enum WorkbenchPropertyPointerResult { Outside, Handled, Selection, Collapse, Activate, ContextMenu }

/** A gesture belongs to one retained tree node. Reprojection and detach cannot transfer a double-click. */
export class WorkbenchPropertyTreePointer implements PointerHoverTarget {
	private hoveredTree: WorkbenchPropertyTree<WorkbenchPropertyElement> | undefined;
	private feedback: WorkbenchTooltip | undefined;
	private feedbackOwner: WorkbenchSurface | undefined;
	private feedbackArea: Readonly<RectBounds> | undefined;
	private feedbackFocus: InputFocusTarget | undefined;
	private unbindBlur: (() => void) | undefined;
	private unbindFocus: (() => void) | undefined;
	private tree: WorkbenchPropertyTree<WorkbenchPropertyElement> | undefined;
	private feedbackNode: WorkbenchTreeNode<WorkbenchPropertyElement> | undefined;
	private feedbackKeyboard = false;
	private feedbackScroll = 0;
	private pointerX = -1;
	private pointerY = -1;
	private readonly feedbackAnchor = create_rect_bounds();
	private feedbackLabel = '';
	private feedbackValue = '';
	private feedbackDescription = '';
	private feedbackText = '';
	private readonly measureFeedback = (text: string) => this.tree!.layout.measure!(text, 0, text.length);

	public constructor(private readonly hover: PointerHoverService) {}

	/** Feedback belongs to the actual editor attachment, independent of source/edit commands. */
	public attachFeedback(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>, focus: InputFocusTarget): void {
		this.feedback = new WorkbenchTooltip(); this.feedbackOwner = owner; this.feedbackArea = workArea; this.feedbackFocus = focus;
		this.feedback.attach(surfaces, owner, workArea);
		this.unbindBlur = focus.onDidBlur(() => this.hideFeedback());
		this.unbindFocus = focus.onDidFocus(() => { if (this.tree !== undefined) this.keyboardSelection(this.tree); });
	}

	public hideFeedback(): void {
		this.feedback?.hide(); this.feedbackNode = undefined; this.feedbackKeyboard = false;
	}

	private retireFeedback(): void {
		this.hideFeedback();
		this.feedbackLabel = ''; this.feedbackValue = ''; this.feedbackDescription = ''; this.feedbackText = '';
	}

	public keyboardSelection<Element extends WorkbenchPropertyElement>(state: WorkbenchPropertyTree<Element>): void {
		this.tree = state; this.feedbackNode = state.rows[state.selectionIndex]; this.feedbackKeyboard = true; this.feedbackScroll = state.scroll;
		this.updateFeedback(state);
	}

	/** Hover and focus read retained strings only; an idle frame never remeasures unchanged feedback. */
	public updateFeedback<Element extends WorkbenchPropertyElement>(state: WorkbenchPropertyTree<Element>): void {
		this.tree = state;
		if (this.feedback === undefined) return;
		if (this.feedbackScroll !== state.scroll) { this.feedbackScroll = state.scroll; this.hideFeedback(); }
		const index = this.feedbackKeyboard ? state.selectionIndex : state.hoverIndex;
		const node = state.rows[index];
		const layout = state.layout;
		if (this.feedbackOwner!.retired || this.feedbackNode !== undefined && node !== this.feedbackNode) {
			this.retireFeedback(); return;
		}
		if (node === undefined || node !== this.feedbackNode
			|| this.feedbackKeyboard && !this.feedbackFocus!.hasFocus
			|| node.element.displayLabel === node.element.label && node.element.displayValue === node.element.value
				&& !(index === state.selectionIndex && state.descriptionClipped)) {
			this.feedback.hide(); return;
		}
		const top = layout.contentTop + (index - (state.scroll | 0)) * layout.rowHeight;
		if (top < layout.contentTop || top + layout.rowHeight > layout.contentBottom) { this.feedback.hide(); return; }
		const element = node.element;
		if (this.feedbackLabel !== element.label || this.feedbackValue !== element.value || this.feedbackDescription !== element.description) {
			this.feedbackLabel = element.label; this.feedbackValue = element.value; this.feedbackDescription = element.description;
			this.feedbackText = element.label + (element.value.length === 0 ? '' : '\n' + element.value)
				+ (element.description.length === 0 ? '' : '\n' + element.description);
		}
		write_rect_bounds(this.feedbackAnchor, layout.contentLeft, top, layout.contentRight, top + layout.rowHeight);
		this.feedback.show(this.feedbackText, this.feedbackAnchor, layout.font!, layout.measure!, this.measureFeedback, this.feedbackArea!);
	}

	public dispose(): void { this.clear(); this.feedback?.detach(); this.unbindBlur?.(); this.unbindFocus?.(); }

	public onPointerLeave(): void {
		this.hoveredTree!.hoverIndex = -1;
		this.hoveredTree = undefined;
		if (!this.feedbackKeyboard) this.hideFeedback();
		this.pointerX = -1; this.pointerY = -1;
	}

	public clear(): void {
		this.hover.release(this); this.cancel(); this.retireFeedback(); this.tree = undefined;
		this.pointerX = -1; this.pointerY = -1;
	}
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
			this.hover.release(this);
			return WorkbenchPropertyPointerResult.Outside;
		}
		if (this.hoveredTree !== state) this.hover.release(this);
		this.hoveredTree = state;
		this.hover.visit(this);
		const index = workbenchListRowIndexAtPosition(state, snapshot.viewportX, snapshot.viewportY);
		state.hoverIndex = index;
		if (this.pointerX !== snapshot.viewportX || this.pointerY !== snapshot.viewportY) {
			this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
			this.tree = state; this.feedbackNode = state.rows[index]; this.feedbackKeyboard = false; this.feedbackScroll = state.scroll;
		}
		if (justPressed || snapshot.justPressedButtons !== 0) this.hideFeedback();
		else this.updateFeedback(state);
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
