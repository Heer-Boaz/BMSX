import { SpriteObject, StateMachineBlueprint, build_fsm, insavegame } from '../bmsx/bmsx';


@insavegame
export class sint extends SpriteObject {
    constructor() {
        super('sint');
        this.setimg('hmm');
    }

    private setimg(imgid: string) {
        this.imgid = imgid; // Set the image to be displayed to 'hmm' so that the size properties are calculated
        if (this.imgid !== 'none') {
            const gamescreenSize = $.getViewportSize();
            this.x = gamescreenSize.x - this.sx;
            this.y = gamescreenSize.y - this.sy;
        }
    }

    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _weg: {
                    on: {
                        vraag: 'vraag',
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                    },
                    enter(this: sint) {
                        this.visible = false;
                    },
                    exit(this: sint) {
                        this.visible = true;
                    },
                },
                vraag: {
                    on: {
                        antwoord: 'antwoord',
                        klaar: 'klaar',
                        weg: 'weg',
                    },
                    enter(this: sint) {
                        this.setimg('hmm');
                    },
                },
                antwoord: {
                    on: {
                        vraag: 'vraag',
                        klaar: 'klaar',
                        weg: 'weg',
                    },
                    enter(this: sint) {
                        this.setimg('goed');
                    },
                },
                klaar: {
                    on: {
                        antwoord: 'antwoord',
                        vraag: 'vraag',
                        weg: 'weg',
                    },
                    enter(this: sint) {
                        this.setimg('klaar');
                    },
                },
            }
        }
    }
}
