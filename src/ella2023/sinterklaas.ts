import { build_bt, BehaviorTreeDefinition, BTStatus } from "../bmsx/behaviourtree";
import { assign_fsm, build_fsm, machine_states, sstate, statedef_builder } from "../bmsx/bfsm";
import { get_gamemodel } from "../bmsx/bmsx";
import { attach_components } from "../bmsx/component";
import { subscribesToSelfScopedEvent } from "../bmsx/eventemitter";
import { insavegame } from "../bmsx/gameserializer";
import { SM } from "../bmsx/soundmaster";
import { SpriteObject } from "../bmsx/sprite";
import { JumpingWhileLeavingScreenComponent, Player } from "./eila";
import { Fighter } from "./fighter";
import { gamemodel } from "./gamemodel";
import { AudioId, BitmapId } from "./resourceids";

const get_model = get_gamemodel<gamemodel>;
export type SinterklaasAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick' | 'mijter_throw';

@insavegame
@assign_fsm('sint_animation')
@attach_components(JumpingWhileLeavingScreenComponent)
export class Sinterklaas extends Fighter {
    constructor() {
        super('sinterklaas', undefined, 'right', 2);
        this.hp = gamemodel.SINT_START_HP;
    }

    override paint(): void {
        super.paint();
    }

    @statedef_builder
    @statedef_builder
    public static bouw_sinterklaas(): machine_states {
        return Player.bouw('sint_animation', 'Sinterklaas');
    }

    @subscribesToSelfScopedEvent('animationEnd')
    public handleAnimationEndEvent(event_name: string, _emitter: Sinterklaas, animation_name: string): void {
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
                        this.sc.dispatch('flyingkick_end', this.id);
                        break;
                    case 'duckkick':
                        if (!this.sc.is('stoerheidsdans')) {
                            this.sc.to('duck');
                        }
                        else {
                            this.sc.to('sint_animation.idle');
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


    @build_fsm('sint_animation')
    public static buildAnimationFsm(): machine_states {
        const statemachine = 'sint_animation';
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
                    run(this: SpriteObject) { },
                    enter(this: SpriteObject, state: sstate) {
                        state.resetSubmachine();
                        this.imgid = BitmapId.sint_walk;
                    },
                    states: {
                        _walk1: {
                            ticks2move: 8,
                            enter(this: SpriteObject, state: sstate) {
                                this.imgid = BitmapId.sint_walk;
                                state.reset();
                            },
                            next(this: SpriteObject) {
                                this.sc.switch(`${statemachine}.walk.walk2`);
                            }
                        },
                        walk2: {
                            ticks2move: 8,
                            enter(this: SpriteObject, state: sstate) {
                                this.imgid = BitmapId.sint_idle;
                                state.reset();
                            },
                            next(this: SpriteObject) {
                                this.sc.switch(`${statemachine}.walk.walk1`);
                            }
                        },
                    }
                },
                highkick: {
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.sint_highkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject) {
                        game.event_emitter.emit('animationEnd', this, 'highkick');
                        this.sc.switch(`${statemachine}.idle`);
                    }
                },
                lowkick: {
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.sint_lowkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject) {
                        game.event_emitter.emit('animationEnd', this, 'lowkick');
                        this.sc.switch('sint_animation.idle');
                    }
                },
                punch: {
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.punch);
                        this.imgid = BitmapId.sint_punch;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject) {
                        game.event_emitter.emit('animationEnd', this, 'punch');
                        this.sc.switch('sint_animation.idle');
                    }
                },
                duckkick: {
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.sint_flyingkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject) {
                        this.sc.switch('sint_animation.duck');
                        game.event_emitter.emit('animationEnd', this, 'duckkick');
                    }
                },
                flyingkick: {
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.sint_flyingkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject) {
                        this.sc.switch('sint_animation.jump');
                        game.event_emitter.emit('animationEnd', this, 'flyingkick');
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
                    ticks2move: 50,
                    enter(this: SpriteObject, state: sstate) {
                        state.reset();
                        SM.play(AudioId.stuk);
                        this.imgid = BitmapId.sint_humiliated_1;
                    },
                    states: {
                        _wait: {
                            ticks2move: 50,
                            auto_tick: true,
                            enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                            next(this: SpriteObject, state: sstate) { state.transition('animation'); }
                        },
                        animation: {
                            ticks2move: 10,
                            tape: ['humiliated1', 'humiliated2'],
                            repetitions: 8,
                            auto_rewind_tape_after_end: true,
                            auto_tick: true,
                            enter(this: SpriteObject, state: sstate) {
                                state.reset();
                            },
                            next(this: SpriteObject, state: sstate) {
                                state.to(`${state.current_tape_value}`);
                            },
                            end(this: SpriteObject, state: sstate) {
                                state.transition('waitEnd');
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
                            ticks2move: 100,
                            auto_tick: true,
                            enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                            next(this: SpriteObject) {
                                game.event_emitter.emit('humiliated_animation_end', this, 'sinterklaas');
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
