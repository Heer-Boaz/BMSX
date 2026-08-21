import { GamepadInput } from './gamepad';
import type {
	ButtonId,
	ButtonState,
	InputMap,
	KeyboardInputMapping,
	KeyOrButtonId2ButtonState,
} from './models';
import { KeyboardInput } from './keyboard';
import { GlobalShortcutRegistry } from './shortcuts';

import { PendingAssignmentProcessor } from './host/assignment_processor';
import { PlayerInput } from './player';
import { PointerInput } from './pointer';
import type { HostClock } from '../clock';
import type {
	GamepadDevice,
	InputDevice,
	InputEventSink,
	InputSource,
	VibrationInitialization,
} from './contracts';
import {
	INPUT_CONTROLLER_KEY_WORD_COUNT,
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	INPUT_CONTROLLER_PAD_COUNT,
	type InputControllerInputSource,
	type InputControllerSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';

const EMPTY_BUTTON_STATE_PATCH: Readonly<Partial<ButtonState>> = Object.freeze({});
const SUPERVISOR_REQUEST_CHORD = ['select', 'lb'] as const;

/**
 * Returns the pressed state of a key or button, and optionally checks if it was clicked.
 * @param stateMap - The state map to check for the key or button.
 * @param consumedStateMap - The click state map to check for the key or button.
 * @param keyOrButtonId - The key or button to check the state of.
 * @returns The pressed state of the key or button.
 */
export function getPressedState(
	stateMap: KeyOrButtonId2ButtonState,
	keyOrButtonId: ButtonId
): ButtonState {
	let state = stateMap[keyOrButtonId];
	if (!state) {
		state = makeButtonState();
		stateMap[keyOrButtonId] = state;
	}
	return state;
}

export function makeButtonState(partialState?: Partial<ButtonState>): ButtonState {
	const {
		pressed = false,
		justpressed = false,
		justreleased = false,
		waspressed = false,
		wasreleased = false,
		repeatpressed = false,
		repeatcount = 0,
		consumed = false,
		presstime = null,
		timestamp = 0,
		pressedAtMs = 0,
		releasedAtMs = 0,
		pressId = 0,
		value = 0,
		value2d = null,
	} = partialState ?? EMPTY_BUTTON_STATE_PATCH;
	return { pressed, justpressed, justreleased, waspressed, wasreleased, repeatpressed, repeatcount, consumed, presstime, timestamp, pressedAtMs, releasedAtMs, pressId, value, value2d };
}

type DeviceBinding =
	| {
		handler: KeyboardInput;
		source: 'keyboard';
		assignedPlayer: number;
	}
	| {
		handler: PointerInput;
		source: 'pointer';
		assignedPlayer: number;
	}
	| {
		handler: GamepadInput;
		source: 'gamepad';
		assignedPlayer: number | null;
		device: GamepadDevice;
	};

/**
 * Represents the Input class, which manages player inputs and gamepad assignments.
 */
export class Input implements InputControllerInputSource, InputEventSink {
	/**
	 * The maximum number of players allowed.
	 */
	public static readonly PLAYERS_MAX = 4;

	/**
	 * The maximum index value for the player, which is the maximum number of players minus 1 as the index is zero-based.
	 */
	public static readonly PLAYER_MAX_INDEX = Input.PLAYERS_MAX - 1;

	/**
	 * The default player index for the keyboard controls. Maps to player 1.
	 */
	public static readonly DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
	/**
	 * An array of player inputs for each player.
	 * The Player 1 input is at index 0, Player 2 input is at index 1, and so on.
	 * @see PlayerInput
	 */
	private playerInputs: PlayerInput[] = [];

	private readonly deviceBindings = new Map<string, DeviceBinding>();
	private readonly deviceBindingList: DeviceBinding[] = [];
	private readonly inputControllerKeyboardHandlers: KeyboardInput[] = [];
	private readonly inputControllerPointerHandlers: PointerInput[] = [];
	public startupGamepadIndex = -1;

	/**
	 * Represents an array of pending gamepad assignments.
	 * @see PendingAssignmentProcessor
	 */
	public pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

	private readonly unsubscribeHostInput: () => void;
	private readonly pendingVibrationDevices: GamepadDevice[] = [];
	public resetInput(): void {
		this.hostSupervisorRequestLine = false;
		this.controlSupervisorRequestLine = false;
		this.updateSupervisorRequestLine();
		for (let i = 0; i < this.playerInputs.length; i++) {
			const player = this.playerInputs[i];
			if (!player) continue;
			player.reset();
		}
		for (let i = 0; i < this.deviceBindingList.length; i += 1) {
			const binding = this.deviceBindingList[i];
			if (binding.assignedPlayer) continue;
			binding.handler.reset();
		}
	}

	public debugHotkeysPaused = false;
	private hostSupervisorRequestLine = false;
	private controlSupervisorRequestLine = false;
	private programmaticSupervisorRequestLine = false;
	private supervisorRequestLine = false;
	private readonly additionalCaptureKeys: Set<string> = new Set();
	private readonly globalShortcuts: GlobalShortcutRegistry;
	private frameDurationMs = 1000 / 60;

	/**
	 * Retrieves the player input for the specified player index.
	 * @param playerIndex - The index of the player.
	 * @returns The player input object for the specified player index.
	 * @throws Error if the player index is out of range.
	 */
	public getPlayerInput(playerIndex: number): PlayerInput {
		const index = playerIndex - 1;
		if (index < 0 || index > Input.PLAYER_MAX_INDEX) {
			throw new Error(`Player index ${playerIndex} is out of range, should be between 1 and ${Input.PLAYERS_MAX}.`);
		}
		return this.playerInputs[index];
	}

	public applyInputControllerVibrationEffect(padIndex: number, durationMs: number, intensity: number): void {
		this.getPlayerInput(padIndex + 1).applyInputControllerVibrationEffect(durationMs, intensity);
	}

	public setFrameDurationMs(frameDurationMs: number): void {
		if (this.frameDurationMs === frameDurationMs) {
			return;
		}
		this.frameDurationMs = frameDurationMs;
		for (let index = 0; index < this.playerInputs.length; index += 1) {
			this.playerInputs[index].setFrameDurationMs(frameDurationMs);
		}
	}

	private static createKeyboardToGamepadMap(keyboard: KeyboardInputMapping): Record<string, string> {
		const inverse: Record<string, string> = {};
		for (const action in keyboard) {
			const bindings = keyboard[action];
			for (let index = 0; index < bindings.length; index += 1) {
				const binding = bindings[index]!;
				const id = typeof binding === 'string' ? binding : binding.id;
				inverse[id] = action;
			}
		}
		return inverse;
	}

	public static readonly DEFAULT_INPUT_MAPPING: InputMap = Object.freeze({
		keyboard: Object.freeze({
			a: ['KeyX'], b: ['KeyC'], x: ['KeyZ'], y: ['KeyS'],
			lb: ['ShiftLeft'], rb: ['ShiftRight'], lt: ['ControlLeft'], rt: ['ControlRight'],
			select: ['Backspace'], start: ['Enter'], ls: ['KeyQ'], rs: ['KeyE'],
			up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
			home: ['Escape'], touch: ['Space'],
		}),
		gamepad: Object.freeze({
			a: ['a'], b: ['b'], x: ['x'], y: ['y'],
			lb: ['lb'], rb: ['rb'], lt: ['lt'], rt: ['rt'],
			select: ['select'], start: ['start'], ls: ['ls'], rs: ['rs'],
			up: ['up'], down: ['down'], left: ['left'], right: ['right'],
			home: ['home'], touch: ['touch'],
		}),
		pointer: Object.freeze({
			pointer_primary: ['pointer_primary'], pointer_secondary: ['pointer_secondary'],
			pointer_aux: ['pointer_aux'], pointer_back: ['pointer_back'],
			pointer_forward: ['pointer_forward'], pointer_delta: ['pointer_delta'],
			pointer_position: ['pointer_position'], pointer_wheel: ['pointer_wheel'],
		}),
	});

	public static readonly KEYBOARDKEY2GAMEPADBUTTON = Object.freeze(Input.createKeyboardToGamepadMap(Input.DEFAULT_INPUT_MAPPING.keyboard));

	/**
	 * Prevents the default action of a UI event based on the key pressed, except for certain keys when the game is running or not paused.
	 * @param e The UI event to prevent the default action of.
	 * @param key The key pressed that triggered the event.
	 */

	public constructor(
		private readonly clock: HostClock,
		inputSource: InputSource,
		startingGamepadIndex: number,
	) {
		this.startupGamepadIndex = startingGamepadIndex;
		for (let index = 0; index < Input.PLAYERS_MAX; index += 1) {
			this.playerInputs[index] = new PlayerInput(index + 1, this.frameDurationMs);
		}
		this.globalShortcuts = new GlobalShortcutRegistry(this);
		const defaultPlayerIndex = Input.DEFAULT_KEYBOARD_PLAYER_INDEX;
		this.globalShortcuts.registerControlChord(
			defaultPlayerIndex,
			SUPERVISOR_REQUEST_CHORD,
			() => this.setControlSupervisorRequestLine(true),
			() => this.setControlSupervisorRequestLine(false),
		);
		const player = this.getPlayerInput(defaultPlayerIndex);
		const keyboard = new KeyboardInput(this.clock, 'keyboard:0');
		const pointer = new PointerInput(this.clock, 'pointer:0');
		player.inputHandlers['keyboard'] = keyboard;
		player.inputHandlers['pointer'] = pointer;
		const keyboardBinding: DeviceBinding = { handler: keyboard, source: 'keyboard', assignedPlayer: defaultPlayerIndex };
		const pointerBinding: DeviceBinding = { handler: pointer, source: 'pointer', assignedPlayer: defaultPlayerIndex };
		this.deviceBindings.set('keyboard:0', keyboardBinding);
		this.deviceBindings.set('pointer:0', pointerBinding);
		this.deviceBindingList.push(keyboardBinding, pointerBinding);
		this.inputControllerKeyboardHandlers.push(keyboard);
		this.inputControllerPointerHandlers.push(pointer);
		const devices = inputSource.devices();
		for (let index = 0; index < devices.length; index += 1) {
			if (!this.deviceBindings.has(devices[index].id)) {
				this.connectInputDevice(devices[index]);
			}
		}
		this.unsubscribeHostInput = inputSource.subscribe(this);
	}

	public readonly shouldCaptureKey = (code: string): boolean => {
		return this.additionalCaptureKeys.has(code);
	};

	public setKeyboardCapture(code: string, enabled: boolean): void {
		if (enabled) {
			this.additionalCaptureKeys.add(code);
		} else {
			this.additionalCaptureKeys.delete(code);
		}
	}

	/**
	 * Disposes the input system by removing all pending gamepad assignments,
	 * player inputs, event subscriptions, and deregistering the input system.
	 */
	public dispose(): void {
		// Remove all pending gamepad assignments
		this.pendingGamepadAssignments = [];

		// Remove all player inputs
		this.playerInputs = [];
		this.unsubscribeHostInput();
		this.inputControllerKeyboardHandlers.length = 0;
		this.inputControllerPointerHandlers.length = 0;
		this.pendingVibrationDevices.length = 0;
		this.debugHotkeysPaused = false;
		this.hostSupervisorRequestLine = false;
		this.controlSupervisorRequestLine = false;
		this.programmaticSupervisorRequestLine = false;
		this.supervisorRequestLine = false;
		this.additionalCaptureKeys.clear();
	}

	public setSupervisorRequestLine(down: boolean): void {
		this.hostSupervisorRequestLine = down;
		this.updateSupervisorRequestLine();
	}

	public setProgrammaticSupervisorRequestLine(down: boolean): void {
		this.programmaticSupervisorRequestLine = down;
		this.updateSupervisorRequestLine();
	}

	private setControlSupervisorRequestLine(down: boolean): void {
		this.controlSupervisorRequestLine = down;
		this.updateSupervisorRequestLine();
	}

	private updateSupervisorRequestLine(): void {
		this.supervisorRequestLine = this.hostSupervisorRequestLine
			|| this.controlSupervisorRequestLine
			|| this.programmaticSupervisorRequestLine;
	}

	public inputButton(
		deviceId: string,
		code: string,
		down: boolean,
		value: number,
		timestamp: number,
		pressId: number,
	): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		this.routeButtonEvent(binding, code, down, value, timestamp, pressId);
	}

	public inputAxis1(deviceId: string, code: string, x: number, timestamp: number): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		this.routeAxis1(binding, code, x, timestamp);
	}

	public inputAxis2(deviceId: string, code: string, x: number, y: number, timestamp: number): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		this.routeAxis2(binding, code, x, y, timestamp);
	}

	private routeButtonEvent(
		binding: DeviceBinding,
		code: string,
		down: boolean,
		value: number,
		timestamp: number,
		pressId: number,
	): void {
		switch (binding.source) {
			case 'keyboard':
				if (down) binding.handler.keydown(code); else binding.handler.keyup(code);
				break;
			case 'pointer':
				binding.handler.ingestButton(code, down, value, timestamp, pressId);
				break;
			case 'gamepad':
				binding.handler.ingestButton(code, down, value, timestamp, pressId);
				break;
		}
	}

	private routeAxis1(binding: DeviceBinding, code: string, x: number, timestamp: number): void {
		if (binding.source === 'pointer') {
			binding.handler.ingestAxis1(code, x, timestamp);
		}
	}

	private routeAxis2(binding: DeviceBinding, code: string, x: number, y: number, timestamp: number): void {
		if (binding.source === 'pointer') {
			binding.handler.ingestAxis2(code, x, y, timestamp);
			return;
		}
		if (binding.source === 'gamepad') {
			binding.handler.ingestAxis2(code, x, y, timestamp);
		}
	}

	public connectInputDevice(device: InputDevice): void {
		const defaultPlayerIndex = Input.DEFAULT_KEYBOARD_PLAYER_INDEX;
		if (device.kind === 'gamepad') {
			const handler = new GamepadInput(
				this.clock,
				device.id,
				device,
			);
			const binding: DeviceBinding = { handler, source: 'gamepad', assignedPlayer: null, device };
			this.deviceBindings.set(device.id, binding);
			this.deviceBindingList.push(binding);
			const autoAssign = this.startupGamepadIndex >= 0 && device.id === `gamepad:${this.startupGamepadIndex}`;
			if (autoAssign) {
				this.startupGamepadIndex = -1;
				this.assignGamepadToPlayer(handler, defaultPlayerIndex);
				if (device.vibrationInitialization) {
					this.pendingVibrationDevices.push(device);
				}
			} else {
				this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(this, handler, null));
			}
			return;
		}
		if (this.deviceBindings.has(device.id)) {
			return;
		}
		switch (device.kind) {
			case 'keyboard': {
				const handler = new KeyboardInput(this.clock, device.id);
				const binding: DeviceBinding = { handler, source: 'keyboard', assignedPlayer: defaultPlayerIndex };
				this.deviceBindings.set(device.id, binding);
				this.deviceBindingList.push(binding);
				this.inputControllerKeyboardHandlers.push(handler);
				return;
			}
			case 'pointer':
			case 'touch': {
				const handler = new PointerInput(this.clock, device.id);
				const binding: DeviceBinding = { handler, source: 'pointer', assignedPlayer: defaultPlayerIndex };
				this.deviceBindings.set(device.id, binding);
				this.deviceBindingList.push(binding);
				this.inputControllerPointerHandlers.push(handler);
				return;
			}
			case 'virtual':
				return;
		}
	}

	public disconnectInputDevice(deviceId: string): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		if (binding.source === 'gamepad') {
			if (binding.assignedPlayer) {
				this.getPlayerInput(binding.assignedPlayer).clearGamepad(binding.handler);
			} else {
				this.removePendingGamepadAssignment(binding.handler.gamepadIndex);
			}
			const vibrationIndex = this.pendingVibrationDevices.indexOf(binding.device);
			if (vibrationIndex >= 0) {
				this.pendingVibrationDevices.splice(vibrationIndex, 1);
			}
		}
		binding.handler.reset();
		this.deviceBindings.delete(deviceId);
		const bindingIndex = this.deviceBindingList.indexOf(binding);
		this.deviceBindingList.splice(bindingIndex, 1);
		if (binding.source === 'keyboard') {
			const handlerIndex = this.inputControllerKeyboardHandlers.indexOf(binding.handler);
			this.inputControllerKeyboardHandlers.splice(handlerIndex, 1);
		} else if (binding.source === 'pointer') {
			const handlerIndex = this.inputControllerPointerHandlers.indexOf(binding.handler);
			this.inputControllerPointerHandlers.splice(handlerIndex, 1);
		}
	}

	/**
	 * Polls the input for each player and processes gamepad assignments.
	 */
	public pollInput(): void {
		const now = this.clock.now();
		for (let index = 0; index < this.playerInputs.length; index += 1) {
			const player = this.playerInputs[index];
			player.pollInput(now);
			this.globalShortcuts.pollPlayer(player);
			const gamepadInput = player.inputHandlers['gamepad'];
			if (gamepadInput) {
				const buttonState = gamepadInput.getButtonState('start');
				if (buttonState.pressed && buttonState.presstime >= 50) {
					player.clearGamepad(gamepadInput);
					this.deviceBindings.get(gamepadInput.deviceId)!.assignedPlayer = null;
					this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(this, gamepadInput, null));
				}
			}
		}
		for (let index = 0; index < this.pendingGamepadAssignments.length; index += 1) {
			const gamepadInput = this.pendingGamepadAssignments[index].run();
			if (gamepadInput?.device.vibrationInitialization) {
				this.pendingVibrationDevices.push(gamepadInput.device);
			}
		}
	}

	public takePendingVibrationInitialization(): VibrationInitialization | null {
		const index = this.pendingVibrationDevices.length - 1;
		if (index < 0) {
			return null;
		}
		const device = this.pendingVibrationDevices[index];
		this.pendingVibrationDevices.length = index;
		return device.vibrationInitialization;
	}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.sampleInputControllerKeyWords(snapshot.keyWords);
		snapshot.pointerButtons = 0;
		snapshot.pointerXQ16 = 0;
		snapshot.pointerYQ16 = 0;
		snapshot.pointerWheelQ16 = 0;
		snapshot.rumbleSupportMask = 0;
		for (let i = 0; i < this.inputControllerPointerHandlers.length; i += 1) {
			this.inputControllerPointerHandlers[i].writeInputControllerPointerSnapshot(snapshot);
		}
		for (let pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
			this.samplePadSnapshot(pad, snapshot);
		}
	}

	public supervisorRequestLineHigh(): boolean {
		return this.supervisorRequestLine;
	}

	private sampleInputControllerKeyWords(keyWords: Uint32Array): void {
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			keyWords[i] = 0;
		}
		for (let i = 0; i < this.inputControllerKeyboardHandlers.length; i += 1) {
			this.inputControllerKeyboardHandlers[i].writeInputControllerKeyWords(keyWords);
		}
	}

	private samplePadSnapshot(pad: number, snapshot: InputControllerSnapshot): void {
		const padSnapshot = snapshot.pads[pad];
		padSnapshot.buttons = 0;
		for (let axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
			padSnapshot.axesQ16[axis] = 0;
		}
		const handler = this.playerInputs[pad].inputHandlers['gamepad'];
		if (!handler) return;
		if (handler.supportsVibrationEffect) {
			snapshot.rumbleSupportMask = (snapshot.rumbleSupportMask | (1 << pad)) >>> 0;
		}
		handler.writeInputControllerPadSnapshot(padSnapshot);
	}

	public getGlobalShortcutRegistry(): GlobalShortcutRegistry {
		return this.globalShortcuts;
	}

	/**
	 * Returns the first available player index for gamepad assignment starting from a specified index.
	 * A player is considered available if there is a connected gamepad that is not already assigned to a player.
	 *
	 * @param from The index to start searching from. Defaults to 1.
	 * @returns The first available player index for gamepad assignment, or null if none is available.
	 */
	public getFirstAvailablePlayerIndexForGamepadAssignment(from: number = 1, reverse: boolean = false): number {
		if (reverse) {
			for (let i = from; i >= 1; i--) {
				if (this.isPlayerIndexAvailableForGamepadAssignment(i)) return i;
			}
		}
		else {
			for (let i = from; i <= Input.PLAYERS_MAX; i++) {
				if (this.isPlayerIndexAvailableForGamepadAssignment(i)) return i;
			}
		}
		return null;
	}

	/**
	 * Checks if the specified player index is available for gamepad assignment.
	 * @param playerIndex - The player index to check.
	 * @returns `true` if the player index is available for gamepad assignment, `false` otherwise.
	 */
	public isPlayerIndexAvailableForGamepadAssignment(playerIndex: number): boolean {
		const playerInput = this.getPlayerInput(playerIndex);
		return (!playerInput.inputHandlers['gamepad'] && !this.pendingGamepadAssignments.some(pending => pending.proposedPlayerIndex === playerInput.playerIndex));
	}

	/**
	 * Adds a pending gamepad assignment.
	 *
	 * @param gamepad - The gamepad waiting to be assigned.
	 */
	/**
	 * Remove a pending gamepad assignment.
	 *
	 * @param gamepad - The gamepad waiting to be assigned.
	 */
	public removePendingGamepadAssignment(gamepadIndex: number): void {
		const index = this.pendingGamepadAssignments.findIndex(pending => pending.inputHandler.gamepadIndex === gamepadIndex);
		if (index !== -1) {
			this.pendingGamepadAssignments.splice(index, 1);
		}
	}

	/**
	 * Assigns a gamepad to a player.
	 *
	 * @param gamepad The gamepad to assign.
	 * @param playerIndex The index of the player.
	 */
	public assignGamepadToPlayer(gamepad: GamepadInput, playerIndex: number): void {
		const player = this.getPlayerInput(playerIndex);
		player.assignGamepadToPlayer(gamepad);
		this.deviceBindings.get(gamepad.deviceId)!.assignedPlayer = playerIndex;
	}
}
