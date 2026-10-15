import { Input } from './manager';
import { HostUiInput } from './ui';
import { OnScreenKeyboard } from './on_screen_keyboard';
import { OnScreenKeyboardAction, OnScreenKeyboardCommand, ON_SCREEN_KEYBOARD_POSITION_TARGET } from './on_screen_keyboard_keys';
import { HostOnScreenKeyboard } from '../host_on_screen_keyboard';
import type { VideoPresenter } from '../../../machine/ts/render/video_presenter';
import { INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT, InputControllerGamepadButtonBit as Button } from '../../../machine/ts/machine/devices/input/contracts';

const COMMAND_BINDINGS = [
	{ button: Button.Y, command: OnScreenKeyboardCommand.TogglePage, requiresSelect: true },
	{ button: Button.B, command: OnScreenKeyboardCommand.Delete, requiresSelect: true },
	{ button: Button.LeftBumper, command: OnScreenKeyboardCommand.Home, requiresSelect: true },
	{ button: Button.RightBumper, command: OnScreenKeyboardCommand.End, requiresSelect: true },
	{ button: Button.B, command: OnScreenKeyboardCommand.Space, requiresSelect: false },
	{ button: Button.X, command: OnScreenKeyboardCommand.Backspace, requiresSelect: false },
	{ button: Button.Y, command: OnScreenKeyboardCommand.Shift, requiresSelect: false },
	{ button: Button.LeftBumper, command: OnScreenKeyboardCommand.Left, requiresSelect: false },
	{ button: Button.RightBumper, command: OnScreenKeyboardCommand.Right, requiresSelect: false },
	{ button: Button.LeftTrigger, command: OnScreenKeyboardCommand.Home, requiresSelect: false },
	{ button: Button.RightTrigger, command: OnScreenKeyboardCommand.End, requiresSelect: false },
	{ button: Button.Start, command: OnScreenKeyboardCommand.Enter, requiresSelect: false },
	{ button: Button.A, command: OnScreenKeyboardCommand.Activate, requiresSelect: false },
] as const;

/** Keyboard device interaction; modal eligibility belongs to HostUiInput, not this policy. */
export class HostKeyboardInteraction {
	private readonly capturePoint = { x: 0, y: 0 };
	private pointerAction = OnScreenKeyboardAction.None;

	public constructor(
		private readonly input: Input,
		public readonly model: OnScreenKeyboard,
		private readonly presenter: VideoPresenter,
		public readonly bitmapView: HostOnScreenKeyboard | undefined,
	) {}

	public readonly capturesPointer = (x: number, y: number): boolean => {
		return this.model.visible && this.bitmapView !== undefined
			&& this.presenter.mapDisplayPointToViewport(x, y, this.capturePoint)
			&& this.bitmapView.containsPoint(this.capturePoint.x, this.capturePoint.y);
	};

	public open(): void {
		this.pointerAction = OnScreenKeyboardAction.None;
		this.model.open();
	}

	public close(): void {
		this.pointerAction = OnScreenKeyboardAction.None;
		this.model.close();
	}

	public tickInput(ui: HostUiInput): void {
		const model = this.model;
		model.updateFeedback(this.input.getPlayerInput(1).pollTimestampMs);
		const view = this.bitmapView;
		if (view !== undefined) {
			if (!ui.pointerHeld) {
				model.releaseSource(OnScreenKeyboard.POINTER_SOURCE, true);
				if (this.pointerAction === OnScreenKeyboardAction.TogglePosition) view.togglePosition();
				this.pointerAction = OnScreenKeyboardAction.None;
			}
			// A captured key is held until actual UP; hover cannot retarget it.
			if (ui.pointerValid && ui.pointerChanged && (!ui.pointerHeld || ui.pointerJustPressed)) {
				const key = view.hitTestAt(ui.pointerPosition.x, ui.pointerPosition.y);
				if (key >= 0) {
					model.selectKey(key, view.publishedPage);
					if (ui.pointerJustPressed) {
						if (key === ON_SCREEN_KEYBOARD_POSITION_TARGET) this.pointerAction = OnScreenKeyboardAction.TogglePosition;
						else model.pressKey(OnScreenKeyboard.POINTER_SOURCE, key);
					}
				}
			}
		}
		if (ui.buttonRepeatEdge(Button.Up)) model.moveVertical(-1);
		if (ui.buttonRepeatEdge(Button.Down)) model.moveVertical(1);
		if (ui.buttonRepeatEdge(Button.Left)) model.moveHorizontal(-1);
		if (ui.buttonRepeatEdge(Button.Right)) model.moveHorizontal(1);
		for (let player = 0; player < Input.PLAYERS_MAX; player += 1) {
			const sourceBase = player * INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
			for (let button = 0; button < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT; button += 1) {
				if (!ui.gamepadButtonPressed(player, button)) model.releaseSource(sourceBase + button);
			}
			for (const binding of COMMAND_BINDINGS) {
				if (ui.gamepadButtonJustPressed(player, binding.button)
					&& ui.gamepadButtonPressed(player, Button.Select) === binding.requiresSelect) {
					if (model.command(sourceBase + binding.button, binding.command) === OnScreenKeyboardAction.TogglePosition
						&& view !== undefined) view.togglePosition();
				}
			}
		}
	}
}
