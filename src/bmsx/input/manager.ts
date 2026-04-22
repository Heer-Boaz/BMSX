import { $ } from '../core/engine';
import type { Identifier, RegisterablePersistent } from '../rompack/format';
import { GamepadInput } from './gamepad';
import type { ActionState, ButtonId, ButtonState, GamepadInputMapping, InputEvent, InputHandler, InputMap, KeyboardInputMapping, KeyOrButtonId2ButtonState, PointerInputMapping } from './models';
import { KeyboardInput } from './keyboard';
import { OnscreenGamepad } from './onscreen_gamepad';
import { GlobalShortcutRegistry } from './shortcuts';

import { PendingAssignmentProcessor } from './assignment_processor';
import { PlayerInput, InputSource } from './player';
import { PointerInput } from './pointer';
import type { DeviceKind, InputDevice, InputEvt, SubscriptionHandle, GameViewCanvas } from '../platform';

const EMPTY_BUTTON_STATE_PATCH: Readonly<Partial<ButtonState>> = Object.freeze({});
const EMPTY_ACTION_STATE_PATCH: Readonly<Partial<ActionState>> = Object.freeze({});

/**
 * Resets the properties of an object by deleting all keys except for the ones specified in the `except` array.
 * If no `except` array is provided, all keys will be deleted.
 * Used for resetting the UI of the onscreen gamepad for events such as button releases.
 *
 * @param obj - The object to reset.
 * @param except - An optional array of keys to exclude from deletion.
 */
export function resetObject(obj: any, except?: string[]) {
	Object.keys(obj).forEach(key => {
		if (!except || !except.includes(key)) {
			delete obj[key];
		}
	});
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
	const state = stateMap[keyOrButtonId];
	if (!state) return makeButtonState();
	return {
		pressed: state.pressed ?? false,
		justpressed: state.justpressed ?? false,
		justreleased: state.justreleased ?? false,
		waspressed: state.waspressed ?? false,
		wasreleased: state.wasreleased ?? false,
		repeatpressed: state.repeatpressed ?? false,
		repeatcount: state.repeatcount ?? 0,
		consumed: state.consumed ?? false,
		presstime: state.presstime,
		timestamp: state.timestamp,
		pressedAtMs: state.pressedAtMs,
		releasedAtMs: state.releasedAtMs,
		pressId: state.pressId,
		value: state.value,
		value2d: state.value2d,
	};
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
		timestamp = $.platform.clock.now(),
		pressedAtMs = null,
		releasedAtMs = null,
		pressId = null,
		value = null,
		value2d = null,
	} = partialState ?? EMPTY_BUTTON_STATE_PATCH;
	return { pressed, justpressed, justreleased, waspressed, wasreleased, repeatpressed, repeatcount, consumed, presstime, timestamp, pressedAtMs, releasedAtMs, pressId, value, value2d };
}

export function makeActionState(actionname: string, partialState?: Partial<ActionState>): ActionState {
	const {
		action = actionname,
		alljustpressed = false,
		allwaspressed = false,
		alljustreleased = false,
		guardedjustpressed = false,
		repeatpressed = false,
		repeatcount = 0,
		...buttonState
	} = partialState ?? EMPTY_ACTION_STATE_PATCH;
	return {
		action,
		alljustpressed,
		allwaspressed,
		alljustreleased,
		guardedjustpressed,
		repeatpressed,
		repeatcount,
		...makeButtonState(buttonState),
	};
}

type BufferedInputEvent = InputEvent & {
	frame: number;
};

type BufferedEdgeRecord = {
	edgeId: number;
	frame: number;
	consumed: boolean;
};

const RECENT_BUFFERED_EDGE_FRAMES = 2;

type DeviceBinding = {
	handler: InputHandler;
	source: InputSource;
	assignedPlayer: number;
	device: InputDevice;
};

/**
 * Manages the input state for a player, including button states and input events.
 *
 * The `InputStateManager` class is responsible for tracking the state of input buttons,
 * processing input events, and maintaining an input buffer. It provides methods to update
 * the state based on current time, retrieve button states, and consume button presses.
 */

export class InputStateManager {
	/**
	 * Represents the input buffer used for processing input data.
	 * @type {InputBuffer}
	 */
	private inputBuffer: BufferedInputEvent[];
	private readonly buttonStates = new Map<ButtonId, ButtonState>();
	private readonly bufferedPressEdges = new Map<ButtonId, BufferedEdgeRecord>();
	private readonly bufferedReleaseEdges = new Map<ButtonId, BufferedEdgeRecord>();
	private readonly pendingFrameStates = new Map<ButtonId, ButtonState>();
	private currentFrame = 0;

	/**
	 * Constructs an instance of the InputStateManager.
	 *
	 * @param bufferframeDuration - The number of simulation frames for which input events are buffered.
	 * This value determines how long input events are retained in the buffer before being cleaned up.
	 */
	constructor(public bufferframeDuration: number = 150) {
		this.inputBuffer = [];
	}

	public get frame(): number {
		return this.currentFrame;
	}

	/** Prepare per-button edge flags for a new frame. */
	beginFrame(currentTime: number): void {
		this.currentFrame += 1;
		for (const state of this.buttonStates.values()) {
			state.justpressed = false;
			state.justreleased = false;
			state.consumed = state.consumed ?? false;
			if (state.pressed) {
				const pressedAt = state.pressedAtMs ?? state.timestamp ?? currentTime;
				state.presstime = Math.max(0, currentTime - pressedAt);
			} else {
				state.presstime = null;
			}
		}
	}

	/**
	 * Updates the input state based on the current time.
	 * Cleans up old events from the input buffer used for windowed queries.
	 */
	update(_currentTime: number): void {
		let write = 0;
		for (let read = 0; read < this.inputBuffer.length; read += 1) {
			const event = this.inputBuffer[read];
			if (this.isBufferedEventInWindow(event, this.bufferframeDuration)) {
				this.inputBuffer[write++] = event;
			}
		}
		this.inputBuffer.length = write;
		this.pruneBufferedEdges(this.bufferedPressEdges);
		this.pruneBufferedEdges(this.bufferedReleaseEdges);
	}

	/**
	 * Adds an input event to the input buffer and updates the immediate button state cache.
	 *
	 * @param event - The input event to be added.
	 */
	addInputEvent(event: InputEvent): void {
		const bufferedEvent: BufferedInputEvent = {
			...event,
			frame: this.currentFrame + 1,
		};
		if (bufferedEvent.eventType === 'press') {
			this.inputBuffer.push(bufferedEvent);
			this.bufferEdge(this.bufferedPressEdges, bufferedEvent);
		} else {
			this.inputBuffer.push(bufferedEvent);
			this.bufferEdge(this.bufferedReleaseEdges, bufferedEvent);
		}
	}

	recordAxis1Sample(identifier: ButtonId, value: number, timestamp: number): void {
		const state = this.pendingFrameStates.get(identifier) ?? makeButtonState();
		if (identifier === 'pointer_wheel') {
			const accumulated = (state.value ?? 0) + value;
			state.value = accumulated;
			state.pressed = accumulated !== 0;
			state.justpressed = accumulated !== 0;
			state.timestamp = timestamp;
			state.pressedAtMs = state.pressedAtMs ?? timestamp;
			state.consumed = false;
		} else {
			const magnitude = Math.abs(value);
			state.value = value;
			state.pressed = magnitude > 0;
			state.justpressed = state.justpressed || magnitude > 0;
			state.timestamp = timestamp;
			if (magnitude > 0) {
				state.pressedAtMs = state.pressedAtMs ?? timestamp;
			}
			state.consumed = false;
		}
		this.pendingFrameStates.set(identifier, state);
	}

	recordAxis2Sample(identifier: ButtonId, x: number, y: number, timestamp: number): void {
		const state = this.pendingFrameStates.get(identifier) ?? makeButtonState();
		if (identifier === 'pointer_delta') {
			let value2d = state.value2d;
			if (value2d === undefined || value2d === null) {
				value2d = [0, 0];
				state.value2d = value2d;
			}
			value2d[0] += x;
			value2d[1] += y;
			const nextX = value2d[0];
			const nextY = value2d[1];
			state.value = Math.hypot(nextX, nextY);
			state.pressed = state.value > 0;
			state.justpressed = state.justpressed || state.pressed;
			state.timestamp = timestamp;
			state.pressedAtMs = state.pressedAtMs ?? timestamp;
			state.consumed = false;
		} else if (identifier === 'pointer_position') {
			state.value2d = [x, y];
			state.value = Math.hypot(x, y);
			state.timestamp = timestamp;
			state.consumed = false;
		} else {
			state.value2d = [x, y];
			state.value = Math.hypot(x, y);
			state.pressed = state.value > 0;
			state.justpressed = state.justpressed || state.pressed;
			state.timestamp = timestamp;
			if (state.pressed) {
				state.pressedAtMs = state.pressedAtMs ?? timestamp;
			}
			state.consumed = false;
		}
		this.pendingFrameStates.set(identifier, state);
	}

	latchButtonState(identifier: ButtonId, rawState: ButtonState, currentTime: number): void {
		let state = this.buttonStates.get(identifier);
		if (!state) {
			state = makeButtonState();
			this.buttonStates.set(identifier, state);
		}
		const pending = this.pendingFrameStates.get(identifier);
		const bufferedPress = this.getBufferedEdgeRecord(this.bufferedPressEdges, identifier, 1);
		const bufferedRelease = this.getBufferedEdgeRecord(this.bufferedReleaseEdges, identifier, 1);
		const previousPressed = state.pressed;
		const nextPressed = pending?.pressed ?? rawState.pressed ?? false;
		const nextTimestamp = pending?.timestamp ?? rawState.timestamp ?? state.timestamp ?? currentTime;
		const nextPressId = rawState.pressId ?? state.pressId ?? pending?.pressId;
		const nextPressedAtMs = nextPressed
			? (rawState.pressedAtMs ?? pending?.pressedAtMs ?? state.pressedAtMs ?? nextTimestamp)
			: null;
		const nextReleasedAtMs = nextPressed
			? null
			: (rawState.releasedAtMs ?? state.releasedAtMs ?? (bufferedRelease ? nextTimestamp : null));
		const nextConsumed = nextPressed && state.consumed;
		state.pressed = nextPressed;
		state.justpressed = bufferedPress != null || !!pending?.justpressed && !previousPressed;
		state.justreleased = bufferedRelease != null || !!pending?.justreleased && previousPressed;
		state.consumed = nextConsumed;
		state.timestamp = nextTimestamp;
		state.pressedAtMs = nextPressedAtMs;
		state.releasedAtMs = nextReleasedAtMs;
		state.pressId = nextPressId;
		state.value = pending?.value ?? rawState.value ?? (nextPressed ? 1 : 0);
		state.value2d = pending?.value2d ?? rawState.value2d;
		state.presstime = nextPressed
			? Math.max(0, currentTime - (nextPressedAtMs ?? nextTimestamp))
			: null;
		this.pendingFrameStates.delete(identifier);
	}

	/**
	 * Retrieves the current state of a button based on its identifier.
	 *
	 * @param identifier - The unique identifier for the button, which can be a string or a number.
	 * @param framewindow - Optional number of frames for windowed evaluation.
	 * @returns The current button state including edge flags and windowed history.
	 */
	getButtonState(identifier: ButtonId, framewindow?: number): ButtonState {
		const window = framewindow != null
			? framewindow
			: this.bufferframeDuration;
		const currentTime = $.platform.clock.now();
		const baseState = this.buttonStates.get(identifier);
		const pressed = baseState?.pressed ?? false;
		const justpressed = !!baseState?.justpressed || this.getBufferedEdgeRecord(this.bufferedPressEdges, identifier, 1) != null;
		const justreleased = !!baseState?.justreleased || this.getBufferedEdgeRecord(this.bufferedReleaseEdges, identifier, 1) != null;
		const presstime = baseState?.presstime ?? (pressed && baseState?.pressedAtMs != null ? Math.max(0, currentTime - baseState.pressedAtMs) : null);
		let consumed = baseState?.consumed ?? false;
		const pressedAtMs = baseState?.pressedAtMs;
		const releasedAtMs = baseState?.releasedAtMs;
		const timestamp = baseState?.timestamp;
		const pressId = baseState?.pressId;
		const value = baseState?.value ?? (pressed ? 1 : 0);
		const value2d = baseState?.value2d;

		const inputEvents = this.inputBuffer.filter(event => event.identifier === identifier && event.frame <= this.currentFrame && this.isBufferedEventInWindow(event, window));
		let waspressed = pressed;
		let wasreleased = justreleased;
		for (let i = 0; i < inputEvents.length; ++i) {
			const event = inputEvents[i];
			if (event.eventType === 'press') {
				waspressed = true;
			}
			if (event.eventType === 'release') {
				wasreleased = true;
			}
			if (event.consumed && (pressId == null || event.pressId === pressId)) consumed = true;
		}

		return makeButtonState({
			pressed,
			justpressed,
			justreleased,
			waspressed,
			wasreleased,
			consumed,
			presstime,
			timestamp,
			pressedAtMs,
			releasedAtMs,
			pressId,
			value,
			value2d,
		});
	}

	/** Returns true if an unconsumed press edge happened recently. */
	hasUnconsumedPress(identifier: ButtonId, windowFrames: number = RECENT_BUFFERED_EDGE_FRAMES): boolean {
		for (let i = this.inputBuffer.length - 1; i >= 0; i -= 1) {
			const event = this.inputBuffer[i];
			if (event.frame > this.currentFrame) {
				continue;
			}
			if (!this.isBufferedEventInWindow(event, windowFrames)) {
				break;
			}
			if (event.identifier !== identifier) {
				continue;
			}
			if (event.eventType === 'press' && !event.consumed) {
				return true;
			}
		}
		return false;
	}

	private getLatestUnconsumedEdgeId(
		identifier: ButtonId,
		eventType: 'press' | 'release'
	): number | undefined {
		const edgeMap = eventType === 'press'
			? this.bufferedPressEdges
			: this.bufferedReleaseEdges;
		return this.getBufferedEdgeRecord(edgeMap, identifier, RECENT_BUFFERED_EDGE_FRAMES)?.edgeId;
	}

	private isBufferedEventInWindow(event: BufferedInputEvent, windowFrames: number): boolean {
		return this.isBufferedFrameInWindow(event.frame, windowFrames);
	}

	private isBufferedFrameInWindow(frame: number, windowFrames: number): boolean {
		if (windowFrames <= 0) {
			return false;
		}
		return this.currentFrame - frame < windowFrames;
	}

	private bufferEdge(edgeMap: Map<ButtonId, BufferedEdgeRecord>, event: BufferedInputEvent): void {
		if (event.pressId == null) {
			return;
		}
		edgeMap.set(event.identifier, {
			edgeId: event.pressId,
			frame: event.frame,
			consumed: event.consumed,
		});
	}

	private getBufferedEdgeRecord(
		edgeMap: Map<ButtonId, BufferedEdgeRecord>,
		identifier: ButtonId,
		windowFrames: number
	): BufferedEdgeRecord | null {
		const edge = edgeMap.get(identifier);
		if (!edge) {
			return null;
		}
		if (edge.consumed) {
			return null;
		}
		if (edge.frame > this.currentFrame) {
			return null;
		}
		if (!this.isBufferedFrameInWindow(edge.frame, windowFrames)) {
			return null;
		}
		return edge;
	}

	private consumeBufferedEdge(edgeMap: Map<ButtonId, BufferedEdgeRecord>, identifier: ButtonId, pressId?: number): void {
		const edge = edgeMap.get(identifier);
		if (!edge) {
			return;
		}
		if (pressId == null || edge.edgeId === pressId) {
			edge.consumed = true;
		}
	}

	private pruneBufferedEdges(edgeMap: Map<ButtonId, BufferedEdgeRecord>): void {
		for (const [identifier, edge] of edgeMap) {
			if (!this.isBufferedFrameInWindow(edge.frame, this.bufferframeDuration)) {
				edgeMap.delete(identifier);
			}
		}
	}

	public getLatestUnconsumedPressId(identifier: ButtonId): number | undefined {
		return this.getLatestUnconsumedEdgeId(identifier, 'press');
	}

	public getLatestUnconsumedReleaseId(identifier: ButtonId): number | undefined {
		return this.getLatestUnconsumedEdgeId(identifier, 'release');
	}

	public hasTrackedButton(identifier: ButtonId): boolean {
		return this.buttonStates.has(identifier);
	}

	/**
	 * Marks the specified button as consumed, preventing further interactions.
	 *
	 * @param identifier - The unique identifier of the button, which can be a string or a number.
	 * If the button state exists, it will be marked as consumed.
	 */
	consumeBufferedEvent(identifier: ButtonId, pressId?: number): void {
		for (const event of this.inputBuffer) {
			if (event.identifier === identifier && (pressId == null || event.pressId === pressId)) {
				event.consumed = true;
			}
		}
		this.consumeBufferedEdge(this.bufferedPressEdges, identifier, pressId);
		this.consumeBufferedEdge(this.bufferedReleaseEdges, identifier, pressId);
		const state = this.buttonStates.get(identifier);
		if (state) {
			state.consumed = true;
		}
	}

	/** Clears transient edge flags and buffered events without discarding held state. */
	resetEdgeState(): void {
		for (const state of this.buttonStates.values()) {
			state.justpressed = false;
			state.justreleased = false;
			state.consumed = false;
			if (!state.pressed) {
				state.presstime = null;
				state.pressedAtMs = null;
				state.pressId = null;
				state.value = 0;
				state.value2d = null;
			}
		}
		this.inputBuffer = [];
		this.bufferedPressEdges.clear();
		this.bufferedReleaseEdges.clear();
		this.pendingFrameStates.clear();
		this.currentFrame = 0;
	}
}

/**
 * Represents the Input class, which manages player inputs and gamepad assignments.
 * Implements the singleton pattern to ensure only one instance exists.
 */
export class Input implements RegisterablePersistent {
	get registrypersistent(): true {
		return true;
	}

	/**
	 * Represents the singleton instance of the Input class.
	 */
	private static _instance: Input;

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
	 * The default player index for the on-screen gamepad. Maps to player 1.
	 */
	public static readonly DEFAULT_ONSCREENGAMEPAD_PLAYER_INDEX = 1;

	/**
	 * Gets the singleton instance of the Input class.
	 * If the instance does not exist, it creates a new one.
	 * @returns The singleton instance of the Input class.
	 */
	public static initialize(startingGamepadIndex?: number): Input {
		if (Input._instance) {
			if (typeof startingGamepadIndex === 'number') {
				Input._instance.startupGamepadIndex = startingGamepadIndex;
			}
			return Input._instance;
		}
		Input._instance = new Input(startingGamepadIndex);
		return Input._instance;
	}

	public static get instance(): Input {
		if (!Input._instance) {
			throw new Error('[Input] Input system has not been initialised. Call Input.initialize() first.');
		}
		return Input._instance;
	}

	/**
	 * An array of player inputs for each player.
	 * The Player 1 input is at index 0, Player 2 input is at index 1, and so on.
	 * @see PlayerInput
	 */
	private playerInputs: PlayerInput[] = [];

	private readonly deviceBindings = new Map<string, DeviceBinding>();
	public startupGamepadIndex: number = null;

	/**
	 * Represents an array of pending gamepad assignments.
	 * @see PendingAssignmentProcessor
	 */
	public pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

	/**
	 * Represents the onscreen gamepad.
	 * @see OnscreenGamepad
	 */
	private onscreenGamepad: OnscreenGamepad = null;

	private platformInputUnsubscribe: SubscriptionHandle = null;
	private focusChangeUnsubscribe: SubscriptionHandle = null;
	private nextPlatformPressId = 1;
	private readonly platformPressIds = new Map<string, Map<string, number>>();
	private readonly platformInputListener = (event: InputEvt): void => {
		this.handleInputEvent(event);
	};
	private readonly handleFocusChange = (_focused: boolean): void => {
		for (let i = 0; i < this.playerInputs.length; i++) {
			const player = this.playerInputs[i];
			if (!player) continue;
			player.reset();
		}
		const iterator = this.deviceBindings.values();
		for (let current = iterator.next(); !current.done; current = iterator.next()) {
			const binding = current.value;
			if (binding.assignedPlayer !== null) continue;
			binding.handler.reset();
		}
	};

	private debugHotkeysEnabled = false;
	public debugHotkeysPaused = false;
	private gameplayCaptureEnabled = true;
	private readonly additionalCaptureKeys: Set<string> = new Set();
	private readonly globalShortcuts = new GlobalShortcutRegistry();

	/**
	 * Retrieves the player input for the specified player index.
	 * @param playerIndex - The index of the player.
	 * @returns The player input object for the specified player index.
	 * @throws Error if the player index is out of range.
	 */
	public getPlayerInput(playerIndex: number): PlayerInput {
		let index = playerIndex - 1;
		if (index < 0 || index > Input.PLAYER_MAX_INDEX) {
			// throw new Error(`Player index ${playerIndex} is out of range, should be between 1 and ${Input.PLAYERS_MAX}.`);
			index = 1;
		}
		if (!this.playerInputs[index]) {
			this.playerInputs[index] = new PlayerInput(playerIndex);
		}
		return this.playerInputs[index];
	}

	/**
	 * Hides the specified buttons.
	 * @param gamepad_button_ids An array of button names to hide.
	 * @throws Error if no element is found matching a button name in the array of buttons.
	 */
	public hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void {
		OnscreenGamepad.hideButtons(gamepad_button_ids);
	}

	/**
	 * The mapping of gamepad button names to their corresponding names.
	 * We use this mapping to get a list of all gamepad buttons.
	 * @see BGamepadButton
	 */
	public static readonly BUTTON_IDS = [
		'a', // Bottom face button
		'b', // Right face button
		'x', // Left face button
		'y', // Top face button
		'lb', // Left shoulder button
		'rb', // Right shoulder button
		'lt', // Left trigger button
		'rt', // Right trigger button
		'select', // Select button
		'start', // Start button
		'ls', // Left stick button
		'rs', // Right stick button
		'up', // D-pad up
		'down', // D-pad down
		'left', // D-pad left
		'right', // D-pad right
		'home', // Xbox button
		'touch', // Touchpad button
	] as const;

	/**
	 * The mapping of keyboard key names to their corresponding gamepad button names.
	 * We use this mapping to map keyboard keys to gamepad buttons during the polling of keyboard input and conversion to gamepad input.
	 * @see BGamepadButton
	 */
	public static readonly KEYBOARDKEY2GAMEPADBUTTON = {
		'ArrowUp': 'up',
		'ArrowLeft': 'left',
		'ArrowRight': 'right',
		'ArrowDown': 'down',
		'KeyX': 'b',
		'KeyA': 'x',
		'KeyZ': 'a',
		'ShiftLeft': 'y',
		'KeyQ': 'lb',
		'KeyW': 'rb',
		'Digit1': 'lt',
		'Digit3': 'rt',
		'ShiftRight': 'select',
		'Enter': 'start',
		'KeyF': 'ls',
		'KeyG': 'rs',
		'KeyH': 'home',
		'KeyT': 'touch'
	} as const;

	private static readonly DEFAULT_POINTER_INPUT_MAPPING: PointerInputMapping = Object.freeze({
		pointer_primary: ['pointer_primary'],
		pointer_secondary: ['pointer_secondary'],
		pointer_aux: ['pointer_aux'],
		pointer_back: ['pointer_back'],
		pointer_forward: ['pointer_forward'],
		pointer_delta: ['pointer_delta'],
		pointer_position: ['pointer_position'],
		pointer_wheel: ['pointer_wheel'],
	});

	private static readonly DEFAULT_KEYBOARD_INPUT_MAPPING: KeyboardInputMapping = Object.freeze({
		a: ['KeyX'],
		b: ['KeyC'],
		x: ['KeyZ'],
		y: ['KeyS'],
		lb: ['ShiftLeft'],
		rb: ['ShiftRight'],
		lt: ['CtrlLeft'],
		rt: ['CtrlRight'],
		select: ['Backspace'],
		start: ['Enter'],
		ls: ['KeyQ'],
		rs: ['KeyE'],
		up: ['ArrowUp'],
		down: ['ArrowDown'],
		left: ['ArrowLeft'],
		right: ['ArrowRight'],
		home: ['Escape'],
		touch: ['Space'],
	});

	private static readonly DEFAULT_GAMEPAD_INPUT_MAPPING: GamepadInputMapping = Object.freeze({
		a: ['a'],
		b: ['b'],
		x: ['x'],
		y: ['y'],
		lb: ['lb'],
		rb: ['rb'],
		lt: ['lt'],
		rt: ['rt'],
		select: ['select'],
		start: ['start'],
		ls: ['ls'],
		rs: ['rs'],
		up: ['up'],
		down: ['down'],
		left: ['left'],
		right: ['right'],
		home: ['home'],
		touch: ['touch'],
	});

	public static readonly DEFAULT_INPUT_MAPPING: InputMap = Object.freeze({
		keyboard: Input.DEFAULT_KEYBOARD_INPUT_MAPPING,
		gamepad: Input.DEFAULT_GAMEPAD_INPUT_MAPPING,
		pointer: Input.DEFAULT_POINTER_INPUT_MAPPING,
	});

	private static readonly DEBUG_CAPTURE_KEYS = new Set(['F11']);

	/**
	 * Prevents the default action of a UI event based on the key pressed, except for certain keys when the game is running or not paused.
	 * @param e The UI event to prevent the default action of.
	 * @param key The key pressed that triggered the event.
	 */

	/**
	 * Gets the unique identifier of the input, which is a static id.
	 * @returns 'input'.
	 */
	public get id(): Identifier { return 'input'; }

	/**
	 * Initializes the input system.
	 * @param debug Whether to enable debug mode. Default is true.
	 */
	constructor(startingGamepadIndex?: number) {
		this.startupGamepadIndex = typeof startingGamepadIndex === 'number' ? startingGamepadIndex : null;
		// this.bind(); // Bind is called explicitly by engine startup.
	}

	/**
	 * Checks if the onscreen gamepad is enabled.
	 * @returns {boolean} True if the onscreen gamepad is enabled, false otherwise.
	 */
	public get isOnscreenGamepadEnabled(): boolean {
		return this.onscreenGamepad !== null;
	}

	public enableOnscreenGamepad(): void {
		if (!this.onscreenGamepad) {
			this.onscreenGamepad = new OnscreenGamepad($.platform.onscreenGamepad);
		}
		this.onscreenGamepad.init();
		this.getPlayerInput(Input.DEFAULT_ONSCREENGAMEPAD_PLAYER_INDEX).inputHandlers['gamepad'] = this.onscreenGamepad;
	}

	public shouldCaptureKey(code: string): boolean {
		if (this.additionalCaptureKeys.has(code)) {
			return true;
		}
		return this.debugHotkeysEnabled && !this.debugHotkeysPaused && Input.DEBUG_CAPTURE_KEYS.has(code);
	}

	public setKeyboardCapture(code: string, enabled: boolean): void {
		if (!code) {
			throw new Error('[Input] Keyboard capture code must be a non-empty string.');
		}
		if (enabled) {
			this.additionalCaptureKeys.add(code);
		} else {
			this.additionalCaptureKeys.delete(code);
		}
	}

	/**
	 * Enables the debug mode for the game screen.
	 * Attaches event listeners to the game screen element to handle debug events.
	 */
	public enableDebugMode(_surface: GameViewCanvas): void {
		this.debugHotkeysEnabled = true;
	}

	/**
	 * Disposes the input system by removing all pending gamepad assignments,
	 * player inputs, event subscriptions, and deregistering the input system.
	 * Also removes the input instance.
	 */
	public dispose(): void {
		// Remove all pending gamepad assignments
		this.pendingGamepadAssignments = [];

		// Remove all player inputs
		this.playerInputs = [];
		if (this.onscreenGamepad) {
			this.onscreenGamepad.dispose();
			this.onscreenGamepad = null;
		}
		this.unbind();
		// Remove the input instance
		Input._instance = undefined;
		this.debugHotkeysEnabled = false;
		this.debugHotkeysPaused = false;
		this.additionalCaptureKeys.clear();
	}

	public bind(): void {
		const defaultPlayerIndex = Input.DEFAULT_KEYBOARD_PLAYER_INDEX;
		const player = this.getPlayerInput(defaultPlayerIndex);
		const keyboard = new KeyboardInput('keyboard:0');
		const pointer = new PointerInput('pointer:0');
		player.inputHandlers['keyboard'] = keyboard;
		player.inputHandlers['pointer'] = pointer;
		this.deviceBindings.set('keyboard:0', { handler: keyboard, source: 'keyboard', assignedPlayer: defaultPlayerIndex, device: null });
		this.deviceBindings.set('pointer:0', { handler: pointer, source: 'pointer', assignedPlayer: defaultPlayerIndex, device: null });
		$.platform.input.setKeyboardCapture(this.shouldCaptureKey.bind(this));
		this.attachToPlatformInput();
		this.focusChangeUnsubscribe = $.platform.gameviewHost.onFocusChange(this.handleFocusChange);
	}

	public refreshBindings(): void {
		this.attachToPlatformInput();
	}

	public setGameplayCaptureEnabled(enabled: boolean): void {
		if (this.gameplayCaptureEnabled === enabled) {
			return;
		}
		this.gameplayCaptureEnabled = enabled;
		if (!enabled) {
			for (let i = 0; i < this.playerInputs.length; i++) {
				const player = this.playerInputs[i];
				if (!player) {
					continue;
				}
				player.clearEdgeState();
			}
		}
	}

	public handleInputEvent(evt: InputEvt): void {
		if (evt.type === 'connect') {
			this.onDeviceConnected(evt.device);
			return;
		}
		if (evt.type === 'disconnect') {
			this.onDeviceDisconnected(evt.deviceId);
			return;
		}
		const binding = this.deviceBindings.get(evt.deviceId);
		if (!binding) return;
		if (evt.type === 'button') {
			this.routeButtonEvent(binding, evt);
			return;
		}
		if (evt.type === 'axis1') {
			this.routeAxis1(binding, evt);
			return;
		}
		if (evt.type === 'axis2') {
			this.routeAxis2(binding, evt);
		}
	}

	private attachToPlatformInput(): void {
		if (this.platformInputUnsubscribe) {
			const previous = this.platformInputUnsubscribe;
			this.platformInputUnsubscribe = null;
			previous.unsubscribe();
		}
		const hub = $.platform.input;
		const devices = hub.devices();
		for (let i = 0; i < devices.length; i++) {
			this.registerPlatformDevice(devices[i]);
		}
		this.platformInputUnsubscribe = hub.subscribe(this.platformInputListener);
	}

	private detachFromPlatformInput(): void {
		if (!this.platformInputUnsubscribe) return;
		const unsubscribe = this.platformInputUnsubscribe;
		this.platformInputUnsubscribe = null;
		unsubscribe.unsubscribe();
	}

	private registerPlatformDevice(device: InputDevice): void {
		const existing = this.deviceBindings.get(device.id);
		if (existing) {
			existing.device = device;
			if (existing.source === 'gamepad') {
				const handler = existing.handler as GamepadInput;
				handler.setDevice(device);
			}
			return;
		}
		this.onDeviceConnected(device);
	}

	private routeButtonEvent(binding: DeviceBinding, evt: Extract<InputEvt, { type: 'button' }>): void {
		const pressId = this.resolvePlatformPressId(evt);
		switch (binding.source) {
			case 'keyboard': {
				const handler = binding.handler as KeyboardInput;
				if (evt.down) handler.keydown(evt.code); else handler.keyup(evt.code);
				break;
			}
			case 'pointer': {
				const value = evt.value ?? (evt.down ? 1 : 0);
				const handler = binding.handler as PointerInput;
				handler.ingestButton(evt.code, makeButtonState({
					pressed: evt.down,
					justpressed: evt.down,
					justreleased: !evt.down,
					timestamp: evt.timestamp,
					pressId,
					value,
				}));
				break;
			}
			case 'gamepad': {
				const value = evt.value ?? (evt.down ? 1 : 0);
				const handler = binding.handler as GamepadInput;
				handler.ingestButton(evt.code, evt.down, value, evt.timestamp, pressId);
				break;
			}
		}
		if (this.gameplayCaptureEnabled && binding.assignedPlayer !== null) {
			this.enqueueButtonEvent(binding.assignedPlayer, binding.source, evt.code, evt.down ? 'press' : 'release', evt.timestamp, pressId);
		}
	}

	private resolvePlatformPressId(evt: Extract<InputEvt, { type: 'button' }>): number {
		if (evt.pressId !== undefined) {
			return evt.pressId;
		}
		if (evt.down) {
			const pressId = this.nextPlatformPressId;
			this.nextPlatformPressId += 1;
			let devicePressIds = this.platformPressIds.get(evt.deviceId);
			if (devicePressIds === undefined) {
				devicePressIds = new Map();
				this.platformPressIds.set(evt.deviceId, devicePressIds);
			}
			devicePressIds.set(evt.code, pressId);
			return pressId;
		}
		const devicePressIds = this.platformPressIds.get(evt.deviceId)!;
		const pressId = devicePressIds.get(evt.code)!;
		devicePressIds.delete(evt.code);
		return pressId;
	}

	private routeAxis1(binding: DeviceBinding, evt: Extract<InputEvt, { type: 'axis1' }>): void {
		if (binding.source === 'pointer') {
			const handler = binding.handler as PointerInput;
			handler.ingestAxis1(evt.code, evt.x, evt.timestamp);
			if (this.gameplayCaptureEnabled && binding.assignedPlayer !== null) {
				this.getPlayerInput(binding.assignedPlayer).recordAxis1Input('pointer', evt.code, evt.x, evt.timestamp);
			}
		}
	}

	private routeAxis2(binding: DeviceBinding, evt: Extract<InputEvt, { type: 'axis2' }>): void {
		if (binding.source === 'pointer') {
			const handler = binding.handler as PointerInput;
			handler.ingestAxis2(evt.code, evt.x, evt.y, evt.timestamp);
			if (this.gameplayCaptureEnabled && binding.assignedPlayer !== null) {
				const player = this.getPlayerInput(binding.assignedPlayer);
				player.recordAxis2Input('pointer', evt.code, evt.x, evt.y, evt.timestamp);
				const delta = handler.getButtonState('pointer_delta').value2d;
				if (delta === undefined || delta === null) {
					player.recordAxis2Input('pointer', 'pointer_delta', 0, 0, evt.timestamp);
				} else {
					player.recordAxis2Input('pointer', 'pointer_delta', delta[0], delta[1], evt.timestamp);
				}
			}
			return;
		}
		if (binding.source === 'gamepad') {
			const handler = binding.handler as GamepadInput;
			handler.ingestAxis2(evt.code, evt.x, evt.y, evt.timestamp);
			if (this.gameplayCaptureEnabled && binding.assignedPlayer !== null) {
				this.getPlayerInput(binding.assignedPlayer).recordAxis2Input('gamepad', evt.code, evt.x, evt.y, evt.timestamp);
			}
		}
	}

	private enqueueButtonEvent(playerIndex: number, source: InputSource, code: string, type: 'press' | 'release', timestamp: number, pressId?: number): void {
		const player = this.getPlayerInput(playerIndex);
		player.recordButtonEvent(source, code, { eventType: type, identifier: code, timestamp, consumed: false, pressId });
	}

	private onDeviceConnected(device: InputDevice): void {
		const defaultPlayerIndex = Input.DEFAULT_KEYBOARD_PLAYER_INDEX;
		if (device.kind === 'gamepad') {
			const handler = new GamepadInput(device.id, device.description, device);
			handler.setDevice(device);
			const binding: DeviceBinding = { handler, source: 'gamepad', assignedPlayer: null, device };
			this.deviceBindings.set(device.id, binding);
			const autoAssign = this.startupGamepadIndex !== null && device.id === `gamepad:${this.startupGamepadIndex}`;
			if (autoAssign) {
				this.startupGamepadIndex = null;
				this.assignGamepadToPlayer(handler, defaultPlayerIndex);
				void handler.init();
			} else {
				this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(handler, null));
			}
			return;
		}
		if (!this.deviceBindings.has(device.id)) {
			const source = this.inferSourceFromKind(device.kind);
			if (source === 'keyboard') {
				const handler = new KeyboardInput(device.id);
				this.deviceBindings.set(device.id, { handler, source: 'keyboard', assignedPlayer: defaultPlayerIndex, device });
			} else if (source === 'pointer') {
				const handler = new PointerInput(device.id);
				this.deviceBindings.set(device.id, { handler, source: 'pointer', assignedPlayer: defaultPlayerIndex, device });
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

	private onDeviceDisconnected(deviceId: string): void {
		const binding = this.deviceBindings.get(deviceId);
		if (!binding) return;
		if (binding.source === 'gamepad') {
			const handler = binding.handler as GamepadInput;
			if (binding.assignedPlayer !== null) {
				const player = this.getPlayerInput(binding.assignedPlayer);
				player.clearGamepad(handler);
			} else {
				this.removePendingGamepadAssignment(handler.gamepadIndex);
			}
			handler.dispose();
		}
		binding.handler.reset();
		this.deviceBindings.delete(deviceId);
	}

	private getBindingForHandler(handler: InputHandler): DeviceBinding {
		for (const value of this.deviceBindings.values()) {
			if (value.handler === handler) return value;
		}
		return undefined;
	}

	public unbind(): void {
		this.detachFromPlatformInput();
		if (this.focusChangeUnsubscribe) {
			const unsubscribe = this.focusChangeUnsubscribe;
			this.focusChangeUnsubscribe = null;
			unsubscribe.unsubscribe();
		}
	}

	/**
	 * Polls the input for each player and processes gamepad assignments.
	 */
	public pollInput(): void {
		this.pollPlatformDevices();
		const now = $.platform.clock.now();
		this.playerInputs.forEach(player => {
			if (!player) return;
			this.processDebugHotkeys(player);
			player.pollInput(now);
			player.update(now);
			this.globalShortcuts.pollPlayer(player);
			const gamepadInput = player.inputHandlers['gamepad'];
			if (gamepadInput) {
				const buttonState = gamepadInput.getButtonState('start');
				if (buttonState.pressed && buttonState.presstime >= 50) {
					gamepadInput.reset();
					player.inputHandlers['gamepad'] = null;
					this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(gamepadInput, null));
				}
			}
		});
		this.pendingGamepadAssignments.forEach(pending => pending.run());
	}

	public beginFrame(currentTime: number = $.platform.clock.now()): void {
		// Input edge state is intentionally advanced explicitly by the runtime only when a
		// new cart-visible simulation frame boundary is reached.
		// beginFrame() clears justpressed/justreleased for the current simulation frame.
		// Calling it from poll/update paths, idle host frames, or budget refills inside the
		// same unfinished gameplay frame will silently destroy buffered jp/jr edges.
		this.playerInputs.forEach(player => {
			if (!player) return;
			player.beginFrame(currentTime);
		});
	}

	public getGlobalShortcutRegistry(): GlobalShortcutRegistry {
		return this.globalShortcuts;
	}

	private pollPlatformDevices(): void {
		const iterator = this.deviceBindings.values();
		const clock = $.platform.clock;
		let current = iterator.next();
		while (!current.done) {
			const binding = current.value;
			const device = binding.device;
			if (device) {
				device.poll(clock);
			}
			current = iterator.next();
		}
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

	private processDebugHotkeys(player: PlayerInput): void {
		if (!this.debugHotkeysEnabled || this.debugHotkeysPaused) return;
		if (player.playerIndex !== Input.DEFAULT_KEYBOARD_PLAYER_INDEX) return;
		const keyboardHandler = player.inputHandlers['keyboard'];
		if (!keyboardHandler) return;

		// const fogToggle = player.getButtonState('KeyF', 'keyboard');
		// if (fogToggle?.justpressed) {
		// 	const atmosphere = $.view?.atmosphere;
		// 	if (!atmosphere) {
		// 		throw new Error('[Input] GameView atmosphere settings unavailable while toggling fog.');
		// 	}
		// 	atmosphere.fogD50 = (atmosphere.fogD50 > 1e6) ? 320.0 : 1e9;
		// 	console.info(`Fog ${atmosphere.fogD50 > 1e6 ? 'disabled' : 'enabled'} (d50=${atmosphere.fogD50})`);
		// 	keyboardHandler.consumeButton('KeyF');
		// }

		// const fogColorToggle = player.getButtonState('KeyG', 'keyboard');
		// if (fogColorToggle?.justpressed) {
		// 	const atmosphere = $.view?.atmosphere;
		// 	if (!atmosphere) {
		// 		throw new Error('[Input] GameView atmosphere settings unavailable while toggling fog color.');
		// 	}
		// 	const isNeutral = atmosphere.fogColorLow[0] === 1.0 && atmosphere.fogColorHigh[0] === 1.0
		// 		&& atmosphere.fogColorLow[1] === 1.0 && atmosphere.fogColorHigh[1] === 1.0
		// 		&& atmosphere.fogColorLow[2] === 1.0 && atmosphere.fogColorHigh[2] === 1.0;
		// 	if (isNeutral) {
		// 		atmosphere.fogColorLow = [0.90, 0.95, 1.00];
		// 		atmosphere.fogColorHigh = [1.05, 1.02, 0.95];
		// 	} else {
		// 		atmosphere.fogColorLow = [1.0, 1.0, 1.0];
		// 		atmosphere.fogColorHigh = [1.0, 1.0, 1.0];
		// 	}
		// 	console.info('Fog color gradient toggled');
		// 	keyboardHandler.consumeButton('KeyG');
		// }

		const allowGlobalHotkeys = $.running || !$.paused;
		if (allowGlobalHotkeys) {
			const fullscreenToggle = keyboardHandler.getButtonState('F11');
			if (fullscreenToggle?.justpressed) {
				if ($.view.fullscreen) {
					$.view.ToWindowed();
				} else {
					$.view.toFullscreen();
				}
				keyboardHandler.consumeButton('F11');
			}
		}
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
