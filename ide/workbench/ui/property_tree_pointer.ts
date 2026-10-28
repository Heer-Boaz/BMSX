import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../common/constants';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';
import { WorkbenchTooltip } from './tooltip';
import { workbenchListRowIndexAtPosition } from './list_view';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from './property_tree';
import { setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, type WorkbenchTreeNode } from './tree_view';

export const enum WorkbenchPropertyPointerResult { Outside, Handled, Selection, Collapse, Activate, ContextMenu, Rejected }

/** A gesture belongs to one retained tree node. Reprojection and detach cannot transfer a double-click. */
export class WorkbenchPropertyTreePointer implements PointerHoverTarget {
	private input: WorkbenchPropertyTree<WorkbenchPropertyElement> | undefined;
	private subject: unknown;
	private inputGeneration = 0;
	private hoveredTree: WorkbenchPropertyTree<WorkbenchPropertyElement> | undefined;
	private feedback: WorkbenchTooltip | undefined;
	private feedbackOwner: WorkbenchSurface | undefined;
	private feedbackArea: Readonly<RectBounds> | undefined;
	private unbindBlur: (() => void) | undefined;
	private unbindFocus: (() => void) | undefined;
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
	private readonly measureFeedback = (text: string) => this.input!.layout.measure!(text, 0, text.length);

	public constructor(private readonly focus: InputFocusService, private readonly hover: PointerHoverService, private readonly focusTarget: InputFocusTarget) {}

	/** A visible tree binding survives canonical reparse, but not a subject or client switch. */
	public setInput<Element extends WorkbenchPropertyElement>(state: WorkbenchPropertyTree<Element>, subject: unknown = state): void {
		if (this.input === state && this.subject === subject) return;
		this.clear();
		this.input = state; this.subject = subject;
		this.inputGeneration++;
	}

	/** Feedback belongs to the actual editor attachment, independent of source/edit commands. */
	public attachFeedback(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>): void {
		this.feedback = new WorkbenchTooltip(); this.feedbackOwner = owner; this.feedbackArea = workArea;
		this.feedback.attach(surfaces, owner, workArea);
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.hideFeedback());
		this.unbindFocus = this.focusTarget.onDidFocus(() => this.keyboardSelection());
	}

	public hideFeedback(): void {
		this.feedback?.hide(); this.feedbackNode = undefined; this.feedbackKeyboard = false;
	}

	private retireFeedback(): void {
		this.hideFeedback();
		this.feedbackLabel = ''; this.feedbackValue = ''; this.feedbackDescription = ''; this.feedbackText = '';
	}

	public keyboardSelection(): void {
		const state = this.input;
		if (state === undefined) return;
		this.feedbackNode = state.rows[state.selectionIndex]; this.feedbackKeyboard = true; this.feedbackScroll = state.scroll;
		this.updateFeedback();
	}

	/** Hover and focus read retained strings only; an idle frame never remeasures unchanged feedback. */
	public updateFeedback(): void {
		const state = this.input;
		if (state === undefined || this.feedback === undefined) return;
		if (this.feedbackScroll !== state.scroll) { this.feedbackScroll = state.scroll; this.hideFeedback(); }
		const index = this.feedbackKeyboard ? state.selectionIndex : state.hoverIndex;
		const node = state.rows[index];
		const layout = state.layout;
		if (this.feedbackOwner!.retired || this.feedbackNode !== undefined && node !== this.feedbackNode) {
			this.retireFeedback(); return;
		}
		if (node === undefined || node !== this.feedbackNode
			|| this.feedbackKeyboard && !this.focusTarget.hasFocus
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
		if (this.input === undefined) return;
		this.input = undefined; this.subject = undefined; this.inputGeneration++;
		this.hover.release(this); this.cancel(); this.retireFeedback();
		this.pointerX = -1; this.pointerY = -1;
	}
	private lastClickNode: WorkbenchTreeNode<WorkbenchPropertyElement> | null = null;
	private lastClickTime = 0;

	public cancel(): void { this.lastClickNode = null; }

	public handle(snapshot: PointerSnapshot, justPressed: boolean, now: number): WorkbenchPropertyPointerResult {
		const state = this.input;
		if (state === undefined) return WorkbenchPropertyPointerResult.Outside;
		const layout = state.layout;
		if (!snapshot.valid || !snapshot.insideViewport || snapshot.viewportX < layout.contentLeft || snapshot.viewportX >= layout.contentRight
			|| snapshot.viewportY < layout.contentTop || snapshot.viewportY >= layout.bottom) {
			if (justPressed || !snapshot.valid || !snapshot.insideViewport) this.cancel();
			this.hover.release(this);
			return WorkbenchPropertyPointerResult.Outside;
		}
		const index = workbenchListRowIndexAtPosition(state, snapshot.viewportX, snapshot.viewportY);
		const twistie = justPressed && index >= 0 && workbenchTreeTwistieContainsPosition(state, index, snapshot.viewportX);
		if (justPressed || (snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			const identity = state.rows[index]?.identity, scope = this.focusTarget.scope, context = scope.contextGeneration, generation = this.inputGeneration;
			if (!this.focusTarget.focus() || this.inputGeneration !== generation || scope.contextGeneration !== context
				|| this.focus.admittedTarget !== this.focusTarget || state.rows[index]?.identity !== identity) {
				this.cancel(); this.hover.release(this);
				return WorkbenchPropertyPointerResult.Rejected;
			}
		}
		if (this.hoveredTree !== state) this.hover.release(this);
		this.hoveredTree = state;
		this.hover.visit(this);
		state.hoverIndex = index;
		if (this.pointerX !== snapshot.viewportX || this.pointerY !== snapshot.viewportY) {
			this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
			this.feedbackNode = state.rows[index]; this.feedbackKeyboard = false; this.feedbackScroll = state.scroll;
		}
		if (justPressed || snapshot.justPressedButtons !== 0) this.hideFeedback();
		else this.updateFeedback();
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
		if (twistie || twice && node.element.kind === 'group') {
			setWorkbenchTreeCollapsed(state, index, !node.collapsed);
			this.cancel();
			return WorkbenchPropertyPointerResult.Collapse;
		}
		this.lastClickNode = twice ? null : node;
		this.lastClickTime = now;
		return twice ? WorkbenchPropertyPointerResult.Activate : WorkbenchPropertyPointerResult.Selection;
	}
}
