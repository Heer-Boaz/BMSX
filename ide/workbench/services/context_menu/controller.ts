import { point_in_rect } from '../../../../machine/ts/common/rect';
import { KeyModifier, type PlayerInput } from '../../../../hosts/common/input/player';
import type { EditorCommandRunner } from '../../../common/commands';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import type { WorkbenchMenuItem } from '../../ui/menu/registry';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { ContextMenuModel } from './model';

type ContextMenuSession = {
	readonly commands: EditorCommandRunner;
	readonly returnFocus: InputFocusTarget | null;
	readonly disposables: DisposableStore;
};

/** One workbench popup lifetime. Contributions own targets and command admission. */
export class ContextMenuController implements PointerCaptureTarget {
	public readonly pointerScope = Symbol('context menu');
	public readonly model = new ContextMenuModel();
	public readonly focusTarget: InputFocusTarget;
	private readonly scroll: WorkbenchScrollControl;
	private session: ContextMenuSession | undefined;
	private pressedIndex = -1;
	private triggerKey: string | undefined;
	private revision = 0;
	private pointerX = 0;
	private pointerY = 0;
	private pointerKnown = false;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService) {
		this.focusTarget = focus.createTarget();
		this.scroll = new WorkbenchScrollControl(focus, capture, this.focusTarget, undefined, this.pointerScope);
		this.scroll.setInput(this.model.viewport);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.hide(false));
	}

	public get visible(): boolean { return this.session !== undefined; }

	/** The caller attaches source/target invalidation to the returned popup lifetime. */
	public show(x: number, y: number, items: readonly WorkbenchMenuItem[], commands: EditorCommandRunner,
		selectFirst = false): DisposableStore {
		this.hide();
		this.capture.cancel();
		const returnFocus = this.focus.target;
		this.focusTarget.commandContext = returnFocus === null ? this.focusTarget : returnFocus.commandContext;
		this.focusTarget.focus();
		const disposables = new DisposableStore();
		this.session = { commands, returnFocus, disposables };
		this.model.setItems(items, x, y);
		this.pointerX = x;
		this.pointerY = y;
		this.pointerKnown = !selectFirst;
		this.update();
		if (selectFirst) this.model.selectNext(1);
		return disposables;
	}

	public hide(restoreFocus = true): void {
		const session = this.session;
		if (session === undefined) return;
		this.session = undefined;
		this.cancelPointer();
		this.scroll.cancelPointer();
		session.disposables.dispose();
		if (restoreFocus && this.focusTarget.hasFocus) this.focus.setTarget(session.returnFocus);
		this.focusTarget.commandContext = this.focusTarget;
	}

	public update(): void {
		if (this.session === undefined) return;
		if (this.revision !== this.model.viewport.revision) {
			this.cancelPointer();
			this.revision = this.model.viewport.revision;
		}
		for (const row of this.model.rows) row.enabled = row.command !== undefined && this.session.commands.isEnabled(row.command);
		if (this.pressedIndex >= 0 && !this.model.rows[this.pressedIndex].enabled) this.cancelPointer();
		if (this.model.selectedIndex >= 0 && !this.model.rows[this.model.selectedIndex].enabled) this.model.selectNext(1);
		this.scroll.update();
	}

	public accept(): void {
		const index = this.model.selectedIndex;
		if (index < 0) return;
		const command = this.model.rows[index].command!;
		const commands = this.session!.commands;
		if (!commands.isEnabled(command)) return;
		this.hide();
		commands.execute(command);
	}

	public cancelPointer(): void { this.capture.release(this); this.pressedIndex = -1; this.triggerKey = undefined; }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!snapshot.valid || !snapshot.insideViewport) return true;
		const x = snapshot.viewportX;
		const y = snapshot.viewportY;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			const inside = point_in_rect(x, y, this.model.bounds);
			this.hide();
			return inside; // A new right-click outside targets the underlying contribution.
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && !point_in_rect(x, y, this.model.bounds)) {
			this.hide();
			return true;
		}
		if (point_in_rect(x, y, this.model.viewport.scrollbar.getTrack())) {
			this.scroll.handlePointer(snapshot);
			return true;
		}
		const moved = this.pointerKnown && (this.pointerX !== x || this.pointerY !== y);
		this.pointerX = x;
		this.pointerY = y;
		this.pointerKnown = true;
		if (moved || (snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			const index = this.model.hitTest(x, y);
			this.model.selectedIndex = index >= 0 && this.model.rows[index].enabled ? index : -1;
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.model.selectedIndex >= 0) {
			this.capture.capture(this, PointerButton.Primary, this.pointerScope);
			this.pressedIndex = this.model.selectedIndex;
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const index = this.model.hitTest(snapshot.viewportX, snapshot.viewportY);
		this.model.selectedIndex = index === this.pressedIndex ? index : -1;
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
		if (this.model.selectedIndex >= 0) this.accept();
	}

	public handleWheel(steps: number): void {
		this.cancelPointer();
		this.scroll.cancelPointer();
		const view = this.model.viewport;
		view.scrollbar.setScroll(view.scrollTop + steps * this.model.rowHeight);
	}

	public handleKeyboard(input: PlayerInput): boolean {
		if (isKeyJustPressed('Escape', input) || isKeyJustPressed('Tab', input)) {
			consumeIdeKey('Escape', input);
			consumeIdeKey('Tab', input);
			this.hide();
			return true;
		}
		if (input.getModifiers() !== KeyModifier.none) {
			if (this.triggerKey !== undefined) this.cancelPointer();
			return false;
		}
		for (const code of ACCEPT_KEYS) {
			const button = input.inputHandlers.keyboard.getKeyState(code);
			if (button.consumed) continue;
			if (button.justpressed && this.triggerKey === undefined && this.model.selectedIndex >= 0) {
				this.cancelPointer();
				this.triggerKey = code;
				this.pressedIndex = this.model.selectedIndex;
			}
			if (button.pressed || button.justpressed || button.justreleased) consumeIdeKey(code, input);
			if (code !== this.triggerKey) continue;
			if (button.justreleased) {
				const accept = this.model.selectedIndex === this.pressedIndex;
				this.cancelPointer();
				if (accept) this.accept();
				return true;
			}
			if (!button.pressed) this.cancelPointer();
			return true;
		}
		for (const code of NAVIGATION_KEYS) if (shouldRepeatKeyFromPlayer(code, input)) {
			consumeIdeKey(code, input);
			this.cancelPointer();
			switch (code) {
				case 'ArrowUp': this.model.selectNext(-1, this.model.selectedIndex < 0 ? 0 : this.model.selectedIndex); break;
				case 'ArrowDown': this.model.selectNext(1); break;
				case 'Home': this.model.selectNext(1, -1); break;
				case 'End': this.model.selectNext(-1, 0); break;
			}
			return true;
		}
		return false;
	}

	public dispose(): void {
		this.hide();
		this.scroll.dispose();
		this.unbindKeyboard();
		this.unbindBlur();
	}
}

const ACCEPT_KEYS = ['Enter', 'NumpadEnter', 'Space'] as const;
const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
