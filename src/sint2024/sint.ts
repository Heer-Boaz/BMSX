import { $, SpriteObject, StateMachineBlueprint, build_fsm, insavegame } from '../bmsx/index';


@insavegame
export class sint extends SpriteObject {
    constructor() {
        super('sint');
    }

    /**
     * Sets the image to be displayed and updates the position based on the viewport size.
     *
     * @param imgid - The ID of the image to be displayed. If the ID is 'none', the position is not updated.
     */
    public setimg(imgid: string) {
        this.imgid = imgid; // Set the image to be displayed to 'hmm' so that the size properties are calculated
        if (this.imgid !== 'none') {
            const gamescreenSize = $.viewportSize;
            this.x = gamescreenSize.x - this.sx;
            this.y = gamescreenSize.y - this.sy;
        }
    }

    @build_fsm()
    /**
     * Constructs and returns a StateMachineBlueprint object.
     *
     * The blueprint defines the states and transitions for a state machine.
     *
     * States:
     * - `_start`: Initial state with transitions to `vraag`, `antwoord`, `klaar`, and `weg`.
     *   - `enter`: Sets the image to 'quiz'.
     * - `weg`: State with transitions to `vraag`, `antwoord`, and `klaar`.
     *   - `enter`: Sets the visibility to false.
     *   - `exit`: Sets the visibility to true.
     * - `vraag`: State with transitions to `antwoord`, `klaar`, and `weg`.
     *   - `enter`: Sets the image to 'hmm'.
     * - `antwoord`: State with transitions to `vraag`, `klaar`, and `weg`.
     *   - `enter`: Sets the image to 'goed'.
     * - `klaar`: State with transitions to `antwoord`, `vraag`, and `weg`.
     *   - `enter`: Sets the image to 'klaar'.
     *
     * @returns {StateMachineBlueprint} The blueprint for the state machine.
     */
    static bouw(): StateMachineBlueprint {
        return {
            substates: {
                _start: {
                    event_handlers: {
                        vraag: 'vraag',
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                        weg: 'weg',
                    },
                    entering_state(this: sint) {
                        this.setimg('quiz');
                    },
                },
                weg: {
                    event_handlers: {
                        vraag: 'vraag',
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                    },
                    entering_state(this: sint) {
                        this.visible = false;
                    },
                    exiting_state(this: sint) {
                        this.visible = true;
                    },
                },
                vraag: {
                    event_handlers: {
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                        weg: 'weg',
                    },
                    entering_state(this: sint) {
                        this.setimg('hmm');
                    },
                },
                antwoord: {
                    event_handlers: {
                        vraag: 'vraag',
                        klaar: 'klaar',
                        weg: 'weg',
                    },
                    entering_state(this: sint) {
                        this.setimg('goed');
                    },
                },
                klaar: {
                    event_handlers: {
                        antwoord: 'antwoord',
                        vraag: 'vraag',
                        weg: 'weg',
                    },
                    entering_state(this: sint) {
                        this.setimg('klaar');
                    },
                },
            }
        }
    }
}
