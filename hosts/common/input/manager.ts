import { GamepadInput } from './gamepad';
import type { ButtonId, ButtonState, InputHandler, InputMap, InputSource, KeyboardInputMapping, KeyOrButtonId2ButtonState } from './models';
import { KeyboardInput } from './keyboard';
import { GlobalShortcutRegistry } from './shortcuts';

import { PendingAssignmentProcessor } from './host/assignment_processor';
import { PlayerInput } from './player';
import { PointerInput } from './pointer';
import type { HostClock } from '../clock';
import type { DeviceKind, GamepadDevice, InputDevice, InputEventSink, InputHub } from './contracts';
import {
	INPUT_CONTROLLER_KEY_WORD_COUNT,
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	INPUT_CONTROLLER_PAD_COUNT,
	type InputControllerInputSource,
	type InputControllerSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';

const EMPTY_BUTTON_STATE_PATCH: Readonly<Partial<ButtonState>> = Object.freeze({});

/**
 * Resets the properties of an object by deleting all keys except for the ones specified in the `except` array.
 * If no `except` array is provided, all keys will be deleted.
 * Used for resetting the UI of the onscreen gamepad for events such as button releases.
 *
 * @param obj - The object to reset.
 * @param except - An optional array of keys to exclude from deletion.
 */
export function resetObject(obj: any, except?: string[]) {
	for (const key in obj) {
		if (!except || !except.includes(key)) {
			delete obj[key];
		}
	}
};

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

type DeviceBinding = {
	handler: InputHandler;
	source: InputSource;
	assignedPlayer: number;
	device: InputDevice;
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
	private readonly inputControllerKeyboardHandlers: InputHandler[] = [];
	private readonly inputControllerPointerHandlers: InputHandler[] = [];
	public startupGamepadIndex = -1;

	/**
	 * Represents an array of pending gamepad assignments.
	 * @see PendingAssignmentProcessor
	 */
	public pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

	private unsubscribeHostInput: (() => void) | null = null;
	private pendingVibrationDevice: GamepadDevice = null;
	private nextHostPressId = 1;
	private readonly hostPressIds = new Map<string, Map<string, number>>();
	public resetInput(): void {
		this.supervisorRequestLine = false;
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
		private readonly inputHub: InputHub,
		startingGamepadIndex: number,
	) {
		this.startupGamepadIndex = startingGamepadIndex;
		for (let index = 0; index < Input.PLAYERS_MAX; index += 1) {
			this.playerInputs[index] = new PlayerInput(index + 1, this.frameDurationMs);
		}
		this.globalShortcuts = new GlobalShortcutRegistry(this);
		const defaultPlayerIndex = Input.DEFAULT_KEYBOARD_PLAYER_INDEX;
		const player = this.getPlayerInput(defaultPlayerIndex);
		const keyboard = new KeyboardInput(this.clock, 'keyboard:0');
		const pointer = new PointerInput(this.clock, 'pointer:0');
		player.inputHandlers['keyboard'] = keyboard;
		player.inputHandlers['pointer'] = pointer;
		const keyboardBinding: DeviceBinding = { handler: keyboard, source: 'keyboard', assignedPlayer: defaultPlayerIndex, device: null };
		const pointerBinding: DeviceBinding = { handler: pointer, source: 'pointer', assignedPlayer: defaultPlayerIndex, device: null };
		this.deviceBindings.set('keyboard:0', keyboardBinding);
		this.deviceBindings.set('pointer:0', pointerBinding);
		this.deviceBindingList.push(keyboardBinding, pointerBinding);
		this.inputControllerKeyboardHandlers.push(keyboard);
		this.inputControllerPointerHandlers.push(pointer);
		this.inputHub.setKeyboardCapture(this.shouldCaptureKey);
		this.attachToHostInput();
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
		this.detachFromHostInput();
		this.inputControllerKeyboardHandlers.length = 0;
		this.inputControllerPointerHandlers.length = 0;
		this.debugHotkeysPaused = false;
		this.supervisorRequestLine = false;
		this.additionalCaptureKeys.clear();
	}

	public setSupervisorRequestLine(down: boolean): void {
		this.supervisorRequestLine = down;
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
		this.routeButtonEvent(binding, deviceId, code, down, value, timestamp, pressId);
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

	private attachToHostInput(): void {
		if (this.unsubscribeHostInput) {
			const previous = this.unsubscribeHostInput;
			this.unsubscribeHostInput = null;
			previous();
		}
		const hub = this.inputHub;
		const devices = hub.devices();
		for (let i = 0; i < devices.length; i++) {
			this.registerHostDevice(devices[i]);
		}
		this.unsubscribeHostInput = hub.subscribe(this);
	}

	private detachFromHostInput(): void {
		if (!this.unsubscribeHostInput) return;
		const unsubscribe = this.unsubscribeHostInput;
		this.unsubscribeHostInput = null;
		unsubscribe();
	}

	private registerHostDevice(device: InputDevice): void {
		const existing = this.deviceBindings.get(device.id);
		if (existing) {
			existing.device = device;
			if (device.kind === 'gamepad') {
				const handler = existing.handler as GamepadInput;
				handler.device = device;
			}
			return;
		}
		this.connectInputDevice(device);
	}

	private routeButtonEvent(
		binding: DeviceBinding,
		deviceId: string,
		code: string,
		down: boolean,
		value: number,
		timestamp: number,
		hostPressId: number,
	): void {
		const pressId = this.resolveHostPressId(deviceId, code, down, hostPressId);
		switch (binding.source) {
			case 'keyboard': {
				const handler = binding.handler as KeyboardInput;
				if (down) handler.keydown(code); else handler.keyup(code);
				break;
			}
			case 'pointer': {
				const handler = binding.handler as PointerInput;
				handler.ingestButton(code, down, value, timestamp, pressId);
				break;
			}
			case 'gamepad': {
				const handler = binding.handler as GamepadInput;
				handler.ingestButton(code, down, value, timestamp, pressId);
				break;
			}
		}
	}

	private resolveHostPressId(deviceId: string, code: string, down: boolean, hostPressId: number): number {
		if (hostPressId) {
			return hostPressId;
		}
		if (down) {
			const pressId = this.nextHostPressId;
			this.nextHostPressId += 1;
			let devicePressIds = this.hostPressIds.get(deviceId);
			if (!devicePressIds) {
				devicePressIds = new Map();
				this.hostPressIds.set(deviceId, devicePressIds);
			}
			devicePressIds.set(code, pressId);
			return pressId;
		}
		const devicePressIds = this.hostPressIds.get(deviceId)!;
		const pressId = devicePressIds.get(code)!;
		devicePressIds.delete(code);
		return pressId;
	}

	private routeAxis1(binding: DeviceBinding, code: string, x: number, timestamp: number): void {
		if (binding.source === 'pointer') {
			const handler = binding.handler as PointerInput;
			handler.ingestAxis1(code, x, timestamp);
		}
	}

	private routeAxis2(binding: DeviceBinding, code: string, x: number, y: number, timestamp: number): void {
		if (binding.source === 'pointer') {
			const handler = binding.handler as PointerInput;
			handler.ingestAxis2(code, x, y, timestamp);
			return;
		}
		if (binding.source === 'gamepad') {
			const handler = binding.handler as GamepadInput;
			handler.ingestAxis2(code, x, y, timestamp);
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
				if (device.vibrationInitializationRequired) {
					this.pendingVibrationDevice = device;
				}
			} else {
				this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(this, handler, null));
			}
			return;
		}
		if (!this.deviceBindings.has(device.id)) {
			const source = this.inferSourceFromKind(device.kind);
				if (source === 'keyboard') {
					const handler = new KeyboardInput(this.clock, device.id);
					const binding: DeviceBinding = { handler, source: 'keyboard', assignedPlayer: defaultPlayerIndex, device };
					this.deviceBindings.set(device.id, binding);
					this.deviceBindingList.push(binding);
					this.inputControllerKeyboardHandlers.push(handler);
				} else if (source === 'pointer') {
					const handler = new PointerInput(this.clock, device.id);
					const binding: DeviceBinding = { handler, source: 'pointer', assignedPlayer: defaultPlayerIndex, device };
					this.deviceBindings.set(device.id, binding);
					this.deviceBindingList.push(binding);
					this.inputControllerPointerHandlers.push(handler);
				}
			}
	}

	private inferSourceFromKind(kind: DeviceKind): InputSource {
		switch (kind) {
			case 'keyboard': return 'keyboard';
			case 'pointer':
			case 'touch': return 'pointer';
			default: return 'gamepad';
		}
	}

	private detachInputControllerHandler(list: InputHandler[], handler: InputHandler): void {
		const index = list.indexOf(handler);
		if (index >= 0) list.splice(index, 1);
	}

	public disconnectInputDevice(deviceId: string): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		if (binding.source === 'gamepad') {
			const handler = binding.handler as GamepadInput;
			if (binding.assignedPlayer) {
				this.getPlayerInput(binding.assignedPlayer).clearGamepad(handler);
			} else {
				this.removePendingGamepadAssignment(handler.gamepadIndex);
			}
		}
		binding.handler.reset();
		this.deviceBindings.delete(deviceId);
		const bindingIndex = this.deviceBindingList.indexOf(binding);
		this.deviceBindingList.splice(bindingIndex, 1);
		if (binding.source === 'keyboard') {
			this.detachInputControllerHandler(this.inputControllerKeyboardHandlers, binding.handler);
		} else if (binding.source === 'pointer') {
			this.detachInputControllerHandler(this.inputControllerPointerHandlers, binding.handler);
		}
	}

	private getBindingForHandler(handler: InputHandler): DeviceBinding {
		for (let i = 0; i < this.deviceBindingList.length; i += 1) {
			const binding = this.deviceBindingList[i];
			if (binding.handler === handler) return binding;
		}
		return undefined;
	}

	/**
	 * Polls the input for each player and processes gamepad assignments.
	 */
	public pollInput(): GamepadDevice | null {
		const now = this.clock.now();
		this.inputHub.poll(now);
		for (let index = 0; index < this.playerInputs.length; index += 1) {
			const player = this.playerInputs[index];
			player.pollInput(now);
			this.globalShortcuts.pollPlayer(player);
			const gamepadInput = player.inputHandlers['gamepad'];
			if (gamepadInput) {
				const buttonState = gamepadInput.getButtonState('start');
				if (buttonState.pressed && buttonState.presstime >= 50) {
					gamepadInput.reset();
					player.inputHandlers['gamepad'] = null;
					this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(this, gamepadInput, null));
				}
			}
		}
		if (this.pendingVibrationDevice) {
			const device = this.pendingVibrationDevice;
			this.pendingVibrationDevice = null;
			return device;
		}
		for (let index = 0; index < this.pendingGamepadAssignments.length; index += 1) {
			const gamepadInput = this.pendingGamepadAssignments[index].run();
			if (gamepadInput?.device.vibrationInitializationRequired) {
				return gamepadInput.device;
			}
		}
		return null;
	}

	public sampleInputControllerSnapshot(snapshot: InputControllerSnapshot): void {
		this.sampleInputControllerKeyWords(snapshot.keyWords);
		snapshot.pointerButtons = 0;
		snapshot.pointerX = 0;
		snapshot.pointerY = 0;
		snapshot.pointerWheel = 0;
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
			padSnapshot.axes[axis] = 0;
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
	public assignGamepadToPlayer(gamepad: InputHandler, playerIndex: number): void {
		const player = this.getPlayerInput(playerIndex);
		player.assignGamepadToPlayer(gamepad);
		const binding = this.getBindingForHandler(gamepad);
		if (binding) {
			binding.assignedPlayer = playerIndex;
		}
	}
}
