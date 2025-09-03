import { ActionDefinitionEvaluator } from './actionparser';
import { Input, InputStateManager, makeActionState, makeButtonState } from './input';
import type { ActionState, ActionStateQuery, BGamepadButton, ButtonId, ButtonState, InputHandler, InputMap, KeyboardButton, VibrationParams } from './inputtypes';
import type { KeyboardInput } from './keyboardinput';
import { OnscreenGamepad } from './onscreengamepad';

export const INPUT_SOURCES = ['keyboard', 'gamepad'] as const;
export type InputSource = typeof INPUT_SOURCES[number];

/**
 * Represents the Input class responsible for handling user input.
 */
export class PlayerInput {
	/**
	 * Represents the input handlers for the player.
	 *
	 * @property {IInputHandler | null} keyboard - The handler for keyboard input, or null if not set.
	 * @property {IInputHandler | null} gamepad - The handler for gamepad input, or null if not set.
	 */
	public inputHandlers: { [source in InputSource]: InputHandler | null } = {
		keyboard: null,
		gamepad: null,
	};

    /** Holds per-button pressed state flags from the previous frame for each handler. */
    private previousStates: { [source in InputSource]: Record<string, boolean> } = {
        keyboard: {},
        gamepad: {},
    };

	/** Manages buffered input events and button state aggregation. */
	private stateManager: InputStateManager;

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
		return ActionDefinitionEvaluator.checkActionTriggered(actionDefinition, this.getActionState.bind(this));
	}

	public checkActionsTriggered(...actions: { id: string; def: string; }[]): string[] {
		return actions.filter(action => this.checkActionTriggered(action.def)).map(action => action.id);
	}

	/**
	 * Sets the input map for a specific player.
	 * @param inputMap - The input map to set.
	 */
	public setInputMap(inputMap: InputMap): void {
		this.inputMap = inputMap;
	}

    public get supportsVibrationEffect(): boolean {
        for (const source of INPUT_SOURCES) {
            if (this.inputHandlers[source]?.supportsVibrationEffect) return true;
        }
        return false;
    }

    public applyVibrationEffect(params: VibrationParams): void {
        for (const source of INPUT_SOURCES) {
            if (!this.inputHandlers[source]?.supportsVibrationEffect) continue;
            this.inputHandlers[source]!.applyVibrationEffect(params);
        }
    }

	/**
	 * Retrieves the state of an action.
	 *
	 * @param action - The name of the action.
	 * @param framewindow - An optional time window in milliseconds to consider for the action state. **Note: This doesn't really work as it should! For instance, if you press the directional button to move left, it will make the action state for 'left' always pressed, even if you release the button, until the time window expires.
	 * @returns The state of the action, including whether it is pressed, consumed, the press time, and the timestamp.
	 */
	public getActionState(action: string, framewindow: number = null): ActionState {
		const inputMap = this.inputMap;
		if (!inputMap) return makeActionState(action);

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
		const getStates = (keys_or_buttons: ButtonId[], getStateFunc: (key: ButtonId, framewindow?: number) => ButtonState) => {
			let allPressed = true;
			let allJustPressed = true;
			let anyJustPressed = false;
			let allJustReleased = true;
			let anyJustReleased = false;
			let allWasPressed = true;
			let anyWasPressed = false;
			let anyWasReleased = false;
			let allWasReleased = true;
			let anyConsumed = false;
			let anyPressed: boolean = false; // To track if any button is pressed, specifically needed for the anyJustReleased
			let leastPressTime = Infinity;
			let recentestTimestamp = -Infinity;

			if (keys_or_buttons) {
				for (const key of keys_or_buttons) {
					const state = getStateFunc(key, framewindow);
					allPressed = allPressed && (state?.pressed ?? false);
					anyPressed = anyPressed || (state?.pressed ?? false);
					allJustPressed = allJustPressed && (state?.justpressed ?? false);
					anyJustPressed = anyJustPressed || (state?.justpressed ?? false);
					allJustReleased = allJustReleased && (state?.justreleased ?? false);
					anyJustReleased = anyJustReleased || (state?.justreleased ?? false);
					allWasPressed = allWasPressed && (state?.waspressed ?? false);
					anyWasPressed = anyWasPressed || (state?.waspressed ?? false);
					allWasReleased = allWasReleased && (state?.wasreleased ?? false);
					anyWasReleased = anyWasReleased || (state?.wasreleased ?? false);
					anyConsumed = anyConsumed || (state?.consumed ?? false);
					if (state?.presstime) {
						leastPressTime = Math.min(leastPressTime, state.presstime);
					}
					if (state?.timestamp) {
						recentestTimestamp = Math.max(recentestTimestamp, state.timestamp);
					}
				}
			} else {
				allPressed = allJustPressed = allWasPressed = allJustReleased = anyWasReleased = allJustReleased = false;
				leastPressTime = recentestTimestamp = null;
			}

			// Only consider anyJustPressed if all buttons are pressed, because if any button is not pressed then the action is not just pressed
			anyJustPressed = anyJustPressed && allPressed;
			// Only consider anyJustReleased if none of the buttons are pressed, because if any button is pressed then the action is not just released
			anyJustReleased = anyJustReleased && !anyPressed;

			return { allPressed, anyJustPressed, allJustPressed, anyWasPressed, allWasPressed, anyJustReleased, allJustReleased, anyWasReleased, allWasReleased, anyConsumed, leastPressTime, recentestTimestamp };
		};

		const keyboardState = getStates(
			keyboardKeys,
			(key: ButtonId, framewindow?: number) => framewindow !== null
				? this.stateManager.getButtonState(key, framewindow)
				: this.getButtonState(key, 'keyboard')
		);
		const gamepadState = getStates(
			gamepadButtons,
			(button: ButtonId, framewindow?: number) => framewindow !== null
				? this.stateManager.getButtonState(button, framewindow)
				: this.getButtonState(button, 'gamepad')
		);
		const minPresstime = Math.min(keyboardState.leastPressTime, gamepadState.leastPressTime);
		const maxTimestamp = Math.max(keyboardState.recentestTimestamp, gamepadState.recentestTimestamp);

		return {
			action: action,
			pressed: keyboardState.allPressed || gamepadState.allPressed,
			justpressed: keyboardState.anyJustPressed || gamepadState.anyJustPressed,
			alljustpressed: keyboardState.allJustPressed || gamepadState.allJustPressed,
			justreleased: keyboardState.anyJustReleased || gamepadState.anyJustReleased,
			alljustreleased: keyboardState.allJustReleased || gamepadState.allJustReleased,
			waspressed: keyboardState.anyWasPressed || gamepadState.anyWasPressed,
			wasreleased: keyboardState.anyWasReleased || gamepadState.anyWasReleased,
			allwaspressed: keyboardState.allWasPressed || gamepadState.allWasPressed,
			consumed: keyboardState.anyConsumed || gamepadState.anyConsumed,
			presstime: minPresstime === Infinity ? null : minPresstime,
			timestamp: maxTimestamp === -Infinity ? null : maxTimestamp,
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

		const pressedActions: ActionState[] = [];
		// Iterate over all input sources (keyboard and gamepad)
		for (const source of ['keyboard', 'gamepad'] as const) {
			for (const action in inputMap[source]) {
				if (query?.filter && !query.filter.includes(action)) continue; // Skip actions that are not in the filter
				const actionState = this.getActionState(action);
				// Check if the just pressed state matches the query, but only if the query explicitly specifies that justPressed should be true
				const justPressedMatches = (query?.justPressed === true)
					? actionState.justpressed === true
					: true;
				// Check if the consumed state matches the query, but only if the query explicitly specifies that consumed should be false
				const consumedMatches = (query?.consumed === false)
					? actionState.consumed === false
					: true;
				if (actionState.pressed === (query?.pressed ?? true) &&
					justPressedMatches &&
					consumedMatches &&
					actionState.presstime >= (query?.pressTime ?? 0)) {
					pressedActions.push(actionState);
				}
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

		for (const source of INPUT_SOURCES) {
			if (!this.inputHandlers[source] || !inputMap[source]) continue;
			const keysOrButtons: KeyboardButton[] | BGamepadButton[] = inputMap[source][action];
			if (!keysOrButtons) continue;
			for (const key of keysOrButtons) {
				const buttonState = this.inputHandlers[source].getButtonState(key);
				if (buttonState.pressed && !buttonState.consumed) {
					this.inputHandlers[source].consumeButton(key);
				}
				// TODO: Only consume a buffered event corresponding to the same logical press that originated the action
				this.stateManager.consumeBufferedEvent(key);
			}
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
	public getButtonState(button: ButtonId, source: InputSource): ButtonState {
		if (source === 'keyboard' && !this.isKeyboardConnected()) return null;
		if (source === 'gamepad' && !this.isGamepadConnected()) return null;
		return this.inputHandlers[source].getButtonState(button);
	}

	/**
	 * Checks if a specific button on a gamepad is currently being pressed down.
	 * @param button - The gamepad button to check.
	 * @returns A boolean indicating whether the button is currently pressed down.
	 */
	public isButtonDown(button: ButtonId, source: InputSource): boolean {
		const buttonState = this.getButtonState(button, source);
		return buttonState?.pressed; // Use optional chaining to avoid errors as a button might not be registered on an e.g. disconnected gamepad
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
	assignGamepadToPlayer(gamepadInput: InputHandler): void {
		if (this.inputHandlers['gamepad'] && this.inputHandlers['gamepad'] !== gamepadInput) {
			console.warn(`Replacing existing gamepad for player ${this.playerIndex} with gamepad ${gamepadInput.gamepadIndex}.`);
			if (this.inputHandlers['gamepad'] instanceof OnscreenGamepad) {
				console.warn(`Existing gamepad ${gamepadInput.gamepadIndex} is an on-screen gamepad that will be reassigned.`);
			}
		}
		// Clear existing gamepad input
		this.inputHandlers['gamepad']?.reset();
		this.previousStates['gamepad'] = {};

		this.inputHandlers['gamepad'] = gamepadInput;

		console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
	}

	/**
	 * Polls the input for the player for each input source (e.g., keyboard, gamepad, ...)
	 */
	pollInput(): void {
		for (const source of INPUT_SOURCES) {
			const handler: InputHandler = this.inputHandlers[source];
			if (!handler) continue;
			handler.pollInput();

			if (source === 'gamepad') {
                for (const button of Input.BUTTON_IDS) {
                    const state = handler.getButtonState(button);
                    const prev = this.previousStates[source][button] ?? false;

					if (state.justpressed) {
						this.stateManager.addInputEvent({
							eventType: 'press',
							identifier: button,
							timestamp: state.timestamp,
							consumed: false,
						});
					}

					if (!state.pressed && prev) {
						this.stateManager.addInputEvent({
							eventType: 'release',
							identifier: button,
							timestamp: state.timestamp,
							consumed: false,
						});
					}

					this.previousStates[source][button] = state.pressed;
				}
			}
			else if (source === 'keyboard') {
                for (const key of Object.keys((handler as KeyboardInput).keyStates)) {
                    const state = handler.getButtonState(key);
                    const prev = this.previousStates[source][key] ?? false;

					if (state.justpressed) {
						this.stateManager.addInputEvent({
							eventType: 'press',
							identifier: key,
							timestamp: state.timestamp,
							consumed: false,
						});
					}

					if (!state.pressed && prev) {
						this.stateManager.addInputEvent({
							eventType: 'release',
							identifier: key,
							timestamp: state.timestamp,
							consumed: false,
						});
					}

					this.previousStates[source][key] = state.pressed;
				}
			}
		}
	}

	/** Updates aggregated button states and cleans up stale events. */
	update(currentTime: number): void {
		this.stateManager.update(currentTime);
	}

	/**
	 * Initializes the input system.
	 */
	public constructor(public playerIndex: number) {
		this.playerIndex = playerIndex;
		this.stateManager = new InputStateManager();
		this.inputHandlers['gamepad'] = null; // Gamepad should be null by default, and set to a value when a gamepad is connected and assigned to this player
		this.reset();

		window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
			const gamepad = e.gamepad;
			if (!gamepad.id.toLowerCase().includes('gamepad')) return; // Ignore devices that are not gamepads

			if (!this.inputHandlers['gamepad']) return; // No gamepad was not assigned to this input-object, so ignore the event (this can happen if multiple gamepads are connected and one is disconnected)

			if (e.gamepad.index === this.inputHandlers['gamepad'].gamepadIndex) {
				if (this.playerIndex) {
					console.info(`Gamepad ${gamepad.index}, that was assigned to player ${this.playerIndex}, disconnected.`);
					this.previousStates['gamepad'] = {};
					this.inputHandlers['gamepad']?.dispose();
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
							console.info(`On-screen gamepad assigned to player ${this.playerIndex}, which is the main player.`);
						}
						else {
							console.info(`On-screen gamepad is already assigned to another player and will not be assigned to player ${this.playerIndex}, which is the main player.`);
						}
					}
				}
			}
		});
	}

	/**
	 * Checks if a keyboard is connected for the specified player index.
	 * @returns True if a keyboard is connected for the specified player index, false otherwise.
	 */
	private isKeyboardConnected(): boolean {
		return this.inputHandlers['keyboard'] !== null;
	}

	/**
	 * Checks if a gamepad is connected for the specified player index.
	 * @returns True if a gamepad is connected for the specified player index, false otherwise.
	 */
	private isGamepadConnected(): boolean {
		return this.inputHandlers['gamepad'] !== null;
	}

	/**
	 * Resets the state of all input keys and gamepad buttons.
	 * @param except An optional array of keys or buttons to exclude from the reset.
	 */
    public reset(except?: string[]): void {
        for (const source of INPUT_SOURCES) {
            this.inputHandlers[source]?.reset(except);
        }
    }
}
