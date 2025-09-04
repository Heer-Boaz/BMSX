import { $ } from '../core/game';
import { SpriteObject } from '../core/sprite';
import { build_fsm } from '../fsm/fsmdecorators';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { State } from '../fsm/state';
import { ZCOORD_MAX } from '../render/backend/webgl.constants';
import type { Identifier } from '../rompack/rompack';
import { GamepadInput } from './gamepad';
import { Input } from './input';
import type { BGamepadButton, InputHandler } from './inputtypes';

/**
 * Represents a selected player index icon that is shown when a new input device has been detected and not yet been assigned to a player.
 * The icon is also shown when an input devices is being reassigned to a player.
 */
class SelectedPlayerIndexIcon extends SpriteObject {
    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            event_handlers: {
                $animation_end: {
                    do(this: SelectedPlayerIndexIcon) {
                        this.markForDisposal();
                    }
                },
            },
            substates: {
                _default: {
                    event_handlers: {
                        controller_assigned: 'assigned',
                        controller_assigmment_cancelled: 'cancelled',
                    },
                },
                assigned: {
                    tape_data: [true, false],
                    repetitions: 5,
                    auto_rewind_tape_after_end: false,
                    ticks2advance_tape: 4,
                    tape_next(this: SelectedPlayerIndexIcon, state: State) {
                        this.colorize = state.current_tape_value ? { r: 1, g: 1, b: 1, a: .5 } : { r: 0, g: 1, b: 0, a: .75 };
                    },
                    tape_end(this: SelectedPlayerIndexIcon) {
                        this.sc.dispatch_event('animation_end', this);
                    },
                },
                cancelled: {
                    tape_data: [2],
                    repetitions: 16,
                    auto_rewind_tape_after_end: false,
                    ticks2advance_tape: 1,
                    entering_state(this: SelectedPlayerIndexIcon) {
                        this.colorize = { r: 1, g: 0, b: 0, a: .75 };
                    },
                    tape_next(this: SelectedPlayerIndexIcon, state: State) {
                        this.y -= state.current_tape_value;
                    },
                    tape_end(this: SelectedPlayerIndexIcon) {
                        this.sc.dispatch_event('animation_end', this);
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
    private checkNonConsumedPressed(button: BGamepadButton, gamepadInput: InputHandler) {
        return gamepadInput.getButtonState(button).pressed && !gamepadInput.getButtonState(button).consumed;
    }

    /**
     * Calculates the X position of the assignment-icon based on the given position index.
     * @param positionIndex The index of the position.
     * @returns The calculated X position of the icon.
     */
    private calcIconPositionX(positionIndex: number) { return PendingAssignmentProcessor.joystick_icon_start.x + (PendingAssignmentProcessor.joystick_icon_increment_x * (positionIndex ?? 0)); };

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
    private createSelectPlayerIconIfNeeded(gamepadInput: InputHandler, positionIndex: number) {
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
                    this.createSelectPlayerIconIfNeeded(this.inputHandler, this.pendingIndex);
                    this.icon.playerIndex = proposedPlayerIndex;
                    console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${proposedPlayerIndex}.`);
                }
            }
        }
        else {
            if (!$.model.getFromCurrentSpace(this.icon.id)) {
                $.model.move_obj_to_space(this.icon.id, $.model.activeSpaceId);
            }
            this.icon.x = this.calcIconPositionX(this.pendingIndex);
            if (this.checkNonConsumedPressed('a', gamepadInput)) {
                // Assign gamepad to player and remove the joystick icon
                gamepadInput.consumeButton('a');
                inputMaestro.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
                // Initialize the HID pad for the gamepad input
                await gamepadInput.init(); // *REQUIRES USER INPUT TO GRANT PERMISSION TO USE THE HID API!! THEREFORE, THIS FUNCTION SHOULD BE CALLED AS PART OF A USER INTERACTION!*
                inputMaestro.removePendingGamepadAssignment(this.inputHandler.gamepadIndex);
                $.emit('controller_assigned', Input.instance, { proposedPlayerIndex: this.proposedPlayerIndex });
                this.icon = null;
            }
            else if (this.checkNonConsumedPressed('b', gamepadInput)) {
                // Cancel assignment process for this gamepad and remove the joystick icon
                gamepadInput.consumeButton('b');
                this.proposedPlayerIndex = null; // Set proposed player index to null to indicate that the gamepad is no longer proposed to be assigned to a player. Note that we keep the pending gamepad assignment object around, so that the gamepad can be assigned to a player again later.
                $.emit('controller_assignment_cancelled', Input.instance, { proposedPlayerIndex: this.proposedPlayerIndex });
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
