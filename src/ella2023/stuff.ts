import { DrawRectOptions, GameObject, Msx1Colors, SpriteObject, StateMachineBlueprint, TextWriter, build_fsm, new_area3d, new_vec3, sstate } from '../bmsx/bmsx';
import { BitmapId } from './resourceids';

export class GameOver extends SpriteObject {
    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _default: {
                    ticks2move: 500,
                    run(this: TitleScreen) {
                        const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions || priorityActions.length === 0) {
                            return;
                        }
                        $.input.getPlayerInput(1).consumeActions(...priorityActions);

                        // If a priority action is pressed, go to the $.
                        $.model.sc.to('titlescreen');
                    },
                    end(this: GameOver) {
                        $.model.sc.to('titlescreen');
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
        $.view.fillRectangle(options);
        const lines = ['je bent toch niet', 'de strijder die ik nodig heb.', 'ik ben een beetje', 'teleurgesteld in jouw ouders...'];

        TextWriter.drawText(x, y, lines);
    }

    constructor() {
        super('gameover');
        this.imgid = BitmapId.gameover;
    }
}

export class Hoera extends SpriteObject {
    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _default: {
                    ticks2move: 500,
                    run(this: TitleScreen) {
                        // const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // // If no priority actions are pressed, do nothing.
                        // if (!priorityActions || priorityActions.length === 0) {
                        //     return;
                        // }
                        // $.input.getPlayerInput(1).consumeActions(...priorityActions);

                        // // If a priority action is pressed, go to the $.
                        // get_model().sc.to('titlescreen');

                    },
                    end(this: Hoera) {
                        $.model.sc.to('titlescreen');
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
        $.view.fillRectangle(options);
        const lines = ['dat heb je', 'redelijk gedaan Elly!', 'ik bedoel: Ei La!'];

        TextWriter.drawText(x, y, lines);
    }

    constructor() {
        super('hoera');
        this.imgid = BitmapId.hoera;
    }
}

export class TitleScreen extends SpriteObject {
    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _default: {
                    run(this: TitleScreen) {
                        const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

                        // If no priority actions are pressed, do nothing.
                        if (!priorityActions || priorityActions.length === 0) {
                            return;
                        }
                        $.input.getPlayerInput(1).consumeActions(...priorityActions);

                        // If a priority action is pressed, go to the $.
                        $.event_emitter.emit('gamestart_selected', this, 2, 'b');
                    },
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        $.view.drawImg({ imgid: BitmapId.menu_arrow, pos: new_vec3(80, 160, 100) });

    }

    constructor() {
        super('title');
        this.imgid = BitmapId.title;
    }
}

export class Gordijn extends GameObject {
    private width;

    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            on: {
                $its_curtains: 'its_curtains_for_you',
                curtained: '_idle',
            },
            states: {
                _idle: {
                },
                its_curtains_for_you: {
                    ticks2move: 5,
                    tape: [8],
                    repetitions: 256 / 8,
                    enter(this: Gordijn, state: sstate) {
                        this.width = 0;
                        state.reset();
                    },
                    next(this: Gordijn, state: sstate) {
                        this.width += state.current_tape_value;
                    },
                    end(this: Gordijn) {
                        $.event_emitter.emit('curtained', this);
                    },
                },
            }
        }
    }

    constructor() {
        super('gordijn');
        this.z = 200;
        this.width = 0;
    }

    override paint(): void {
        if (this.width === 0) {
            return;
        }
        super.paint();
        const options: DrawRectOptions = { area: new_area3d(0, 0, this.z + 1, 256, 192, this.z), color: Msx1Colors[0] };
        $.view.fillRectangle(options);
    }
}
