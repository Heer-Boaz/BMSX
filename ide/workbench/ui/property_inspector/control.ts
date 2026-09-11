import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { KeyModifier, type PlayerInput } from '../../../../hosts/common/input/player';
import type { EditorCommandId } from '../../../common/commands';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import type { PointerCaptureService } from '../../../input/pointer/capture';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WorkbenchScrollControl } from '../scroll_control';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from './model';

export type PropertyInspection<Element> = {
	readonly title: string;
	readonly items: readonly Element[];
	canOpenSource(item: Element): boolean;
	openSource(item: Element): void;
};

/** A local read-only inspector session; the contribution retains source identity/lifetime. */
export class WorkbenchPropertyInspector<Element extends InspectedProperty> {
	public readonly model = new WorkbenchPropertyInspectorModel<Element>();
	public readonly actionBar = createWorkbenchActionBar('propertyInspector.title');
	public readonly bounds = create_rect_bounds();
	public readonly focusTarget: InputFocusTarget;
	public title = '';
	private readonly content = create_rect_bounds();
	private readonly scroll: WorkbenchScrollControl;
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindBlur: () => void;
	private input: PropertyInspection<Element> | undefined;
	private lifetime: DisposableStore | undefined;
	private layoutDirty = true;
	private triggerKey: string | undefined;
	private padPressed = false;
	private returnFocus: InputFocusTarget | null = null;

	public constructor(private readonly focus: InputFocusService, capture: PointerCaptureService, parent: InputFocusTarget) {
		this.scroll = new WorkbenchScrollControl(focus, capture, parent, input => this.handleKeyboard(input) || this.handleGamepad(input));
		this.focusTarget = this.scroll.focusTarget;
		this.actions = new WorkbenchActionBarControl(focus, capture, this, this.focusTarget);
		this.focusTarget.next = this.actions.focusTarget;
		this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
		this.unbindBlur = this.focusTarget.onDidBlur(() => { this.triggerKey = undefined; this.padPressed = false; });
		this.focusTarget.registerCommand('propertyInspector.source', {
			isEnabled: () => this.isEnabled('propertyInspector.source'), run: () => this.openSource(),
		});
		this.focusTarget.registerCommand('propertyInspector.close', { isEnabled: () => this.visible, run: () => this.hide() });
	}

	public get visible(): boolean { return this.input !== undefined; }

	public show(input: PropertyInspection<Element>): DisposableStore {
		this.hide();
		this.returnFocus = this.focus.target;
		this.input = input;
		this.lifetime = new DisposableStore();
		this.model.setItems(input.items);
		this.scroll.setInput(this.model.viewport);
		this.actions.setInput(this.actionBar, this.focusTarget);
		this.layoutDirty = true;
		this.focusTarget.focus();
		return this.lifetime;
	}

	public hide(): void {
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

	public dispose(): void { this.hide(); this.actions.dispose(); this.scroll.dispose(); this.unbindBlur(); }

	public update(): void {
		if (!this.visible) return;
		this.scroll.update();
		this.actions.update();
	}

	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number, bounds: RectBounds): void {
		if (this.layoutDirty || this.model.font !== font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom) {
			write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
			const headerBottom = bounds.top + font.lineHeight + 8;
			layoutWorkbenchActionBar(this.actionBar, bounds.right - 4, bounds.top + 2, headerBottom - 2, measureText);
			this.title = truncateMeasuredText(this.input!.title, this.actionBar.items[0].bounds.left - bounds.left - 8, measure);
			write_rect_bounds(this.content, bounds.left, headerBottom, bounds.right, bounds.bottom);
			this.scroll.lineStep = font.lineHeight;
			this.layoutDirty = false;
		}
		this.model.layout(font, measure, this.content);
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (this.input === undefined) return false;
		if (command === 'propertyInspector.close') return true;
		return command === 'propertyInspector.source' && this.model.selectionIndex >= 0
			&& this.input.canOpenSource(this.model.rows[this.model.selectionIndex].element);
	}

	public execute(command: EditorCommandId): void {
		if (command === 'propertyInspector.close') this.hide();
		else if (command === 'propertyInspector.source') this.openSource();
		else throw new Error(`Not a property inspector command: ${command}`);
	}

	private openSource(): void {
		if (!this.isEnabled('propertyInspector.source')) return;
		const input = this.input!;
		const item = this.model.rows[this.model.selectionIndex].element;
		this.hide();
		input.openSource(item);
	}

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model.viewport.bounds)) {
			const row = this.model.rowAt(snapshot.viewportY);
			this.model.hoverIndex = row;
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && row >= 0) {
				this.model.selectionIndex = row;
				this.triggerKey = undefined;
				this.padPressed = false;
			}
		} else this.model.hoverIndex = -1;
		return this.scroll.handlePointer(snapshot);
	}

	public handleWheel(snapshot: PointerSnapshot, delta: number): boolean { return this.scroll.handleWheel(snapshot, delta); }

	private handleKeyboard(input: PlayerInput): boolean {
		if (input.getModifiers() !== KeyModifier.none) { this.triggerKey = undefined; return false; }
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.hide(); return true; }
		for (const key of NAVIGATION_KEYS) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			this.triggerKey = undefined;
			this.padPressed = false;
			this.model.select(key === 'Home' ? 0 : key === 'End' ? this.model.rows.length - 1
				: this.model.selectionIndex + (key === 'ArrowUp' ? -1 : 1));
			return true;
		}
		for (const key of TRIGGER_KEYS) {
			const button = input.inputHandlers.keyboard.getKeyState(key);
			if (button.consumed) continue;
			if (button.justpressed && this.triggerKey === undefined) this.triggerKey = key;
			if (button.pressed || button.justpressed || button.justreleased) consumeIdeKey(key, input);
			if (this.triggerKey !== key) continue;
			if (button.justreleased) { this.triggerKey = undefined; this.openSource(); }
			else if (!button.pressed) this.triggerKey = undefined;
			return true;
		}
		return false;
	}

	private handleGamepad(input: PlayerInput): boolean {
		const gamepad = input.inputHandlers.gamepad;
		if (gamepad === null) return false;
		const back = gamepad.getButtonState('b');
		if (back.justpressed && !back.consumed) { gamepad.consumeButton('b'); this.hide(); return true; }
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
