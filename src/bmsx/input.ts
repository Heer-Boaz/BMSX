import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseUp, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventEmitter } from './eventemitter';
import { ZCOORD_MAX } from './glview';
import { SpriteObject } from './sprite';
import type { IRegisterable, Identifier } from "./game";
import { Registry } from './registry';
import { StateMachineBlueprint, build_fsm, State } from './bfsm';

export type ActionStateQuery = {
	filter?: string[];
	pressed?: boolean;
	consumed?: boolean;
	pressTime?: number;
	actionsByPriority?: string[];
};

/**
 * Represents the ID of a button.
 * It can be one of the predefined values 'BTN1', 'BTN2', 'BTN3', 'BTN4',
 * or a custom Key value.
 */
type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;

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
 * Prevents the default action, propagation, and immediate propagation of an event.
 *
 * @param e The event object.
 * @returns Returns false.
 */
// function preventAction(e: Event): boolean {
//     e.preventDefault();
//     return false;
// }

function resetObject(obj: Index2State | Index2PressTime, except?: string[]) {
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
 * @param key - The key or button to check the state of.
 * @returns The pressed state of the key or button.
 */
function getPressedState(
	stateMap: Index2State,
	consumedStateMap: Index2State,
	pressTimeMap: Index2PressTime,
	key: string | number
): ButtonState {
	return { pressed: stateMap[key] ?? false, consumed: consumedStateMap[key] ?? false, presstime: pressTimeMap[key] ?? null };
}

/**
 * Represents the state of an index in the Index2State type.
 */
type Index2State = { [index: string | number]: boolean; }

type Index2PressTime = { [index: string | number]: number | null; }
/**
 * Represents a mapping of keyboard inputs to actions.
 */
export type KeyboardInputMapping = {
	[action: string]: KeyboardButton;
}

/**
 * Represents a mapping of gamepad inputs to gamepad buttons.
 */
export type GamepadInputMapping = {
	[action: string]: GamepadButton;
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
export type GamepadButton = keyof typeof Input.BUTTON2INDEX;

/**
 * Represents the state of a button.
 */
export type ButtonState = { pressed: boolean; consumed: boolean; presstime: number | null; };
/**
 * Represents the state of an action, including the action name and button state.
 */
export type ActionState = { action: string } & ButtonState;

// Abstract Input Handler Interface
interface IInputHandler {
	pollInput(): void;
	getButtonState(btn: number | null): ButtonState;
	consumeButton(button: number): void;
	reset(except?: string[]): void;
	get gamepadIndex(): number;
}


const options = {
	passive: false,
	once: false,
};


class SelectedPlayerIndexIcon extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			on: {
				$animation_end: {
					do: function (this: SelectedPlayerIndexIcon) {
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
					enter: function (this: SelectedPlayerIndexIcon) {
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

	public static getIconId(gamepadIndex: number): Identifier {
		return `joystick_icon_${gamepadIndex ?? 0}`;
	}

	constructor(public gamepadIndex: number) {
		super(SelectedPlayerIndexIcon.getIconId(gamepadIndex));
		this.z = ZCOORD_MAX;
		this.colorize = { r: 1, g: 1, b: 1, a: .75 };
	}

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

class PendingAssignmentProcessor {
	private static readonly joystick_icon_start = { x: 0, y: 0 };
	private static readonly joystick_icon_increment_x = 32;
	private get pendingIndex() { return this.gamepadInput.gamepadIndex; } // DOESN'T WORK, AS THE GAMEPAD INDEX 0 WILL OVERLAP THE HARDCODED INDEX 0 OF ON-SCREEN GAMEPAD!

	private icon: SelectedPlayerIndexIcon = null;

	private checkNonConsumedPressed(button: GamepadButton, gamepadInput: IInputHandler) {
		return gamepadInput.getButtonState(Input.BUTTON2INDEX[button]).pressed && !gamepadInput.getButtonState(Input.BUTTON2INDEX[button]).consumed;
	}

	private calcIconPositionX(positionIndex: number) { return PendingAssignmentProcessor.joystick_icon_start.x + (PendingAssignmentProcessor.joystick_icon_increment_x * (positionIndex ?? 0)) };
	private handleSelectPlayerIndexButtonPress(button: GamepadButton, increment: number, gamepadInput: IInputHandler) {
		if (this.checkNonConsumedPressed(button, gamepadInput)) {
			gamepadInput.consumeButton(Input.BUTTON2INDEX[button]);

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

	constructor(public gamepadInput: IInputHandler, public proposedPlayerIndex: number | null) {
		const self = this;
		window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
			const gamepad = e.gamepad;
			if (!gamepad.id.toLowerCase().includes('gamepad')) return;

			if (!self.gamepadInput) return; // No gamepad was not assigned to this object, so ignore the event (should not happen).
			const gamepadIndex = e.gamepad.index;
			if (gamepadIndex === self.gamepadInput.gamepadIndex) {
				// No player was assigned to this gamepad yet, but this input object was used for polling input from the gamepad
				console.info(`Gamepad ${gamepad.index} disconnected while pending assignment.`);
				Input.instance.removePendingGamepadAssignment(gamepadIndex); // Remove pending gamepad assignment
			}
		});
	}

	run(): void {
		const inputMaestro = Input.instance;
		const gamepadInput = this.gamepadInput
		gamepadInput.pollInput();

		// Check whether the start button was pressed and not consumed yet to assign the gamepad to a player
		if (this.proposedPlayerIndex === null) {
			if (this.checkNonConsumedPressed('start', gamepadInput)) {
				gamepadInput.consumeButton(Input.BUTTON2INDEX['start']);
				const proposedPlayerIndex = inputMaestro.getFirstAvailablePlayerIndexForGamepadAssignment();

				if (proposedPlayerIndex !== null) {
					this.proposedPlayerIndex = proposedPlayerIndex;
					this.createSelectPlayerIconIfNeeded(this.gamepadInput, this.pendingIndex);
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
				gamepadInput.consumeButton(Input.BUTTON2INDEX['a']);
				inputMaestro.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
				inputMaestro.removePendingGamepadAssignment(this.gamepadInput.gamepadIndex);
				$.emit('controller_assigned', Input.instance, this.proposedPlayerIndex);
				this.icon = null;
			}
			else if (this.checkNonConsumedPressed('b', gamepadInput)) {
				// Cancel assignment process for this gamepad and remove the joystick icon
				gamepadInput.consumeButton(Input.BUTTON2INDEX['b']);
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

	removeIcon(): void {
		if (this.icon) {
			$.model.exile(this.icon);
			this.icon = undefined;
		}
	}
}

export class Input implements IRegisterable {
	private static _instance: Input;

	public static PLAYERS_MAX = 4;
	public static PLAYER_MAX_INDEX = Input.PLAYERS_MAX - 1;

	public static get instance(): Input {
		if (!Input._instance) {
			Input._instance = new Input();
		}

		return Input._instance;
	}

	private playerInputs: PlayerInput[] = [];
	private pendingGamepadAssignments: PendingAssignmentProcessor[] = [];
	private onscreenGamepad: OnscreenGamepad;

	public getOnscreenGamepad(): OnscreenGamepad {
		return this.onscreenGamepad;
	}

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
	 * @throws Error if no HTML element is found matching a button name.
	 */
	public hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void {
		OnscreenGamepad.hideButtons(gamepad_button_ids);
	}

	/**
	* The mapping of gamepad button names to their corresponding indices.
	*/
	public static readonly BUTTON2INDEX = {
		'a': 0, // Bottom face button
		'b': 1, // Right face button
		'x': 2, // Left face button
		'y': 3, // Top face button
		'lb': 4, // Left shoulder button
		'rb': 5, // Right shoulder button
		'lt': 6, // Left trigger button
		'rt': 7, // Right trigger button
		'select': 8, // Select button
		'start': 9, // Start button
		'ls': 10, // Left stick button
		'rs': 11, // Right stick button
		'up': 12, // D-pad up
		'down': 13, // D-pad down
		'left': 14, // D-pad left
		'right': 15, // D-pad right
		'home': 16, // Xbox button
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
		16: 'home', // Xbox button
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

	public get id(): Identifier { return 'input'; }

	/**
	 * Initializes the input system.
	 * @param debug Whether to enable debug mode. Default is true.
	 */
	constructor() {
		const self = this;
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
		window.addEventListener("gamepadconnected", function (e: GamepadEvent) {
			const gamepad = e.gamepad;
			if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) return;
			console.info(`Gamepad ${gamepad.index} connected.`);
			self.addPendingGamepadAssignment(gamepad)
		});

		document.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
		window.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
		document.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
		window.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
		document.addEventListener('contextmenu', e => {
			if (e.target === document.getElementById('gamescreen')) {
				return true; // Allow context menu on gamescreen
			} else {
				e.preventDefault(); // Suppress context menu on rest of document
				return false;
			}
		}, false);
		document.addEventListener('touchforcechange', e => preventActionAndPropagation(e), options);// iOS -- https://stackoverflow.com/questions/58159526/draggable-element-in-iframe-on-mobile-is-buggy && iOS -- https://stackoverflow.com/questions/50980876/can-you-prevent-3d-touch-on-an-img-but-not-tap-and-hold-to-save

		this.getPlayerInput(1).keyboardInput = new KeyboardInput();
	}

	public get isOnscreenGamepadEnabled(): boolean {
		const controls = document.getElementById('d-pad-controls');
		return !controls!.hidden;
	}

	public enableOnscreenGamepad(): void {
		this.onscreenGamepad ??= new OnscreenGamepad();
		this.onscreenGamepad.init();
		this.getPlayerInput(1).gamepadInput = this.onscreenGamepad;
	}

	public enableDebugMode(): void {
		const gamescreen = document.getElementById('gamescreen');
		gamescreen.addEventListener('click', this.handleDebugEvents, options);
		gamescreen.addEventListener('mousedown', this.handleDebugEvents, options);
		gamescreen.addEventListener('mousemove', this.handleDebugEvents, options);
		gamescreen.addEventListener('mouseup', this.handleDebugEvents, options);
		gamescreen.addEventListener('mouseout', this.handleDebugEvents, options);
		gamescreen.addEventListener('contextmenu', e => this.handleDebugEvents(e), options);
		window.addEventListener('keydown', e => this.handleDebugEvents(e), options);
		// window.addEventListener('click', function (e) {
		//     if ((e.target as Element).matches('ul.tree li:before')) {
		//         const parentNode = (e.target as HTMLElement).parentNode as HTMLElement;
		//         parentNode?.classList.toggle('open');
		//     }
		// });
	}

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

	public pollInput(): void {
		this.playerInputs.forEach(player => {
			player.pollInput();
			const gamepadInput = player.gamepadInput;
			if (gamepadInput) {
				const buttonState = gamepadInput.getButtonState(Input.BUTTON2INDEX['start']);
				if (buttonState.pressed && buttonState.presstime >= 50) {
					gamepadInput.reset();
					player.gamepadInput = null;
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

	public isPlayerIndexAvailableForGamepadAssignment(playerIndex: number): boolean {
		const playerInput = this.getPlayerInput(playerIndex);
		return (!playerInput.gamepadInput && !this.pendingGamepadAssignments.some(pending => pending.proposedPlayerIndex === playerInput.playerIndex));
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
		const index = this.pendingGamepadAssignments.findIndex(pending => pending.gamepadInput.gamepadIndex === gamepadIndex);
		if (index !== -1) {
			// const pendingAssignmentProcessor = this.pendingGamepadAssignments[index];
			this.pendingGamepadAssignments.splice(index, 1);
			// pendingAssignmentProcessor.removeIcon(); // Dispose the joystick icon
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
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowUp', Input.BUTTON2INDEX.up);
	}

	public static get KC_RIGHT(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowRight', Input.BUTTON2INDEX.right);
	}

	public static get KC_DOWN(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowDown', Input.BUTTON2INDEX.down);
	}

	public static get KC_LEFT(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ArrowLeft', Input.BUTTON2INDEX.left);
	}

	public static get KC_BTN1(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('ShiftLeft', Input.BUTTON2INDEX.a);
	}

	public static get KC_BTN2(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('KeyZ', Input.BUTTON2INDEX.b);
	}

	public static get KC_BTN3(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F1', Input.BUTTON2INDEX.x);
	}

	public static get KC_BTN4(): boolean {
		return Input.instance.getPlayerInput(1).checkAndConsume('F5', Input.BUTTON2INDEX.y);
	}

	public static get KD_F1(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F1').pressed;
	}
	public static get KD_F12(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F12').pressed;
	}
	public static get KD_F2(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F2').pressed;
	}
	public static get KD_F3(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F3').pressed;
	}
	public static get KD_F4(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F4').pressed;
	}
	public static get KD_F5(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F5').pressed;
	}
	public static get KD_M(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('KeyM').pressed;
	}
	public static get KD_SPACE(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('Space').pressed;
	}
	public static get KD_UP(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('ArrowUp').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.up).pressed;
	}
	public static get KD_RIGHT(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('ArrowRight').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.right).pressed;
	}
	public static get KD_DOWN(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('ArrowDown').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.down).pressed;
	}
	public static get KD_LEFT(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('ArrowLeft').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.left).pressed;
	}
	public static get KD_BTN1(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('ShiftLeft').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.a).pressed;
	}
	public static get KD_BTN2(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('KeyZ').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.b).pressed;
	}
	public static get KD_BTN3(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F1').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.x).pressed;
	}
	public static get KD_BTN4(): boolean {
		return Input.instance.getPlayerInput(1).getKeyState('F5').pressed || Input.instance.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.y).pressed;
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
					if (this.getPlayerInput(1).getKeyState(e.code).consumed) break;
					else this.getPlayerInput(1).consumeKey(e.code);
					if (!global.$.paused) {
						global.$.paused = true;
						global.$.debug_runSingleFrameAndPause = false;
					}
					else {
						global.$.paused = false;
						global.$.debug_runSingleFrameAndPause = this.getPlayerInput(1).getKeyState('ShiftLeft').pressed;
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
 * Represents the Input class responsible for handling user this.
 */
export class PlayerInput {
	public playerIndex: number;
	public keyboardInput: KeyboardInput;
	public gamepadInput: IInputHandler;

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
	 *         'jump': 'Space',
	 *         'left': 'ArrowLeft',
	 *         'right': 'ArrowRight',
	 *         'up': 'ArrowUp',
	 *         'down': 'ArrowDown',
	 *     },
	 *     gamepad: {
	 *         'jump': 'a',
	 *         'left': 'left',
	 *         'right': 'right',
	 *         'up': 'up',
	 *         'down': 'down',
	 *     },
	 * });
	 */
	private inputMap: InputMap;

	preventInput: boolean; // Prevents input from being registered. For instance, when the game loses focus.

	/**
	 * Sets the input map for a specific player.
	 * @param inputMap - The input map to set.
	 */
	public setInputMap(inputMap: InputMap): void {
		this.inputMap = inputMap;
	}

	/**
	 * Returns whether a specific action is currently pressed for a given player index, and optionally checks if it was clicked.
	 * @param action - The name of the action to check.
	 * @returns Whether the action is currently pressed for the given player index.
	 */
	public getActionState(action: string): ActionState {
		const inputMap = this.inputMap;
		if (!inputMap) return { action, pressed: false, consumed: false, presstime: null };

		const keyboardKey = inputMap.keyboard ? inputMap.keyboard[action] : null;
		const gamepadButton = inputMap.gamepad ? Input.BUTTON2INDEX[inputMap.gamepad[action]] : null;

		const keyboardButtonState = this.getKeyState(keyboardKey);
		const gamepadButtonState = this.getGamepadButtonState(gamepadButton);
		return {
			action: action,
			pressed: (keyboardButtonState?.pressed ?? false) || (gamepadButtonState?.pressed ?? false),
			consumed: (keyboardButtonState?.consumed ?? false) || (gamepadButtonState?.consumed ?? false),
			presstime: (keyboardButtonState?.presstime ?? null) ?? (gamepadButtonState?.presstime ?? null),
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
			if (actionState.pressed === (query?.pressed ?? true) &&
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
	 * @param action The name of the input action to consume.
	 */
	public consumeAction(actionToConsume: ActionState | string) {
		const inputMap = this.inputMap;
		if (!inputMap) return;

		const action: string = (typeof actionToConsume === 'string') ? actionToConsume : actionToConsume.action;

		const keyboardKey = inputMap.keyboard?.[action];
		if (keyboardKey && this.keyboardInput.KeyState[keyboardKey]) this.keyboardInput?.consumeKey(keyboardKey);

		if (this.gamepadInput) {
			const gamepadButton = inputMap.gamepad[action] ? Input.BUTTON2INDEX[inputMap.gamepad[action]] : null;
			(gamepadButton !== null) && this.gamepadInput.consumeButton(gamepadButton);
		}
	}

	public consumeActions(...actions: (ActionState | string)[]) {
		actions.forEach(action => this.consumeAction(action));
	}

	/**
	 * Retrieves the state of a gamepad button.
	 * @param key - The button index.
	 * @returns The state of the button.
	 */
	public getKeyState(key: string): ButtonState {
		if (!this.isKeyboardConnected()) return null;
		return this.keyboardInput.getKeyState(key);
	}

	public consumeKey(key: string): void {
		this.keyboardInput.consumeKey(key);
	}

	/**
	 * Retrieves the state of a gamepad button.
	 * @param button - The button index.
	 * @returns The state of the button.
	 */
	public getGamepadButtonState(button: number): ButtonState {
		if (!this.isGamepadConnected()) return null;
		return this.gamepadInput.getButtonState(button);
	}

	/**
	 * Checks if a specific button on a gamepad is currently being pressed down.
	 * @param btn - The button code of the gamepad button to check.
	 * @returns A boolean indicating whether the button is currently pressed down.
	 */
	public isGamepadButtonDown(btn: number): boolean {
		const buttonState = this.getGamepadButtonState(btn);
		return buttonState.pressed;
	}

	public checkAndConsume(key: string, button?: number): boolean {
		const keyState = this.keyboardInput.getKeyState(key);

		if (keyState.pressed && !keyState.consumed) {
			this.keyboardInput.consumeKey(key);
			return true;
		}

		if (button !== undefined && this.isGamepadConnected()) {
			const buttonState = this.getGamepadButtonState(button);
			if (buttonState.pressed && !buttonState.consumed) {
				this.gamepadInput.consumeButton(button);
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
		if (this.gamepadInput && this.gamepadInput !== gamepadInput) {
			console.warn(`Replacing existing gamepad for player ${this.playerIndex} with gamepad ${gamepadInput.gamepadIndex}.`);
			if (this.gamepadInput instanceof OnscreenGamepad) {

			}
		}
		this.gamepadInput = gamepadInput;

		console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
	}

	/**
	 * Polls the input from the gamepad.
	 */
	pollInput(): void {
		this.gamepadInput?.pollInput();
	}

	/**
	 * Initializes the input system.
	 * @param debug Whether to enable debug mode. Default is true.
	 */
	public constructor(playerIndex: number) {
		const self = this;
		this.playerIndex = playerIndex;
		this.gamepadInput = null; // Gamepad should be null by default, and set to a value when a gamepad is connected and assigned to this player
		this.reset();

		window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
			const gamepad = e.gamepad;
			if (!gamepad.id.toLowerCase().includes('gamepad')) return; // Ignore devices that are not gamepads

			if (!self.gamepadInput) return; // No gamepad was not assigned to this input-object, so ignore the event (this can happen if multiple gamepads are connected and one is disconnected)

			if (e.gamepad.index === self.gamepadInput.gamepadIndex) {
				if (self.playerIndex) {
					console.info(`Gamepad ${gamepad.index}, that was assigned to player ${playerIndex}, disconnected.`);
					self.gamepadInput = null; // Remove gamepad for this input-object

					// If this is the main player, assign the on-screen gamepad to the main player, if the onscreen gamepad is enabled and that onscreen gamepad is not already assigned to another player
					if (self.isMainPlayer && Input.instance.isOnscreenGamepadEnabled) {
						// Check whether the onscreen gamepad is being used by another player
						let isOnscreenGamepadAssignedToAnotherPlayer = false;
						for (let i = 1; i < Input.PLAYERS_MAX; i++) {
							if (i === self.playerIndex) continue;
							const playerInput = Input.instance.getPlayerInput(i);
							if (playerInput.gamepadInput instanceof OnscreenGamepad) {
								isOnscreenGamepadAssignedToAnotherPlayer = true;
								break;
							}
						}

						if (!isOnscreenGamepadAssignedToAnotherPlayer) {
							Input.instance.enableOnscreenGamepad();
							self.gamepadInput = Input.instance.getOnscreenGamepad();
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
		return !(!this.keyboardInput);
	}

	/**
	 * Checks if a gamepad is connected for the specified player index.
	 * @returns True if a gamepad is connected for the specified player index, false otherwise.
	 */
	private isGamepadConnected(): boolean {
		return !(!this.gamepadInput);
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		this.gamepadInput?.reset(except);
		this.keyboardInput?.reset(except);
	}

}

class KeyboardInput implements IInputHandler {
	public readonly gamepadIndex = 0;

	constructor() {
		this.KeyState = {};
		this.KeyPressedConsumedState = {};
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
			this.KeyState = {};
			this.KeyPressedConsumedState = {};
			this.KeyPressedTimes = {};
			return;
		}

		resetObject(this.KeyState, except);
		resetObject(this.KeyPressedConsumedState, except);
		resetObject(this.KeyPressedTimes, except);
	}


	/**
	 * The state of each keyboard key.
	 */
	public KeyState: Index2State = {};

	/**
	 * The state of each keyboard key click request.
	 */
	public KeyPressedConsumedState: Index2State = {};

	public KeyPressedTimes: Index2PressTime = {};

	/**
	 * Consumes the given key by setting its key state to "consumed".
	 * @param key The key to consume.
	 */
	public consumeKey(key: string) {
		this.KeyPressedConsumedState[key] = true;
	}

	public consumeButton(_button: number): void {
	}

	public getButtonState(_button: number): ButtonState {
		return null;
	}

	/**
	 * Returns the pressed state of a key, and optionally checks if it was clicked.
	 * @param key - The key to check the state of.
	 * @returns The pressed state of the key.
	 */
	public getKeyState(key: string): ButtonState {
		if (key === null) return { pressed: false, consumed: false, presstime: null };
		return getPressedState(this.KeyState, this.KeyPressedConsumedState, this.KeyPressedTimes, key);
	}

	pollInput(): void {
	}

	/**
	 * Sets the key state to true when a key is pressed.
	 * @param key_code - The button ID or string representing the key.
	 */
	keydown(key_code: ButtonId | string): void {
		this.KeyState[key_code] = true;
		this.KeyPressedTimes[key_code] = 0;
	}

	/**
	 * Handles the keyup event for a given key.
	 * @param key_code - The key identifier or name.
	 */
	keyup(key_code: ButtonId | string): void {
		this.KeyState[key_code] = this.KeyPressedConsumedState[key_code] = false;
		this.KeyPressedTimes[key_code] = null;
	}

	blur(_e: FocusEvent): void {
		// this.preventInput = true; // Prevent input when the window loses focus
		this.reset();
	}

	focus(_e: FocusEvent): void {
		this.reset();
		// this.preventInput = false; // Allow input when the window regains focus
	}
}

class GamepadInput implements IInputHandler {
	public get gamepadIndex(): number | null {
		return this.gamepad?.index ?? null;
	}

	private _gamepad: Gamepad;
	public get gamepad(): Gamepad { return this._gamepad; }

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: Index2State = {};

	/**
	 * The state of each gamepad button click request for each player.
	 */
	private gamepadButtonPressedConsumedStates: Index2State = {};

	/**
	 * The state of each gamepad button click request for each player.
	 */
	private gamepadButtonPressTimes: Index2PressTime = {};

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
		this.gamepadButtonStates = {};

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
		const [xAxis, yAxis] = gamepad.axes;
		this.gamepadButtonStates[Input.BUTTON2INDEX.left] = xAxis < -0.5;
		this.gamepadButtonStates[Input.BUTTON2INDEX.right] = xAxis > 0.5;
		this.gamepadButtonStates[Input.BUTTON2INDEX.up] = yAxis < -0.5;
		this.gamepadButtonStates[Input.BUTTON2INDEX.down] = yAxis > 0.5;
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
			const btn = buttons[btnIndex];
			const pressed = typeof btn === "object" ? btn.pressed : btn === 1.0;
			// Consider that the button can already be regarded as pressed if it was pressed as part of another action, like an axis
			this.gamepadButtonStates[btnIndex] = this.gamepadButtonStates[btnIndex] || pressed;
			if (!pressed) {
				this.gamepadButtonPressedConsumedStates[btnIndex] = false;
				this.gamepadButtonPressTimes[btnIndex] = null;
			}
			else {
				// If the button is pressed, increment the press time counter for detecting hold actions
				this.gamepadButtonPressTimes[btnIndex] = (this.gamepadButtonPressTimes[btnIndex] ?? 0) + 1;
			}
		}
	}

	/**
	 * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
	 * @param btn - The index of the button to check the state of.
	 * @returns The pressed state of the button.
	 */
	public getButtonState(btn: number | null): ButtonState {
		if (btn === null) return { pressed: false, consumed: false, presstime: null };

		const stateMap = this.gamepadButtonStates || {};
		const consumedStateMap = this.gamepadButtonPressedConsumedStates;
		const pressTimes = this.gamepadButtonPressTimes;
		if (!consumedStateMap) return null;
		return getPressedState(stateMap, consumedStateMap, pressTimes, btn);
	}

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(button: number) {
		if (this.gamepadButtonPressedConsumedStates) {
			this.gamepadButtonPressedConsumedStates[button] = true;
		}
	}

	/**
	 * Resets the state of all gamepad buttons.
	 * @param except An optional array of buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			this.gamepadButtonStates = {};
			this.gamepadButtonPressedConsumedStates = {};
			this.gamepadButtonPressTimes = {};
		}
		else {
			resetObject(this.gamepadButtonStates, except);
			resetObject(this.gamepadButtonPressedConsumedStates, except);
			resetObject(this.gamepadButtonPressTimes, except);
		}
	}
}

class OnscreenGamepad implements IInputHandler {
	public readonly gamepadIndex = 7;

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: Index2State = {};

	/**
	 * The state of each gamepad button click request for each player.
	 */
	private gamepadButtonPressedConsumedStates: Index2State = {};

	/**
	 * The state of each gamepad button click request for each player.
	 */
	private gamepadButtonPressTimes: Index2PressTime = {};

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
	public getButtonState(btn: number | null): ButtonState {
		if (btn === null) return { pressed: false, consumed: false, presstime: null };
		const button = Input.INDEX2BUTTON[btn];
		const stateMap = this.gamepadButtonStates || {};
		const consumedStateMap = this.gamepadButtonPressedConsumedStates;
		const pressTimes = this.gamepadButtonPressTimes;
		if (!consumedStateMap) return null;
		return getPressedState(stateMap, consumedStateMap, pressTimes, button);
	}

	public pollInput(): void {
		// Initialize new states with current values instead of resetting
		const defaultState = { pressed: false, consumed: true, presstime: null };

		let newGamepadButtonStates = {};
		let newGamepadButtonPressedConsumedStates = { ...this.gamepadButtonPressedConsumedStates };
		let newGamepadButtonPressTimes = { ...this.gamepadButtonPressTimes };

		Object.keys(Input.BUTTON2INDEX).forEach(button => {
			newGamepadButtonStates[button] = this.gamepadButtonStates[button] ?? defaultState.pressed;
		});

		for (let i = 0; i < OnscreenGamepad.onscreenButtonElementNames.length; i++) {
			const d = document.getElementById(OnscreenGamepad.onscreenButtonElementNames[i]);
			const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[d.id];
			if (buttonData) {
				buttonData.buttons.forEach(button => {
					if (d.dataset.touched === 'true') {
						// Update the state only if the button is currently pressed
						newGamepadButtonStates[button] = true;
						newGamepadButtonPressTimes[button] = (newGamepadButtonPressTimes[button] ?? 0) + 1;
						newGamepadButtonPressedConsumedStates[button] ??= false;
					} else {
						// Set to false only if no other element is pressing this button
						if (!this.isOtherElementPressingButton(button)) {
							newGamepadButtonStates[button] = false;
							newGamepadButtonPressTimes[button] = null;
							newGamepadButtonPressedConsumedStates[button] = false;
						}
					}
				});
			}
		}

		// Update the button states with the new states
		this.gamepadButtonStates = newGamepadButtonStates;
		this.gamepadButtonPressedConsumedStates = newGamepadButtonPressedConsumedStates;
		this.gamepadButtonPressTimes = newGamepadButtonPressTimes;
	}

	// Helper function to determine if any other element is pressing the same button
	private isOtherElementPressingButton(button: string): boolean {
		return OnscreenGamepad.onscreenButtonElementNames.some(dpadId => {
			const element = document.getElementById(dpadId);
			return element && element.classList.contains('druk') && OnscreenGamepad.ALL_BUTTON_MAP[element.id].buttons.includes(button);
		});
	}

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(buttonIndex: number) {
		if (this.gamepadButtonPressedConsumedStates) {
			const button = Input.INDEX2BUTTON[buttonIndex];
			this.gamepadButtonPressedConsumedStates[button] = true;
		}
	}

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

	private static readonly dpadButtonElementIds = ['d-pad-u', 'd-pad-ru', 'd-pad-r', 'd-pad-rd', 'd-pad-d', 'd-pad-ld', 'd-pad-l', 'd-pad-lu'];
	private static readonly actionButtonElementIds = ['btn1_knop', 'btn2_knop', 'btn3_knop', 'btn4_knop', 'ls_knop', 'rs_knop', 'lt_knop', 'rt_knop', 'select_knop', 'start_knop', 'home_knop'];

	private static readonly onscreenButtonElementNames = Object.keys(OnscreenGamepad.ALL_BUTTON_MAP);

	public init(): void {
		// Reset gamepad button states
		this.reset();
		const self = this;
		function addTouchListeners(controlsElement: HTMLElement, action_type: 'dpad' | 'action') {
			controlsElement.addEventListener('touchmove', e => { self.handleTouchMove(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchstart', e => { self.handleTouchStart(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchend', e => { self.handleTouchEndStuff(e, action_type); return true; }, options);
			controlsElement.addEventListener('touchcancel', e => { self.handleTouchEndStuff(e, action_type); return true; }, options);
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
			this.gamepadButtonStates = {};
			this.gamepadButtonPressedConsumedStates = {};
			this.gamepadButtonPressTimes = {};
		}
		else {
			resetObject(this.gamepadButtonStates, except);
			resetObject(this.gamepadButtonPressedConsumedStates, except);
			resetObject(this.gamepadButtonPressTimes, except);
		}
	}

	/**
	 * Resets the state of all UI elements related to the gamepad this.
	 * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
	 * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
	 */
	public resetUI(elementsToFilterById?: string[]): void {
		const self = this;
		function resetElementAndButtonPress(element_id: string): void {
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
					self.gamepadButtonStates[button] = false;
				});
			}
		}

		if (elementsToFilterById) {
			OnscreenGamepad.onscreenButtonElementNames.forEach(element => !elementsToFilterById.includes(element) && resetElementAndButtonPress(element));
		}
		else {
			OnscreenGamepad.onscreenButtonElementNames.forEach(resetElementAndButtonPress);
		}
	}

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
					this.handleTouchEndStuff(e, control_type);
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
		switch (control_type) {
			case 'action':
				this.resetUI(OnscreenGamepad.dpadButtonElementIds);
				break;
			case 'dpad':
				this.resetUI(OnscreenGamepad.actionButtonElementIds);
				break;
		}

		if (e.touches.length === 0) {
			return;
		}

		const filterFromReset: string[] = [];
		const elementsToFilter: string[] = [];
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

						switch (elementUnderTouch.id) {
							case 'd-pad-lu':
								elementsToFilter.push('d-pad-u', 'd-pad-l');
								break;
							case 'd-pad-u':
								elementsToFilter.push('d-pad-lu', 'd-pad-ru');
								break;
							case 'd-pad-ru':
								elementsToFilter.push('d-pad-u', 'd-pad-r');
								break;
							case 'd-pad-r':
								elementsToFilter.push('d-pad-ru', 'd-pad-rd');
								break;
							case 'd-pad-ld':
								elementsToFilter.push('d-pad-d', 'd-pad-l');
								break;
							case 'd-pad-d':
								elementsToFilter.push('d-pad-ld', 'd-pad-rd');
								break;
							case 'd-pad-rd':
								elementsToFilter.push('d-pad-d', 'd-pad-r');
								break;
							case 'd-pad-l':
								elementsToFilter.push('d-pad-lu', 'd-pad-ld');
								break;
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
				elementsToFilter.push(...OnscreenGamepad.dpadButtonElementIds);
				break;
			case 'dpad':
				elementsToFilter.push(...OnscreenGamepad.actionButtonElementIds);
				break;
		}

		this.resetUI(elementsToFilter);
	}

	handleTouchEndStuff(_e: TouchEvent, control_type: 'dpad' | 'action'): void {
		switch (control_type) {
			case 'action':
				this.resetUI(OnscreenGamepad.dpadButtonElementIds);
				break;
			case 'dpad':
				this.resetUI(OnscreenGamepad.actionButtonElementIds);
				break;
		}
	}

	/**
	 * Handles the element under touch by triggering the corresponding keydown event and adding the 'druk' class to the element.
	 * @param e The element under touch.
	 * @returns An array of keys or buttons that were triggered by the touch event.
	 */
	handleElementUnderTouch(e: Element): (ButtonId | string)[] {
		const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[e.id];
		if (buttonData) {
			buttonData.buttons.forEach(button => {
				if (this.gamepadButtonStates[button]) {
					this.gamepadButtonPressTimes[button] = (this.gamepadButtonPressTimes[button] ?? 0) + 1;
				}
				else {
					this.gamepadButtonStates[button] = true;
					this.gamepadButtonPressedConsumedStates[button] = false;
					this.gamepadButtonPressTimes[button] = 0;
				}
			});
			document.getElementById(e.id).classList.add('druk');
			return buttonData.buttons;
		}
		return [];
	}


	blur(_e: FocusEvent): void {
		this.reset();
	}

	focus(_e: FocusEvent): void {
		this.reset();
	}
}
