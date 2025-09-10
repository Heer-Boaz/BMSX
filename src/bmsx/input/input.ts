import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import { Registry } from '../core/registry';
import { handleDebugClick, handleContextMenu as handleDebugContextMenu, handleDebugMouseDown, handleDebugMouseMove, handleDebugMouseOut, handleDebugMouseUp, handleOpenDebugMenu, handleOpenObjectMenu } from '../debugger/bmsxdebugger';
import { toggleRenderHUD } from '../debugger/renderhud';
import { toggleECSHUD } from '../debugger/ecshud';
import type { Identifier, RegisterablePersistent } from '../rompack/rompack';
import { GamepadInput } from './gamepad';
import { controllerUnassignedToast } from './ui_toast';
import type { ActionState, ButtonId, ButtonState, InputEvent, InputHandler, KeyOrButtonId2ButtonState } from './inputtypes';
import { KeyboardInput } from './keyboardinput';
import { OnscreenGamepad } from './onscreengamepad';
import { PendingAssignmentProcessor } from './pendingassignmentprocessor';
import { ControllerAssignmentUI } from './controller_assignment_ui';
import { PlayerInput } from './playerinput';
import { id_to_space_symbol } from 'bmsx/core/space';

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
	return { pressed: stateMap[keyOrButtonId]?.pressed ?? false, justpressed: stateMap[keyOrButtonId]?.justpressed ?? false, justreleased: stateMap[keyOrButtonId]?.justreleased ?? false, wasreleased: stateMap[keyOrButtonId]?.wasreleased ?? false, consumed: stateMap[keyOrButtonId]?.consumed ?? false, presstime: stateMap[keyOrButtonId]?.presstime ?? null, timestamp: stateMap[keyOrButtonId]?.timestamp ?? null, waspressed: stateMap[keyOrButtonId]?.waspressed ?? false };
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

	/**
	 * Updates the input state based on the current time.
	 *
	 * This method processes input events, updates the press time for
	 * each button based on whether it is pressed, and cleans up old
	 * events from the input buffer.
	 *
	 * @param currentTime - The current time in milliseconds used to
	 *                      calculate the press time and manage input
	 *                      events.
	 */
	update(currentTime: number): void {
		// Clean up old events from the buffers if needed
		this.inputBuffer = this.inputBuffer.filter(event => currentTime - event.timestamp <= this.bufferWindowDuration);
	}

	/**
	 * Adds an input event to the input buffer.
	 *
	 * @param event - The input event to be added.
	 */
	addInputEvent(event: InputEvent): void {
		this.inputBuffer.push(event);
	}

	/**
	 * Retrieves the current state of a button based on its identifier.
	 *
	 * @param identifier - The unique identifier for the button, which can be a string or a number.
	 * @returns The current state of the button, including properties such as:
	 *  - `pressed`: Indicates if the button is currently pressed.
	 *  - `justpressed`: Indicates if the button was just pressed in the current frame.
	 *  - `consumed`: Indicates if the button's press has been consumed.
	 *  - `presstime`: The duration for which the button has been pressed, or null if not applicable.
	 *  - `timestamp`: The time at which the button state was last updated, or null if not applicable.
	 */
	getButtonState(identifier: ButtonId, framewindow?: number): ButtonState {
		const window = framewindow !== undefined
			? this.toMs(framewindow)
			: this.bufferWindowDuration;
		const currentTime = performance.now();

		// Get the input events from the input buffer so that we can determine the state of the button
		const inputEvents = this.inputBuffer.filter(event => event.identifier === identifier && (currentTime - event.timestamp <= window));
		if (inputEvents.length === 0) {
			return makeButtonState();
		}
		const lastEvent = inputEvents[inputEvents.length - 1];
		const pressed = lastEvent.eventType === 'press'; // isPressed is true if the last event was a press event, otherwise it is false (i.e. the button was released)
		const released = lastEvent.eventType === 'release'; // isReleased is true if the last event was a release event, otherwise it is false (i.e. the button was pressed)
		// Just pressed is true if the last event was of type `press` and it happened in the current frame
		const isInCurrentFrame = currentTime - lastEvent.timestamp <= this.toMs(1); // Check if the last event happened in the current frame
		const justpressed = pressed && isInCurrentFrame;
		// Just released is true if the last event was of type `release` and it happened in the current frame
		const justreleased = released && isInCurrentFrame;

		// True if any 'press' event in window has not been followed by a 'release' in window, or if a press-release pair both occurred in window
		let waspressed = false;
		for (let i = 0; i < inputEvents.length; ++i) {
			if (inputEvents[i].eventType === 'press') {
				// Look for a release after this press
				let released = false;
				for (let j = i + 1; j < inputEvents.length; ++j) {
					if (inputEvents[j].eventType === 'release') {
						released = true;
						break;
					}
				}
				// If not released, or if both press and release are in window, count as waspressed
				if (!released || (released && (currentTime - inputEvents[i].timestamp <= window))) {
					waspressed = true;
					break;
				}
			}
		}
		let wasreleased = false;
		for (let i = 0; i < inputEvents.length; ++i) {
			if (inputEvents[i].eventType === 'release') {
				// Look for a press after this release
				let pressed = false;
				for (let j = i + 1; j < inputEvents.length; ++j) {
					if (inputEvents[j].eventType === 'press') {
						pressed = true;
						break;
					}
				}
				// If not pressed, or if both press and release are in window, count as wasreleased
				if (!pressed || (pressed && (currentTime - inputEvents[i].timestamp <= window))) {
					wasreleased = true;
					break;
				}
			}
		}

		const presstime = pressed ? currentTime - lastEvent.timestamp : null;
		const timestamp = pressed ? lastEvent.timestamp : null;

		// If any event in the input buffer for this button was consumed, we consider the button as consumed
		// This means that the button press has been processed and should not trigger any further actions
		// This is useful for preventing multiple actions from being triggered by a single button press
		// For example, if a button is pressed and then released, we can mark it as consumed to prevent further actions
		// from being triggered by the same button press.
		const consumed = inputEvents.some(event => event.consumed);

		// const consumed = lastEvent.consumed;

		// Return the button state based on the last event
		return makeButtonState({
			pressed,
			justpressed,
			justreleased,
			waspressed,
			wasreleased,
			consumed,
			presstime,
			timestamp
		});
	}

	/**
	 * Marks the specified button as consumed, preventing further interactions.
	 *
	 * @param identifier - The unique identifier of the button, which can be a string or a number.
	 * If the button state exists, it will be marked as consumed.
	 */
	consumeBufferedEvent(identifier: ButtonId, pressId?: number | null): void {
		const inputEvents = this.inputBuffer.filter(event => event.identifier === identifier && (pressId == null || event.pressId === pressId));
		if (inputEvents.length > 0) {
			inputEvents.forEach(event => { event.consumed = true; });
		}
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
		if (!Input._instance) {
			Input._instance = new Input(startingGamepadIndex);
		}
		return Input._instance;
	}

	public static get instance(): Input {
		if (!Input._instance) {
			Input._instance = new Input();
		}
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
	static preventDefaultEventAction(e: UIEvent, key: string) {
		if ($.running || !$.paused) {
			switch (key) {
				case 'Escape':
				case 'Esc':
				case 'F12':
					break;
				case 'F1':
					// preventActionAndPropagation(e);
					e.preventDefault();
					toggleRenderHUD();
					toggleECSHUD();
					break;
				case 'F6':
					e.preventDefault();
					handleOpenDebugMenu(e);
					break;
				case 'F7':
					e.preventDefault();
					handleOpenObjectMenu(e);
					break;
				case 'F11':
					e.preventDefault();
					if ($.view.isFullscreen)
						$.view.ToWindowed();
					else $.view.toFullscreen();
					break;
				default:
					// e.preventDefault();
					break;
			}
		}
	}

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

	/**
	 * Enables the debug mode for the game screen.
	 * Attaches event listeners to the game screen element to handle debug events.
	 */
	public enableDebugMode(): void {
		const gamescreen = document.getElementById('gamescreen');
		gamescreen.addEventListener('click', this.handleDebugEvents, options);
		gamescreen.addEventListener('mousedown', this.handleDebugEvents, options);
		gamescreen.addEventListener('mousemove', this.handleDebugEvents, options);
		gamescreen.addEventListener('mouseup', this.handleDebugEvents, options);
		gamescreen.addEventListener('mouseout', this.handleDebugEvents, options);
		gamescreen.addEventListener('contextmenu', e => this.handleDebugEvents(e), options);
		window.addEventListener('keydown', e => this.handleDebugEvents(e), options);
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
	}

	public bind(): void {
		// Register the input system
		Registry.instance.register(this);

		/**
		 * Event listener for when a gamepad is connected. Assigns the gamepad to a player and dispatches a player join event.
		 * @param e The gamepad event.
		 */
		window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
			const gamepad = e.gamepad;
			if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) return;
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
		document.addEventListener('touchforcechange', e => preventActionAndPropagation(e), options);// iOS -- https://stackoverflow.com/questions/58159526/draggable-element-in-iframe-on-mobile-is-buggy && iOS -- https://stackoverflow.com/questions/50980876/can-you-prevent-3d-touch-on-an-img-but-not-tap-and-hold-to-save

		this.getPlayerInput(Input.DEFAULT_KEYBOARD_PLAYER_INDEX).inputHandlers['keyboard'] = new KeyboardInput();

		// Mobile/browser UX: pointer capture and touch-action tuning on the interactive surface
		const gamescreenEl = document.getElementById('gamescreen');
		if (gamescreenEl instanceof HTMLElement) {
			gamescreenEl.style.touchAction = 'manipulation';
			gamescreenEl.addEventListener('pointerdown', (e: PointerEvent) => { try { gamescreenEl.setPointerCapture(e.pointerId); } catch { /* noop */ } }, options);
			// Prevent iOS scroll/zoom gestures on the game surface
			gamescreenEl.addEventListener('touchstart', (e: TouchEvent) => e.preventDefault(), options);
			gamescreenEl.addEventListener('touchmove', (e: TouchEvent) => e.preventDefault(), options);
		}

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
			player.pollInput();
			player.update(now);
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
	* Handles debug events such as mouse events and touch events.
	*
	* @param e The event object representing the debug event.
	*/
	private handleDebugEvents(e: MouseEvent | TouchEvent | KeyboardEvent): void {
		if (e instanceof KeyboardEvent) {
			Input.preventDefaultEventAction(e, e.code);
			switch (e.code) {
				case 'Space':
					if (this.getPlayerInput(1).getButtonState(e.code, 'keyboard').consumed) break;
					else this.getPlayerInput(1).getButtonState(e.code, 'keyboard');
					if (!$.paused) {
						$.paused = true;
						$.debug_runSingleFrameAndPause = false;
					}
					else {
						$.paused = false;
						$.debug_runSingleFrameAndPause = this.getPlayerInput(1).getButtonState('ShiftLeft', 'keyboard').pressed;
					}
					break;
			}
		}
		else if (e instanceof MouseEvent) {
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
		} else if (e instanceof TouchEvent) {
			e.preventDefault();
			switch (e.type) {
				case "touchstart":
					// handleDebugTouchStart(e);
					break;
				case "touchmove":
					// handleDebugTouchMove(e);
					break;
				case "touchend":
					// handleDebugTouchEnd(e);
					break;
				case "touchcancel":
					// handleDebugTouchCancel(e);
					break;
			}
		}
	}
}
