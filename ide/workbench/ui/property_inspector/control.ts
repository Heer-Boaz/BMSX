import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import type { EditorCommandId } from '../../../common/commands';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerPosition, PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerHoverService, PointerHoverTarget } from '../../../input/pointer/hover';
import type { PointerCaptureService } from '../../../input/pointer/capture';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WorkbenchScrollControl } from '../scroll_control';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from './model';

export type PropertyInspection<Element> = {
	readonly title: string;
	readonly items: readonly Element[];
	/** Embedded details remain visible when focus returns to their owner. */
	readonly dismissible?: boolean;
	canOpenSource(item: Element): boolean;
	openSource(item: Element): void;
	onDidClose?(): void;
};

/** A local read-only inspector session; the contribution retains source identity/lifetime. */
export class WorkbenchPropertyInspector<Element extends InspectedProperty> implements PointerHoverTarget {
	public readonly model = new WorkbenchPropertyInspectorModel<Element>();
	public readonly actionBar = createWorkbenchActionBar('propertyInspector.title');
	public readonly bounds = create_rect_bounds();
	public readonly focusTarget: InputFocusTarget;
	public title = '';
	public onContextMenu: ((x: number, y: number, keyboard: boolean) => void) | undefined;
	private readonly content = create_rect_bounds();
	private readonly scroll: WorkbenchScrollControl;
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindBlur: () => void;
	private readonly unbindGamepad: () => void;
	private input: PropertyInspection<Element> | undefined;
	private lifetime: DisposableStore | undefined;
	private layoutDirty = true;
	private triggerKey: string | undefined;
	private padPressed = false;
	private returnFocus: InputFocusTarget | null = null;
	private focusOrder: { previous: InputFocusTarget; next: InputFocusTarget } | undefined;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService, private readonly hover: PointerHoverService, parent: InputFocusTarget) {
		this.scroll = new WorkbenchScrollControl(focus, capture, parent, input => this.handleKeyboard(input), undefined,
			() => { this.triggerKey = undefined; this.padPressed = false; });
		this.focusTarget = this.scroll.focusTarget;
		this.unbindGamepad = this.focusTarget.bindGamepad(input => { this.handleGamepad(input); });
		this.focusTarget.clipboard = { readOnly: true, copy: () => {
			const selected = this.model.selectionIndex;
			return selected < 0 ? null : this.model.rows[selected].element.value;
		} };
		this.actions = new WorkbenchActionBarControl(focus, capture, hover, this, this.focusTarget);
		this.focusTarget.next = this.actions.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.unbindBlur = this.focusTarget.onDidBlur(() => { this.triggerKey = undefined; this.padPressed = false; });
		this.focusTarget.registerCommand('propertyInspector.source', {
			isEnabled: () => this.isEnabled('propertyInspector.source'), run: () => this.openSource(),
		});
		this.focusTarget.registerCommand('propertyInspector.close', { isEnabled: () => this.isEnabled('propertyInspector.close'), run: () => this.close() });
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.visible && this.onContextMenu !== undefined && this.model.selectionIndex >= 0,
			run: () => {
				this.model.select(this.model.selectionIndex);
				const view = this.model.viewport, row = this.model.rows[this.model.selectionIndex];
				this.onContextMenu!(view.bounds.left + 4, Math.max(view.bounds.top,
					Math.min(view.bounds.bottom, view.offsetTop + row.top + this.model.font!.lineHeight)), true);
			},
		});
	}

	public get visible(): boolean { return this.input !== undefined; }

	public show(input: PropertyInspection<Element>, focus = true): DisposableStore {
		this.hide();
		this.capture.cancel();
		this.returnFocus = focus ? this.focus.target : this.focusTarget.parent;
		this.input = input;
		this.actionBar.items[0].visible = input.items.some(item => input.canOpenSource(item));
		this.actionBar.items[1].visible = input.dismissible !== false;
		this.updateFocusOrder();
		this.lifetime = new DisposableStore();
		this.model.setItems(input.items);
		this.scroll.setInput(this.model.viewport);
		this.actions.setInput(this.actionBar, this.focusTarget);
		this.layoutDirty = true;
		if (focus) this.focusTarget.focus();
		return this.lifetime;
	}

	/** Embedded inspectors participate in their containing pane's tab order. */
	public setFocusOrder(previous: InputFocusTarget, next: InputFocusTarget): void {
		this.focusOrder = { previous, next };
		this.updateFocusOrder();
	}

	private updateFocusOrder(): void {
		const hasActions = this.actionBar.items.some(item => item.visible);
		const previous = this.focusOrder?.previous ?? this.focusTarget;
		const next = this.focusOrder?.next ?? this.focusTarget;
		previous.next = this.focusTarget;
		this.focusTarget.previous = previous;
		this.focusTarget.next = hasActions ? this.actions.focusTarget : next;
		this.actions.focusTarget.previous = this.focusTarget;
		this.actions.focusTarget.next = next;
		next.previous = hasActions ? this.actions.focusTarget : this.focusTarget;
		if (!hasActions && this.actions.focusTarget.hasFocus) this.focusTarget.focus();
	}

	private close(): void {
		const input = this.input;
		if (input?.dismissible === false) { this.focus.setTarget(this.returnFocus); return; }
		this.hide();
		input?.onDidClose?.();
	}

	public hide(): void {
		this.hover.release(this);
		const ownedFocus = this.focusTarget.hasFocus || this.actions.focusTarget.hasFocus;
		this.actions.clearInput();
		this.scroll.clearInput();
		if (ownedFocus) this.focus.setTarget(this.returnFocus);
		this.returnFocus = null;
		this.input = undefined;
		this.lifetime?.dispose();
		this.lifetime = undefined;
		this.model.setItems([]);
		this.triggerKey = undefined;
		this.padPressed = false;
	}

	public updateItems(items: readonly Element[], equals: (left: Element, right: Element) => boolean): void {
		this.model.updateItems(items, equals);
		const canOpenSource = items.some(item => this.input!.canOpenSource(item));
		if (this.actionBar.items[0].visible !== canOpenSource) {
			this.actionBar.items[0].visible = canOpenSource;
			this.updateFocusOrder();
			this.layoutDirty = true;
		}
	}

	public dispose(): void { this.hide(); this.actions.dispose(); this.scroll.dispose(); this.unbindBlur(); this.unbindGamepad(); }

	public update(): void {
		if (!this.visible) return;
		this.actions.update();
	}

	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number, bounds: RectBounds): void {
		if (this.layoutDirty || this.model.font !== font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom) {
			write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
			const headerBottom = bounds.top + font.lineHeight + 8;
			layoutWorkbenchActionBar(this.actionBar, bounds.right - 4, bounds.top + 2, headerBottom - 2, measureText, font);
			const firstAction = this.actionBar.items.find(item => item.visible);
			this.title = truncateMeasuredText(this.input!.title, (firstAction === undefined ? bounds.right : firstAction.bounds.left) - bounds.left - 8, measure);
			write_rect_bounds(this.content, bounds.left, headerBottom, bounds.right, bounds.bottom);
			this.scroll.lineStep = font.lineHeight;
			this.layoutDirty = false;
		}
		this.model.layout(font, measure, this.content);
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (this.input === undefined) return false;
		if (command === 'propertyInspector.close') return this.input.dismissible !== false;
		return command === 'propertyInspector.source' && this.model.selectionIndex >= 0
			&& this.input.canOpenSource(this.model.rows[this.model.selectionIndex].element);
	}

	public execute(command: EditorCommandId): void {
		if (command === 'propertyInspector.close') this.close();
		else if (command === 'propertyInspector.source') this.openSource();
		else throw new Error(`Not a property inspector command: ${command}`);
	}

	private openSource(): void {
		if (!this.isEnabled('propertyInspector.source')) return;
		const input = this.input!;
		const item = this.model.rows[this.model.selectionIndex].element;
		if (input.dismissible !== false) this.hide();
		input.openSource(item);
	}

	public onPointerLeave(): void { this.model.hoverIndex = -1; }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.viewport.bounds)) {
			this.hover.visit(this);
			const row = this.model.rowAt(snapshot.viewportY);
			this.model.hoverIndex = row;
			if ((snapshot.justPressedButtons & (PointerButton.Primary | PointerButton.Secondary)) !== 0 && row >= 0) {
				this.model.selectionIndex = row;
				this.triggerKey = undefined;
				this.padPressed = false;
				if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && this.onContextMenu !== undefined) {
					this.focusTarget.focus();
					this.onContextMenu(snapshot.viewportX, snapshot.viewportY, false);
					return true;
				}
			}
		} else this.hover.release(this);
		return this.scroll.handlePointer(snapshot);
	}

	public handleWheel(snapshot: PointerPosition, delta: number): boolean { return this.scroll.handleWheel(snapshot, delta); }

	private handleKeyboard(input: KeyInputEvent): boolean {
		if (input.modifiers !== KeyModifier.none) { this.triggerKey = undefined; return false; }
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.close(); return true; }
		for (const key of NAVIGATION_KEYS) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			this.triggerKey = undefined;
			this.padPressed = false;
			this.model.select(key === 'Home' ? 0 : key === 'End' ? this.model.rows.length - 1
				: this.model.selectionIndex + (key === 'ArrowUp' ? -1 : 1));
			return true;
		}
		if (TRIGGER_KEYS.includes(input.code as typeof TRIGGER_KEYS[number]) && !input.consumed) {
			if (input.down && !input.repeat && this.triggerKey === undefined) this.triggerKey = input.code;
			consumeIdeKey(input.code, input);
			if (input.code === this.triggerKey && !input.down) { this.triggerKey = undefined; this.openSource(); }
			return true;
		}
		return false;
	}

	private handleGamepad(input: PlayerInput): boolean {
		const gamepad = input.inputHandlers.gamepad;
		if (gamepad === null) return false;
		const back = gamepad.getButtonState('b');
		if (back.justpressed && !back.consumed) { gamepad.consumeButton('b'); this.close(); return true; }
		for (const button of PAD_NAVIGATION) if (input.controlButtonRepeatEdge(button, 'gamepad')) {
			gamepad.consumeButton(button);
			this.triggerKey = undefined;
			this.padPressed = false;
			if (button === 'up' || button === 'down') this.model.select(this.model.selectionIndex + (button === 'up' ? -1 : 1));
			else {
				const view = this.model.viewport;
				view.scrollbar.setScroll(view.scrollTop + (button === 'lb' ? -view.height : view.height));
			}
			return true;
		}
		const activate = gamepad.getButtonState('a');
		if (activate.consumed) return false;
		if (activate.justpressed) this.padPressed = true;
		if (activate.pressed || activate.justpressed || activate.justreleased) gamepad.consumeButton('a');
		if (!this.padPressed) return false;
		if (activate.justreleased) { this.padPressed = false; this.openSource(); }
		else if (!activate.pressed) this.padPressed = false;
		return true;
	}
}

const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
const TRIGGER_KEYS = ['Enter', 'NumpadEnter'] as const;
const PAD_NAVIGATION = ['up', 'down', 'lb', 'rb'] as const;
