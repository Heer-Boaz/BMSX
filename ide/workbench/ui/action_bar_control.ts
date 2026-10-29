import { point_in_rect } from '../../../machine/ts/common/rect';
import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import type { EditorCommandId, EditorCommandRunner } from '../../common/commands';
import type { PointerSnapshot } from '../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../input/keyboard/key_input';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { PointerHoverService, PointerHoverTarget } from '../../input/pointer/hover';
import { WORKBENCH_ACTION_BAR_OVERFLOW, type WorkbenchActionBarAction, type WorkbenchActionBarItem, type WorkbenchActionBarState } from './action_bar';
import { editorCommandTitle } from '../../commands/catalog';
import type { ContextMenuController } from '../services/context_menu/controller';
import type { DisposableStore } from '../../common/lifecycle';
import type { WorkbenchMenuEntry } from './menu/model';

const TRIGGER_KEYS = ['Enter', 'NumpadEnter', 'Space'] as const;
const HORIZONTAL_NAVIGATION_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;
const VERTICAL_NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const;

/** One composite control; input-owned geometry outlives physical gestures.
 * The owner chooses content focus on Escape; command scope and teardown parent are separate. */
export class WorkbenchActionBarControl implements PointerCaptureTarget, PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	/** Domain owners attach source/target invalidation to the actual popup lifetime. */
	public onDidOpenOverflow: ((lifetime: DisposableStore) => void) | undefined;
	private input: WorkbenchActionBarState | undefined;
	private pointerCommand: WorkbenchActionBarAction | null = null;
	private triggerKey: string | undefined;
	private pressedEntry: WorkbenchMenuEntry | undefined;
	private pressedEntryRevision = 0;
	private readonly unbindKeyboard: () => void;
	private readonly unbindFocus: () => void;
	private readonly unbindBlur: () => void;
	private unbindPressBlur: (() => void) | undefined;
	private readonly cancelPress = () => this.cancelPointer();
	private layoutRevision = -1;
	private presentationRevision = -1;
	private overflowSession: DisposableStore | undefined;
	private readonly itemCommands: EditorCommandId[] = [];

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly hover: PointerHoverService, private readonly commands: EditorCommandRunner, parent: InputFocusTarget | null,
		private readonly focusContent: () => void, private readonly contextMenu?: ContextMenuController,
		private readonly orientation: 'horizontal' | 'vertical' = 'horizontal') {
		this.focusTarget = focus.createTarget(parent);
		this.focusTarget.canFocus = () => {
			const state = this.input;
			if (state === undefined) return false;
			for (const item of state.items) if (item.visible && !item.overflowed && item.enabled) return true;
			return state.overflow?.button.visible === true && state.overflow.button.enabled;
		};
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input), this.cancelPress);
		this.unbindFocus = this.focusTarget.onDidFocus(() => {
			this.input!.hasFocus = true;
			this.update();
		});
		this.unbindBlur = this.focusTarget.onDidBlur(() => {
			this.cancelPointer();
			this.input!.hasFocus = false;
		});
	}

	public setInput(input: WorkbenchActionBarState, context: InputFocusTarget): void {
		if (this.input === input && this.focusTarget.commandContext === context) return;
		this.clearInput();
		this.input = input;
		this.focusTarget.commandContext = context;
		if (context !== this.focusTarget) for (const item of input.items) {
			const command = context.getCommand(item.command);
			if (command !== undefined) {
				this.focusTarget.registerCommand(item.command, command);
				this.itemCommands.push(item.command);
			}
		}
		this.update();
	}

	public clearInput(): void {
		for (const command of this.itemCommands) this.focusTarget.unregisterCommand(command);
		this.itemCommands.length = 0;
		if (this.overflowSession !== undefined) this.contextMenu!.hide();
		this.hover.release(this);
		this.cancelPointer();
		this.focusTarget.release();
		this.input = undefined;
		this.layoutRevision = -1;
		this.presentationRevision = -1;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindFocus();
		this.unbindBlur();
	}

	/** Hover wins over keyboard focus; an armed gesture never has a competing tooltip. */
	public get tooltipItem(): WorkbenchActionBarItem<WorkbenchActionBarAction> | undefined {
		const state = this.input;
		if (state === undefined || state.pressedCommand !== null) return undefined;
		if (state.hoveredCommand !== null) {
			if (state.hoveredCommand === WORKBENCH_ACTION_BAR_OVERFLOW) return state.overflow!.button;
			for (const item of state.items) if (item.command === state.hoveredCommand && item.visible && !item.overflowed) return item;
		} else if (state.hasFocus && state.focusedIndex >= 0)
			return state.focusedIndex === state.items.length ? state.overflow!.button : state.items[state.focusedIndex];
		return undefined;
	}

	/** Revoke disabled attempts even when there is no new pointer or key event. */
	public update(): void {
		this.refreshPresentation();
		const state = this.input!;
		for (const item of state.items) {
			item.enabled = item.visible && this.commands.isEnabled(item.command, this.focusTarget.commandContext);
			item.tooltip = editorCommandTitle(item.command, item.checked);
		}
		const command = this.pointerCommand === null ? state.pressedCommand : this.pointerCommand;
		if (command !== null && !this.isEnabled(command)) this.cancelPointer();
		const selected = state.focusedIndex === state.items.length ? state.overflow?.button : state.items[state.focusedIndex];
		if (state.hasFocus && (selected === undefined || !selected.visible || selected.overflowed || !selected.enabled)) {
			this.moveFocus(1, state.focusedIndex === state.items.length ? -1 : state.focusedIndex);
		}
	}

	/** Physical admission observes source retirement even before the next layout. */
	private refreshPresentation(): void {
		const state = this.input!;
		state.presentation.refresh();
		const layoutChanged = this.layoutRevision !== state.layoutRevision;
		const presentationChanged = this.presentationRevision !== state.presentation.revision;
		this.layoutRevision = state.layoutRevision;
		this.presentationRevision = state.presentation.revision;
		// Ordinary attempts own one placement; More owns the entire derived menu.
		if (layoutChanged || this.pressedEntry !== undefined && this.pressedEntry.revision !== this.pressedEntryRevision
			|| presentationChanged && (this.pointerCommand === WORKBENCH_ACTION_BAR_OVERFLOW || state.pressedCommand === WORKBENCH_ACTION_BAR_OVERFLOW))
			this.cancelPointer();
		if ((layoutChanged || presentationChanged) && this.overflowSession !== undefined) this.contextMenu!.hide();
	}

	/** A subject change revokes its action without interrupting unrelated window controls. */
	public cancelCommand(command: WorkbenchActionBarAction): void {
		if (this.pointerCommand === command || this.input?.pressedCommand === command) this.cancelPointer();
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.unbindPressBlur?.();
		this.unbindPressBlur = undefined;
		this.pointerCommand = null;
		this.triggerKey = undefined;
		this.pressedEntry = undefined;
		if (this.input !== undefined) {
			this.input.pressedCommand = null;
			this.input.hoveredCommand = null;
		}
	}

	public onPointerLeave(): void { this.input!.hoveredCommand = null; }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		this.refreshPresentation();
		const state = this.input!;
		const index = this.hitTest(snapshot);
		const item = index < 0 ? undefined : index === state.items.length ? state.overflow!.button : state.items[index];
		state.hoveredCommand = item === undefined ? null : item.command;
		if (index < 0) { this.hover.release(this); return false; }
		this.hover.visit(this);
		const command = item!.command;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.isEnabled(command)) {
			this.cancelPointer();
			this.capture.capture(this);
			this.pointerCommand = command;
			this.pressedEntry = item!.menuEntry;
			this.pressedEntryRevision = this.pressedEntry === undefined ? 0 : this.pressedEntry.revision;
			state.pressedCommand = command;
			state.hoveredCommand = command;
			state.focusedIndex = index;
			// Keep field focus/drafts until the command's normal admission step.
			this.unbindPressBlur = this.focus.target?.onDidBlur(this.cancelPress);
			this.focusTarget.activate();
			if (this.input !== state || this.pointerCommand !== command) return true;
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		if (this.pointerCommand === null) return;
		const state = this.input!;
		const index = this.hitTest(snapshot);
		state.hoveredCommand = index < 0 ? null : index === state.items.length ? state.overflow!.button.command : state.items[index].command;
		if (index < 0) this.hover.release(this);
		else this.hover.visit(this);
		state.pressedCommand = state.hoveredCommand === this.pointerCommand ? this.pointerCommand : null;
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.update();
		const command = this.pointerCommand;
		const index = this.hitTest(snapshot);
		const state = this.input!, item = index < 0 ? undefined : index === state.items.length ? state.overflow!.button : state.items[index];
		const accept = command !== null && item?.command === command && this.isEnabled(command);
		const context = this.focusTarget.commandContext;
		this.cancelPointer(); // Execution may synchronously detach this pane/control.
		if (accept) this.invoke(command, context);
	}

	private hitTest(snapshot: PointerSnapshot): number {
		if (!snapshot.valid || !snapshot.insideViewport) return -1;
		const items = this.input!.items;
		for (let index = 0; index < items.length; index += 1) {
			if (items[index].visible && !items[index].overflowed && point_in_rect(snapshot.viewportX, snapshot.viewportY, items[index].bounds)) return index;
		}
		const overflow = this.input!.overflow?.button;
		if (overflow?.visible && point_in_rect(snapshot.viewportX, snapshot.viewportY, overflow.bounds)) return items.length;
		return -1;
	}

	private moveFocus(direction: number, from: number): void {
		const state = this.input!;
		const count = state.items.length + (state.overflow?.button.visible ? 1 : 0);
		let index = from;
		for (let remaining = count; remaining > 0; remaining -= 1) {
			index = (index + direction + count) % count;
			const item = index === state.items.length ? state.overflow!.button : state.items[index];
			if (item.visible && !item.overflowed && item.enabled) {
				state.focusedIndex = index;
				return;
			}
		}
		state.focusedIndex = -1;
	}

	private isEnabled(command: WorkbenchActionBarAction): boolean {
		return command === WORKBENCH_ACTION_BAR_OVERFLOW ? this.input!.overflow!.button.visible
			: this.input!.items.some(item => item.command === command && item.visible && !item.overflowed)
				&& this.commands.isEnabled(command, this.focusTarget.commandContext);
	}
	private invoke(command: WorkbenchActionBarAction, context: InputFocusTarget): void {
		if (command !== WORKBENCH_ACTION_BAR_OVERFLOW) { this.commands.execute(command, context, undefined, this.focusTarget); return; }
		this.openOverflow();
	}
	/** Named pane commands and physical More activation share the same owned popup. */
	public openOverflow(): void {
		const state = this.input!, overflow = state.overflow!;
		this.contextMenu!.show(overflow.button.bounds.left, overflow.button.bounds.bottom, state.presentation,
			this.commands, { placement: 'below', selectFirst: true, invocationOrigin: this.focusTarget,
				commandTarget: this.focusTarget.commandContext, onWillShow: session => {
				this.overflowSession = session;
				session.add({ dispose: () => { if (this.overflowSession === session) this.overflowSession = undefined; } });
				this.onDidOpenOverflow?.(session);
			} });
	}

	private handleKeyboard(input: KeyInputEvent): void {
		this.update();
		if (input.modifiers !== KeyModifier.none) {
			if (this.triggerKey !== undefined) this.cancelPointer();
			return;
		}
		if (isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input);
			this.cancelPointer();
			this.focusContent();
			return;
		}
		const state = this.input!;
		const navigationKeys = this.orientation === 'vertical' ? VERTICAL_NAVIGATION_KEYS : HORIZONTAL_NAVIGATION_KEYS;
		for (const key of navigationKeys) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			this.cancelPointer();
			this.moveFocus(key === 'ArrowLeft' || key === 'ArrowUp' || key === 'End' ? -1 : 1,
				key === 'Home' ? -1 : key === 'End' ? 0 : state.focusedIndex);
			return;
		}
		if (!TRIGGER_KEYS.includes(input.code as typeof TRIGGER_KEYS[number]) || input.consumed) return;
		if (input.down && !input.repeat && this.triggerKey === undefined && state.focusedIndex >= 0) {
			this.cancelPointer();
			this.triggerKey = input.code;
			const item = state.focusedIndex === state.items.length ? state.overflow!.button : state.items[state.focusedIndex];
			state.pressedCommand = item.command;
			this.pressedEntry = item.menuEntry;
			this.pressedEntryRevision = this.pressedEntry === undefined ? 0 : this.pressedEntry.revision;
		}
		consumeIdeKey(input.code, input);
		if (input.code !== this.triggerKey || input.down) return;
		const command = state.pressedCommand!;
		this.cancelPointer();
		if (this.isEnabled(command)) this.invoke(command, this.focusTarget.commandContext);
	}
}
