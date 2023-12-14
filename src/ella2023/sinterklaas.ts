import { build_bt, BehaviorTreeDefinition, BTStatus } from "../bmsx/behaviourtree";
import { assign_fsm, build_fsm, machine_states, sstate, statedef_builder } from "../bmsx/bfsm";
import { get_gamemodel } from "../bmsx/bmsx";
import { StateMachineVisualizer } from "../bmsx/bmsxdebugger";
import { ProhibitLeavingScreenComponent } from "../bmsx/collisioncomponents";
import { attach_components } from "../bmsx/component";
import { subscribesToSelfScopedEvent } from "../bmsx/eventemitter";
import { insavegame } from "../bmsx/gameserializer";
import { SpriteObject } from "../bmsx/sprite";
import { JumpingWhileLeavingScreenComponent } from "./eila";
import { gamemodel } from "./gamemodel";
import { BitmapId } from "./resourceids";

const get_model = get_gamemodel<gamemodel>;

@insavegame
@assign_fsm('sint_animation')
@attach_components(ProhibitLeavingScreenComponent, JumpingWhileLeavingScreenComponent, StateMachineVisualizer)
export class Sinterklaas extends SpriteObject {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;

    facing: 'left' | 'right';

    constructor() {
        super('sinterklaas');
        this.facing = 'right';
    }

    override paint(): void {
        this.flip_h = this.facing !== 'left';
        super.paint();
    }



    @statedef_builder
    public static bouw(): machine_states {
        function defaultrun(this: Sinterklaas, state: sstate) {
        }
        function jumprun(this: Sinterklaas, state: sstate) {
        }
        function duckrun(this: Sinterklaas, state: sstate) {
        }

        return {
            states: {
                _idle: {
                    run: defaultrun,
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.idle');
                    },
                },
                walk: {
                    run: defaultrun,
                    enter(this: Sinterklaas) {
                        if (!this.state.is('sint_animation.walk')) {
                            this.state.to('sint_animation.walk');
                        }
                    },
                },
                punch: {
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.punch');
                    },
                },
                highkick: {
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.highkick');
                    },
                },
                lowkick: {
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.lowkick');
                    },
                },
                duckkick: {
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.duckkick');
                    },
                },
                duck: {
                    run: duckrun,
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.duck');
                    },
                },
                jump: {
                    enter(this: Sinterklaas, state: sstate, directional: boolean = false) {
                        this.state.to('Sinterklaas.jump.jump_up', directional);
                        this.state.to('sint_animation.jump');
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                    },
                    exit(this: Sinterklaas) {
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
                    },
                    run: jumprun,
                    states: {
                        _jump_up: {
                            nudges2move: Sinterklaas.JUMP_DURATION / 2,
                            enter(this: Sinterklaas, state: sstate, directional: boolean = false) {
                                state.reset();
                                state.data.directional = directional;
                                state.to('normal');
                            },
                            run(this: Sinterklaas, state: sstate) {
                                this.y -= Sinterklaas.JUMP_SPEED;
                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Sinterklaas.SPEED;
                                    } else {
                                        this.x += Sinterklaas.SPEED;
                                    }
                                }
                            },
                            next(this: Sinterklaas, state: sstate) {
                                this.state.switch('Sinterklaas.jump.jump_down', state.data.directional, state.currentid);
                            },
                            states: {
                                _normal: {
                                    enter(this: Sinterklaas) {
                                        this.state.machines.sint_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Sinterklaas) {
                                        this.state.machines.sint_animation.to('flyingkick');
                                    }
                                },
                            }
                        },
                        jump_down: {
                            nudges2move: Sinterklaas.JUMP_DURATION / 2,
                            enter(this: Sinterklaas, state: sstate, directional: boolean = false, substate: 'normal' | 'flyingkick' = 'normal') {
                                state.reset();
                                state.data.directional = directional;
                                state.to(substate);
                            },
                            run(this: Sinterklaas, state: sstate) {
                                this.y += Sinterklaas.JUMP_SPEED;

                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Sinterklaas.SPEED;
                                    } else {
                                        this.x += Sinterklaas.SPEED;
                                    }
                                }
                            },
                            next(this: Sinterklaas, state: sstate) {
                                this.state.to('idle');
                            },
                            states: {
                                _normal: {
                                    enter(this: Sinterklaas) {
                                        this.state.machines.sint_animation.to('jump');
                                    }
                                },
                                flyingkick: {
                                    enter(this: Sinterklaas) {
                                        this.state.machines.sint_animation.to('flyingkick');
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
    public handleAnimationEndEvent(event_name: string, emitter: Sinterklaas, animation_name: string): void {
        switch (event_name) {
            case 'animationEnd':
                switch (animation_name) {
                    case 'highkick':
                    case 'punch':
                    case 'lowkick':
                        this.state.to('idle');
                        break;
                    case 'flyingkick':
                        this.state.switch('Sinterklaas.jump.jump_up.normal');
                        this.state.switch('Sinterklaas.jump.jump_down.normal');
                        break;
                    case 'duckkick':
                        this.state.to('duck');
                        break;
                }
                break;
        }
    }

    @build_fsm('sint_animation')
    public static buildAnimationFsm(): machine_states {
        return {
            parallel: true,
            states: {
                _idle: {
                    run: () => { },
                    enter(this: SpriteObject) {
                        this.imgid = BitmapId.sint_idle;
                    },
                },
                walk: {
                    run(this: SpriteObject, state: sstate) { },
                    enter(this: SpriteObject, state: sstate) {
                        state.state.reset();
                        this.imgid = BitmapId.sint_walk;
                    },
                    states: {
                        _walk1: {
                            nudges2move: 8,
                            enter(this: SpriteObject, state: sstate) {
                                this.imgid = BitmapId.sint_walk;
                                state.reset();
                            },
                            next(this: SpriteObject, state: sstate) {
                                this.state.switch('sint_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            nudges2move: 8,
                            enter(this: SpriteObject, state: sstate) {
                                this.imgid = BitmapId.sint_idle;
                                state.reset();
                            },
                            next(this: SpriteObject, state: sstate) {
                                this.state.switch('sint_animation.walk.walk1');
                            }
                        },
                    }
                },
                highkick: {
                    nudges2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_highkick;
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'highkick');
                        this.state.switch('sint_animation.idle');
                    }
                },
                lowkick: {
                    nudges2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_lowkick;
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'lowkick');
                        this.state.switch('sint_animation.idle');
                    }
                },
                punch: {
                    nudges2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_punch;
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'punch');
                        this.state.switch('sint_animation.idle');
                    }
                },
                duckkick: {
                    nudges2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_flyingkick;
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'duckkick');
                        this.state.switch('sint_animation.duck');
                    }
                },
                flyingkick: {
                    nudges2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_flyingkick;
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'flyingkick');
                        this.state.switch('sint_animation.jump');
                    }
                },
                duck: {
                    run: () => { },
                    enter(this: SpriteObject) { this.imgid = BitmapId.sint_duckorjump; },
                },
                jump: {
                    run: () => { },
                    enter(this: SpriteObject) { this.imgid = BitmapId.sint_duckorjump; },
                },
                humiliated: {
                    nudges2move: 50,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        this.imgid = BitmapId.sint_humiliated_1;
                    },
                    states: {
                        _wait: {
                            nudges2move: 50,
                            auto_nudge: true,
                            enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                            next(this: SpriteObject, state: sstate) {
                                this.state.to('sint_animation.humiliated.animation');
                            }
                        },
                        animation: {
                            nudges2move: 10,
                            tape: ['humiliated1', 'humiliated2'],
                            repetitions: 8,
                            auto_rewind_tape_after_end: true,
                            auto_nudge: true,
                            enter(this: SpriteObject, state: sstate) {
                                state.reset();
                            },
                            next(this: SpriteObject, state: sstate) {
                                this.state.to(`sint_animation.humiliated.animation.${state.current_tape_value}`);
                            },
                            end(this: SpriteObject, state: sstate) {
                                this.state.to('sint_animation.humiliated.waitEnd');
                            },
                            states: {
                                _humiliated1: {
                                    enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                                },
                                humiliated2: {
                                    enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_2; },
                                },
                            },
                        },
                        waitEnd: {
                            nudges2move: 50,
                            auto_nudge: true,
                            enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                            next(this: SpriteObject, state: sstate) {
                                this.state.to('sint_animation.idle'); // Placeholder
                            }
                        },
                    },
                    tape: ['wait', 'animation', 'waitEnd'],
                },
            }
        };

    }

    @build_bt('enemyBehaviorTree')
    public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
        function isPlayerInRange(this: Sinterklaas): boolean {
            // Logic to determine if the player is in range
            return false; // Placeholder logic
        }

        function isPlayerAttacking(this: Sinterklaas): boolean {
            // Logic to check if the player is attacking
            return false; // Placeholder logic
        }

        function performAttackMove1(this: Sinterklaas): BTStatus {
            // Logic for attack move 1
            return 'SUCCESS';
        }

        function performAttackMove2(this: Sinterklaas): BTStatus {
            // Logic for attack move 2
            return 'SUCCESS';
        }

        function performSpecialMove(this: Sinterklaas): BTStatus {
            // Logic for special move
            return 'SUCCESS';
        }

        function block(this: Sinterklaas): BTStatus {
            // Logic for block action
            return 'SUCCESS';
        }

        function dodge(this: Sinterklaas): BTStatus {
            // Logic for dodge action
            return 'SUCCESS';
        }

        function counter(this: Sinterklaas): BTStatus {
            // Logic for counter action
            return 'SUCCESS';
        }

        function idle(this: Sinterklaas): BTStatus {
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
