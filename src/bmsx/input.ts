import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseUp, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventEmitter } from './eventemitter';
import { ZCOORD_MAX } from './glview';
import { SpriteObject } from './sprite';
import type { IRegisterable, Identifier } from "./game";
import { Registry } from './registry';
import { State } from './fsm';
import { ActionParser } from './actionparser';
import type { StateMachineBlueprint } from './fsmtypes';
import { build_fsm } from './fsmdecorators';

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
 * Represents a query to retrieve the state of one or more actions.
 * Used to query the state of actions in the input system, such as whether a button is pressed or consumed or whether there is a long-press.
 * @see ActionState for the structure of the query result.
 * @see PlayerInput.getPressedActions for how this query is used.
 */
export type ActionStateQuery = {
	/**
	 * An optional array of filters to apply when querying for action states.
	 */
	filter?: string[];

	/**
	 * Specifies whether the action is currently pressed.
	 */
	pressed?: boolean;

	/**
	 * Specifies whether the action was not pressed before (i.e., it was just pressed).
	 */
	justPressed?: boolean;

	/**
	 * Specifies whether the action has been consumed.
	 */
	consumed?: boolean;

	/**
	 * The time at which the action was pressed, in milliseconds.
	 */
	pressTime?: number;

	/**
	 * An optional array of action names, ordered by priority, to use when querying for action states.
	 */
	actionsByPriority?: string[];
}

/**
 * Represents the ID of a button.
 * It can be one of the predefined values 'BTN1', 'BTN2', 'BTN3', 'BTN4',
 * or a custom Key value.
 */
type KeyboardButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;

type ButtonId = string;

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
function resetObject(obj: any, except?: string[]) {
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
function getPressedState(
	stateMap: KeyOrButtonId2ButtonState,
	keyOrButtonId: ButtonId
): ButtonState {
	return { pressed: stateMap[keyOrButtonId]?.pressed ?? false, justpressed: stateMap[keyOrButtonId]?.justpressed ?? false, consumed: stateMap[keyOrButtonId]?.consumed ?? false, presstime: stateMap[keyOrButtonId]?.presstime ?? null, timestamp: stateMap[keyOrButtonId]?.timestamp ?? null };
}

/**
 * Represents the state of an button-press-index in the Index2State type. Used for tracking the state of a button.
 */
type KeyOrButtonId2ButtonState = { [index: ButtonId]: ButtonState; }

/**
 * Represents a mapping of keyboard inputs to actions.
 */5
export type KeyboardInputMapping = {
	[action: string]: KeyboardButton[];
}

/**
 * Represents a mapping of gamepad inputs to gamepad buttons.
 */
export type GamepadInputMapping = {
	[action: string]: GamepadButton[];
}

/**
 * Represents the input mapping for a game.
 */
export interface InputMap {
	keyboard: KeyboardInputMapping;
	gamepad: GamepadInputMapping;
}

/**
 * Represents a keyboard button.
 * It can be one of the predefined keys or a custom string.
 */
export type KeyboardButton = keyof typeof Key | string;

/**
 * Represents a gamepad button.
 * @typedef {keyof typeof Input.BUTTON2INDEX } GamepadButton
 */
export type GamepadButton = typeof Input.BUTTON_IDS[number];

/**
 * Represents the state of a button.
 */
export type ButtonState = {
	pressed: boolean;
	justpressed: boolean;
	consumed: boolean;
	presstime: number | null;
	timestamp: number | null;
};

/**
 * Represents the input event that is stored when a key or button is pressed or released.
 */
type InputEvent = {
	eventType: 'press' | 'release';
	identifier: ButtonId; // Key code or button name
	timestamp: number;
	source: 'keyboard' | 'gamepad' | 'onscreen';
	playerIndex: number;
};

/**
 * Represents the state of an action, including the action name and button state.
 */
export type ActionState = { action: string, alljustpressed: boolean } & ButtonState;

function makeButtonState(partialState?: Partial<ButtonState>): ButtonState {
	const { pressed = false, justpressed = false, consumed = false, presstime = null, timestamp = null } = partialState ?? {};
	return { pressed, justpressed, consumed, presstime, timestamp };
}

/**
 * Represents an input handler that provides methods for polling input, getting button states,
 * consuming buttons, resetting input, and getting the gamepad index.
 */
interface IInputHandler {
	/**
	 * Polls the input to update the button states.
	 */
	pollInput(): void;

	/**
	 * Gets the state of the specified button.
	 * @param btn - The button name or null to get the state of all buttons.
	 * @returns The state of the button.
	 */
	getButtonState(btn: ButtonId): ButtonState;

	/**
	 * Consumes the specified button, marking it as processed.
	 * @param button - The button name to consume.
	 */
	consumeButton(button: ButtonId): void;

	/**
	 * Resets the input, optionally excluding specified buttons.
	 * @param except - An optional array of button names to exclude from the reset.
	 */
	reset(except?: string[]): void;

	/**
	 * Gets the index of the gamepad.
	 */
	get gamepadIndex(): number;
}

const options = {
	passive: false,
	once: false,
}

/**
 * Represents a selected player index icon that is shown when a new input device has been detected and not yet been assigned to a player.
 * The icon is also shown when an input devices is being reassigned to a player.
 */
class SelectedPlayerIndexIcon extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			on: {
				$animation_end: {
					do(this: SelectedPlayerIndexIcon) {
						this.markForDisposal();
					}
				},
			},
			states: {
				_default: {
					on: {
						controller_assigned: 'assigned',
						controller_assigmment_cancelled: 'cancelled',
					},
				},
				assigned: {
					tape: [true, false],
					repetitions: 5,
					auto_rewind_tape_after_end: false,
					ticks2move: 4,
					next(this: SelectedPlayerIndexIcon, state: State) {
						this.colorize = state.current_tape_value ? { r: 1, g: 1, b: 1, a: .5 } : { r: 0, g: 1, b: 0, a: .75 };
					},
					end(this: SelectedPlayerIndexIcon) {
						this.sc.do('animation_end', this);
					},
				},
				cancelled: {
					tape: [2],
					repetitions: 16,
					auto_rewind_tape_after_end: false,
					ticks2move: 1,
					enter(this: SelectedPlayerIndexIcon) {
						this.colorize = { r: 1, g: 0, b: 0, a: .75 };
					},
					next(this: SelectedPlayerIndexIcon, state: State) {
						this.y -= state.current_tape_value;
					},
					end(this: SelectedPlayerIndexIcon) {
						this.sc.do('animation_end', this);
					},
				},
			},
		};
	}

	/**
	 * Returns the icon identifier for the specified gamepad index.
	 * If the gamepad index is not provided, it defaults to 0.
	 *
	 * @param gamepadIndex - The index of the gamepad.
	 * @returns The icon identifier.
	 */
	public static getIconId(gamepadIndex: number): Identifier {
		return `joystick_icon_${gamepadIndex ?? 0}`;
	}

	/**
	 * Constructs an instance of the class.
	 *
	 * @param gamepadIndex - The index of the gamepad associated with the player.
	 * This value is used to retrieve the icon ID for the selected player.
	 */
	constructor(public gamepadIndex: number) {
		super(SelectedPlayerIndexIcon.getIconId(gamepadIndex));
		this.z = ZCOORD_MAX;
		this.colorize = { r: 1, g: 1, b: 1, a: .75 };
	}

	/**
	 * Sets the player index, which updates the icon image to represent a particular player by number.
	 * @param playerIndex - The index of the player.
	 */
	public set playerIndex(playerIndex: number) {
		if (playerIndex === null) {
			this.imgid = 'joystick_none';
			return;
		}
		else {
			this.imgid = `joystick${playerIndex}`;
		}
	}
}

/**
 * Represents a processor for handling pending gamepad assignments.
 * This class manages the selection of player indexes for gamepad assignments and the placement of the joystick icon.
 */
class PendingAssignmentProcessor {
	/**
	 * The starting position of the joystick icon in pixels.
	 */
	private static readonly joystick_icon_start = { x: 0, y: 0 };

	/**
	 * The amount of increment in the x-axis for the joystick icon in pixels.
	 */
	private static readonly joystick_icon_increment_x = 32;

	/**
	 * Gets the pending index of the gamepad input.
	 * @returns The pending index of the gamepad input.
	 */
	private get pendingIndex() { return this.inputHandler.gamepadIndex; }

	/**
	 * The icon representing the selected player index.
	 */
	private icon: SelectedPlayerIndexIcon = null;

	/**
	 * Checks if a specific gamepad button is pressed and not consumed.
	 *
	 * @param button - The gamepad button to check.
	 * @param gamepadInput - The gamepad input handler.
	 * @returns A boolean value indicating whether the button is pressed and not consumed.
	 */
	private checkNonConsumedPressed(button: GamepadButton, gamepadInput: IInputHandler) {
		return gamepadInput.getButtonState(button).pressed && !gamepadInput.getButtonState(button).consumed;
	}

	/**
	 * Calculates the X position of the assignment-icon based on the given position index.
	 * @param positionIndex The index of the position.
	 * @returns The calculated X position of the icon.
	 */
	private calcIconPositionX(positionIndex: number) { return PendingAssignmentProcessor.joystick_icon_start.x + (PendingAssignmentProcessor.joystick_icon_increment_x * (positionIndex ?? 0)) };

	/**
	 * Handles the button press event for selecting the player index.
	 * @param button - The gamepad button that was pressed.
	 * @param increment - The amount by which to increment or decrement the player index.
	 * @param gamepadInput - The gamepad input handler.
	 */
	private handleSelectPlayerIndexButtonPress(button: GamepadButton, increment: number, gamepadInput: IInputHandler) {
		if (this.checkNonConsumedPressed(button, gamepadInput)) {
			gamepadInput.consumeButton(button);

			let newProposedPlayerIndex: number = this.proposedPlayerIndex + increment;
			if (newProposedPlayerIndex < 1) {
				newProposedPlayerIndex = 1; // No wrap-around to avoid accidentally assigning a gamepad to the wrong player
				return; // Don't do anything if the player index is already 1 and the user tries to decrement it
			}
			if (newProposedPlayerIndex > Input.PLAYERS_MAX) {
				newProposedPlayerIndex = Input.PLAYERS_MAX; // No wrap-around to avoid accidentally assigning a gamepad to the wrong player
				return; // Don't do anything if the player index is already the max and the user tries to increment it
			}

			// Find the next available player index for gamepad assignment
			newProposedPlayerIndex = Input.instance.getFirstAvailablePlayerIndexForGamepadAssignment(newProposedPlayerIndex, increment < 0);

			if (newProposedPlayerIndex !== null) {
				this.proposedPlayerIndex = newProposedPlayerIndex;
				this.icon.playerIndex = newProposedPlayerIndex;
			}
			else {
				// No new player index available for gamepad assignment found => don't do anything!
			}
			console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${newProposedPlayerIndex ?? 'none (no free slots left)'}.`);
		}
	}

	/**
	 * Creates a select player icon if it doesn't exist yet and handles its placement in the scene.
	 *
	 * @param gamepadInput - The gamepad input handler.
	 * @param positionIndex - The position index of the icon.
	 */
	private createSelectPlayerIconIfNeeded(gamepadInput: IInputHandler, positionIndex: number) {
		const model = $.model;
		if (!this.icon) { // If the joystick icon doesn't exist yet, create it
			const joystick_icon = new SelectedPlayerIndexIcon(gamepadInput.gamepadIndex);
			this.icon = joystick_icon;
			const existingIcon = model.getGameObject<SelectedPlayerIndexIcon>(this.icon.id); // Check whether the icon already exists. This can happen when the icon was still animating while somehow the assignment needs to happen again.
			existingIcon && model.exile(existingIcon); // Remove the existing icon so that we can replace it with a new, younger and prettier version.
			model.spawn(joystick_icon);
			joystick_icon.x = this.calcIconPositionX(positionIndex);
			joystick_icon.y = PendingAssignmentProcessor.joystick_icon_start.y;
		}
		else if (!model.is_obj_in_current_space(this.icon.id)) { // Check whether the joystick icon is already part of the current space (scene)
			// If the joystick icon already exists, move it to the current space (scene) (e.g. if the player changed scenes)
			model.move_obj_to_current_space(this.icon.id);
		}
	}

	/**
	 * Constructs a new instance of the class.
	 *
	 * @param inputHandler - An object that handles input from the gamepad.
	 * @param proposedPlayerIndex - The index of the player that is proposed to be assigned to the gamepad, or null if no player is proposed.
	 *
	 * This constructor sets up an event listener for the "gamepaddisconnected" event,
	 * which handles the disconnection of gamepads and manages pending assignments.
	 */
	constructor(public inputHandler: IInputHandler, public proposedPlayerIndex: number | null) {
		window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
			const gamepad = e.gamepad;
			if (!gamepad.id.toLowerCase().includes('gamepad')) return;

			if (!this.inputHandler) return; // No gamepad was not assigned to this object, so ignore the event (should not happen).
			const gamepadIndex = e.gamepad.index;
			if (gamepadIndex === this.inputHandler.gamepadIndex) {
				// No player was assigned to this gamepad yet, but this input object was used for polling input from the gamepad
				console.info(`Gamepad ${gamepad.index} disconnected while pending assignment.`);
				Input.instance.removePendingGamepadAssignment(gamepadIndex); // Remove pending gamepad assignment
			}
		});
	}

	/**
	 * Runs the gamepad assignment process.
	 * If a gamepad is proposed to be assigned to a player, handles the assignment and removal of the joystick icon.
	 * If no gamepad is proposed, checks for the start button press to propose a gamepad for assignment.
	 * Handles the movement of the joystick icon to change the proposed player index.
	 */
	run(): void {
		const inputMaestro = Input.instance;
		const gamepadInput = this.inputHandler;
		gamepadInput.pollInput();

		// Check whether the start button was pressed and not consumed yet to assign the gamepad to a player
		if (this.proposedPlayerIndex === null) {
			if (this.checkNonConsumedPressed('start', gamepadInput)) {
				gamepadInput.consumeButton('start');
				const proposedPlayerIndex = inputMaestro.getFirstAvailablePlayerIndexForGamepadAssignment();

				if (proposedPlayerIndex !== null) {
					this.proposedPlayerIndex = proposedPlayerIndex;
					this.createSelectPlayerIconIfNeeded(this.inputHandler, this.pendingIndex);
					this.icon.playerIndex = proposedPlayerIndex;
					console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${proposedPlayerIndex}.`);
				}
			}
		}
		else {
			if (!$.model.getFromCurrentSpace(this.icon.id)) {
				$.model.move_obj_to_space(this.icon.id, $.model.current_space_id);
			}
			this.icon.x = this.calcIconPositionX(this.pendingIndex);
			if (this.checkNonConsumedPressed('a', gamepadInput)) {
				// Assign gamepad to player and remove the joystick icon
				gamepadInput.consumeButton('a');
				inputMaestro.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
				inputMaestro.removePendingGamepadAssignment(this.inputHandler.gamepadIndex);
				$.emit('controller_assigned', Input.instance, this.proposedPlayerIndex);
				this.icon = null;
			}
			else if (this.checkNonConsumedPressed('b', gamepadInput)) {
				// Cancel assignment process for this gamepad and remove the joystick icon
				gamepadInput.consumeButton('b');
				this.proposedPlayerIndex = null; // Set proposed player index to null to indicate that the gamepad is no longer proposed to be assigned to a player. Note that we keep the pending gamepad assignment object around, so that the gamepad can be assigned to a player again later.
				$.emit('controller_assigmment_cancelled', Input.instance, this.proposedPlayerIndex);
				this.icon = null;
				// this.removeIcon();
			}
			else {
				// Handle joystick icon movement to change the proposed player index
				this.handleSelectPlayerIndexButtonPress('up', 1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('right', 1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('down', -1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('left', -1, gamepadInput);
			}
		}
	}

	/**
	 * Removes the icon from the model if it exists.
	 * If the icon is present, it will be exiled from the model
	 * and the reference to the icon will be set to undefined.
	 */
	removeIcon(): void {
		if (this.icon) {
			$.model.exile(this.icon);
			this.icon = undefined;
		}
	}
}

/**
 * Manages the input state for a player, including button states and input events.
 *
 * The `InputStateManager` class is responsible for tracking the state of input buttons,
 * processing input events, and maintaining an input buffer. It provides methods to update
 * the state based on current time, retrieve button states, and consume button presses.
 */
// @ts-ignore
class InputStateManager {
	/**
	 * Represents the input buffer used for processing input data.
	 * @type {InputBuffer}
	 */
	private inputBuffer: InputBuffer;
	/**
	 * A map that holds the states of buttons.
	 *
	 * The keys can be either a string or a number, representing the identifier of the button.
	 * The values are of type `ButtonState`, which encapsulates the current state of the button.
	 *
	 * @type {Map<ButtonId, ButtonState>}
	 */
	private buttonStates: Map<ButtonId, ButtonState> = new Map();

	/**
	 * Creates an instance of the class.
	 * @param playerIndex - The index of the player.
	 */
	constructor(private playerIndex: number) {
		this.inputBuffer = new InputBuffer();
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
		// Process input events
		this.processInputEvents(currentTime);

		// Update presstime for pressed buttons
		this.buttonStates.forEach((state) => {
			if (state.pressed) {
				state.presstime = currentTime - (state.timestamp ?? currentTime);
			} else {
				state.presstime = null;
			}
		});

		// Clean up old events from the buffer if needed
		this.inputBuffer.cleanup(currentTime);
	}

	/**
	 * Processes input events for the current player.
	 *
	 * This method retrieves events from the input buffer for the specified player index,
	 * updates the button states based on the event type (press or release), and manages
	 * the state properties such as pressed, justpressed, and timestamps.
	 *
	 * After processing the events, it clears the events from the input buffer to prepare
	 * for the next set of input events.
	 *
	 * @param _currentTime - The current time in milliseconds, used for timestamping events.
	 *
	 * @returns void
	 */
	private processInputEvents(_currentTime: number): void {
		const events = this.inputBuffer.getEventsForPlayer(this.playerIndex);

		events.forEach(event => {
			let state = this.buttonStates.get(event.identifier);
			if (!state) {
				state = {
					pressed: false,
					justpressed: false,
					consumed: false,
					presstime: null,
					timestamp: null,
				};
				this.buttonStates.set(event.identifier, state);
			}

			if (event.eventType === 'press') {
				if (!state.pressed) {
					state.pressed = true;
					state.justpressed = true;
					state.timestamp = event.timestamp;
				} else {
					state.justpressed = false;
				}
			} else if (event.eventType === 'release') {
				state.pressed = false;
				state.justpressed = false;
				state.timestamp = null;
				state.presstime = null;
			}
		});

		// Clear events after processing
		this.inputBuffer.clearEventsForPlayer(this.playerIndex);
	}

	/**
	 * Adds an input event to the input buffer.
	 *
	 * @param event - The input event to be added.
	 */
	addInputEvent(event: InputEvent): void {
		this.inputBuffer.addEvent(event);
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
	getButtonState(identifier: ButtonId): ButtonState {
		return this.buttonStates.get(identifier) || {
			pressed: false,
			justpressed: false,
			consumed: false,
			presstime: null,
			timestamp: null,
		};
	}

	/**
	 * Marks the specified button as consumed, preventing further interactions.
	 *
	 * @param identifier - The unique identifier of the button, which can be a string or a number.
	 * If the button state exists, it will be marked as consumed.
	 */
	consumeButton(identifier: ButtonId): void {
		const state = this.buttonStates.get(identifier);
		if (state) {
			state.consumed = true;
		}
	}
}

// @ts-ignore
class InputBuffer {
	private events: InputEvent[] = [];
	private bufferDuration: number; // e.g., 200ms

	constructor(bufferDuration: number = 200) {
		this.bufferDuration = bufferDuration;
	}

	addEvent(event: InputEvent): void {
		this.events.push(event);
	}

	getEventsForPlayer(playerIndex: number): InputEvent[] {
		return this.events.filter(event => event.playerIndex === playerIndex);
	}

	clearEventsForPlayer(playerIndex: number): void {
		this.events = this.events.filter(event => event.playerIndex !== playerIndex);
	}

	cleanup(currentTime: number): void {
		this.events = this.events.filter(event => currentTime - event.timestamp <= this.bufferDuration);
	}
}

/**
 * Represents the Input class, which manages player inputs and gamepad assignments.
 * Implements the singleton pattern to ensure only one instance exists.
 */
export class Input implements IRegisterable {
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
	private pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

	/**
	 * Represents the onscreen gamepad.
	 * @see OnscreenGamepad
	 */
	private onscreenGamepad: OnscreenGamepad;

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
	* @see GamepadButton
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
		* @see GamepadButton
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
		if (global.$.running || !global.$.paused) {
			switch (key) {
				case 'Escape':
				case 'Esc':
				case 'F12':
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
	constructor() {
		// Register the input system
		Registry.instance.register(this);

		// Initialize gamepad states for already connected gamepads
		const gamepads = navigator.getGamepads();
		for (let i = 0; i < gamepads.length; i++) {
			const gamepad = gamepads[i];
			if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) continue;

			this.addPendingGamepadAssignment(gamepad);
		}

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
		this.pendingGamepadAssignments.forEach(pending => pending.removeIcon());
		this.pendingGamepadAssignments = [];

		// Remove all player inputs
		this.playerInputs = [];

		// Remove all event subscriptions
		EventEmitter.instance.removeSubscriber(this);

		// Deregister the input system
		Registry.instance.deregister(this);

		// Remove the input instance
		Input._instance = undefined;
	}

	/**
	 * Polls the input for each player and processes gamepad assignments.
	 */
	public pollInput(): void {
		this.playerInputs.forEach(player => {
			player.pollInput();
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
	public assignGamepadToPlayer(gamepad: IInputHandler, playerIndex: number): void {
		this.getPlayerInput(playerIndex).assignGamepadToPlayer(gamepad);
		EventEmitter.instance.emit('playerjoin', this, playerIndex);
	}

	public static get KC_F1(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume(Key.F1);
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
					if (!global.$.paused) {
						global.$.paused = true;
						global.$.debug_runSingleFrameAndPause = false;
					}
					else {
						global.$.paused = false;
						global.$.debug_runSingleFrameAndPause = this.getPlayerInput(1).getButtonState('ShiftLeft', 'keyboard').pressed;
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

/**
 * Represents the Input class responsible for handling user input.
 */
export class PlayerInput {
	/**
	 * The index of the player whose input is being handled.
	 */
	public playerIndex: number;

	/**
	 * Represents the input handlers for the player.
	 *
	 * @property {IInputHandler | null} keyboard - The handler for keyboard input, or null if not set.
	 * @property {IInputHandler | null} gamepad - The handler for gamepad input, or null if not set.
	 */
	public inputHandlers: { [key in 'keyboard' | 'gamepad']: IInputHandler | null } = {
		keyboard: null,
		gamepad: null,
	};

	/**
	 * Indicates whether the player is the main player.
	 * Currently used for determining whether to assign the on-screen gamepad automatically if any other assigned gamepad is disconnected.
	 * @returns {boolean} True if the player is the main player, false otherwise.
	 */
	private get isMainPlayer(): boolean { return this.playerIndex === 1; }

	/**
	 * The input maps for each player.
	 * @private
	 * @param {number} playerIndex - The index of the player to set the input map for.
	 * @param {InputMap} inputMap - The input map to set for the player.
	 * @returns {void}
	 * @throws {Error} Throws an error if the player index is out of range.
	 * @throws {Error} Throws an error if the input map is invalid.
	 * @see {@link this.getActionState} and {@link this.getPressedActions} for checking if an action is pressed for a player.
	 * @example
	 * this.setInputMap(0, {
	 *     keyboard: {
	 *         'jump': ['Space'],
	 *         'left': ['ArrowLeft'],
	 *         'right': ['ArrowRight'],
	 *         'up': ['ArrowUp'],
	 *         'down': ['ArrowDown'],
	 *    	   'jumpleft': ['ArrowLeft', 'Space'],
	 *	       'jumpright': ['ArrowRight', 'Space'],
	 *     },
	 *     gamepad: {
	 *         'jump': ['a'],
	 *         'left': ['left'],
	 *         'right': ['right'],
	 *         'up': ['up'],
	 *         'down': ['down'],
	 *		   'jumpleft': ['left', 'a'],
	 *		   'jumpright': ['right', 'a'],
	 *     },
	 * });
	 */
	private inputMap: InputMap;

	/**
	 * Checks if all actions defined in the action definition string have been triggered.
	 * Supports both AND (•) and OR (+) operators.
	 * @param actionDefinition The action definition string to check.
	 * @returns True if the action definition is satisfied, false otherwise.
	 */
	public checkActionTriggered(actionDefinition: string): boolean {
		return ActionParser.checkActionTriggered(actionDefinition, this.getActionState.bind(this));
	}

	/**
	 * Sets the input map for a specific player.
	 * @param inputMap - The input map to set.
	 */
	public setInputMap(inputMap: InputMap): void {
		this.inputMap = inputMap;
	}

	/**
	 * Retrieves the state of an action.
	 *
	 * @param action - The name of the action.
	 * @returns The state of the action, including whether it is pressed, consumed, the press time, and the timestamp.
	 */
	public getActionState(action: string): ActionState {
		const inputMap = this.inputMap;
		if (!inputMap) return { action, pressed: false, justpressed: false, alljustpressed: false, consumed: false, presstime: null, timestamp: undefined };

		const keyboardKeys = inputMap.keyboard?.[action];
		const gamepadButtons = inputMap.gamepad?.[action];

		/**
		 * Retrieves the state of the specified action, which can be a combination of keyboard keys or gamepad buttons or a single key/button.
		 *
		 * @param keys_or_buttons - An array of keys or button identifiers that make up the action.
		 * @param getStateFunc - A function that takes a button identifier and returns its state.
		 * @returns An object containing:
		 *  - `allPressed`: A boolean indicating if all specified keys/buttons are currently pressed.
		 *  - `anyConsumed`: A boolean indicating if any of the specified keys/buttons have been consumed.
		 *  - `anyJustPressed`: A boolean indicating if any of the specified keys/buttons were just pressed in the current frame, but only if all are pressed.
		 *  - `allJustPressed`: A boolean indicating if all specified keys/buttons were just pressed in the current frame.
		 *  - `leastPressTime`: The minimum press time among the specified keys/buttons, or `null` if none are pressed.
		 *  - `recentestTimestamp`: The maximum timestamp among the specified keys/buttons, or `null` if none are pressed.
		 */
		const getActionState = (keys_or_buttons: ButtonId[], getStateFunc: (key: ButtonId) => ButtonState) => {
			let allPressed = true;
			let allJustPressed = true;
			let anyJustPressed = false;
			let anyConsumed = false;
			let leastPressTime = Infinity;
			let recentestTimestamp = -Infinity;

			if (keys_or_buttons) {
				for (const key of keys_or_buttons) {
					const state = getStateFunc(key);
					allPressed = allPressed && (state?.pressed ?? false);
					allJustPressed = allJustPressed && (state?.justpressed ?? false);
					anyJustPressed = anyJustPressed || (state?.justpressed ?? false);
					anyConsumed = anyConsumed || (state?.consumed ?? false);
					if (state?.presstime) {
						leastPressTime = Math.min(leastPressTime, state.presstime);
					}
					if (state?.timestamp) {
						recentestTimestamp = Math.max(recentestTimestamp, state.timestamp);
					}
				}
			} else {
				allPressed = allJustPressed = false;
				leastPressTime = recentestTimestamp = null;
			}

			// Only consider anyJustPressed if all buttons are pressed, because if any button is not pressed then the action is not just pressed
			anyJustPressed = anyJustPressed && allPressed;

			return { allPressed, anyJustPressed, allJustPressed, anyConsumed, leastPressTime, recentestTimestamp };
		};

		const keyboardState = getActionState(keyboardKeys, (key: ButtonId) => this.getButtonState(key, 'keyboard'));
		const gamepadState = getActionState(gamepadButtons, (button: ButtonId) => this.getButtonState(button, 'gamepad'));
		const minPresstime = Math.min(keyboardState.leastPressTime, gamepadState.leastPressTime);
		const maxTimestamp = Math.max(keyboardState.recentestTimestamp, gamepadState.recentestTimestamp);

		return {
			action: action,
			pressed: keyboardState.allPressed || gamepadState.allPressed,
			justpressed: keyboardState.anyJustPressed || gamepadState.anyJustPressed,
			alljustpressed: keyboardState.allJustPressed || gamepadState.allJustPressed,
			consumed: keyboardState.anyConsumed || gamepadState.anyConsumed,
			presstime: minPresstime === Infinity ? null : minPresstime,
			timestamp: maxTimestamp === -Infinity ? undefined : maxTimestamp,
		};
	}

	/**
	 * Returns all actions that have been pressed for a given player index.
	 * Retrieves an array of pressed ActionStates based on the provided filter.
	 * If no filter is provided, all pressed ActionStates are returned.
	 * if `actionsByPriority` is given, it retrieves the priority actions for a given player index based on the action priority list.
	 * @param filter - An optional array of strings representing the actions to filter.
	 * @returns An array of pressed ActionStates.
	 */
	public getPressedActions(query?: ActionStateQuery): ActionState[] {
		const inputMap = this.inputMap;
		if (!inputMap) return [];

		const pressedActions: ActionState[] = [];

		for (const action in inputMap.keyboard ?? inputMap.gamepad) {
			if (query?.filter && !query.filter.includes(action)) continue; // Skip actions that are not in the filter
			const actionState = this.getActionState(action);
			// Check if the action state matches the query
			if (actionState.pressed === (query?.pressed ?? true) &&
				actionState.justpressed === (query?.justPressed ?? false) &&
				actionState.consumed === (query?.consumed ?? false) &&
				actionState.presstime >= (query?.pressTime ?? 0)) {
				pressedActions.push(actionState);
			}
		}

		if (query?.actionsByPriority) {
			const priorityActions: ActionState[] = [];
			for (const priorityAction of query.actionsByPriority) {
				const actionObject = pressedActions.find(action => action.action === priorityAction);

				if (actionObject) {
					priorityActions.push(actionObject);
				}
			}
			return priorityActions;
		}

		return pressedActions;
	}

	/**
	 * Consumes the input action for the specified player index.
	 * @param actionToConsume The name of the input action to consume.
	 */
	public consumeAction(actionToConsume: ActionState | string) {
		const inputMap = this.inputMap;
		if (!inputMap) return;

		// Determine the action string
		const action: string = (typeof actionToConsume === 'string') ? actionToConsume : actionToConsume.action;

		for (const source in this.inputHandlers) {
			if (!this.inputHandlers[source] || !inputMap[source]) continue;
			const keysOrButtons: KeyboardButton[] | GamepadButton[] = inputMap[source][action];
			if (!keysOrButtons) continue;
			keysOrButtons
				.filter(key => this.inputHandlers[source].getButtonState(key).pressed)
				.forEach(key => this.inputHandlers[source].consumeButton(key));
		}
	}

	/**
	 * Consumes a list of actions.
	 *
	 * @param actions - The actions to consume.
	 */
	public consumeActions(...actions: (ActionState | string)[]) {
		actions.forEach(action => this.consumeAction(action));
	}

	/**
	 * Retrieves the state of a gamepad button.
	 * @param button - The gamepad button identifier.
	 * @returns The state of the button.
	 */
	public getButtonState(button: ButtonId, source: 'keyboard' | 'gamepad'): ButtonState {
		if (source === 'keyboard' && !this.isKeyboardConnected()) return null;
		if (source === 'gamepad' && !this.isGamepadConnected()) return null;
		return this.inputHandlers[source].getButtonState(button);
	}

	/**
	 * Checks if a specific button on a gamepad is currently being pressed down.
	 * @param button - The gamepad button to check.
	 * @returns A boolean indicating whether the button is currently pressed down.
	 */
	public isButtonDown(button: ButtonId, source: 'keyboard' | 'gamepad'): boolean {
		const buttonState = this.getButtonState(button, source);
		return buttonState.pressed;
	}

	/**
	 * Checks if a key or gamepad button is pressed and consumes the input if it is.
	 * @param key - The key to check.
	 * @param button - The gamepad button to check (optional).
	 * @returns `true` if the input was consumed, `false` otherwise.
	 */
	public checkAndConsume(key: ButtonId, button?: ButtonId): boolean {
		const keyState = this.inputHandlers['keyboard']?.getButtonState(key) ?? makeButtonState();

		if (keyState.pressed && !keyState.consumed) {
			this.inputHandlers['keyboard'].consumeButton(key);
			return true;
		}

		if (button !== undefined && this.isGamepadConnected()) {
			const buttonState = this.getButtonState(button, 'gamepad');
			if (buttonState.pressed && !buttonState.consumed) {
				this.inputHandlers['gamepad'].consumeButton(button);
				return true;
			}
		}

		return false;
	}

	/**
	* Assigns a gamepad to a player and returns the player index.
	* If no player index is available, returns null.
	* @param gamepad The gamepad to assign to a player.
	* @returns The player index the gamepad was assigned to, or null if no player index was available.
	*/
	assignGamepadToPlayer(gamepadInput: IInputHandler): void {
		if (this.inputHandlers['gamepad'] && this.inputHandlers['gamepad'] !== gamepadInput) {
			console.warn(`Replacing existing gamepad for player ${this.playerIndex} with gamepad ${gamepadInput.gamepadIndex}.`);
			if (this.inputHandlers['gamepad'] instanceof OnscreenGamepad) {
				console.warn(`Existing gamepad ${gamepadInput.gamepadIndex} is an on-screen gamepad that will be reassigned.`);
			}
		}
		this.inputHandlers['gamepad'] = gamepadInput;

		console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
	}

	/**
	 * Polls the input for the player for each input source (e.g., keyboard, gamepad, ...)
	 */
	pollInput(): void {
		for (const source in this.inputHandlers) {
			this.inputHandlers[source]?.pollInput();
		}
	}

	/**
	 * Initializes the input system.
	 */
	public constructor(playerIndex: number) {
		this.playerIndex = playerIndex;
		this.inputHandlers['gamepad'] = null; // Gamepad should be null by default, and set to a value when a gamepad is connected and assigned to this player
		this.reset();

		window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
			const gamepad = e.gamepad;
			if (!gamepad.id.toLowerCase().includes('gamepad')) return; // Ignore devices that are not gamepads

			if (!this.inputHandlers['gamepad']) return; // No gamepad was not assigned to this input-object, so ignore the event (this can happen if multiple gamepads are connected and one is disconnected)

			if (e.gamepad.index === this.inputHandlers['gamepad'].gamepadIndex) {
				if (this.playerIndex) {
					console.info(`Gamepad ${gamepad.index}, that was assigned to player ${playerIndex}, disconnected.`);
					this.inputHandlers['gamepad'] = null; // Remove gamepad for this input-object

					// If this is the main player, assign the on-screen gamepad to the main player, if the onscreen gamepad is enabled and that onscreen gamepad is not already assigned to another player
					if (this.isMainPlayer && Input.instance.isOnscreenGamepadEnabled) {
						// Check whether the onscreen gamepad is being used by another player
						let isOnscreenGamepadAssignedToAnotherPlayer = false;
						for (let i = 1; i < Input.PLAYERS_MAX; i++) {
							if (i === this.playerIndex) continue;
							const playerInput = Input.instance.getPlayerInput(i);
							if (playerInput.inputHandlers['gamepad'] instanceof OnscreenGamepad) {
								isOnscreenGamepadAssignedToAnotherPlayer = true;
								break;
							}
						}

						if (!isOnscreenGamepadAssignedToAnotherPlayer) {
							Input.instance.enableOnscreenGamepad();
							this.inputHandlers['gamepad'] = Input.instance.getOnscreenGamepad();
							console.info(`On-screen gamepad assigned to player ${playerIndex}, which is the main player.`);
						}
						else {
							console.info(`On-screen gamepad is already assigned to another player and will not be assigned to player ${playerIndex}, which is the main player.`);
						}
					}
				}
			}
		});
	}

	/**
	 * Checks if a keyboard is connected for the specified player index.
	 * @returns True if a ketboard is connected for the specified player index, false otherwise.
	 */
	private isKeyboardConnected(): boolean {
		return !(!this.inputHandlers['keyboard']);
	}

	/**
	 * Checks if a gamepad is connected for the specified player index.
	 * @returns True if a gamepad is connected for the specified player index, false otherwise.
	 */
	private isGamepadConnected(): boolean {
		return !(!this.inputHandlers['gamepad']);
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		for (const source in this.inputHandlers) {
			this.inputHandlers[source]?.reset(except);
		}
	}
}

/**
 * Represents a keyboard input handler that implements the IInputHandler interface.
 *
 * This class manages the state of keyboard keys, allowing for key press detection,
 * consumption of key events, and resetting of input states. It listens for keydown
 * and keyup events to update the state of keys accordingly.
 *
 * @implements {IInputHandler}
 */
class KeyboardInput implements IInputHandler {
	/**
	 * The state of each keyboard key.
	 */
	public keyStates: KeyOrButtonId2ButtonState = {};

	public gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	/**
	 * The index of the input device, which defaults to 0 (the main player).
	 */
	public readonly gamepadIndex = 0;

	constructor() {
		this.keyStates = {};
		this.gamepadButtonStates = {};
		this.reset();

		window.addEventListener('keydown', e => { this.keydown(e.code); }, options);
		window.addEventListener('keyup', e => { this.keyup(e.code); }, options);
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			this.keyStates = {};
			this.gamepadButtonStates = {};
		}
		else {
			resetObject(this.keyStates, except);
			resetObject(this.gamepadButtonStates, except);
		}
	}

	/**
	 * Marks the specified key as consumed, preventing further processing of its state.
	 *
	 * @param key - The identifier of the key to be consumed.
	 * @returns void
	 */
	public consumeButton(key: string): void {
		this.gamepadButtonStates[key].consumed = true;
	}

	/**
	 * Retrieves the current state of a specified button.
	 *
	 * @param key - The identifier for the button whose state is to be retrieved.
	 * @returns The current state of the button as a ButtonState object.
	 *          If the provided key is null, a default ButtonState is returned.
	 */
	public getButtonState(key: string): ButtonState {
		if (key === null) return makeButtonState();
		return getPressedState(this.gamepadButtonStates, key);
	}

	/**
	 * Polls the input from the keyboard.
	 * This function should be called once per frame to ensure that keyboard input is up-to-date.
	 * It updates the state of each key based on the current keydown and keyup events.
	 * @returns void
	 */
	pollInput(): void {
		// Reset gamepad button states
		const defaultState = makeButtonState();

		const newGamepadButtonStates: KeyOrButtonId2ButtonState = {};
		Object.keys(this.keyStates).forEach(buttonId => {
			if (this.keyStates[buttonId].pressed) {
				// Update the state only if the button is currently pressed
				newGamepadButtonStates[buttonId] = { pressed: true, presstime: (this.gamepadButtonStates[buttonId]?.presstime ?? 0) + 1, consumed: this.gamepadButtonStates[buttonId]?.consumed ?? false, timestamp: this.gamepadButtonStates[buttonId]?.timestamp ?? performance.now(), justpressed: (this.gamepadButtonStates[buttonId]?.presstime ?? 0) === 0 };
			} else {
				newGamepadButtonStates[buttonId] = { ...defaultState };
			}

			// Use the constant to map keyboard keys to gamepad buttons
			const keyMappedToCorrespondingGamepadButtonId = Input.KEYBOARDKEY2GAMEPADBUTTON[buttonId];
			if (keyMappedToCorrespondingGamepadButtonId) {
				newGamepadButtonStates[keyMappedToCorrespondingGamepadButtonId] = { ...newGamepadButtonStates[buttonId] };
			}
		});

		// Update the button states with the new states
		this.gamepadButtonStates = newGamepadButtonStates;
	}

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: KeyboardButtonId | string): void {
		if (!this.keyStates[key_code]) {
			this.keyStates[key_code] = makeButtonState({ pressed: true, justpressed: true, presstime: 0, timestamp: performance.now() });
		}
		else {
			this.keyStates[key_code].pressed = true;
		}
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	keyup(key_code: KeyboardButtonId | string): void {
		if (!this.keyStates[key_code]) return;

		this.keyStates[key_code].pressed = this.keyStates[key_code].consumed = this.keyStates[key_code].justpressed = false;
		this.keyStates[key_code].presstime = this.keyStates[key_code].timestamp = null;
	}

	/**
	 * Handles the blur event of the input element by resetting the input state.
	 * @param _e - The blur event object.
	 */
	blur(_e: FocusEvent): void {
		// this.preventInput = true; // Prevent input when the window loses focus
		this.reset();
	}

	/**
	 * Handles the focus event for the input element by resetting the input state.
	 * Resets the input state.
	 * @param _e - The focus event object.
	 */
	focus(_e: FocusEvent): void {
		this.reset();
		// this.preventInput = false; // Allow input when the window regains focus
	}
}

/**
 * Represents a handler for gamepad input.
 * Implements the IInputHandler interface to manage and poll the state of a gamepad.
 *
 * @class GamepadInput
 * @implements {IInputHandler}
 */
class GamepadInput implements IInputHandler {
	/**
	 * Gets the index of the gamepad.
	 * @returns The index of the gamepad, or `null` if no gamepad is connected.
	 */
	public get gamepadIndex(): number | null {
		return this.gamepad?.index ?? null;
	}

	private _gamepad: Gamepad;
	/**
	 * Gets the current gamepad instance.
	 * @returns The current Gamepad object.
	 */
	public get gamepad(): Gamepad { return this._gamepad; }

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	/**
	 * Creates an instance of the class and initializes the gamepad.
	 *
	 * @param gamepad - The Gamepad object to be associated with this instance.
	 *
	 * This constructor also resets the gamepad button states upon initialization.
	 */
	constructor(gamepad: Gamepad) {
		this._gamepad = gamepad;

		// Reset gamepad button states
		this.reset();
	}

	/**
	 * Polls the input from the assigned gamepad for this player.
	 * If no gamepad is assigned, or if the browser does not support the gamepads API,
	 * or if the gamepad index is out of range of the connected gamepads array,
	 * this method does nothing.
	 * This function should be called once per frame to ensure that gamepad input is up-to-date.
	 */
	public pollInput(): void {
		if (this.gamepadIndex === null || !this.gamepad) return; // No gamepad was assigned to this GamepadInput-object
		const gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined); // Get gamepads from browser API
		if (!gamepads) return; // Browser does not support gamepads API
		if (gamepads.length < this.gamepadIndex) return; // Gamepad index is out of range of connected gamepads array (this can happen if multiple gamepads are connected and one is disconnected)
		this._gamepad = gamepads[this.gamepadIndex]; // Update gamepad reference

		// Reset gamepad button states
		const defaultState = makeButtonState();
		Input.BUTTON_IDS.forEach(button => {
			if (!this.gamepadButtonStates[button]) {
				this.gamepadButtonStates[button] = { ...defaultState };
			}
		});

		// Check whether any axes have been triggered
		this.pollGamepadAxes(this.gamepad);

		// Check button states
		this.pollGamepadButtons(this.gamepad);
	}

	/**
	 * Polls the state of the axes on the given gamepad and updates the corresponding button states.
	 * @param gamepad The gamepad to poll.
	 */
	private pollGamepadAxes(gamepad: Gamepad): void {
		if (!gamepad) return; // Will be null if the gamepad was disconnected
		// TODO: IMPLEMENT DPAD SUPPORT
		const [xAxis, yAxis] = gamepad.axes;
		this.gamepadButtonStates['left'].pressed = xAxis < -0.5;
		this.gamepadButtonStates['right'].pressed = xAxis > 0.5;
		this.gamepadButtonStates['up'].pressed = yAxis < -0.5;
		this.gamepadButtonStates['down'].pressed = yAxis > 0.5;
	}

	/**
	 * Polls the state of all buttons on the given gamepad and updates the corresponding button states.
	 * @param gamepad The gamepad to poll.
	 */
	private pollGamepadButtons(gamepad: Gamepad): void {
		if (!gamepad) return; // Will be null if the gamepad was disconnected
		const buttons = gamepad.buttons;
		if (!buttons) return;
		for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
			const gamepadButton = buttons[btnIndex];
			const pressed = typeof gamepadButton === 'object' ? gamepadButton.pressed : gamepadButton === 1.0;
			// Consider that the button can already be regarded as pressed if it was pressed as part of an axis (which is also regarded as a button press)
			const buttonId = Input.INDEX2BUTTON[btnIndex];
			const oldPressTime = this.gamepadButtonStates[buttonId].presstime ?? 0;
			this.gamepadButtonStates[buttonId].pressed = buttonId === 'left' || buttonId === 'right' || buttonId === 'up' || buttonId === 'down'
				? this.gamepadButtonStates[buttonId].pressed || pressed
				: pressed;

			if (this.gamepadButtonStates[buttonId].pressed) {
				// If the button is pressed, increment the press time counter for detecting hold actions
				this.gamepadButtonStates[buttonId].presstime = oldPressTime + 1;
				// Set the timestamp only if it was not set before
				this.gamepadButtonStates[buttonId].timestamp ||= performance.now();
				// Set the justpressed flag if the button was not pressed before this poll
				this.gamepadButtonStates[buttonId].justpressed = oldPressTime === 0;
			} else {
				// Reset the button state if it is not pressed
				this.gamepadButtonStates[buttonId] = makeButtonState();
			}
		}
	}

	/**
	 * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
	 * @param btn - The index of the button to check the state of.
	 * @returns The pressed state of the button.
	 */
	public getButtonState(btn: string): ButtonState {
		const stateMap = this.gamepadButtonStates;
		return getPressedState(stateMap, btn);
	}

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(button: string) {
		this.gamepadButtonStates[button].consumed = true;
	}

	/**
	 * Resets the state of all gamepad buttons.
	 * @param except An optional array of buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			// Initialize the states of all gamepad buttons and axes
			Object.values(this.gamepadButtonStates).forEach(state => {
				state.pressed = false;
				state.consumed = false;
				state.presstime = null;
				state.timestamp = null;
			});
		}
		else {
			resetObject(this.gamepadButtonStates, except);
		}
	}
}

/**
 * Represents an on-screen gamepad for handling input in a game.
 * Implements the IInputHandler interface to manage gamepad button states,
 * including touch events for both directional and action buttons.
 * It is used to simulate gamepad input on touch devices, and is intended to be used in conjunction with the {@link Input} class.
 *
 * @class OnscreenGamepad
 * @implements {IInputHandler}
 */
class OnscreenGamepad implements IInputHandler {
	/**
	 * The index of the gamepad used for input.
	 * @remarks
	 * This value is set to 7 by default.
	 */
	public readonly gamepadIndex = 7;

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	/**
	 * Hides the specified buttons.
	 * @param gamepad_button_ids An array of button names to hide.
	 * @throws Error if no HTML element is found matching a button name.
	 */
	public static hideButtons(gamepad_button_ids: string[]): void {
		gamepad_button_ids.forEach(b => {
			const elementId = OnscreenGamepad.ACTION_BUTTON_TO_ELEMENTID_MAP[b];
			if (!elementId) throw new Error(`Error while attempting to hide your buttons - no HTML elementID found matching button '${b}'.`);
			const element = document.getElementById(elementId);
			const textElement = document.getElementById(`${elementId}_text`);
			if (!element) throw new Error(`Error while attempting to hide your buttons - no HTML element found matching button '${b}' and elementID '${elementId}'.`);
			if (!textElement) throw new Error(`Error while attempting to hide your buttons - no HTML *text* element found matching button '${b}' and elementID '${elementId}'.`);
			element.classList.add('hidden');
			textElement.classList.add('hidden');
		});
	}

	/**
	 * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
	 * @param btn - The index of the button to check the state of.
	 * @returns The pressed state of the button.
	 */
	public getButtonState(btn: string): ButtonState {
		const stateMap = this.gamepadButtonStates || {};
		return getPressedState(stateMap, btn);
	}

	/**
	 * Polls the input to update the button states and press times.
	 * This method should be called once per frame to ensure that gamepad input is up-to-date.
	 * It uses the `touched` attribute (in the dataset) of the on-screen buttons to determine if they are currently being pressed.
	 */
	public pollInput(): void {
		// Initialize new states with current values instead of resetting
		const defaultState = makeButtonState();

		const newGamepadButtonStates: KeyOrButtonId2ButtonState = {};

		Input.BUTTON_IDS.forEach(button => {
			newGamepadButtonStates[button] = this.gamepadButtonStates[button] ?? { ...defaultState };
		});

		for (let i = 0; i < OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.length; i++) {
			const d = document.getElementById(OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES[i]);
			const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[d.id];
			if (buttonData) {
				buttonData.buttons.forEach(button => {
					if (d.dataset.touched === 'true') {
						const oldPressTime = this.gamepadButtonStates[button].presstime ?? 0;
						// Update the state only if the button is currently pressed
						newGamepadButtonStates[button].pressed = true;
						newGamepadButtonStates[button].presstime = oldPressTime + 1;
						newGamepadButtonStates[button].consumed ??= false;
						newGamepadButtonStates[button].timestamp ??= performance.now();
						newGamepadButtonStates[button].justpressed = oldPressTime === 0;
					} else {
						// Set to false only if no other element is pressing this button
						if (!this.isOtherElementPressingButton(button)) {
							newGamepadButtonStates[button] = { ...defaultState }; // TODO: IS THIS REQUIRED AS WE ARE SETTING THE STATE TO DEFAULT BEFORE THE LOOP?
						}
					}
				});
			}
		}

		// Update the button states with the new states
		this.gamepadButtonStates = newGamepadButtonStates;
	}

	/**
	 * Checks if any other on-screen gamepad element is currently pressing the specified button.
	 *
	 * @param button - The identifier of the button to check for.
	 * @returns True if any element is pressing the button; otherwise, false.
	 */
	private isOtherElementPressingButton(button: string): boolean {
		return OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.some(dpadId => {
			const element = document.getElementById(dpadId);
			return element && element.dataset.touched === 'true' && OnscreenGamepad.ALL_BUTTON_MAP[element.id].buttons.includes(button);
		});
	}

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(button: string) {
		if (this.gamepadButtonStates[button]) this.gamepadButtonStates[button].consumed = true;
	}

	/**
	 * A mapping of directional pad (D-Pad) button combinations to their corresponding button arrays.
	 *
	 * Each key represents a specific D-Pad direction or combination, and the value is an object containing
	 * an array of buttons that are associated with that direction. The buttons are validated to be of type
	 * `GamepadButton`.
	 */
	private static readonly DPAD_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		'd-pad-u': {
			buttons: ['up' satisfies GamepadButton],
		},
		'd-pad-ru': {
			buttons: ['up' satisfies GamepadButton, 'right' satisfies GamepadButton],
		},
		'd-pad-r': {
			buttons: ['right' satisfies GamepadButton],
		},
		'd-pad-rd': {
			buttons: ['right' satisfies GamepadButton, 'down' satisfies GamepadButton],
		},
		'd-pad-d': {
			buttons: ['down' satisfies GamepadButton],
		},
		'd-pad-ld': {
			buttons: ['down' satisfies GamepadButton, 'left' satisfies GamepadButton],
		},
		'd-pad-l': {
			buttons: ['left' satisfies GamepadButton],
		},
		'd-pad-lu': {
			buttons: ['left' satisfies GamepadButton, 'up' satisfies GamepadButton],
		},
	}

	/**
	 * A mapping of action buttons to their corresponding GamepadButton representations.
	 *
	 * Each key in the ACTION_BUTTON_MAP represents a specific action button, and the value
	 * is an object containing an array of button identifiers that satisfy the GamepadButton type.
	 *
	 * Note: Some buttons like 'lt_knop', 'rt_knop', and 'home_knop' are commented out and not currently in use.
	 */
	private static readonly ACTION_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		'a_knop': {
			buttons: ['a' satisfies GamepadButton],
		},
		'b_knop': {
			buttons: ['b' satisfies GamepadButton],
		},
		'x_knop': {
			buttons: ['x' satisfies GamepadButton],
		},
		'y_knop': {
			buttons: ['y' satisfies GamepadButton],
		},
		'ls_knop': {
			buttons: ['ls' satisfies GamepadButton],
		},
		'rs_knop': {
			buttons: ['rs' satisfies GamepadButton],
		},
		// 'lt_knop': {
		// 	buttons: ['lt' satisfies GamepadButton],
		// },
		// 'rt_knop': {
		// 	buttons: ['rt' satisfies GamepadButton],
		// },
		'select_knop': {
			buttons: ['select' satisfies GamepadButton],
		},
		'start_knop': {
			buttons: ['start' satisfies GamepadButton],
		},
		// 'home_knop': {
		//     buttons: ['home' satisfies GamepadButton],
		// },
	}

	/**
	 * Maps action button names to corresponding element names.
	 * Used for hiding buttons at game start.
	 */
	private static readonly ACTION_BUTTON_TO_ELEMENTID_MAP: Record<string, string> = {
		'a': 'a_knop',
		'b': 'b_knop',
		'x': 'x_knop',
		'y': 'y_knop',
		'ls': 'ls_knop',
		'rs': 'rs_knop',
		'lt': 'lt_knop',
		'rt': 'rt_knop',
		'select': 'select_knop',
		'start': 'start_knop',
		// 'home': 'home_knop',
	}

	/**
	* Mapping of button names to their corresponding key inputs.
	*/
	private static readonly ALL_BUTTON_MAP: Record<string, { buttons: string[] }> = {
		...OnscreenGamepad.DPAD_BUTTON_MAP,
		...OnscreenGamepad.ACTION_BUTTON_MAP,
	}

	/**
	 * A list of element IDs representing the directional pad (D-Pad) buttons.
	 */
	private static readonly DPAD_BUTTON_ELEMENT_IDS = ['d-pad-u', 'd-pad-ru', 'd-pad-r', 'd-pad-rd', 'd-pad-d', 'd-pad-ld', 'd-pad-l', 'd-pad-lu'];
	private static readonly ACTION_BUTTON_ELEMENT_IDS = ['btn1_knop', 'btn2_knop', 'btn3_knop', 'btn4_knop', 'ls_knop', 'rs_knop', 'lt_knop', 'rt_knop', 'select_knop', 'start_knop', 'home_knop'];

	private static readonly ONSCREEN_BUTTON_ELEMENT_NAMES = Object.keys(OnscreenGamepad.ALL_BUTTON_MAP);

	/**
	 * Initializes the input system.
	 * Sets up event listeners for touch and mouse input,
	 * and resets the gamepad button states.
	 */
	public init(): void {
		// Reset gamepad button states
		this.reset();
		const addTouchListeners = (controlsElement: HTMLElement, action_type: 'dpad' | 'action') => {
			controlsElement.addEventListener('touchmove', e => { this.handleTouchMove(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchstart', e => { this.handleTouchStart(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchend', e => { this.handleTouchEnd(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchcancel', e => { this.handleTouchEnd(e, action_type); return true; }, options);
		}

		addTouchListeners(document.getElementById('d-pad-controls')!, 'dpad');
		addTouchListeners(document.getElementById('button-controls')!, 'action');
		// Prevent default touch events for all other elements in the DOM
		document.addEventListener('touchstart', e => { e.preventDefault(); return true; }, options);

		window.addEventListener('blur', e => this.blur(e), false); // Blur event will pause the game and prevent any input from being registered and reset the key states
		window.addEventListener('focus', e => this.focus(e), false); // Focus event will allow input to be registered again
		window.addEventListener('mouseout', () => this.reset(), options); // Reset input states when mouse leaves the window
	}

	/**
	 * Resets the state of all gamepad buttons.
	 * @param except An optional array of buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			// Initialize the states of all gamepad buttons and axes
			Input.BUTTON_IDS.forEach(buttonId => this.gamepadButtonStates[buttonId] = makeButtonState());
		}
		else {
			resetObject(this.gamepadButtonStates, except);
		}
	}

	/**
	 * Resets the state of all UI elements related to the gamepad this.
	 * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
	 * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
	 */
	public resetUI(elementsToFilterById?: string[]): void {
		const resetElementAndButtonPress = (element_id: string): void => {
			const element = document.getElementById(element_id);
			if (element.classList.contains('druk')) {
				element.classList.remove('druk');
				element.classList.add('los');
				element.dataset.touched = 'false';

				const textElement = document.getElementById(`${element_id}_text`);
				if (textElement && textElement.classList.contains('druk')) {
					textElement.classList.remove('druk');
					textElement.classList.add('los');
				}
			}

			// Also reset the state of the button
			const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[element_id];
			if (buttonData) {
				buttonData.buttons.forEach(button => {
					this.gamepadButtonStates[button].pressed = false;
				});
			}
		}

		if (elementsToFilterById) {
			OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(element => !elementsToFilterById.includes(element) && resetElementAndButtonPress(element));
		}
		else {
			OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(resetElementAndButtonPress);
		}
	}

	/**
	 * Handles the touch move event for a specific control type on the on-screen gamepad.
	 * This function is used to handle touch move events for the on-screen gamepad controls.
	 * It is called when the user moves their finger across the screen while touching the on-screen gamepad.
	 * The function checks which elements are being touched and updates the UI accordingly.
	 * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
	 * If an element is not touched, it adds the 'los' class to it and removes the 'druk' class.
	 * It considers the control-type to determine which elements to filter from the reset.
	 * @param e - The touch event.
	 * @param control_type - The type of control ('dpad' or 'action').
	 */
	handleTouchMove(e: TouchEvent, control_type: 'dpad' | 'action'): void {
		if (e.touches.length === 0) {
			return;
		}

		switch (control_type) {
			case 'action':
				const target = e.target as HTMLElement;
				let foundTarget = false;
				for (let i = 0; i < e.touches.length; i++) {
					let pos = e.touches[i];
					const elementsUnderTouch = document.elementsFromPoint(pos.clientX, pos.clientY) as HTMLElement[];
					if (elementsUnderTouch && elementsUnderTouch.length > 0) {
						if (elementsUnderTouch.includes(target)) {
							foundTarget = true;
						}
					}
				}

				if (!foundTarget) {
					this.handleTouchEnd(e, control_type);
				}
				break;
			case 'dpad':
				this.handleTouchStart(e, control_type);
				break;
		}
	}

	/**
	 * Handles touch events by resetting the UI and checking which elements were touched.
	 * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
	 * It also filters the touched buttons from the reset.
	 * @param e The touch event to handle.
	 */
	handleTouchStart(e: TouchEvent, control_type: 'dpad' | 'action'): void {
		const dpad_omheining = document.getElementById('d-pad-omheining') as HTMLElement;
		switch (control_type) {
			case 'action':
				this.resetUI(OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
				break;
			case 'dpad':
				this.resetUI(OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
				// Remove all classes from dpad_omheining
				dpad_omheining.classList.remove(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
				break;
		}

		if (e.touches.length === 0) {
			return;
		}

		const filterFromReset: string[] = [];
		const elementsToFilter: string[] = [];
		const dpadMappings = {
			'd-pad-lu': ['d-pad-u', 'd-pad-l'],
			'd-pad-u': ['d-pad-lu', 'd-pad-ru'],
			'd-pad-ru': ['d-pad-u', 'd-pad-r'],
			'd-pad-r': ['d-pad-ru', 'd-pad-rd'],
			'd-pad-ld': ['d-pad-d', 'd-pad-l'],
			'd-pad-d': ['d-pad-ld', 'd-pad-rd'],
			'd-pad-rd': ['d-pad-d', 'd-pad-r'],
			'd-pad-l': ['d-pad-lu', 'd-pad-ld'],
		};
		for (let i = 0; i < e.touches.length; i++) {
			let pos = e.touches[i];
			const elementsUnderTouch = document.elementsFromPoint(pos.clientX, pos.clientY) as HTMLElement[];
			if (elementsUnderTouch) {
				for (let j = 0; j < elementsUnderTouch.length; j++) {
					const elementUnderTouch = elementsUnderTouch[j];
					let buttonsTouched: string[];
					switch (control_type) {
						case 'action':
							buttonsTouched = OnscreenGamepad.ACTION_BUTTON_MAP[elementUnderTouch.id]?.buttons;
							break;
						case 'dpad':
							buttonsTouched = OnscreenGamepad.DPAD_BUTTON_MAP[elementUnderTouch.id]?.buttons;
							break;
					}
					if (buttonsTouched?.length > 0) {
						elementUnderTouch.dataset.touched = 'true';
						elementsToFilter.push(elementUnderTouch.id);

						buttonsTouched.forEach(b => filterFromReset.push(b));
						if (dpadMappings[elementUnderTouch.id]) {
							elementsToFilter.push(...dpadMappings[elementUnderTouch.id]);
							dpad_omheining.classList.add(elementUnderTouch.id);
						}
					}
				}
			}
		}

		for (let i = 0; i < elementsToFilter.length; i++) {
			const elementToFilter = elementsToFilter[i];
			const element = document.getElementById(elementToFilter) as HTMLElement;
			element.classList.add('druk');
			element.classList.remove('los');
			if (control_type === 'action') {
				const textElement = document.getElementById(`${elementToFilter}_text`);
				textElement.classList.add('druk');
				textElement.classList.remove('los');
			}
		}

		switch (control_type) {
			case 'action':
				elementsToFilter.push(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
				break;
			case 'dpad':
				elementsToFilter.push(...OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
				break;
		}

		this.resetUI(elementsToFilter);
	}

	/**
	 * Handles the touch end event for the specified control type.
	 * This function is used to handle touch end events for the on-screen gamepad controls.
	 * It is called when the user lifts their finger off the screen after touching the on-screen gamepad.
	 * The function checks which controls where touched before the user lifted their finger
	 * and resets the UI for those controls and leaves the rest as they are.
	 *
	 * @param _e - The touch event object.
	 * @param control_type - The type of control ('dpad' or 'action').
	 */
	handleTouchEnd(_e: TouchEvent, control_type: 'dpad' | 'action'): void {
		switch (control_type) {
			case 'action':
				this.resetUI(OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
				break;
			case 'dpad':
				const dpad_omheining = document.getElementById('d-pad-omheining') as HTMLElement;
				// Remove all classes from dpad_omheining
				dpad_omheining.classList.remove(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
				this.resetUI(OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
				break;
		}
	}

	/**
	 * Handles the blur event for the input element.
	 * Resets the input state.
	 * @param _e - The blur event object.
	 */
	blur(_e: FocusEvent): void {
		this.reset();
	}

	/**
	 * Sets the focus on the element and resets its state.
	 * @param _e - The focus event.
	 */
	focus(_e: FocusEvent): void {
		this.reset();
	}
}
