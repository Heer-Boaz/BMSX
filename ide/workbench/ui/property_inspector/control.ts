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
import { WORKBENCH_ICON_SIZE } from '../icon';
import { WorkbenchTooltip } from '../tooltip';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';

export type PropertyInspection<Element> = {
	readonly title: string;
	readonly items: readonly Element[];
	/** Embedded details remain visible when focus returns to their owner. */
	readonly dismissible?: boolean;
	readonly focusReturn?: InputFocusTarget;
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
	private readonly unbindFocus: () => void;
	private readonly unbindGamepad: () => void;
	private input: PropertyInspection<Element> | undefined;
	private lifetime: DisposableStore | undefined;
	private layoutDirty = true;
	private triggerKey: string | undefined;
	private padPressed = false;
	private returnFocus: InputFocusTarget | null = null;
	private focusOrder: { previous: InputFocusTarget; next: InputFocusTarget } | undefined;
	private feedback: WorkbenchTooltip | undefined;
	private feedbackOwner: WorkbenchSurface | undefined;
	private feedbackArea: (() => Readonly<RectBounds>) | undefined;
	private readonly feedbackAnchor = create_rect_bounds();
	private feedbackItem: Element | undefined;
	private feedbackLabel = '';
	private feedbackValue = '';
	private feedbackDescription = '';
	private feedbackText = '';
	private feedbackKeyboard = false;
	private feedbackPointer = false;
	private feedbackScroll = 0;
	private pointerKnown = false;
	private pointerX = 0;
	private pointerY = 0;

	public constructor(private readonly focus: InputFocusService, capture: PointerCaptureService, private readonly hover: PointerHoverService, parent: InputFocusTarget, public readonly chrome: 'header' | 'client' = 'header') {
		this.scroll = new WorkbenchScrollControl(focus, capture, parent, input => this.handleKeyboard(input), undefined,
			() => { this.triggerKey = undefined; this.padPressed = false; });
		this.focusTarget = this.scroll.focusTarget;
		this.scroll.onWillScroll = () => this.retireFeedback();
		this.unbindGamepad = this.focusTarget.bindGamepad(input => { this.handleGamepad(input); });
		this.focusTarget.clipboard = { readOnly: true, copy: () => {
			const selected = this.model.selectionIndex;
			return selected < 0 ? null : this.model.rows[selected].element.value;
		} };
		this.actions = new WorkbenchActionBarControl(focus, capture, hover, this, this.focusTarget, () => this.focusTarget.focus());
		this.focusTarget.next = this.actions.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.unbindFocus = this.focusTarget.onDidFocus(() => { this.feedbackKeyboard = true; });
		this.unbindBlur = this.focusTarget.onDidBlur(() => {
			this.triggerKey = undefined; this.padPressed = false; this.retireFeedback(); this.hover.release(this);
		});
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

	/** The containing surface owns feedback lifetime; the inspector does not know its placement kind. */
	public attachFeedback(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, getWorkArea: () => Readonly<RectBounds>): void {
		if (this.feedbackOwner === owner) return;
		const feedback = this.feedback ??= new WorkbenchTooltip();
		feedback.detach(); this.feedbackOwner = owner; this.feedbackArea = getWorkArea;
		feedback.attach(surfaces, owner, getWorkArea);
		this.feedbackScroll = this.model.viewport.scrollTop;
	}

	public show(input: PropertyInspection<Element>, focus = true): DisposableStore {
		this.hide();
		this.returnFocus = input.focusReturn ?? (focus ? this.focus.target : this.focusTarget.parent);
		this.input = input;
		this.actionBar.items[0].visible = this.chrome === 'header' && input.items.some(item => input.canOpenSource(item));
		this.actionBar.items[1].visible = this.chrome === 'header' && input.dismissible !== false;
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
		this.retireFeedback(); this.feedback?.detach(); this.feedbackOwner = undefined; this.feedbackArea = undefined;
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
		if (this.feedbackItem !== undefined) {
			let retained = false;
			for (const item of items) if (equals(item, this.feedbackItem)) { retained = true; break; }
			if (!retained) this.retireFeedback();
		}
		this.model.updateItems(items, equals);
		const canOpenSource = this.chrome === 'header' && items.some(item => this.input!.canOpenSource(item));
		if (this.actionBar.items[0].visible !== canOpenSource) {
			this.actionBar.items[0].visible = canOpenSource;
			this.updateFocusOrder();
			this.layoutDirty = true;
		}
	}

	public dispose(): void { this.hide(); this.actions.dispose(); this.scroll.dispose(); this.unbindBlur(); this.unbindFocus(); this.unbindGamepad(); }

	public update(): void {
		if (!this.visible) return;
		this.actions.update();
	}

	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number, bounds: RectBounds): void {
		if (this.layoutDirty || this.model.font !== font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom) {
			write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
			const headerBottom = this.chrome === 'header' ? bounds.top + font.lineHeight + 8 : bounds.top;
			if (this.chrome === 'header') {
				layoutWorkbenchActionBar(this.actionBar, bounds.right - 4, bounds.top + 2, headerBottom - 2, measureText, font, bounds.left + 4);
				const firstAction = this.actionBar.items.find(item => item.visible);
				this.title = truncateMeasuredText(this.input!.title, (firstAction === undefined ? bounds.right : firstAction.bounds.left) - bounds.left - 8, measure);
			}
			write_rect_bounds(this.content, bounds.left, headerBottom, bounds.right, bounds.bottom);
			this.scroll.lineStep = font.lineHeight;
			this.layoutDirty = false;
		}
		this.model.layout(font, measure, this.content);
		this.updateFeedback(font, measure, measureText);
	}

	private retireFeedback(): void {
		this.feedbackKeyboard = false; this.feedbackPointer = false;
		this.feedbackItem = undefined; this.feedbackLabel = ''; this.feedbackValue = ''; this.feedbackDescription = ''; this.feedbackText = '';
		this.feedback?.hide();
	}
	private updateFeedback(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number): void {
		if (this.feedbackOwner === undefined) return;
		const view = this.model.viewport;
		if (this.feedbackScroll !== view.scrollTop) { this.feedbackScroll = view.scrollTop; this.feedbackPointer = false; }
		const index = this.feedbackKeyboard && this.focusTarget.hasFocus ? this.model.selectionIndex
			: this.feedbackPointer ? this.model.hoverIndex : -1;
		const row = this.model.rows[index];
		if (!this.visible || this.feedbackOwner.retired || row === undefined || row.element.compact !== true || row.textExpanded
			|| row.label[0] === row.element.label && (row.element.group === true || row.value[0] === row.element.value)) {
			this.feedback!.hide(); return;
		}
		const top = view.offsetTop + row.top, bottom = top + row.headerHeight;
		if (bottom <= view.bounds.top || top >= view.bounds.bottom) { this.feedback!.hide(); return; }
		const item = row.element;
		if (this.feedbackItem !== item || this.feedbackLabel !== item.label || this.feedbackValue !== item.value || this.feedbackDescription !== item.description) {
			this.feedbackItem = item; this.feedbackLabel = item.label; this.feedbackValue = item.value; this.feedbackDescription = item.description;
			this.feedbackText = `${item.label}\n${item.value}${item.description.length === 0 ? '' : `\n${item.description}`}`;
		}
		write_rect_bounds(this.feedbackAnchor, view.bounds.left, Math.max(top, view.bounds.top), view.bounds.right, Math.min(bottom, view.bounds.bottom));
		this.feedback!.show(this.feedbackText, this.feedbackAnchor, font, measure, measureText, this.feedbackArea!());
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

	public onPointerEnter(): void { this.feedbackPointer = true; this.feedbackKeyboard = false; }
	public onPointerLeave(): void { this.model.hoverIndex = -1; this.retireFeedback(); }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		let pointerIntent = false;
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.viewport.bounds)) {
			pointerIntent = !this.pointerKnown || this.pointerX !== snapshot.viewportX || this.pointerY !== snapshot.viewportY || snapshot.justPressedButtons !== 0;
			this.pointerKnown = true; this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
			if (pointerIntent) { this.feedbackPointer = true; this.feedbackKeyboard = false; }
			this.hover.visit(this);
			const row = this.model.rowAt(snapshot.viewportY);
			this.model.hoverIndex = row;
			if ((snapshot.justPressedButtons & (PointerButton.Primary | PointerButton.Secondary)) !== 0 && row >= 0) {
				this.model.selectionIndex = row;
				this.triggerKey = undefined;
				this.padPressed = false;
				if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && this.onContextMenu !== undefined) {
					this.focusTarget.focus();
					this.feedbackKeyboard = false;
					this.onContextMenu(snapshot.viewportX, snapshot.viewportY, false);
					return true;
				}
				const item = this.model.rows[row], expansion = item.element.expansion;
				const disclosureLeft = this.model.viewport.bounds.left + item.disclosureLeft;
				if ((expansion !== undefined || item.textExpandable) && (snapshot.justPressedButtons & PointerButton.Primary) !== 0
					&& snapshot.viewportX >= disclosureLeft && snapshot.viewportX < disclosureLeft + WORKBENCH_ICON_SIZE + 2
					&& snapshot.viewportY < this.model.viewport.offsetTop + item.top + item.headerHeight) {
					this.focusTarget.focus();
					this.feedbackKeyboard = false;
					if (expansion !== undefined) expansion.setExpanded(!expansion.expanded);
					else this.model.setValueExpanded(row, !item.textExpanded);
					return true;
				}
			}
		} else this.hover.release(this);
		const handled = this.scroll.handlePointer(snapshot);
		if (pointerIntent) this.feedbackKeyboard = false;
		return handled;
	}

	public handleWheel(snapshot: PointerPosition, delta: number): boolean { return this.scroll.handleWheel(snapshot, delta); }

	private handleKeyboard(input: KeyInputEvent): boolean {
		if (input.modifiers !== KeyModifier.none) { this.triggerKey = undefined; return false; }
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.close(); return true; }
		if (isKeyJustPressed('ArrowRight', input) || isKeyJustPressed('ArrowLeft', input)) {
			if (!this.navigateDisclosure(input.code === 'ArrowRight')) return false;
			consumeIdeKey(input.code, input); return true;
		}
		for (const key of NAVIGATION_KEYS) if (isKeyDown(key, input)) {
			this.feedbackKeyboard = true; this.feedbackPointer = false;
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
			if (input.code === this.triggerKey && !input.down) { this.triggerKey = undefined; this.activate(); }
			return true;
		}
		return false;
	}

	/** Shared tree/text disclosure policy for keyboard and controller navigation. */
	private navigateDisclosure(expand: boolean): boolean {
		const index = this.model.selectionIndex, item = this.model.rows[index]?.element;
		if (item?.compact !== true) return false;
		this.triggerKey = undefined; this.padPressed = false;
		this.feedbackKeyboard = true; this.feedbackPointer = false;
		if (expand) {
			if (item.expansion !== undefined) {
				if (!item.expansion.expanded) item.expansion.setExpanded(true);
				else if (this.model.rows[index + 1] !== undefined && (this.model.rows[index + 1].element.depth ?? 0) > (item.depth ?? 0)) this.model.select(index + 1);
			} else this.model.setValueExpanded(index, true);
		} else if (item.expansion?.expanded) item.expansion.setExpanded(false);
		else if (!this.model.setValueExpanded(index, false)) for (let parent = index - 1; parent >= 0; parent--)
			if ((this.model.rows[parent].element.depth ?? 0) < (item.depth ?? 0)) { this.model.select(parent); break; }
		return true;
	}

	private handleGamepad(input: PlayerInput): boolean {
		const gamepad = input.inputHandlers.gamepad;
		if (gamepad === null) return false;
		const back = gamepad.getButtonState('b');
		if (back.justpressed && !back.consumed) { gamepad.consumeButton('b'); this.close(); return true; }
		for (const button of PAD_NAVIGATION) if (input.controlButtonRepeatEdge(button, 'gamepad')) {
			if ((button === 'left' || button === 'right') && !this.navigateDisclosure(button === 'right')) return false;
			gamepad.consumeButton(button);
			this.triggerKey = undefined;
			this.padPressed = false;
			if (button === 'up' || button === 'down') this.model.select(this.model.selectionIndex + (button === 'up' ? -1 : 1));
			else if (button === 'lb' || button === 'rb') {
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
		if (activate.justreleased) { this.padPressed = false; this.activate(); }
		else if (!activate.pressed) this.padPressed = false;
		return true;
	}
	private activate(): void {
		const row = this.model.rows[this.model.selectionIndex], expansion = row?.element.expansion;
		if (expansion !== undefined) expansion.setExpanded(!expansion.expanded);
		else if (row?.textExpandable && !this.input!.canOpenSource(row.element)) this.model.setValueExpanded(this.model.selectionIndex, !row.textExpanded);
		else this.openSource();
	}
}

const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
const TRIGGER_KEYS = ['Enter', 'NumpadEnter'] as const;
const PAD_NAVIGATION = ['up', 'down', 'left', 'right', 'lb', 'rb'] as const;
