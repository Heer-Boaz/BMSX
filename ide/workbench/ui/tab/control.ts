import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../../common/constants';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover, type PointerHoverTarget } from '../../../input/pointer/hover';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { createWorkbenchActionBar } from '../action_bar';
import { Scrollbar } from '../scrollbar';
import { ScrollbarPointerControl } from '../scrollbar_pointer';
import { renderTabBar, type EditorTabStripRenderContext } from '../../render/tab_bar';
import type { EditorTabGroupModel } from './group_model';
import type { EditorTabId } from './id';
import { EditorTabStripLayout, type EditorTabStripLayoutContext } from './layout';
import { EditorTabDrag } from './drag';

/** A concrete group's tab control, with no frontend-wide selection or geometry state. */
export class EditorTabStrip implements PointerHoverTarget {
	public readonly actions = createWorkbenchActionBar('editorTabs.title');
	public readonly scrollbar = new Scrollbar('horizontal');
	public readonly scrollControl: ScrollbarPointerControl;
	public readonly actionBar: WorkbenchActionBarControl;
	public readonly layoutState: EditorTabStripLayout;
	public readonly drag: EditorTabDrag;
	public hoverId: EditorTabId | null = null;
	public lastClickId: EditorTabId | null = null;
	public lastClickTime = 0;

	public constructor(public readonly model: EditorTabGroupModel, commands: EditorCommandRunner,
		private readonly focusParent: InputFocusTarget, private readonly activate: (id: EditorTabId) => void,
		private readonly close: (id: EditorTabId) => void, focusContent: () => void) {
		const scope = focusParent.scope.surfaceScope;
		this.scrollControl = new ScrollbarPointerControl(pointerCapture, scope);
		this.layoutState = new EditorTabStripLayout(model, this.actions, this.scrollbar);
		this.drag = new EditorTabDrag(model, this.layoutState, this.scrollbar, pointerCapture, scope, () => { this.lastClickId = null; });
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, focusParent, focusContent);
	}

	/** Host-time gesture advancement runs before the owning group publishes its next layout. */
	public update(now: number): void {
		this.drag.advance(now);
	}

	public layout(bounds: Readonly<RectBounds>, context: EditorTabStripLayoutContext): void {
		this.layoutState.layout(bounds, context, this.hoverId, this.drag.state?.hasDragged === true);
		this.drag.refreshTarget();
		this.actionBar.setInput(this.actions, this.focusParent);
		this.actionBar.update();
	}

	public draw(context: EditorTabStripRenderContext): void {
		renderTabBar(this, context);
	}

	/** The group keeps its strip alive when its last editor closes. */
	public clear(): void {
		this.drag.cancel();
		pointerCapture.cancelTarget(this.scrollControl);
		this.scrollControl.cancelPointer();
		pointerCapture.cancelTarget(this.actionBar);
		this.actionBar.clearInput();
		for (const item of this.actions.items) item.visible = false;
		pointerHover.release(this);
		this.hoverId = null;
		this.lastClickId = null;
		this.lastClickTime = 0;
		this.scrollbar.setScroll(0);
		this.layoutState.clear();
	}

	public dispose(): void {
		this.clear();
		this.actionBar.dispose();
	}

	public cancelDrag(): void {
		this.drag.cancel();
	}

	public onPointerLeave(): void {
		this.hoverId = null;
		this.lastClickId = null;
	}

	private updateHover(snapshot: PointerSnapshot): boolean {
		const layout = this.layoutState;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.bounds)) {
			pointerHover.release(this);
			return false;
		}
		pointerHover.visit(this);
		this.hoverId = null;
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.viewportBounds)) return true;
		for (let index = 0; index < layout.items.length; index++) {
			const item = layout.items.peek(index);
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, item.bounds)) {
				this.hoverId = item.input.id;
				break;
			}
		}
		return true;
	}

	public handlePointer(snapshot: PointerSnapshot, now: number): boolean {
		const over = this.updateHover(snapshot);
		if (!over) {
			if (snapshot.justPressedButtons !== 0) this.lastClickId = null;
			pointerHover.release(this.actionBar);
			return false;
		}
		if (this.actionBar.handlePointer(snapshot)) {
			if (snapshot.justPressedButtons !== 0) this.lastClickId = null;
			return true;
		}
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if (this.scrollControl.handlePointer(snapshot, this.scrollbar)) {
			if (snapshot.justPressedButtons !== 0) this.lastClickId = null;
			return true;
		}
		const x = snapshot.viewportX, y = snapshot.viewportY;
		if (!point_in_rect(x, y, this.layoutState.viewportBounds)) return true;
		const middle = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
		if (!primary && !middle) return true;
		for (let index = 0; index < this.layoutState.items.length; index++) {
			const item = this.layoutState.items.peek(index), tab = item.input;
			if (!point_in_rect(x, y, item.bounds)) continue;
			if (middle) {
				if (tab.closable) {
					this.lastClickId = null;
					this.drag.cancel();
					this.close(tab.id);
				}
				return true;
			}
			if (point_in_rect(x, y, item.closeBounds)) {
				this.lastClickId = null;
				this.drag.cancel();
				this.hoverId = null;
				this.close(tab.id);
				return true;
			}
			const twice = this.lastClickId === tab.id && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
			if (twice) this.model.pin(tab);
			this.lastClickId = twice ? null : tab.id;
			this.lastClickTime = now;
			this.activate(tab.id);
			this.drag.begin(tab.id, snapshot, now);
			return true;
		}
		this.lastClickId = null;
		return true;
	}

	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!event.valid || !event.insideViewport || !point_in_rect(event.viewportX, event.viewportY, this.layoutState.bounds)) return false;
		pointerCapture.cancelTarget(this.scrollControl);
		const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
		this.scrollbar.setScroll(this.scrollbar.getScroll() + delta * this.layoutState.charAdvance * 4);
		return true;
	}
}
