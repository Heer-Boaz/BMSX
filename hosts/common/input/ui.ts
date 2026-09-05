import { Input } from './manager';
import { GAMEPAD_BUTTON_IDS } from './gamepad_buttons';
import { ButtonRepeat } from './button_repeat';
import { INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT, InputControllerGamepadAxis, InputControllerGamepadButtonBit } from '../../../machine/ts/machine/devices/input/contracts';
import type { VideoPresenter } from '../../../machine/ts/render/video_presenter';

export const enum HostUiInputSource { None = 0, Keyboard = 1, Gamepad = 2, LeftStick = 4, Pointer = 8 }
const SOURCE_COUNT = Input.PLAYERS_MAX + 1;
const BUTTON_COUNT = INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
const ALL_BUTTONS = (1 << BUTTON_COUNT) - 1;

/** Physical UI input lifetime, independent of page actions and guest ICU state. */
export class HostUiInput {
	public readonly pointerPosition = { x: 0, y: 0 };
	public pointerValid = false;
	public pointerChanged = false;
	private pointerDown = false;
	private pointerPressed = false;
	private pointerReleased = false;
	private pointerBlocked = false;
	private pointerTarget = -1;
	private sources = HostUiInputSource.None;
	private keyboardButtons = 0;
	private readonly buttons = new Uint32Array(SOURCE_COUNT);
	private readonly blocked = new Uint32Array(SOURCE_COUNT);
	private readonly pressedEdges = new Uint32Array(SOURCE_COUNT);
	private readonly repeatEdges = new Uint32Array(SOURCE_COUNT);
	private readonly repeats: ButtonRepeat[] = Array.from({ length: SOURCE_COUNT * BUTTON_COUNT }, () => new ButtonRepeat());

	public constructor(private readonly input: Input, private readonly presenter: VideoPresenter) {}

	public reset(nextSources: HostUiInputSource, nextKeyboardButtons: number): void {
		this.consumeSources(this.sources | nextSources, this.keyboardButtons | nextKeyboardButtons);
		this.sources = nextSources;
		this.keyboardButtons = nextKeyboardButtons;
		this.buttons.fill(0);
		this.blocked.fill(ALL_BUTTONS);
		this.pressedEdges.fill(0);
		this.repeatEdges.fill(0);
		for (const repeat of this.repeats) repeat.reset();
		this.pointerTarget = -1;
		this.pointerValid = false;
		this.pointerChanged = false;
		this.pointerDown = false;
		this.pointerPressed = false;
		this.pointerReleased = false;
		this.pointerBlocked = true;
	}

	public update(currentTimeMs: number): void {
		if (this.sources === HostUiInputSource.None) return;
		const clock = this.input.getPlayerInput(1);
		let keyboardButtons = 0;
		if ((this.sources & HostUiInputSource.Keyboard) !== 0) {
			const keyboard = clock.inputHandlers.keyboard!;
			for (let button = 0; button < BUTTON_COUNT; button += 1) {
				const mask = 1 << button;
				if ((this.keyboardButtons & mask) !== 0 && keyboard.getButtonState(GAMEPAD_BUTTON_IDS[button]).pressed) keyboardButtons |= mask;
			}
		}
		this.updateButtons(0, keyboardButtons, currentTimeMs, clock.frameDurationMs, clock.pollFrame);
		for (let player = 1; player < SOURCE_COUNT; player += 1) {
			const gamepad = this.input.getPlayerInput(player).inputHandlers.gamepad;
			let buttons = 0;
			if ((this.sources & HostUiInputSource.Gamepad) !== 0 && gamepad !== null) {
				buttons = gamepad.physicalGamepadButtonsWord();
				if ((this.sources & HostUiInputSource.LeftStick) !== 0) {
					const x = gamepad.physicalGamepadAxisWord(InputControllerGamepadAxis.LeftX) | 0;
					const y = gamepad.physicalGamepadAxisWord(InputControllerGamepadAxis.LeftY) | 0;
					if (x <= -0x8000) buttons |= 1 << InputControllerGamepadButtonBit.Left;
					if (x >= 0x8000) buttons |= 1 << InputControllerGamepadButtonBit.Right;
					if (y <= -0x8000) buttons |= 1 << InputControllerGamepadButtonBit.Up;
					if (y >= 0x8000) buttons |= 1 << InputControllerGamepadButtonBit.Down;
				}
			}
			this.updateButtons(player, buttons, currentTimeMs, clock.frameDurationMs, clock.pollFrame);
		}
		if ((this.sources & HostUiInputSource.Pointer) !== 0) {
			const pointer = clock.inputHandlers.pointer!;
			const x = this.pointerPosition.x;
			const y = this.pointerPosition.y;
			const valid = this.pointerValid;
			this.pointerValid = pointer.positionValid && this.presenter.mapDisplayPointToViewport(
				pointer.getButtonState('pointer_position').value2d![0],
				pointer.getButtonState('pointer_position').value2d![1],
				this.pointerPosition,
			);
			const physicalDown = pointer.getButtonState('pointer_primary').pressed;
			this.pointerBlocked &&= physicalDown;
			const down = physicalDown && !this.pointerBlocked;
			this.pointerPressed = down && !this.pointerDown;
			this.pointerReleased = !down && this.pointerDown;
			this.pointerDown = down;
			this.pointerChanged = valid !== this.pointerValid || x !== this.pointerPosition.x || y !== this.pointerPosition.y || this.pointerPressed || this.pointerReleased;
		}
	}

	private updateButtons(source: number, physicalButtons: number, now: number, frameDurationMs: number, frameId: number): void {
		this.blocked[source] &= physicalButtons;
		const eligible = physicalButtons & ~this.blocked[source];
		const edges = eligible & ~this.buttons[source];
		let work = eligible | (this.buttons[source] & ~physicalButtons);
		this.buttons[source] = physicalButtons;
		this.pressedEdges[source] = edges;
		let repeats = 0;
		while (work !== 0) {
			const button = 31 - Math.clz32(work & -work);
			const mask = 1 << button;
			work &= work - 1;
			if (this.repeats[source * BUTTON_COUNT + button].update((eligible & mask) !== 0, (edges & mask) !== 0, now, now, frameDurationMs, frameId)) repeats |= mask;
		}
		this.repeatEdges[source] = repeats;
	}

	public buttonJustPressed(button: InputControllerGamepadButtonBit): boolean {
		const mask = 1 << button;
		for (let source = 0; source < SOURCE_COUNT; source += 1) if ((this.pressedEdges[source] & mask) !== 0) return true;
		return false;
	}
	public buttonRepeatEdge(button: InputControllerGamepadButtonBit): boolean {
		const mask = 1 << button;
		for (let source = 0; source < SOURCE_COUNT; source += 1) if ((this.repeatEdges[source] & mask) !== 0) return true;
		return false;
	}
	public gamepadButtonPressed(player: number, button: InputControllerGamepadButtonBit): boolean { return (this.buttons[player + 1] & (1 << button)) !== 0; }
	public gamepadButtonJustPressed(player: number, button: InputControllerGamepadButtonBit): boolean { return (this.pressedEdges[player + 1] & (1 << button)) !== 0; }
	public gamepadButtonRepeatEdge(player: number, button: InputControllerGamepadButtonBit): boolean { return (this.repeatEdges[player + 1] & (1 << button)) !== 0; }

	public activatePointer(target: number): boolean {
		if (this.pointerPressed) this.pointerTarget = target;
		if (!this.pointerReleased) return false;
		const activated = target >= 0 && target === this.pointerTarget;
		this.pointerTarget = -1;
		return activated;
	}

	public consume(): void { this.consumeSources(this.sources, this.keyboardButtons); }

	private consumeSources(sources: HostUiInputSource, keyboardButtons: number): void {
		if ((sources & HostUiInputSource.Gamepad) !== 0) {
			for (let player = 1; player < SOURCE_COUNT; player += 1) this.input.getPlayerInput(player).inputHandlers.gamepad?.consumeAllInput();
		}
		if ((sources & HostUiInputSource.Keyboard) !== 0) {
			const keyboard = this.input.getPlayerInput(1).inputHandlers.keyboard!;
			for (let button = 0; button < BUTTON_COUNT; button += 1) if ((keyboardButtons & (1 << button)) !== 0) keyboard.consumeButton(GAMEPAD_BUTTON_IDS[button]);
		}
		if ((sources & HostUiInputSource.Pointer) !== 0) this.input.getPlayerInput(1).inputHandlers.pointer!.consumeButton('pointer_primary');
	}
}
