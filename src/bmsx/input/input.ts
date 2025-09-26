import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import { Registry } from '../core/registry';
import { handleDebugClick, handleContextMenu as handleDebugContextMenu, handleDebugMouseDown, handleDebugMouseMove, handleDebugMouseOut, handleDebugMouseUp, handleOpenDebugMenu, handleOpenObjectMenu } from '../debugger/bmsxdebugger';
import { toggleRenderHUD } from '../debugger/renderhud';
import { toggleECSHUD } from '../debugger/ecshud';
import { toggleInputHUD } from '../debugger/inputhud';
import type { Identifier, Identifiable, RegisterablePersistent } from '../rompack/rompack';
import { GamepadInput } from './gamepad';
import { controllerUnassignedToast } from './ui_toast';
import type { ActionState, ButtonId, ButtonState, InputEvent, InputHandler, KeyOrButtonId2ButtonState } from './inputtypes';
import { KeyboardInput } from './keyboardinput';
import { OnscreenGamepad } from './onscreengamepad';
import { PendingAssignmentProcessor } from './pendingassignmentprocessor';
import { ControllerAssignmentUI } from './controller_assignment_ui';
import { PlayerInput } from './playerinput';
import { PointerInput } from './pointerinput';
import { id_to_space_symbol } from '../core/space';

// @ts-ignore
function svgToPng(svgElement, filename) {
	svgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	var svgData = new XMLSerializer().serializeToString(svgElement);

	var canvas = document.createElement('canvas');
	canvas.width = 100;
	canvas.height = 100;
	var ctx = canvas.getContext('2d');

	var img = document.createElement('img');

	var svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
	var svgUrl = URL.createObjectURL(svgBlob);

	img.onload = function () {
		ctx.drawImage(img, 0, 0);
		URL.revokeObjectURL(svgUrl);

		var imgsrc = canvas.toDataURL('image/png');

		// Create a link element
		var link = document.createElement('a');

		// Set the href of the link to the data URL and the download attribute to the desired file name
		link.href = imgsrc;
		link.download = filename;

		// Append the link to the body
		document.body.appendChild(link);

		// Programmatically click the link to start the download
		link.click();

		// Remove the link from the body
		document.body.removeChild(link);
	};

	img.src = svgUrl;
}

/**
 * Prevents the default action, propagation, and immediate propagation of an event.
 *
 * @param e The event object.
 * @returns Returns false.
 */
function preventActionAndPropagation(e: Event): boolean {
	e.preventDefault();
	e.stopPropagation();
	e.stopImmediatePropagation();
	return false;
}

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
		consumed: state.consumed ?? false,
		presstime: state.presstime ?? null,
		timestamp: state.timestamp ?? null,
		pressedAtMs: state.pressedAtMs ?? null,
		releasedAtMs: state.releasedAtMs ?? null,
		pressId: state.pressId ?? null,
		value: state.value ?? null,
		value2d: state.value2d ?? null,
	};
}

export function makeButtonState(partialState?: Partial<ButtonState>): ButtonState {
	const {
		pressed = false,
		justpressed = false,
		justreleased = false,
		waspressed = false,
		wasreleased = false,
		consumed = false,
		presstime = null,
		timestamp = performance.now(),
		pressedAtMs = null,
		releasedAtMs = null,
		pressId = null,
		value = null,
		value2d = null,
	} = partialState ?? {};
	return { pressed, justpressed, justreleased, waspressed, wasreleased, consumed, presstime, timestamp, pressedAtMs, releasedAtMs, pressId, value, value2d };
}

export function makeActionState(actionname: string, partialState?: Partial<ActionState>): ActionState {
	const { action = actionname, alljustpressed = false, allwaspressed = false, alljustreleased = false, ...buttonState } = partialState ?? {};
	return { action, alljustpressed, allwaspressed, alljustreleased, ...makeButtonState(buttonState) };
}

export const options: EventListenerOptions & { passive: boolean, once: boolean } = {
	passive: false,
	once: false,
}

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
	private inputBuffer: InputEvent[];
	private readonly buttonStates = new Map<ButtonId, ButtonState>();

	public get bufferWindowDuration(): number {
		return this.toMs(this.bufferframeDuration);
	}

	private toMs(frames: number) { return frames * 1000 / $.targetFPS; }

	/**
	 * Constructs an instance of the InputStateManager.
	 *
	 * @param bufferframeDuration - The duration in milliseconds for which input events are buffered.
	 * This value determines how long input events are retained in the buffer before being cleaned up.
	 */
	constructor(public bufferframeDuration: number = 150) {
		this.inputBuffer = [];
	}

	/** Prepare per-button edge flags for a new frame. */
	beginFrame(currentTime: number): void {
		for (const state of this.buttonStates.values()) {
			state.justpressed = false;
			state.justreleased = false;
			state.consumed = false;
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
	update(currentTime: number): void {
		this.inputBuffer = this.inputBuffer.filter(event => currentTime - event.timestamp <= this.bufferWindowDuration);
	}

	/**
	 * Adds an input event to the input buffer and updates the immediate button state cache.
	 *
	 * @param event - The input event to be added.
	 */
	addInputEvent(event: InputEvent): void {
		this.inputBuffer.push(event);
		let state = this.buttonStates.get(event.identifier);
		if (!state) {
			state = makeButtonState();
			this.buttonStates.set(event.identifier, state);
		}
		if (event.eventType === 'press') {
			state.pressed = true;
			state.justpressed = true;
			state.justreleased = false;
			state.pressedAtMs = event.timestamp;
			state.presstime = 0;
			state.timestamp = event.timestamp;
			state.releasedAtMs = state.releasedAtMs ?? null;
			state.pressId = event.pressId ?? state.pressId ?? null;
			state.value = state.value ?? 1;
			state.consumed = event.consumed ?? false;
		} else {
			state.pressed = false;
			state.justpressed = false;
			state.justreleased = true;
			state.presstime = null;
			state.timestamp = event.timestamp;
			state.releasedAtMs = event.timestamp;
			state.pressId = event.pressId ?? state.pressId ?? null;
			state.value = 0;
			state.consumed = event.consumed ?? state.consumed ?? false;
		}
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
			? this.toMs(framewindow)
			: this.bufferWindowDuration;
		const currentTime = performance.now();
		const baseState = this.buttonStates.get(identifier);

		const pressed = baseState?.pressed ?? false;
		const justpressed = baseState?.justpressed ?? false;
		const justreleased = baseState?.justreleased ?? false;
		let presstime = baseState?.presstime ?? (pressed && baseState?.pressedAtMs != null ? Math.max(0, currentTime - baseState.pressedAtMs) : null);
		let consumed = baseState?.consumed ?? false;
		const pressedAtMs = baseState?.pressedAtMs ?? null;
		const releasedAtMs = baseState?.releasedAtMs ?? null;
		const timestamp = baseState?.timestamp ?? null;
		const pressId = baseState?.pressId ?? null;
		const value = baseState?.value ?? (pressed ? 1 : 0);
		const value2d = baseState?.value2d ?? null;

		const inputEvents = this.inputBuffer.filter(event => event.identifier === identifier && (currentTime - event.timestamp <= window));
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
			if (event.consumed) consumed = true;
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

	/**
	 * Marks the specified button as consumed, preventing further interactions.
	 *
	 * @param identifier - The unique identifier of the button, which can be a string or a number.
	 * If the button state exists, it will be marked as consumed.
	 */
	consumeBufferedEvent(identifier: ButtonId, pressId?: number | null): void {
		for (const event of this.inputBuffer) {
			if (event.identifier === identifier && (pressId == null || event.pressId === pressId)) {
				event.consumed = true;
			}
		}
		const state = this.buttonStates.get(identifier);
		if (state) state.consumed = true;
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
		Input._instance = new Input(startingGamepadIndex);
		return Input._instance;
	}

	public static get instance(): Input {
		return Input._instance;
	}

	/**
	 * An array of player inputs for each player.
	 * The Player 1 input is at index 0, Player 2 input is at index 1, and so on.
	 * @see PlayerInput
	 */
	private playerInputs: PlayerInput[] = [];

	/**
	 * Represents an array of pending gamepad assignments.
	 * @see PendingAssignmentProcessor
	 */
	public pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

	/**
	 * Represents the onscreen gamepad.
	 * @see OnscreenGamepad
	 */
	private onscreenGamepad: OnscreenGamepad;

	// Spawn-once guard for UI controller
	private uiControllerSpawned = false;

	private debugHotkeysEnabled = false;

	private readonly handleSpaceChanged = (_event: string, _emitter: Identifiable, _payload?: unknown): void => {
		for (const player of this.playerInputs) {
			if (!player) continue;
			player.clearEdgeState();
		}
	};

	/**
	 * Gets the onscreen gamepad.
	 * @returns The onscreen gamepad.
	 */
	public getOnscreenGamepad(): OnscreenGamepad {
		return this.onscreenGamepad;
	}

	/**
	 * Retrieves the player input for the specified player index.
	 * @param playerIndex - The index of the player.
	 * @returns The player input object for the specified player index.
	 * @throws Error if the player index is out of range.
	 */
	public getPlayerInput(playerIndex: number): PlayerInput {
		const index = playerIndex - 1;
		if (index < 0 || index > Input.PLAYER_MAX_INDEX) throw new Error(`Player index ${playerIndex} is out of range, should be between 1 and ${Input.PLAYERS_MAX}.`);
		if (!this.playerInputs[index]) {
			this.playerInputs[index] = new PlayerInput(playerIndex);
		}
		return this.playerInputs[index];
	}

	/**
	 * Hides the specified buttons.
	 * @param gamepad_button_ids An array of button names to hide.
	 * @throws Error if no HTML element is found matching a button name in the array of buttons.
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

	public static readonly POINTER_BUTTONS = ['pointer_primary', 'pointer_secondary', 'pointer_aux', 'pointer_back', 'pointer_forward'] as const;

	private static readonly DEBUG_CAPTURE_KEYS = new Set(['F1', 'F6', 'F7', 'F11']);

	/**
	* The mapping of indices to their corresponding gamepad button names.
	*/
	public static readonly INDEX2BUTTON = {
		0: 'a', // Bottom face button
		1: 'b', // Right face button
		2: 'x', // Left face button
		3: 'y', // Top face button
		4: 'lb', // Left shoulder button
		5: 'rb', // Right shoulder button
		6: 'lt', // Left trigger button
		7: 'rt', // Right trigger button
		8: 'select', // Select button
		9: 'start', // Start button
		10: 'ls', // Left stick button
		11: 'rs', // Right stick button
		12: 'up', // D-pad up
		13: 'down', // D-pad down
		14: 'left', // D-pad left
		15: 'right', // D-pad right
		16: 'home', // Xbox button,
		17: 'touch', // Touchpad button
	} as const;

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
		this.bind();

		const initAlreadyConnectedGamepads = () => {
			// Handle gamepad input initialization
			// Initialize gamepad states for already connected gamepads
			// *Must happen after the starting gamepad index is set, if any, to ensure that any related HID device is initialized first based on the gamepad whose input started the game*
			const gamepads = navigator.getGamepads();
			for (let i = 0; i < gamepads.length; i++) {
				const gamepad = gamepads[i];
				if (!gamepad) continue;
				// Skip the gamepad if it is the starting gamepad index (already initialized) or if it does not have 'gamepad' in its id
				if (typeof startingGamepadIndex === 'number' && gamepad.index === startingGamepadIndex) continue;

				this.addPendingGamepadAssignment(gamepad);
			}
		}

		if (typeof startingGamepadIndex === 'number') {
			const gp = navigator.getGamepads?.()[startingGamepadIndex];
			if (gp) {
				const gamepadInput = new GamepadInput(gp);
				this.assignGamepadToPlayer(gamepadInput, 1);
				// Call init to ensure user interaction for permission before initializing all other connected gamepads
				gamepadInput.init().then(initAlreadyConnectedGamepads);
			}
		}
		else {
			// If no starting gamepad index is provided, initialize all connected gamepads
			initAlreadyConnectedGamepads();
		}

		// Spawn UI controller in the persistent UI space when the space is ready.
		// Defer spawning ControllerAssignmentUI until spaces are guaranteed to exist; see pollInput()
	}

	/**
	 * Checks if the onscreen gamepad is enabled.
	 * @returns {boolean} True if the onscreen gamepad is enabled, false otherwise.
	 */
	public get isOnscreenGamepadEnabled(): boolean {
		const controls = document.getElementById('d-pad-controls');
		return !controls!.hidden;
	}

	/**
	 * Enables the onscreen gamepad and assigns it as the gamepad input for player 1.
	 */
	public enableOnscreenGamepad(): void {
		this.onscreenGamepad ??= new OnscreenGamepad();
		this.onscreenGamepad.init();
		this.getPlayerInput(Input.DEFAULT_ONSCREENGAMEPAD_PLAYER_INDEX).inputHandlers['gamepad'] = this.onscreenGamepad;
	}

	public shouldCaptureKey(code: string): boolean {
		return this.debugHotkeysEnabled && Input.DEBUG_CAPTURE_KEYS.has(code);
	}

	/**
	 * Enables the debug mode for the game screen.
	 * Attaches event listeners to the game screen element to handle debug events.
	 */
	public enableDebugMode(): void {
		const gamescreen = document.getElementById('gamescreen');
		gamescreen.addEventListener('click', this.handleDebugPointerEvents, options);
		gamescreen.addEventListener('mousedown', this.handleDebugPointerEvents, options);
		gamescreen.addEventListener('mousemove', this.handleDebugPointerEvents, options);
		gamescreen.addEventListener('mouseup', this.handleDebugPointerEvents, options);
		gamescreen.addEventListener('mouseout', this.handleDebugPointerEvents, options);
		gamescreen.addEventListener('contextmenu', e => this.handleDebugPointerEvents(e), options);
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
		this.unbind();
		// Remove the input instance
		Input._instance = undefined;
		this.debugHotkeysEnabled = false;
	}

	public bind(): void {
		// Register the input system
		Registry.instance.register(this);
		EventEmitter.instance.on('spaceChanged', this.handleSpaceChanged, this, { persistent: true });

		/**
		 * Event listener for when a gamepad is connected. Assigns the gamepad to a player and dispatches a player join event.
		 * @param e The gamepad event.
		 */
			window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
				const gamepad = e.gamepad;
				if (!gamepad) return;
			console.info(`Gamepad ${gamepad.index} connected.`);
			this.addPendingGamepadAssignment(gamepad)
		});

		document.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
		window.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
		document.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
		window.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
		document.addEventListener('contextmenu', e => {
			if (e.target === document.getElementById('gamescreen')) {
				return true; // Allow context menu on gamescreen
			} else {
				// e.preventDefault(); // Suppress context menu on rest of document
				return false;
			}
		}, false);
			// Gesture suppression is CSS-driven; avoid global touchforcechange handlers.

		const gamescreenEl = document.getElementById('gamescreen');
		if (!(gamescreenEl instanceof HTMLElement)) {
			throw new Error('[Input] Game screen element #gamescreen not found while initializing inputs.');
		}

		this.getPlayerInput(Input.DEFAULT_KEYBOARD_PLAYER_INDEX).inputHandlers['keyboard'] = new KeyboardInput();
		this.getPlayerInput(Input.DEFAULT_KEYBOARD_PLAYER_INDEX).inputHandlers['pointer'] = new PointerInput(gamescreenEl);

		// Mobile/browser UX: pointer capture aids consistent drag behavior across devices
		gamescreenEl.addEventListener('pointerdown', (e: PointerEvent) => {
			try { gamescreenEl.setPointerCapture(e.pointerId); } catch { /* noop */ }
		}, options);

		// Visibility lifecycle: reset edges, cancel rumble, clear transient buffers
		const handleVisibilityLost = () => {
			for (let i = 1; i <= Input.PLAYERS_MAX; i++) {
				const p = this.playerInputs[i - 1];
				if (!p) continue;
				p.reset();
				const hk = p.inputHandlers['keyboard']; if (hk) { try { hk.applyVibrationEffect({ effect: 'dual-rumble', duration: 0, intensity: 0 }); } catch { /* noop */ } }
				const hg = p.inputHandlers['gamepad']; if (hg) { try { hg.applyVibrationEffect({ effect: 'dual-rumble', duration: 0, intensity: 0 }); } catch { /* noop */ } }
			}
			try { if ('vibrate' in navigator) { navigator.vibrate(0); } } catch { /* noop */ }
		};
		document.addEventListener('visibilitychange', () => { if (document.hidden) handleVisibilityLost(); }, options);
		window.addEventListener('pagehide', handleVisibilityLost, options);
	}

	public unbind(): void {
		// Remove all event subscriptions
		EventEmitter.instance.removeSubscriber(this);

		// Deregister the input system
		Registry.instance.deregister(this);
	}

	/**
	 * Polls the input for each player and processes gamepad assignments.
	 */
	public pollInput(): void {
		const now = performance.now();
		// Ensure UI controller exists once spaces are ready
		if (!this.uiControllerSpawned) {
			const ui = $.world[id_to_space_symbol]['ui'];
			if (ui) {
				const existing = $.world.getWorldObject('controller_assignment_ui');
				if (!existing) ui.spawn(new ControllerAssignmentUI());
				this.uiControllerSpawned = true;
			}
		}
		this.playerInputs.forEach(player => {
			if (!player) return;
			player.pollInput(now);
			player.update(now);
			this.processDebugHotkeys(player);
			const gamepadInput = player.inputHandlers['gamepad'];
			if (gamepadInput) {
				const buttonState = gamepadInput.getButtonState('start');
				if (buttonState.pressed && buttonState.presstime >= 50) {
					gamepadInput.reset();
					player.inputHandlers['gamepad'] = null;
					this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(gamepadInput, null));
					controllerUnassignedToast();
				}
			}
		});
		this.pendingGamepadAssignments.forEach(pending => pending.run());
	}

	/**
	 * Returns the first available player index for gamepad assignment starting from a specified index.
	 * A player is considered available if there is a connected gamepad that is not already assigned to a player.
	 *
	 * @param from The index to start searching from. Defaults to 1.
	 * @returns The first available player index for gamepad assignment, or null if none is available.
	 */
	public getFirstAvailablePlayerIndexForGamepadAssignment(from: number = 1, reverse: boolean = false): number | null {
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
		if (!this.debugHotkeysEnabled) return;
		if (player.playerIndex !== Input.DEFAULT_KEYBOARD_PLAYER_INDEX) return;
		const keyboardHandler = player.inputHandlers['keyboard'];
		if (!keyboardHandler) return;

		const togglePause = player.getButtonState('Space', 'keyboard');
		if (togglePause?.justpressed) {
			if (!$.paused) {
				$.paused = true;
				$.debug_runSingleFrameAndPause = false;
			} else {
				$.paused = false;
				$.debug_runSingleFrameAndPause = player.getButtonState('ShiftLeft', 'keyboard')?.pressed ?? false;
			}
			keyboardHandler.consumeButton('Space');
		}

		const fogToggle = player.getButtonState('KeyF', 'keyboard');
		if (fogToggle?.justpressed) {
			const atmosphere = $.view?.atmosphere;
			if (!atmosphere) {
				throw new Error('[Input] GameView atmosphere settings unavailable while toggling fog.');
			}
			atmosphere.fogD50 = (atmosphere.fogD50 > 1e6) ? 320.0 : 1e9;
			console.info(`Fog ${atmosphere.fogD50 > 1e6 ? 'disabled' : 'enabled'} (d50=${atmosphere.fogD50})`);
			keyboardHandler.consumeButton('KeyF');
		}

		const fogColorToggle = player.getButtonState('KeyG', 'keyboard');
		if (fogColorToggle?.justpressed) {
			const atmosphere = $.view?.atmosphere;
			if (!atmosphere) {
				throw new Error('[Input] GameView atmosphere settings unavailable while toggling fog color.');
			}
			const isNeutral = atmosphere.fogColorLow[0] === 1.0 && atmosphere.fogColorHigh[0] === 1.0
				&& atmosphere.fogColorLow[1] === 1.0 && atmosphere.fogColorHigh[1] === 1.0
				&& atmosphere.fogColorLow[2] === 1.0 && atmosphere.fogColorHigh[2] === 1.0;
			if (isNeutral) {
				atmosphere.fogColorLow = [0.90, 0.95, 1.00];
				atmosphere.fogColorHigh = [1.05, 1.02, 0.95];
			} else {
				atmosphere.fogColorLow = [1.0, 1.0, 1.0];
				atmosphere.fogColorHigh = [1.0, 1.0, 1.0];
			}
			console.info('Fog color gradient toggled');
			keyboardHandler.consumeButton('KeyG');
		}

		const allowGlobalHotkeys = $.running || !$.paused;
		if (allowGlobalHotkeys) {
			const hudToggle = player.getButtonState('F1', 'keyboard');
			if (hudToggle?.justpressed) {
				toggleRenderHUD();
				toggleECSHUD();
				toggleInputHUD();
				keyboardHandler.consumeButton('F1');
			}

			const debugMenu = player.getButtonState('F6', 'keyboard');
			if (debugMenu?.justpressed) {
				handleOpenDebugMenu(null);
				keyboardHandler.consumeButton('F6');
			}

			const objectMenu = player.getButtonState('F7', 'keyboard');
			if (objectMenu?.justpressed) {
				handleOpenObjectMenu(null);
				keyboardHandler.consumeButton('F7');
			}

			const fullscreenToggle = player.getButtonState('F11', 'keyboard');
			if (fullscreenToggle?.justpressed) {
				if ($.view.isFullscreen) {
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
	private addPendingGamepadAssignment(gamepad: Gamepad): void {
		const gamepadInput = new GamepadInput(gamepad);
		this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(gamepadInput, null));
	}

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
		this.getPlayerInput(playerIndex).assignGamepadToPlayer(gamepad);
		EventEmitter.instance.emit('playerjoin', this, { playerIndex: playerIndex });
	}

	public static get KC_F1(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F1');
	}

	public static get KC_F12(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F12');
	}

	public static get KC_F2(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F2');
	}

	public static get KC_F3(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F3');
	}

	public static get KC_F4(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F4');
	}

	public static get KC_F5(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F5');
	}

	public static get KC_M(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('KeyM');
	}

	public static get KC_SPACE(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('Space');
	}

	public static get KC_UP(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowUp', 'up');
	}

	public static get KC_RIGHT(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowRight', 'right');
	}

	public static get KC_DOWN(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowDown', 'down');
	}

	public static get KC_LEFT(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowLeft', 'left');
	}

	public static get KC_BTN1(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ShiftLeft', 'a');
	}

	public static get KC_BTN2(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('KeyZ', 'b');
	}

	public static get KC_BTN3(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F1', 'x');
	}

	public static get KC_BTN4(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F5', 'y');
	}

	public static get KD_F1(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F1', 'keyboard').pressed;
	}
	public static get KD_F12(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F12', 'keyboard').pressed;
	}
	public static get KD_F2(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F2', 'keyboard').pressed;
	}
	public static get KD_F3(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F3', 'keyboard').pressed;
	}
	public static get KD_F4(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F4', 'keyboard').pressed;
	}
	public static get KD_F5(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F5', 'keyboard').pressed;
	}
	public static get KD_M(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('KeyM', 'keyboard').pressed;
	}
	public static get KD_SPACE(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('Space', 'keyboard').pressed;
	}
	public static get KD_UP(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('ArrowUp', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('up', 'gamepad').pressed;
	}
	public static get KD_RIGHT(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('ArrowRight', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('right', 'gamepad').pressed;
	}
	public static get KD_DOWN(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('ArrowDown', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('down', 'gamepad').pressed;
	}
	public static get KD_LEFT(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('ArrowLeft', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('left', 'gamepad').pressed;
	}
	public static get KD_BTN1(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('ShiftLeft', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('a', 'gamepad').pressed;
	}
	public static get KD_BTN2(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('KeyZ', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('b', 'gamepad').pressed;
	}
	public static get KD_BTN3(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F1', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('x', 'gamepad').pressed;
	}
	public static get KD_BTN4(): boolean {
		return Input.instance.getPlayerInput(1).getButtonState('F5', 'keyboard').pressed || Input.instance.getPlayerInput(1).getButtonState('y', 'gamepad').pressed;
	}

		/**
		* Handles debug events such as mouse/pointer events and keyboard events.
		*
		* @param e The event object representing the debug event.
		*/
	private handleDebugPointerEvents(e: MouseEvent): void {
		switch (e.type) {
			case "mousedown":
				handleDebugMouseDown(e);
				break;
			case "mousemove":
				handleDebugMouseMove(e);
				break;
			case "mouseup":
				handleDebugMouseUp(e);
				break;
			case "mouseout":
				handleDebugMouseOut(e);
				break;
			case "contextmenu":
				handleDebugContextMenu(e);
				break;
			case "click":
				handleDebugClick(e);
				break;
		}
	}
}
