import { copy_rect_bounds, create_rect_bounds, point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PointerInputSnapshot, PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, SCROLLBAR_WIDTH } from '../../../common/constants';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
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
import { EditorTabDrag, type EditorTabDragHandler } from './drag';
import type { EditorInput } from '../../common/editor_inputs';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS } from '../menu/registry';
import type { DisposableStore } from '../../../common/lifecycle';

/** A concrete group's tab control, with no frontend-wide selection or geometry state. */
export class EditorTabStrip implements PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	private focusedInputValue: EditorInput | null = null;
	public get focusedInput(): EditorInput | null { return this.focusedInputValue; }
	public readonly actions = createWorkbenchActionBar('editorTabs.title');
	public readonly scrollbar = new Scrollbar('horizontal');
	public readonly scrollControl: ScrollbarPointerControl;
	public readonly actionBar: WorkbenchActionBarControl;
	public readonly layoutState: EditorTabStripLayout;
	public readonly drag: EditorTabDrag;
	public dropTargeted = false;
	public hoverId: EditorTabId | null = null;
	public lastClickId: EditorTabId | null = null;
	public lastClickTime = 0;
	private layoutBounds: Readonly<RectBounds> | undefined;
	private readonly projectedBounds = create_rect_bounds();
	private projectedRevision = -1;
	private projectedFont: EditorTabStripLayoutContext['font'] | undefined;
	private projectedTabHeight = 0;
	private projectedCharAdvance = 0;
	private projectedHover: EditorTabId | null = null;
	private projectedDragging = false;
	private projectedScroll = 0;
	private actionsAttached = false;
	private contextMenuSession: DisposableStore | undefined;
	private focusedIndex = -1;
	private projectedFocus: EditorInput | null = null;
	private triggerKey: string | undefined;
	private triggerInput: EditorInput | null = null;
	private triggerContext = 0;
	private readonly subscriptions: (() => void)[] = [];

	public constructor(public readonly model: EditorTabGroupModel, private readonly layoutContext: EditorTabStripLayoutContext, private readonly commands: EditorCommandRunner,
		private readonly focusParent: InputFocusTarget, private readonly activate: (id: EditorTabId, preserveFocus?: boolean) => boolean,
		private readonly close: (id: EditorTabId) => void, private readonly focusContent: () => boolean, dragHandler: EditorTabDragHandler,
		private readonly contextMenu: ContextMenuController) {
		const scope = focusParent.scope.surfaceScope;
		this.focusTarget = inputFocus.createTarget(focusParent, new InputFocusScope(scope, focusParent.scope));
		this.focusTarget.canFocus = () => this.actionsAttached && this.model.tabs.length > 0;
		this.subscriptions.push(this.focusTarget.bindKeyboard(input => this.handleKeyboard(input), () => this.cancelKeyboard()),
			this.focusTarget.onDidFocus(() => {
				if (this.focusedInput === null) this.setFocusedInput(this.model.activeTab === null ? this.model.tabs[0] : this.model.activeTab);
			}), this.focusTarget.onDidBlur(() => this.cancelKeyboard()), this.model.onDidChange(() => {
				if (this.focusedInput === null) return;
				if (this.model.contains(this.focusedInput)) { this.focusedIndex = this.model.indexOf(this.focusedInput); return; }
				this.setFocusedInput(this.model.tabs.length === 0 ? null : this.model.tabs[Math.min(this.focusedIndex, this.model.tabs.length - 1)]);
				if (this.focusedInput === null && this.focusTarget.hasFocus) this.focusContent();
			}));
		this.scrollControl = new ScrollbarPointerControl(pointerCapture, scope);
		this.layoutState = new EditorTabStripLayout(model, this.actions, this.scrollbar);
		this.drag = new EditorTabDrag(pointerCapture, scope, () => { this.lastClickId = null; }, dragHandler);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, focusParent, focusContent);
		this.focusTarget.next = () => { if (this.actionBar.focusTarget.canFocus!()) this.actionBar.focusTarget.focus(); else this.focusContent(); };
		this.focusTarget.previous = this.focusContent;
		this.actionBar.focusTarget.previous = () => { this.focus(); };
		this.actionBar.focusTarget.next = this.focusContent;
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.focusedInput !== null,
			run: () => {
				const input = this.focusedInput!;
				this.layout(this.layoutBounds!);
				const bounds = this.layoutState.items.peek(this.model.indexOf(input)).bounds;
				this.openContextMenu(bounds.left, bounds.bottom, input, true);
			},
		});
		for (const command of ['tabs.close', 'save', 'keepEditor', 'window.moveEditor', 'window.copyEditor'] as const)
			this.focusTarget.registerCommand(command, {
				isEnabled: () => this.focusedInput !== null && commands.isEnabled(command, this.focusTarget, this.focusedInput),
				run: () => { commands.execute(command, this.focusTarget, this.focusedInput!); },
			});
		this.actionBar.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.actionsAttached,
			run: () => this.openContextMenu(this.layoutState.bounds.left, this.layoutState.bounds.bottom, undefined, true),
		});
	}

	/** Entering the tab list focuses its selected tab without activating a different pane. */
	public focus(): boolean {
		if (!this.focusTarget.canFocus!()) return false;
		const revision = inputFocus.revision;
		const context = this.setFocusedInput(this.model.activeTab === null ? this.model.tabs[0] : this.model.activeTab);
		if (revision !== inputFocus.revision || context !== this.focusTarget.scope.contextGeneration || !this.focusTarget.canFocus!()) return false;
		this.focusTarget.focus();
		return this.focusTarget.hasFocus;
	}

	private setFocusedInput(input: EditorInput | null): number {
		if (input === this.focusedInput) return this.focusTarget.scope.contextGeneration;
		this.cancelKeyboard();
		this.focusedInputValue = input;
		this.focusedIndex = input === null ? -1 : this.model.indexOf(input);
		return this.focusTarget.scope.retireContext();
	}

	private cancelKeyboard(): void { this.triggerKey = undefined; this.triggerInput = null; }

	private handleKeyboard(input: KeyInputEvent): void {
		if (input.modifiers !== KeyModifier.none) { this.cancelKeyboard(); return; }
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input); this.cancelKeyboard(); this.focusContent(); return;
		}
		if (isKeyDown('ArrowLeft', input) || isKeyDown('ArrowRight', input) || isKeyDown('Home', input) || isKeyDown('End', input)) {
			consumeIdeKey(input.code, input);
			const tabs = this.model.tabs, count = tabs.length;
			const index = input.code === 'Home' ? 0 : input.code === 'End' ? count - 1
				: (this.focusedIndex + (input.code === 'ArrowLeft' ? count - 1 : 1)) % count;
			this.cancelKeyboard(); this.setFocusedInput(tabs[index]); return;
		}
		if (input.code !== 'Enter' && input.code !== 'NumpadEnter' && input.code !== 'Space') return;
		consumeIdeKey(input.code, input);
		if (input.down && !input.repeat && this.triggerKey === undefined) {
			this.triggerKey = input.code; this.triggerInput = this.focusedInput; this.triggerContext = this.focusTarget.scope.contextGeneration;
		} else if (!input.down && input.code === this.triggerKey) {
			const editor = this.triggerInput, context = this.triggerContext;
			this.cancelKeyboard();
			if (editor !== null && editor === this.focusedInput && this.model.contains(editor) && this.focusTarget.hasFocus
				&& this.focusTarget.scope.contextGeneration === context) this.activate(editor.id, true);
		}
	}

	/** Host-time gesture advancement runs before the owning group publishes its next layout. */
	public update(now: number): void {
		this.drag.advance(now);
		if (this.actionsAttached && !this.needsLayout) this.actionBar.update();
	}
	public get needsLayout(): boolean {
		const bounds = this.layoutBounds, context = this.layoutContext;
		return bounds === undefined || this.projectedRevision !== this.model.revision
			|| this.projectedBounds.left !== bounds.left || this.projectedBounds.top !== bounds.top
			|| this.projectedBounds.right !== bounds.right || this.projectedBounds.bottom !== bounds.bottom
			|| this.projectedFont !== context.font || this.projectedTabHeight !== context.tabBarHeight
			|| this.projectedCharAdvance !== context.charAdvance || this.projectedHover !== this.hoverId
			|| this.projectedFocus !== (this.focusTarget.hasFocus ? this.focusedInput : null)
			|| this.projectedDragging !== (this.drag.state?.hasDragged === true || this.dropTargeted) || this.projectedScroll !== this.scrollbar.getScroll();
	}
	/** Independent group minima include the real scrollbar lane at overflowing widths. */
	public get minimumHeight(): number { return this.layoutContext.tabBarHeight + SCROLLBAR_WIDTH; }

	public layout(bounds: Readonly<RectBounds>): void {
		this.layoutBounds = bounds;
		const context = this.layoutContext;
		if (this.needsLayout) {
			this.layoutState.layout(bounds, context, this.hoverId, this.drag.state?.hasDragged === true || this.dropTargeted, this.focusTarget.hasFocus ? this.focusedInput : null);
			this.drag.refreshTarget();
			copy_rect_bounds(this.projectedBounds, bounds);
			this.projectedRevision = this.model.revision; this.projectedFont = context.font;
			this.projectedTabHeight = context.tabBarHeight; this.projectedCharAdvance = context.charAdvance;
			this.projectedHover = this.hoverId; this.projectedDragging = this.drag.state?.hasDragged === true || this.dropTargeted;
			this.projectedScroll = this.scrollbar.getScroll();
			this.projectedFocus = this.focusTarget.hasFocus ? this.focusedInput : null;
		}
		if (!this.actionsAttached) {
			this.actionBar.setInput(this.actions, this.focusParent);
			this.actionsAttached = true;
		}
		this.actionBar.update();
	}

	public draw(context: EditorTabStripRenderContext): void {
		renderTabBar(this, context);
	}

	/** The group keeps its strip alive when its last editor closes. */
	public clear(): void {
		this.actionsAttached = false;
		this.cancelKeyboard(); this.setFocusedInput(null); this.focusTarget.release();
		if (this.contextMenuSession !== undefined) this.contextMenu.hide();
		this.drag.cancel();
		pointerCapture.cancelTarget(this.scrollControl);
		this.scrollControl.cancelPointer();
		pointerCapture.cancelTarget(this.actionBar);
		this.actionBar.clearInput();
		this.actionsAttached = false;
		for (const item of this.actions.items) item.visible = false;
		pointerHover.release(this);
		this.hoverId = null;
		this.lastClickId = null;
		this.lastClickTime = 0;
		this.scrollbar.setScroll(0);
		this.layoutState.clear();
		this.projectedRevision = -1;
		this.projectedFocus = null;
	}

	public dispose(): void {
		this.clear();
		for (const unbind of this.subscriptions) unbind();
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

	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		const over = this.updateHover(snapshot);
		if (!over) {
			if (snapshot.justPressedButtons !== 0) this.lastClickId = null;
			pointerHover.release(this.actionBar);
			return false;
		}
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.lastClickId = null;
			this.drag.cancel();
			const input = this.hoverId === null ? undefined : this.model.findById(this.hoverId);
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY, input, false);
			return true;
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
			if (!this.activate(tab.id)) {
				this.lastClickId = null;
				return true;
			}
			const twice = this.lastClickId === tab.id && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
			this.lastClickId = twice ? null : tab.id;
			this.lastClickTime = now;
			this.drag.begin({ kind: 'editor', model: this.model, input: tab }, snapshot, now);
			if (twice) this.model.pin(tab);
			return true;
		}
		this.lastClickId = null;
		if (primary && this.focusContent()) this.drag.begin({ kind: 'group', model: this.model }, snapshot, now);
		return true;
	}

	private openContextMenu(x: number, y: number, input: EditorInput | undefined, keyboard: boolean): void {
		this.contextMenu.show(x, y, WORKBENCH_MENUS[input === undefined ? 'editorGroup.context' : 'editorTabs.context'], this.commands,
			{ invocationOrigin: keyboard && input !== undefined ? this.focusTarget : this.focusParent,
				commandTarget: keyboard && input !== undefined ? this.focusTarget : this.focusParent,
				editor: input, selectFirst: keyboard,
				onWillShow: lifetime => {
					this.contextMenuSession = lifetime;
					lifetime.add({ dispose: () => { this.contextMenuSession = undefined; } });
					if (input !== undefined) {
						lifetime.add({ dispose: input.onWillDispose(() => this.contextMenu.hide()) });
						lifetime.add({ dispose: this.model.onDidChange(() => {
							if (!this.model.contains(input)) this.contextMenu.hide();
						}) });
						if (!this.model.contains(input)) this.contextMenu.hide();
					}
				} });
	}

	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!event.valid || !event.insideViewport || !point_in_rect(event.viewportX, event.viewportY, this.layoutState.bounds)) return false;
		pointerCapture.cancelTarget(this.scrollControl);
		const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
		this.scrollbar.setScroll(this.scrollbar.getScroll() + delta * this.layoutState.charAdvance * 4);
		return true;
	}
}
