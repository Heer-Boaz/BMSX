import { Action } from './inputmapping';
import { AudioId, BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { get_gamemodel } from '../bmsx/bmsx';
import { ScreenBoundaryComponent } from './../bmsx/collisioncomponents';
import { Fighter } from './fighter';
import { attach_components } from '../bmsx/component';
import { subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from '../bmsx/eventemitter';
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
    public onLeavingScreen(_event_name: string, emitter: Player, d: Direction, _old_x_or_y: number) {
        if (d === 'left') {
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
        function defaultrun(this: Player) {
            const priorityActions = Input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, actionsByPriority: ['duck', 'right', 'left', 'jump', 'punch', 'highkick', 'lowkick' ] });

            // If no actions are pressed, switch to idle
            if (priorityActions.length === 0) {
                this.sc.to('idle');
                return;
            }

            let higherPrioActionProcessed = false;
            let leftOrRightPressed = false;
            for (const actionObject of priorityActions) {
                const { action } = actionObject;
                if (higherPrioActionProcessed) break;

                switch (action as Action) {
                    case 'right':
                    case 'left':
                        if (leftOrRightPressed) break;
                        leftOrRightPressed = true;
                        this.facing = action as typeof this.facing;

                        // Check for combined jump left/right action
                        if (priorityActions.some(action => action.action === 'jump')) {
                            this.sc.to('jump', true);
                            higherPrioActionProcessed = true;
                        }
                        else {
                            this.x += action === 'right' ? Player.SPEED : -Player.SPEED;
                            this.sc.to('walk');
                        }
                        break;
                    case 'duck':
                        this.sc.to('duck');
                        higherPrioActionProcessed = true;
                        break;
                    case 'punch':
                    case 'highkick':
                    case 'lowkick':
                        Input.getPlayerInput(1).consumeAction(action);
                        this.sc.to(action);
                        break;
                    case 'jump':
                        Input.getPlayerInput(1).consumeAction(action);
                        this.sc.to('jump', false); // Actions 'left' and 'right' have higher priority than 'jump' and thus directonal jumps are handled in the 'left' and 'right' cases
                        break;
                    // case 'stoer':
                    //     this.state.to('stoerheidsdans');
                    //     break;
                }
            }
        }

        function duckrun(this: Player) {
            const pressedActions = Input.getPlayerInput(1).getPressedActions();
            const actionMap = new Map();

            // Create a map of actions for efficient lookup
            pressedActions.forEach(action => actionMap.set(action.action, true));

            if (actionMap.get('lowkick')) {
                this.sc.to('duckkick');
                return;
            }
            // Search whether the `duck` action was NOT pressed
            else if (!actionMap.get('duck')) {
                this.sc.to('idle');
                return;
            }
            else if (actionMap.get('left')) {
                this.facing = 'left';
                return;
            }
            else if (actionMap.get('right')) {
                this.facing = 'right';
                return;
            }
        }

        function jumprun(this: Player) {
            const kickActions = Input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['lowkick', 'highkick'] });
            if (kickActions.length > 0) {
                // Consume all kick actions
                kickActions.forEach(action => Input.getPlayerInput(1).consumeAction(action));
                if (this.sc.is('Player.jump.jump_up.normal') || this.sc.is('Player.jump.jump_down.normal')) {
                    this.sc.switch('Player.jump.*.flyingkick');
                }
            }
        }

        const statemachine = 'player_animation';
        return {
            states: {
                _idle: {
                    run: defaultrun,
                    enter(this: Player) {
                        this.sc.to('player_animation.idle');
                    },
                },
                humiliated: {
                    enter(this: Player) {
                        this.hittable = false;
                        this.resetVerticalPosition();
                        this.sc.to('player_animation.humiliated');
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
                        // this.hittable = false;
                        this.sc.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    run(this: Player, state: sstate) {
                        // Lelijk
                        if (this.sc.machines[statemachine].is(`idle`)) {
                            ++state.ticks;
                        }
                    },
                    next(this: Fighter, state: sstate) {
                        this.sc.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    end(this: Fighter) {
                        this.sc.to('nagenieten');
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                },
                nagenieten: {
                    enter(this: Player) {
                        this.sc.to(`player_animation.idle`);
                    },
                },
                au: {
                    enter(this: Player) {
                        this.sc.pause_statemachine('player_animation');
                    },
                    exit(this: Player) {
                        this.sc.resume_statemachine('player_animation');
                    }
                },
                doetau: {
                    enter(this: Player) {
                        this.sc.pause_statemachine('player_animation');
                    },
                    exit(this: Player) {
                        this.sc.resume_statemachine('player_animation');
                    }
                },
                walk: {
                    run: defaultrun,
                    enter(this: Player) {
                        if (!this.sc.is('player_animation.walk')) {
                            this.sc.to('player_animation.walk');
                        }
                    },
                },
                punch: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('punch', get_model().theOtherFighter(this));
                        this.sc.to('player_animation.punch', hit);
                    },
                },
                highkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('highkick', get_model().theOtherFighter(this));
                        this.sc.to('player_animation.highkick', hit);
                    },
                },
                lowkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('lowkick', get_model().theOtherFighter(this));
                        this.sc.to('player_animation.lowkick', hit);
                    },
                },
                duckkick: {
                    enter(this: Player) {
                        const hit = this.doAttackFlow('dickkick', get_model().theOtherFighter(this));
                        this.sc.to('player_animation.duckkick', hit);
                    },
                },
                duck: {
                    run: duckrun,
                    enter(this: Player) {
                        this.sc.to('player_animation.duck');
                    },
                },
                jump: {
                    enter(this: Player, _state: sstate, directional: boolean = false) {
                        this.sc.to('Player.jump.jump_up', directional);
                        this.sc.to('player_animation.jump');
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
                                this.sc.switch('Player.jump.jump_down', state.data.directional, state.currentid);
                            },
                            states: {
                                _normal: {
                                    enter(this: Player) {
                                        this.sc.machines.player_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Player) {
                                        const hit = this.doAttackFlow('flyingkick', get_model().theOtherFighter(this));
                                        this.sc.machines.player_animation.to('flyingkick', hit);
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
                            next(this: Player) {
                                this.sc.to('idle');
                            },
                            states: {
                                _normal: {
                                    enter(this: Player) {
                                        this.sc.machines.player_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Player, _state: sstate) {
                                        const hit = this.doAttackFlow('flyingkick', get_model().theOtherFighter(this));
                                        this.sc.machines.player_animation.to('flyingkick', hit);
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
    public handleAnimationEndEvent(event_name: string, _emitter: Player, animation_name: string): void {
        switch (event_name) {
            case 'animationEnd':
                switch (animation_name) {
                    case 'highkick':
                    case 'punch':
                    case 'lowkick':
                        if (!this.sc.is('stoerheidsdans')) {
                            this.sc.to('idle');
                        }
                        break;
                    case 'flyingkick':
                        this.sc.switch('Player.jump.jump_up.normal');
                        this.sc.switch('Player.jump.jump_down.normal');
                        break;
                    case 'duckkick':
                        if (!this.sc.is('stoerheidsdans')) {
                            this.sc.to('duck');
                        }
                        else {
                            this.sc.to('player_animation.idle');
                        }
                        break;
                }
                break;
        }
    }

    override handleFighterStukEvent(this: Fighter, _event_name: string, emitter: Fighter): void {
        this.sc.to('humiliated');
        get_model().theOtherFighter(emitter).sc.to('stoerheidsdans');
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
                    run(this: Player) { },
                    enter(this: Player, state: sstate) {
                        state.resetSubmachine();
                        this.imgid = BitmapId.eila_walk;
                    },
                    states: {
                        _walk1: {
                            ticks2move: 8,
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.eila_walk;
                                state.reset();
                            },
                            next(this: Player) {
                                this.sc.switch('player_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            ticks2move: 8,
                            enter(this: Player, state: sstate) {
                                this.imgid = BitmapId.eila_idle;
                                state.reset();
                            },
                            next(this: Player) {
                                this.sc.switch('player_animation.walk.walk1');
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
                    next(this: Player) {
                        global.eventEmitter.emit('animationEnd', this, 'highkick');
                        this.sc.switch('player_animation.idle');
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
                    next(this: Player) {
                        global.eventEmitter.emit('animationEnd', this, 'lowkick');
                        this.sc.switch('player_animation.idle');
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
                    next(this: Player) {
                        global.eventEmitter.emit('animationEnd', this, 'punch');
                        this.sc.switch('player_animation.idle');
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
                    next(this: Player) {
                        this.sc.switch('player_animation.duck');
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
                    next(this: Player) {
                        this.sc.switch('player_animation.jump');
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
                    next(this: Player) {
                        get_gamemodel().sc.to('gameover');
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
