import { BTStatus } from './../bmsx/behaviourtree';
import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { new_area, Direction, Game, new_vec2, get_gamemodel } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';
import { attach_components } from '../bmsx/component';
import { BehaviorTreeDefinition, build_bt } from '../bmsx/behaviourtree';
import { ProhibitLeavingScreenComponent } from './../bmsx/collisioncomponents';
import { PositionUpdateAxisComponent } from './../bmsx/collisioncomponents';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || global;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode);
    _game.start();
};

const get_model = get_gamemodel<gamemodel>;

const actions = ['jump', 'right', 'duck', 'left', 'punch', 'kick', 'block'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton;
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton;
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'jump': 'ArrowUp',
    'right': 'ArrowRight',
    'duck': 'ArrowDown',
    'left': 'ArrowLeft',
    'punch': 'ShiftLeft',
    'kick': 'KeyZ',
    'block': 'KeyA',
    // 'blap': 'KeyS',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'jump': 'up',
    'right': 'right',
    'duck': 'down',
    'left': 'left',
    'punch': 'a',
    'kick': 'b',
    'block': 'x',
    // 'blap': 'y',
};

@insavegame
class enemy extends SpriteObject {
    @build_bt('enemyBehaviorTree')
    public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
        function isPlayerInRange(this: enemy): boolean {
            // Logic to determine if the player is in range
            return false; // Placeholder logic
        }

        function isPlayerAttacking(this: enemy): boolean {
            // Logic to check if the player is attacking
            return false; // Placeholder logic
        }

        function performAttackMove1(this: enemy): BTStatus {
            // Logic for attack move 1
            return 'SUCCESS';
        }

        function performAttackMove2(this: enemy): BTStatus {
            // Logic for attack move 2
            return 'SUCCESS';
        }

        function performSpecialMove(this: enemy): BTStatus {
            // Logic for special move
            return 'SUCCESS';
        }

        function block(this: enemy): BTStatus {
            // Logic for block action
            return 'SUCCESS';
        }

        function dodge(this: enemy): BTStatus {
            // Logic for dodge action
            return 'SUCCESS';
        }

        function counter(this: enemy): BTStatus {
            // Logic for counter action
            return 'SUCCESS';
        }

        function idle(this: enemy): BTStatus {
            // Logic for idle behavior
            return 'SUCCESS';
        }

        return {
            type: 'Selector',
            children: [
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isPlayerInRange
                        },
                        {
                            type: 'RandomSelector',
                            currentchild_propname: 'currentAttackMove',
                            children: [
                                { type: 'Action', action: performAttackMove1 },
                                { type: 'Action', action: performAttackMove2 },
                                { type: 'Action', action: performSpecialMove }
                            ]
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isPlayerAttacking
                        },
                        {
                            type: 'RandomSelector',
                            currentchild_propname: 'currentDefenseMove',
                            children: [
                                { type: 'Action', action: block },
                                { type: 'Action', action: dodge },
                                { type: 'Action', action: counter }
                            ]
                        }
                    ]
                },
                {
                    type: 'Action',
                    action: idle
                }
            ]
        };
    }
}

@insavegame
@assign_fsm('player_animation')
@attach_components(ProhibitLeavingScreenComponent)
class Player extends SpriteObject {
    facing: 'left' | 'right';

    @build_fsm('player_animation')
    public static buildAnimationFsm(): machine_states {
        return {
            parallel: true,
            states: {
                _idle: {
                    run: () => { },
                    enter(this: Player) {
                        this.imgid = BitmapId.lee_idle;
                    },
                },
                walk: {
                    run(this: Player, state: sstate) { },
                    enter(this: Player, state: sstate) {
                        state.state.reset();
                        this.imgid = BitmapId.lee_walk;
                    },
                    states: {
                        _walk1: {
                            nudges2move: 8,
                            run(this: Player, state: sstate) {
                                ++state.nudges;
                            },
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.lee_walk;
                                state.reset();
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('player_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            nudges2move: 8,
                            run(this: Player, state: sstate) { ++state.nudges; },
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.lee_idle;
                                state.reset();
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('player_animation.walk.walk1');
                            }
                        },
                    }
                },
                highkick: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_highkick; },
                },
                lowkick: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_lowkick; },
                },
                punch: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_punch; },
                },
                flyingkick: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_flyingkick; },
                },
                duck: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_duckorjump; },
                },
                jump: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.lee_duckorjump; },
                },
                humiliated: {
                    nudges2move: 50,
                    enter(this: Player) { this.imgid = BitmapId.lee_humiliated_1; },
                    states: {
                        _wait: {
                            nudges2move: 50,
                            enter(this: Player) { this.imgid = BitmapId.lee_humiliated_1; },
                            next(this: Player, state: sstate) {
                                this.state['player_animation'].to('humiliated.animation');
                            }
                        },
                        animation: {
                            nudges2move: 25,
                            states: {
                                _humiliated1: {
                                    nudges2move: 25,
                                    enter(this: Player) { this.imgid = BitmapId.lee_humiliated_1; },
                                    next(this: Player, state: sstate) {
                                        this.state['player_animation'].to('humiliated.animation.humiliated2');
                                    }
                                },
                                humiliated2: {
                                    nudges2move: 25,
                                    enter(this: Player) { this.imgid = BitmapId.lee_humiliated_2; },
                                    next(this: Player, state: sstate) {
                                        this.state['player_animation'].to('humiliated.animation._humiliated1');
                                    }
                                },
                            },
                            tape: ['humiliated1', 'humiliated2'],
                            repetitions: 8,
                            auto_rewind_tape_after_end: true,
                            next(this: Player, state: sstate) {
                                this.state['player_animation'].to('humiliated.waitEnd');
                            }
                        },
                        waitEnd: {
                            nudges2move: 50,
                            enter(this: Player) { this.imgid = BitmapId.lee_humiliated_1; },
                            next(this: Player, state: sstate) {
                                this.state['player_animation'].to('nextState'); // replace 'nextState' with the actual state to transition to
                            }
                        },
                    },
                    tape: ['wait', 'animation', 'waitEnd'],
                },
            }
        };
    }

    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        // To check if an action is pressed for player 0
        function defaultrun(this: Player, s: sstate) {
            const speed = 2;

            const pressedActions = Input.getPressedActions(0);
            let walked = false;

            for (const { action, pressed, consumed } of pressedActions) {
                switch (action as Action) {
                    case 'right':
                        walked = true;
                        this.facing = 'right';
                        this.x += speed;
                        break;
                    case 'left':
                        walked = true;
                        this.facing = 'left';
                        this.x -= speed;
                        break;
                }
            }
            if (walked && !this.state.is('player_animation.walk')) {
                this.state.switch('player_animation.walk');
            } else if (!walked && this.state.is('Player.idle_or_walk')) {
                this.state.switch('player_animation.idle');
            }
        }

        return {
            states: {
                _idle_or_walk: {
                    run: defaultrun,
                    enter(this: Player) {
                        this.state.switch('player_animation.idle');
                    },
                },
            }
        };
    }

    constructor() {
        super('player');
        this.facing = 'left';
        this.size.x = 40;
        this.size.y = 37;
        this.hitarea = new_area(0, 0, 40, 37);
    }

    override paint(): void {
        this.flip_h = this.facing !== 'left';
        super.paint();
    }
};

@insavegame
class gamemodel extends BaseModel {
    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                _game_start: {
                    run(this: gamemodel, s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.state.to('default');
                    }
                },
                default: {
                    run: BaseModel.defaultrun,
                },
            }
        };
    }

    // DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
    // Trying to add logic here will most often result in runtime errors.
    // These runtime errors usually occur because the model was not created and initialized (with states),
    // while creating new game objects that reference the model or the model states
    constructor() {
        super();
    }

    public get constructor_name(): string {
        return this.constructor.name;
    }

    public override do_one_time_game_init(): this {
        _model.spawn(new Player(), new_vec2(100, 100));
        return this;
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(o: GameObject, dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(x: number, y: number): boolean {
        return false;
    }
}

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
        super.drawSprites();
    }
}
