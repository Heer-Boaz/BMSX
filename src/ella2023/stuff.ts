import { SpriteObject } from '../bmsx/sprite';
import { BitmapId } from './resourceids';
import { machine_states, statedef_builder } from '../bmsx/bfsm';
import { get_gamemodel, new_area3d, new_vec3 } from '../bmsx/bmsx';
import { gamemodel } from './gamemodel';
import { TextWriter } from '../bmsx/textwriter';
import { Input } from '../bmsx/input';
import { DrawRectOptions } from '../bmsx/view';
import { Msx1Colors } from '../bmsx/msx';

const get_model = get_gamemodel<gamemodel>;

export class GameOver extends SpriteObject {
    @statedef_builder
    static bouw(): machine_states {
        return {
            states: {
                _default: {
                    ticks2move: 500,
                    run(this: TitleScreen) {
                        const priorityActions = Input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions || priorityActions.length === 0) {
                            return;
                        }
                        Input.getPlayerInput(1).consumeActions(...priorityActions);

                        // If a priority action is pressed, go to the game.
                        get_model().sc.to('titlescreen');
                    },
                    end(this: GameOver) {
                        get_model().sc.to('titlescreen');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        const x = 8;
        const y = 144;

        const options: DrawRectOptions = { area: new_area3d(0, 136, this.z + 1, 256, 192 - 8, this.z + 1), color: Msx1Colors[0] };
        game.view.fillRectangle(options);
        const lines = ['je bent toch niet', 'de strijder die ik nodig heb.', 'ik ben een beetje', 'teleurgesteld in jouw ouders...'];

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
                    run(this: TitleScreen) {
                        // const priorityActions = Input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // // If no priority actions are pressed, do nothing.
                        // if (!priorityActions || priorityActions.length === 0) {
                        //     return;
                        // }
                        // Input.getPlayerInput(1).consumeActions(...priorityActions);

                        // // If a priority action is pressed, go to the game.
                        // get_model().sc.to('titlescreen');

                    },
                    end(this: Hoera) {
                        get_model().sc.to('titlescreen');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        const x = 16;
        const y = 160;

        const options: DrawRectOptions = { area: new_area3d(0, 152, this.z + 1, 256, 192, this.z + 1), color: Msx1Colors[0] };
        game.view.fillRectangle(options);
        const lines = ['dat heb je', 'redelijk gedaan Elly!', 'ik bedoel: Ei La!'];

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
                    run(this: TitleScreen) {
                        const priorityActions = Input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions || priorityActions.length === 0) {
                            return;
                        }
                        Input.getPlayerInput(1).consumeActions(...priorityActions);

                        // If a priority action is pressed, go to the game.
                        get_model().sc.to('default');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        game.view.drawImg({ imgid: BitmapId.menu_arrow, pos: new_vec3(80, 160, 100) });

    }

    constructor() {
        super('title');
        this.imgid = BitmapId.title;
    }
}
