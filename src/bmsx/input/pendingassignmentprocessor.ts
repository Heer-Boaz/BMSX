import { $ } from '../core/game';
import { GamepadInput } from './gamepad';
import { Input } from './input';
import type { BGamepadButton, InputHandler } from './inputtypes';

/**
 * Represents a processor for handling pending gamepad assignments.
 * This class manages the selection of player indexes for gamepad assignments and the placement of the joystick icon.
 */
export class PendingAssignmentProcessor {
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

    // UI is handled by ControllerAssignmentUI via events

    /**
     * Checks if a specific gamepad button is pressed and not consumed.
     *
     * @param button - The gamepad button to check.
     * @param gamepadInput - The gamepad input handler.
     * @returns A boolean value indicating whether the button is pressed and not consumed.
     */
    private checkNonConsumedPressed(button: BGamepadButton, gamepadInput: InputHandler) {
        return gamepadInput.getButtonState(button).pressed && !gamepadInput.getButtonState(button).consumed;
    }

    /**
     * Calculates the X position of the assignment-icon based on the given position index.
     * @param positionIndex The index of the position.
     * @returns The calculated X position of the icon.
     */
    private calcIconPositionX(positionIndex: number) { return PendingAssignmentProcessor.joystick_icon_start.x + (PendingAssignmentProcessor.joystick_icon_increment_x * (positionIndex ?? 0)); };

    private notifyUIProposed(gamepadIndex: number, proposedPlayerIndex: number | null): void {
        $.emit('controller_assignment_proposed', Input.instance, { gamepadIndex, proposedPlayerIndex, positionIndex: this.pendingIndex });
    }

    private lastNotified: { proposed: number | null; positionIndex: number } | null = null;
    private maybeNotify(gamepadIndex: number, proposedPlayerIndex: number | null): void {
        const pos = this.pendingIndex;
        const prev = this.lastNotified;
        if (!prev || prev.proposed !== proposedPlayerIndex || prev.positionIndex !== pos) {
            this.lastNotified = { proposed: proposedPlayerIndex, positionIndex: pos };
            this.notifyUIProposed(gamepadIndex, proposedPlayerIndex);
        }
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
            newProposedPlayerIndex = Input.instance.getFirstAvailablePlayerIndexForGamepadAssignment(newProposedPlayerIndex, increment < 0);

            if (newProposedPlayerIndex !== null) {
                this.proposedPlayerIndex = newProposedPlayerIndex;
                this.maybeNotify((this.inputHandler as any).gamepadIndex ?? 0, this.proposedPlayerIndex);
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
    // UI creation/movement handled by ControllerAssignmentUI

    /**
     * Constructs a new instance of the class.
     *
     * @param inputHandler - An object that handles input from the gamepad.
     * @param proposedPlayerIndex - The index of the player that is proposed to be assigned to the gamepad, or null if no player is proposed.
     *
     * This constructor sets up an event listener for the "gamepaddisconnected" event,
     * which handles the disconnection of gamepads and manages pending assignments.
     */
    constructor(public inputHandler: InputHandler, public proposedPlayerIndex: number | null) {
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
        // Defer UI creation to ControllerAssignmentUI
    }

    /**
     * Runs the gamepad assignment process.
     * If a gamepad is proposed to be assigned to a player, handles the assignment and removal of the joystick icon.
     * If no gamepad is proposed, checks for the start button press to propose a gamepad for assignment.
     * Handles the movement of the joystick icon to change the proposed player index.
     */
    async run(): Promise<void> {
        const inputMaestro = Input.instance;
        const gamepadInput = this.inputHandler as GamepadInput;
        gamepadInput.pollInput();

        // Check whether the start button was pressed and not consumed yet to assign the gamepad to a player
        if (this.proposedPlayerIndex === null) {
            if (this.checkNonConsumedPressed('start', gamepadInput)) {
                gamepadInput.consumeButton('start');
                const proposedPlayerIndex = inputMaestro.getFirstAvailablePlayerIndexForGamepadAssignment();

                if (proposedPlayerIndex !== null) {
                    this.proposedPlayerIndex = proposedPlayerIndex;
                    this.notifyUIProposed(gamepadInput.gamepadIndex, this.proposedPlayerIndex);
                    console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${proposedPlayerIndex}.`);
                }
            }
        }
        else {
            this.maybeNotify(gamepadInput.gamepadIndex, this.proposedPlayerIndex);
            if (this.checkNonConsumedPressed('a', gamepadInput)) {
                // Assign gamepad to player and remove the joystick icon
                gamepadInput.consumeButton('a');
                inputMaestro.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
                // Initialize the HID pad for the gamepad input
                await gamepadInput.init(); // *REQUIRES USER INPUT TO GRANT PERMISSION TO USE THE HID API!! THEREFORE, THIS FUNCTION SHOULD BE CALLED AS PART OF A USER INTERACTION!*
                // Reset states so the confirming button does not leak into gameplay
                gamepadInput.reset();
                inputMaestro.removePendingGamepadAssignment(this.inputHandler.gamepadIndex);
                // Broadcast for UI and other listeners
                $.emit('controller_assigned', Input.instance, { proposedPlayerIndex: this.proposedPlayerIndex, gamepadIndex: gamepadInput.gamepadIndex });
            }
            else if (this.checkNonConsumedPressed('b', gamepadInput)) {
                // Cancel assignment process for this gamepad and remove the joystick icon
                gamepadInput.consumeButton('b');
                this.proposedPlayerIndex = null; // Set proposed player index to null to indicate that the gamepad is no longer proposed to be assigned to a player. Note that we keep the pending gamepad assignment object around, so that the gamepad can be assigned to a player again later.
                $.emit('controller_assignment_cancelled', Input.instance, { proposedPlayerIndex: this.proposedPlayerIndex, gamepadIndex: gamepadInput.gamepadIndex });
            }
            else {
                // Handle joystick icon movement to change the proposed player index
                this.handleSelectPlayerIndexButtonPress('up', 1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('right', 1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('down', -1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('left', -1, gamepadInput);
                // Consume any other pressed buttons on this device to prevent gameplay leakage while selecting
                for (const btn of Input.BUTTON_IDS) {
                    const st = gamepadInput.getButtonState(btn);
                    if (st?.pressed && !st.consumed) gamepadInput.consumeButton(btn);
                }
            }
        }
    }

    // UI removal handled by UI controller
}
