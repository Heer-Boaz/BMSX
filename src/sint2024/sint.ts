import { SpriteObject, StateMachineBlueprint, build_fsm, insavegame } from '../bmsx/bmsx';


@insavegame
export class sint extends SpriteObject {
    constructor() {
        super('sint');
        this.imgid = 'hmm'; // Set the image to be displayed to 'hmm' so that the size properties are calculated
        // Place sint at lower-right corner of the screen by using the
        // screen width and height minus the sprite width and height
        const gamescreenSize = $.getViewportSize();
        this.x = gamescreenSize.x - this.sx;
        this.y = gamescreenSize.y - this.sy;
    }

    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _vraag: {
                    on: {
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                    },
                    enter(this: sint) {
                        this.imgid = 'hmm';
                    },
                },
                antwoord: {
                    on: {
                        vraag: 'vraag',
                        klaar: 'klaar',
                    },
                    enter(this: sint) {
                        this.imgid = 'goed';
                    },
                },
                klaar: {
                    on: {
                        antwoord: 'antwoord',
                        vraag: 'vraag',
                    },
                    enter(this: sint) {
                        this.imgid = 'klaar';
                    },
                },
            }
        }
    }
}
