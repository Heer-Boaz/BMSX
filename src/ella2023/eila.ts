import { BTStatus } from './../bmsx/behaviourtree';
import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { new_area, Direction, Game, new_vec2, get_gamemodel, BFont, new_vec3 } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { Sprite, SpriteObject } from '../bmsx/sprite';
import { attach_components } from '../bmsx/component';
import { BehaviorTreeDefinition, build_bt } from '../bmsx/behaviourtree';
import { ProhibitLeavingScreenComponent, ScreenBoundaryComponent } from './../bmsx/collisioncomponents';
import { PositionUpdateAxisComponent } from './../bmsx/collisioncomponents';
import { subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from '../bmsx/eventemitter';
import { StateMachineVisualizer } from '../bmsx/bmsxdebugger';
import { gamemodel } from './gamemodel';


const actions = ['jump', 'right', 'duck', 'left', 'punch', 'highkick', 'lowkick', 'block'] as const;
type Action = typeof actions[number];
const get_model = get_gamemodel<gamemodel>;

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
    'punch': 'KeyX',
    'highkick': 'KeyA',
    'lowkick': 'KeyZ',
    'block': 'ShiftLeft',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'jump': 'up',
    'right': 'right',
    'duck': 'down',
    'left': 'left',
    'punch': 'a',
    'highkick': 'b',
    'lowkick': 'x',
    'block': 'y',
};

@insavegame
export class JumpingWhileLeavingScreenComponent extends ScreenBoundaryComponent {
    constructor(_id: string) {
        super(_id);
        this.enabled = false; // Disabled by default
    }

    /**
     * Event handler for the 'leavingScreen' event.
     * @param emitter - The ID of the game object emitting the event.
     * @param d - The direction in which the game object is leaving the screen.
     * @param old_x_or_y - The previous x or y coordinate of the game object.
     */
    @subscribesToParentScopedEvent('leavingScreen')
    public onLeavingScreen(event_name: string, emitter: Player, d: Direction, old_x_or_y: number) {
        if (d === Direction.Left) {
            emitter.facing = 'right';
        }
        else emitter.facing = 'left';
        // if (d === Direction.Left || d === Direction.Right) {
        //     if (emitter.state.is('Player.jump.jump_up')) {
        //         emitter.state.switch('Player.jump.jump_down'); // Gaat niet werken wegens niet passen van kickstate
        //     }
    }
}

@insavegame
@assign_fsm('player_animation')
@attach_components(JumpingWhileLeavingScreenComponent, ProhibitLeavingScreenComponent, StateMachineVisualizer)
export class Player extends SpriteObject {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;

    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        // To check if an action is pressed for player 0
        function defaultrun(this: Player, s: sstate) {
            const priorityActions = Input.getPressedPriorityActions(0, ['duck', 'right', 'left', 'jump', 'punch', 'highkick', 'lowkick', 'block']);

            // If no actions are pressed, switch to idle
            if (!priorityActions.some(action => action.pressed && !action.consumed)) {
                this.state.to('idle');
                return;
            }

            let higherPrioActionProcessed = false;
            let leftOrRightPressed = false;
            for (const actionObject of priorityActions) {
                const { action, pressed, consumed } = actionObject;
                if (higherPrioActionProcessed) break;

                switch (action as Action) {
                    case 'right':
                    case 'left':
                        if (leftOrRightPressed) break;
                        leftOrRightPressed = true;
                        this.facing = action as typeof this.facing;

                        // Check for combined jump left/right action
                        if (priorityActions.some(action => action.action === 'jump')) {
                            this.state.to('jump', true);
                            higherPrioActionProcessed = true;
                        }
                        else {
                            this.x += action === 'right' ? Player.SPEED : -Player.SPEED;
                            this.state.to('walk');
                        }
                        break;
                    case 'duck':
                        this.state.to('duck');
                        higherPrioActionProcessed = true;
                        break;
                    case 'punch':
                    case 'highkick':
                    case 'lowkick':
                        if (!consumed) {
                            Input.consumeAction(0, action);
                            this.state.to(action);
                        }
                        break;
                    case 'jump':
                        this.state.to('jump', false); // Actions 'left' and 'right' have higher priority than 'jump' and thus directonal jumps are handled in the 'left' and 'right' cases
                        break;
                }
            }
        }

        function duckrun(this: Player) {
            const pressedActions = Input.getPressedActions(0);

            if (pressedActions.some(action => action.action === 'lowkick')) {
                this.state.to('duckkick');
            }
            // Search whether the `duck` action was NOT pressed
            else if (!pressedActions.some(action => action.action === 'duck')) {
                this.state.to('idle');
            }
        }

        function jumprun(this: Player) {
            const pressedActions = Input.getPressedActions(0);

            if (pressedActions.some(action => action.action === 'lowkick' || action.action === 'highkick')) {
                if (this.state.is('Player.jump.jump_up.normal') || this.state.is('Player.jump.jump_down.normal')) {
                    this.state.switch('Player.jump.*.flyingkick');
                }
            }
        }

        return {
            states: {
                _idle: {
                    run: defaultrun,
                    enter(this: Player) {
                        this.state.machines.player_animation.to('idle');
                    },
                },
                walk: {
                    run: defaultrun,
                    enter(this: Player) {
                        if (!this.state.is('player_animation.walk')) {
                            this.state.to('player_animation.walk');
                        }
                    },
                },
                punch: {
                    enter(this: Player) {
                        this.state.to('player_animation.punch');
                    },
                },
                highkick: {
                    enter(this: Player) {
                        this.state.to('player_animation.highkick');
                    },
                },
                lowkick: {
                    enter(this: Player) {
                        this.state.to('player_animation.lowkick');
                    },
                },
                duckkick: {
                    enter(this: Player) {
                        this.state.to('player_animation.duckkick');
                    },
                },
                duck: {
                    run: duckrun,
                    enter(this: Player) {
                        this.state.to('player_animation.duck');
                    },
                },
                jump: {
                    enter(this: Player, state: sstate, directional: boolean = false) {
                        this.state.to('Player.jump.jump_up', directional);
                        this.state.to('player_animation.jump');
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                    },
                    exit(this: Player) {
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
                    },
                    run: jumprun,
                    states: {
                        _jump_up: {
                            nudges2move: Player.JUMP_DURATION / 2,
                            enter(this: Player, state: sstate, directional: boolean = false) {
                                state.reset();
                                state.data.directional = directional;
                                state.to('normal');
                            },
                            run(this: Player, state: sstate) {
                                this.y -= Player.JUMP_SPEED;
                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Player.SPEED;
                                    } else {
                                        this.x += Player.SPEED;
                                    }
                                }
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('Player.jump.jump_down', state.data.directional, state.currentid);
                            },
                            states: {
                                _normal: {
                                    enter(this: Player) {
                                        this.state.machines.player_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Player) {
                                        this.state.machines.player_animation.to('flyingkick');
                                    }
                                },
                            }
                        },
                        jump_down: {
                            nudges2move: Player.JUMP_DURATION / 2,
                            enter(this: Player, state: sstate, directional: boolean = false, substate: 'normal' | 'flyingkick' = 'normal') {
                                state.reset();
                                state.data.directional = directional;
                                state.to(substate);
                            },
                            run(this: Player, state: sstate) {
                                this.y += Player.JUMP_SPEED;

                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Player.SPEED;
                                    } else {
                                        this.x += Player.SPEED;
                                    }
                                }
                            },
                            next(this: Player, state: sstate) {
                                this.state.to('idle');
                            },
                            states: {
                                _normal: {
                                    enter(this: Player) {
                                        this.state.machines.player_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Player) {
                                        this.state.machines.player_animation.to('flyingkick');
                                    }
                                },
                            }
                        },
                    },
                },
            }
        }
    }

    @subscribesToSelfScopedEvent('animationEnd')
    public handleAnimationEndEvent(event_name: string, emitter: Player, animation_name: string): void {
        switch (event_name) {
            case 'animationEnd':
                switch (animation_name) {
                    case 'highkick':
                    case 'punch':
                    case 'lowkick':
                        this.state.to('idle');
                        break;
                    case 'flyingkick':
                        this.state.switch('Player.jump.jump_up.normal');
                        this.state.switch('Player.jump.jump_down.normal');
                        break;
                    case 'duckkick':
                        this.state.to('duck');
                        break;
                }
                break;
        }
    }

    facing: 'left' | 'right';

    @build_fsm('player_animation')
    public static buildAnimationFsm(): machine_states {
        return {
            parallel: true,
            states: {
                _idle: {
                    run: () => { },
                    enter(this: Player) {
                        this.imgid = BitmapId.eila_idle;
                    },
                },
                walk: {
                    run(this: Player, state: sstate) { },
                    enter(this: Player, state: sstate) {
                        state.state.reset();
                        this.imgid = BitmapId.eila_walk;
                    },
                    states: {
                        _walk1: {
                            nudges2move: 8,
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.eila_walk;
                                state.reset();
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('player_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            nudges2move: 8,
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.eila_idle;
                                state.reset();
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('player_animation.walk.walk1');
                            }
                        },
                    }
                },
                highkick: {
                    nudges2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_highkick;
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'highkick');
                        this.state.switch('player_animation.idle');
                    }
                },
                lowkick: {
                    nudges2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_lowkick;
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'lowkick');
                        this.state.switch('player_animation.idle');
                    }
                },
                punch: {
                    nudges2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_punch;
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'punch');
                        this.state.switch('player_animation.idle');
                    }
                },
                duckkick: {
                    nudges2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_duckkick;
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'duckkick');
                        this.state.switch('player_animation.duck');
                    }
                },
                flyingkick: {
                    nudges2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_flyingkick;
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'flyingkick');
                        this.state.switch('player_animation.jump');
                    }
                },
                duck: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.eila_duck; },
                },
                jump: {
                    run: () => { },
                    enter(this: Player) { this.imgid = BitmapId.eila_jump; },
                },
                humiliated: {
                    nudges2move: 50,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.eila_humiliated;
                    },
                    next(this: Player, state: sstate) {
                        this.state.to('player_animation.idle'); // Placeholder
                    }
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
