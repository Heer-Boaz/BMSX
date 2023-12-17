import { build_bt, BehaviorTreeDefinition, BTStatus } from "../bmsx/behaviourtree";
import { assign_fsm, build_fsm, machine_states, sstate, statedef_builder } from "../bmsx/bfsm";
import { get_gamemodel } from "../bmsx/bmsx";
import { StateMachineVisualizer } from "../bmsx/bmsxdebugger";
import { ProhibitLeavingScreenComponent } from "../bmsx/collisioncomponents";
import { attach_components } from "../bmsx/component";
import { subscribesToGlobalEvent, subscribesToSelfScopedEvent } from "../bmsx/eventemitter";
import { insavegame } from "../bmsx/gameserializer";
import { Input } from "../bmsx/input";
import { SM } from "../bmsx/soundmaster";
import { SpriteObject } from "../bmsx/sprite";
import { JumpingWhileLeavingScreenComponent, Player } from "./eila";
import { Fighter, HitMarkerInfo } from "./fighter";
import { gamemodel } from "./gamemodel";
import { Action } from "./inputmapping";
import { AudioId, BitmapId } from "./resourceids";

const get_model = get_gamemodel<gamemodel>;
export type SinterklaasAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick' | 'mijter_throw';

@insavegame
@assign_fsm('sint_animation')
@attach_components(JumpingWhileLeavingScreenComponent)
export class Sinterklaas extends Fighter {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;

    constructor() {
        super('sinterklaas', undefined, 'right');
        this.hp = gamemodel.SINT_START_HP;
    }

    override paint(): void {
        super.paint();
    }

    @statedef_builder
    public static bouw(): machine_states {
        function defaultrun(this: Sinterklaas, state: sstate) {
            // To check if an action is pressed for player 1
            const priorityActions = Input.getPlayerInput(2).getPressedPriorityActions( ['duck', 'right', 'left', 'jump', 'punch', 'highkick', 'lowkick', 'stoer']);

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
                            Input.getPlayerInput(2).consumeAction(action);
                            this.state.to(action);
                        }
                        break;
                    case 'jump':
                        this.state.to('jump', false); // Actions 'left' and 'right' have higher priority than 'jump' and thus directonal jumps are handled in the 'left' and 'right' cases
                        break;
                    case 'stoer':
                        this.state.to('stoerheidsdans');
                        break;
                }
            }
        }

        function duckrun(this: Player) {
            const pressedActions = Input.getPlayerInput(2).getPressedActions();

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
            const pressedActions = Input.getPlayerInput(2).getPressedActions();

            if (pressedActions.some(action => action.action === 'lowkick' || action.action === 'highkick')) {
                if (this.state.is('Sinterklaas.jump.jump_up.normal') || this.state.is('Sinterklaas.jump.jump_down.normal')) {
                    this.state.switch('Sinterklaas.jump.*.flyingkick');
                }
            }
        }

        const statemachine = 'sint_animation';
        return {
            states: {
                _idle: {
                    run: defaultrun,
                    enter(this: Sinterklaas) {
                        this.state.to('sint_animation.idle');
                    },
                },
                humiliated: {
                    enter(this: Sinterklaas) {
                        // this.hittable = false;
                        this.resetVerticalPosition();
                        this.state.to('sint_animation.humiliated');
                    },
                },
                stoerheidsdans: {
                    auto_tick: false,
                    ticks2move: 1,
                    repetitions: 2,
                    tape: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
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
                    enter(this: Sinterklaas) {
                        this.state.pause_statemachine('sint_animation');
                    },
                    exit(this: Sinterklaas) {
                        this.state.resume_statemachine('sint_animation');
                    }
                },
                doetau: {
                    enter(this: Sinterklaas) {
                        this.state.pause_statemachine('sint_animation');
                    },
                    exit(this: Sinterklaas) {
                        this.state.resume_statemachine('sint_animation');
                    }
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
                        const hit = this.doAttackFlow('punch', get_model().theOtherFighter(this));
                        this.state.to('sint_animation.punch', hit);
                    },
                },
                highkick: {
                    enter(this: Sinterklaas) {
                        const hit = this.doAttackFlow('highkick', get_model().theOtherFighter(this));
                        this.state.to('sint_animation.highkick', hit);
                    },
                },
                lowkick: {
                    enter(this: Sinterklaas) {
                        const hit = this.doAttackFlow('lowkick', get_model().theOtherFighter(this));
                        this.state.to('sint_animation.lowkick', hit);
                    },
                },
                duckkick: {
                    enter(this: Sinterklaas) {
                        const hit = this.doAttackFlow('dickkick', get_model().theOtherFighter(this));
                        this.state.to('sint_animation.duckkick', hit);
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
                        // this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                    },
                    exit(this: Sinterklaas) {
                        // this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
                    },
                    run: jumprun,
                    states: {
                        _jump_up: {
                            ticks2move: Sinterklaas.JUMP_DURATION / 2,
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
                                        this.doAttackFlow('flyingkick', get_model().theOtherFighter(this));
                                    }
                                },
                            }
                        },
                        jump_down: {
                            ticks2move: Sinterklaas.JUMP_DURATION / 2,
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
    public handleAnimationEndEvent(event_name: string, emitter: Sinterklaas, animation_name: string): void {
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
                        this.state.switch('Sinterklaas.jump.jump_up.normal');
                        this.state.switch('Sinterklaas.jump.jump_down.normal');
                        break;
                    case 'duckkick':
                        if (!this.state.is('stoerheidsdans')) {
                            this.state.to('duck');
                        }
                        else {
                            this.state.to('sint_animation.idle');
                        }
                        break;
                }
                break;
        }
    }

    override handleFighterStukEvent(this: Fighter, event_name: string, emitter: Fighter): void {
        this.state.to('sint_animation.humiliated');
        get_model().theOtherFighter(emitter).state.to('stoerheidsdans');
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
                            ticks2move: 8,
                            enter(this: SpriteObject, state: sstate) {
                                this.imgid = BitmapId.sint_walk;
                                state.reset();
                            },
                            next(this: SpriteObject, state: sstate) {
                                this.state.switch('sint_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            ticks2move: 8,
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
                    ticks2move: Sinterklaas.ATTACK_DURATION,
                    enter(this: SpriteObject, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.sint_highkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'highkick');
                        this.state.switch('sint_animation.idle');
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
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'lowkick');
                        this.state.switch('sint_animation.idle');
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
                    next(this: SpriteObject, state: sstate) {
                        global.eventEmitter.emit('animationEnd', this, 'punch');
                        this.state.switch('sint_animation.idle');
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
                    next(this: SpriteObject, state: sstate) {
                        this.state.switch('sint_animation.duck');
                        global.eventEmitter.emit('animationEnd', this, 'duckkick');
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
                    next(this: SpriteObject, state: sstate) {
                        this.state.switch('sint_animation.jump');
                        global.eventEmitter.emit('animationEnd', this, 'flyingkick');
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
                            next(this: SpriteObject, state: sstate) {
                                this.state.to('sint_animation.humiliated.animation');
                            }
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
                            ticks2move: 100,
                            auto_tick: true,
                            enter(this: SpriteObject) { this.imgid = BitmapId.sint_humiliated_1; },
                            next(this: SpriteObject, state: sstate) {
                                get_gamemodel().state.to('hoera');
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
