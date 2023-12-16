import { Action, gamepadInputMapping, keyboardInputMapping1 } from './inputmapping';
import { AudioId, BitmapId } from './resourceids';
import { Input, InputMap } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { get_gamemodel, new_area } from '../bmsx/bmsx';
import { ScreenBoundaryComponent } from './../bmsx/collisioncomponents';
import { Fighter, HitMarkerInfo } from './fighter';
import { attach_components } from '../bmsx/component';
import { subscribesToGlobalEvent, subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from '../bmsx/eventemitter';
import { Direction } from "../bmsx/bmsx";
import { gamemodel } from './gamemodel';
import { SM } from '../bmsx/soundmaster';

const get_model = get_gamemodel<gamemodel>;

export type EilaAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick';

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
    }
}

@insavegame
@assign_fsm('player_animation')
@attach_components(JumpingWhileLeavingScreenComponent)
export class Player extends Fighter {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;

    @statedef_builder
    public static bouw(): machine_states {
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
                return;
            }
            // Search whether the `duck` action was NOT pressed
            else if (!pressedActions.some(action => action.action === 'duck')) {
                this.state.to('idle');
                return;
            }
            else if (pressedActions.some(action => action.action === 'left')) {
                this.facing = 'left';
                return;
            }
            else if (pressedActions.some(action => action.action === 'right')) {
                this.facing = 'right';
                return;
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

        const statemachine = 'player_animation';
        return {
            states: {
                _idle: {
                    run: defaultrun,
                    enter(this: Player) {
                        this.state.to('player_animation.idle');
                    },
                },
                humiliated: {
                    enter(this: Player) {
                        this.hittable = false;
                        this.resetVerticalPosition();
                        this.state.to('player_animation.humiliated');
                    },
                },
                stoerheidsdans: {
                    auto_tick: false,
                    ticks2move: 1,
                    tape: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
                    repetitions: 2,
                    enter(this: Fighter, state: sstate) {
                        state.reset();
                        this.resetVerticalPosition();
                        this.hittable = false;
                        this.state.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    run(this: Player, state: sstate) {
                        // Lelijk
                        if (this.state.machines[statemachine].is(`idle`)) {
                            ++state.ticks;
                        }
                    },
                    next(this: Fighter, state: sstate) {
                        this.state.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    end(this: Fighter) {
                        this.state.to('idle');
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                },
                au: {
                    enter(this: Player) {
                        this.state.pause_statemachine('player_animation');
                    },
                    exit(this: Player) {
                        this.state.resume_statemachine('player_animation');
                    }
                },
                doetau: {
                    enter(this: Player) {
                        this.state.pause_statemachine('player_animation');
                    },
                    exit(this: Player) {
                        this.state.resume_statemachine('player_animation');
                    }
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
                        const hit = this.doAttackFlow('punch', get_model().theOtherFighter(this));
                        this.state.to('player_animation.punch', hit);
                    },
                },
                highkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('highkick', get_model().theOtherFighter(this));
                        this.state.to('player_animation.highkick', hit);
                    },
                },
                lowkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('lowkick', get_model().theOtherFighter(this));
                        this.state.to('player_animation.lowkick', hit);
                    },
                },
                duckkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('dickkick', get_model().theOtherFighter(this));
                        this.state.to('player_animation.duckkick', hit);
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
                            ticks2move: Player.JUMP_DURATION / 2,
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
                                        this.doAttackFlow('flyingkick', get_model().theOtherFighter(this));
                                    }
                                },
                            }
                        },
                        jump_down: {
                            ticks2move: Player.JUMP_DURATION / 2,
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
                                        this.doAttackFlow('flyingkick', get_model().theOtherFighter(this));
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
                        if (!this.state.is('stoerheidsdans')) {
                            this.state.to('idle');
                        }
                        break;
                    case 'flyingkick':
                        this.state.switch('Player.jump.jump_up.normal');
                        this.state.switch('Player.jump.jump_down.normal');
                        break;
                    case 'duckkick':
                        if (!this.state.is('stoerheidsdans')) {
                            this.state.to('duck');
                        }
                        else {
                            this.state.to('player_animation.idle');
                        }
                        break;
                }
                break;
        }
    }

    override handleFighterStukEvent(this: Fighter, event_name: string, emitter: Fighter): void {
        this.state.to('humiliated');
        get_model().theOtherFighter(emitter).state.to('stoerheidsdans');
    }

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
                            ticks2move: 8,
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.eila_walk;
                                state.reset();
                            },
                            next(this: Player, state: sstate) {
                                this.state.switch('player_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            ticks2move: 8,
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
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate, hit: boolean) {
                        state.reset();
                        this.imgid = BitmapId.eila_highkick;
                        SM.play(AudioId.kick);
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'highkick');
                        this.state.switch('player_animation.idle');
                    }
                },
                lowkick: {
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_lowkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'lowkick');
                        this.state.switch('player_animation.idle');
                    }
                },
                punch: {
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.punch);
                        this.imgid = BitmapId.eila_punch;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Player, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'punch');
                        this.state.switch('player_animation.idle');
                    }
                },
                duckkick: {
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_duckkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Player, state: sstate) {
                        this.state.switch('player_animation.duck');
                        global.eventEmitter.emit('animationEnd', this, 'duckkick');
                    }
                },
                flyingkick: {
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_flyingkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Player, state: sstate) {
                        this.state.switch('player_animation.jump');
                        global.eventEmitter.emit('animationEnd', this, 'flyingkick');
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
                    ticks2move: 300,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        SM.play(AudioId.stuk);
                        this.imgid = BitmapId.eila_humiliated;
                    },
                    next(this: Player, state: sstate) {
                        get_gamemodel().state.to('gameover');
                    }
                },
            }
        };
    }

    constructor() {
        super('player', undefined, 'left');
        this.hp = gamemodel.EILA_START_HP;
    }

    override paint(): void {
        super.paint();
    }
};
