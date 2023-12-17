import { SpriteObject } from '../bmsx/sprite';
import { BitmapId } from './resourceids';
import { machine_states, sstate, statedef_builder } from '../bmsx/bfsm';
import { get_gamemodel } from '../bmsx/bmsx';
import { GLView } from '../bmsx/glview';
import { Msx1Colors } from '../bmsx/msx';
import { gamemodel } from './gamemodel';
import { Fighter } from './fighter';
import { TextWriter } from '../bmsx/textwriter';
import { Input } from '../bmsx/input';

const get_model = get_gamemodel<gamemodel>;

export class GameOver extends SpriteObject {
    @statedef_builder
    static bouw(): machine_states {
        return {
            states: {
                _default: {
                    ticks2move: 500,
                    run(this: TitleScreen, state: sstate) {
                        const priorityActions = Input.getPlayerInput(0).getPressedPriorityActions( ['punch', 'highkick', 'lowkick', 'block']);

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions.some(action => action.pressed && !action.consumed)) {
                            return;
                        }
                        for (const action of ['punch', 'highkick', 'lowkick', 'block']) {
                            Input.getPlayerInput(0).consumeAction(action);
                        }
                        // If a priority action is pressed, go to the game.
                        get_model().state.to('titlescreen');
                    },
                    end(this: GameOver, state: sstate) {
                        get_model().state.to('titlescreen');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        const x = 16;
        const y = 144;

        const lines = ['je bent toch niet', 'de strijder die ik nodig heb..', 'ik ben toch', 'lichtelijk teleurgesteld...'];

        TextWriter.drawText(x, y, lines);
    }

    constructor() {
        super('gameover');
        this.imgid = BitmapId.gameover;
    }
}

export class Hoera extends SpriteObject {
    @statedef_builder
    static bouw(): machine_states {
        return {
            states: {
                _default: {
                    ticks2move: 500,
                    run(this: TitleScreen, state: sstate) {
                        const priorityActions = Input.getPlayerInput(0).getPressedPriorityActions( ['punch', 'highkick', 'lowkick', 'block']);

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions.some(action => action.pressed && !action.consumed)) {
                            return;
                        }
                        // If a priority action is pressed, go to the game.
                        for (const action of ['punch', 'highkick', 'lowkick', 'block']) {
                            Input.getPlayerInput(0).consumeAction(action);
                        }
                        get_model().state.to('titlescreen');

                    },
                    end(this: Hoera, state: sstate) {
                        get_model().state.to('titlescreen');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        const x = 16;
        const y = 144;

        const lines = ['dat heb je', 'redelijk gedaan Ella!', 'ik bedoel: ei la!'];

        TextWriter.drawText(x, y, lines);
    }

    constructor() {
        super('hoera');
        this.imgid = BitmapId.hoera;
    }
}

export class TitleScreen extends SpriteObject {
    @statedef_builder
    static bouw(): machine_states {
        return {
            states: {
                _default: {
                    run(this: TitleScreen, state: sstate) {
                        const priorityActions = Input.getPlayerInput(0).getPressedPriorityActions( ['punch', 'highkick', 'lowkick', 'block']);

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions.some(action => action.pressed && !action.consumed)) {
                            return;
                        }
                        for (const action of ['punch', 'highkick', 'lowkick', 'block']) {
                            Input.getPlayerInput(0).consumeAction(action);
                        }
                        // If a priority action is pressed, go to the game.
                        get_model().state.to('default');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();

        global.view.drawImg({ imgid: BitmapId.menu_arrow, x: 80, y: 160, z: 100 });
    }

    constructor() {
        super('title');
        this.imgid = BitmapId.title;
    }
}
