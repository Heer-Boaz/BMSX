import { GamepadInput } from '../gamepad';
import { GAMEPAD_BUTTON_IDS } from '../gamepad_buttons';
import { Input } from '../manager';
import type { BGamepadButton, InputHandler } from '../models';

/**
 * Represents a processor for handling pending gamepad assignments.
 * This class manages the selection of player indexes for gamepad assignments and the placement of the joystick icon.
 */
export class PendingAssignmentProcessor {

	/**
	 * Checks if a specific gamepad button is pressed and not consumed.
	 *
	 * @param button - The gamepad button to check.
	 * @param gamepadInput - The gamepad input handler.
	 * @returns A boolean value indicating whether the button is pressed and not consumed.
	 */
	private checkNonConsumedPressed(button: BGamepadButton, gamepadInput: InputHandler) {
		const state = gamepadInput.getButtonState(button);
		return state.pressed && !state.consumed;
	}

	/**
	 * Handles the button press event for selecting the player index.
	 * @param button - The gamepad button that was pressed.
	 * @param increment - The amount by which to increment or decrement the player index.
	 * @param gamepadInput - The gamepad input handler.
	 */
	private handleSelectPlayerIndexButtonPress(button: BGamepadButton, increment: number, gamepadInput: InputHandler) {
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
			newProposedPlayerIndex = this.input.getFirstAvailablePlayerIndexForGamepadAssignment(newProposedPlayerIndex, increment < 0);

			if (newProposedPlayerIndex !== null) {
				this.proposedPlayerIndex = newProposedPlayerIndex;
			}
			else {
				// No new player index available for gamepad assignment found => don't do anything!
			}
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
	constructor(
		private readonly input: Input,
		public inputHandler: InputHandler,
		public proposedPlayerIndex: number,
	) {
		// Defer UI creation to ControllerAssignmentUI
	}

	/**
	 * Runs the gamepad assignment process.
	 * If a gamepad is proposed to be assigned to a player, handles the assignment and removal of the joystick icon.
	 * If no gamepad is proposed, checks for the start button press to propose a gamepad for assignment.
	 * Handles the movement of the joystick icon to change the proposed player index.
	 */
	run(): GamepadInput | null {
		const gamepadInput = this.inputHandler as GamepadInput;
		gamepadInput.pollInput();

		// Check whether the start button was pressed and not consumed yet to assign the gamepad to a player
		if (this.proposedPlayerIndex === null) {
			if (this.checkNonConsumedPressed('start', gamepadInput)) {
				gamepadInput.consumeButton('start');
				const proposedPlayerIndex = this.input.getFirstAvailablePlayerIndexForGamepadAssignment();

				if (proposedPlayerIndex !== null) {
					this.proposedPlayerIndex = proposedPlayerIndex;
				}
			}
		}
		else {
			if (this.checkNonConsumedPressed('a', gamepadInput)) {
				// Assign gamepad to player and remove the joystick icon
				gamepadInput.consumeButton('a');
				this.input.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
				gamepadInput.reset();
				this.input.removePendingGamepadAssignment(this.inputHandler.gamepadIndex);
				return gamepadInput;
			}
			else if (this.checkNonConsumedPressed('b', gamepadInput)) {
				// Cancel assignment process for this gamepad and remove the joystick icon
				gamepadInput.consumeButton('b');
				this.proposedPlayerIndex = null; // Set proposed player index to null to indicate that the gamepad is no longer proposed to be assigned to a player. Note that we keep the pending gamepad assignment object around, so that the gamepad can be assigned to a player again later.
			}
			else {
				// Handle joystick icon movement to change the proposed player index
				this.handleSelectPlayerIndexButtonPress('up', 1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('right', 1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('down', -1, gamepadInput);
				this.handleSelectPlayerIndexButtonPress('left', -1, gamepadInput);
				// Consume any other pressed buttons on this device to prevent gameplay leakage while selecting
				for (let i = 0; i < GAMEPAD_BUTTON_IDS.length; i += 1) {
					const btn = GAMEPAD_BUTTON_IDS[i];
					const st = gamepadInput.getButtonState(btn);
					if (st?.pressed && !st.consumed) gamepadInput.consumeButton(btn);
				}
			}
		}
		return null;
	}

	// UI removal handled by UI controller
}
