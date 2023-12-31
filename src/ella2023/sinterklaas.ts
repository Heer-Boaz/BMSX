import { BTStatus, BTVisualizer, BehaviorTreeDefinition, Blackboard, SM, SpriteObject, StateMachineBlueprint, WaitForActionCompletionDecorator, assign_bt, assign_fsm, attach_components, build_bt, build_fsm, insavegame, sstate, subscribesToSelfScopedEvent } from '../bmsx/bmsx';
import { JumpingWhileLeavingScreenComponent, Eila } from "./eila";
import { Fighter } from "./fighter";
import { gamemodel } from "./gamemodel";
import { AudioId, BitmapId } from "./resourceids";

export type SinterklaasAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick' | 'mijter_throw';

@insavegame
@assign_fsm('sint_animation')
@assign_bt('sinterklaasBT')
@attach_components(JumpingWhileLeavingScreenComponent, BTVisualizer)
export class Sinterklaas extends Fighter {
    constructor() {
        super('sinterklaas', undefined, 'right', 2);
        this.hp = gamemodel.SINT_START_HP;
        this._aied = true;
    }

    override paint(): void {
        super.paint();
    }

    @build_fsm()
    public static bouw_sinterklaas(): StateMachineBlueprint {
        return Eila.bouw('sint_animation', 'Sinterklaas');
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
        $.modelAs<gamemodel>().theOtherFighter(emitter).sc.to('stoerheidsdans');
    }

    @build_fsm('sint_animation')
    public static buildAnimationFsm(): StateMachineBlueprint {
        const statemachine = 'sint_animation';
        return {
            parallel: true,
            on: {
                i_hit_face: {
                    do(state: sstate) {
                        state.current.setTicksNoSideEffect(state.current.definition.ticks2move - 1);
                    }
                }
            },
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
                        $.event_emitter.emit('animationEnd', this, 'highkick');
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
                        $.event_emitter.emit('animationEnd', this, 'lowkick');
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
                        $.event_emitter.emit('animationEnd', this, 'punch');
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
                        $.event_emitter.emit('animationEnd', this, 'duckkick');
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
                        $.event_emitter.emit('animationEnd', this, 'flyingkick');
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
                                $.event_emitter.emit('humiliated_animation_end', this, 'sinterklaas');
                            }
                        },
                    },
                    tape: ['wait', 'animation', 'waitEnd'],
                },
            }
        };

    }

    @build_bt('sinterklaasBT')
    public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
        function getOpponentRange(this: Fighter): [number, number] {
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);

            if (theOther) {
                const dx = Math.abs(theOther.center_x - this.center_x);
                const dy = Math.abs(theOther.center_y - this.center_y);

                // Check if the player is within range
                return [dx, dy];
            }
            return [Number.MAX_VALUE, Number.MAX_VALUE];
        }

        // @ts-ignore
        function isPlayerInPunchRange(this: Fighter): boolean {
            const [dx] = getOpponentRange.apply(this);
            const RANGE = (this.sx / 5) * 3; // Define the range

            if (dx <= RANGE) {
                return true;
            }

            return false;
        }

        // @ts-ignore
        function isPlayerInKickRange(this: Fighter): boolean {
            const [dx] = getOpponentRange.apply(this);
            const RANGE = (this.sx / 4) * 3; // Define the range

            if (dx <= RANGE) {
                return true;
            }

            return false;
        }

        function isPlayerFarAway(this: Fighter): boolean {
            const [dx] = getOpponentRange.apply(this);
            const RANGE = this.sx * 2.5; // Define the range

            if (dx >= RANGE) {
                return true;
            }

            return false;
        }

        function isPlayerDucking(this: Fighter): boolean {
            // Logic to check if the player is ducking
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);
            if (theOther) {
                return theOther.isDucking;
            }
            return false; // Placeholder logic
        }

        // @ts-ignore
        function isOrWasPlayerHighKicking(this: Fighter): boolean {
            // Logic to check if the player is ducking
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);
            if (theOther) {
                return theOther.currentAttackType === 'highkick' || theOther.previousAttackType === 'highkick';
            }
            return false; // Placeholder logic
        }

        // @ts-ignore
        function isOrWasPlayerLowOrDuckKicking(this: Fighter): boolean {
            // Logic to check if the player is ducking
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);
            if (theOther) {
                return theOther.currentAttackType === 'lowkick' || theOther.previousAttackType === 'lowkick' || theOther.currentAttackType === 'duckkick' || theOther.previousAttackType === 'duckkick';
            }
            return false; // Placeholder logic
        }

        // @ts-ignore
        function isPlayerAttacking(this: Fighter): boolean {
            // Logic to check if the player is attacking
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);
            if (theOther) {
                return theOther.isAttacking;
            }
            return false; // Placeholder logic
        }

        function punch(this: Fighter): BTStatus {
            if (isAttacking.apply(this)) return 'RUNNING';
            // if (isBusy.apply(this)) return 'FAILED';
            this.sc.dispatch('go_punch', this);
            return 'SUCCESS';
        }

        function highkick(this: Fighter): BTStatus {
            if (isAttacking.apply(this)) return 'RUNNING';
            // if (isBusy.apply(this)) return 'FAILED';
            this.sc.dispatch('go_highkick', this);
            return 'SUCCESS';
        }

        function duckkick(this: Fighter): BTStatus {
            if (isAttacking.apply(this)) return 'RUNNING';
            // if (isBusy.apply(this)) return 'FAILED';
            this.sc.dispatch('go_duckkick', this);
            return 'SUCCESS';
        }

        // @ts-ignore
        function duck(this: Fighter): BTStatus {
            this.sc.dispatch('go_duck', this);
            return 'SUCCESS';
        }

        function jump(this: Fighter): BTStatus {
            if (this.isJumping) return 'RUNNING';
            this.sc.dispatch('go_jump', this, this.facing);
            return 'SUCCESS';
        }

        function straightJump(this: Fighter): BTStatus {
            if (this.isJumping) return 'RUNNING';
            this.sc.dispatch('go_jump', this, undefined);
            return 'SUCCESS';
        }

        function jumpkick(this: Fighter): BTStatus {
            if (isAttacking.apply(this)) return 'RUNNING';
            this.sc.dispatch('go_flyingkick', this, this.facing);
            return 'SUCCESS';
        }

        // @ts-ignore
        function idle(this: Fighter): BTStatus {
            // Logic for idle behavior
            this.sc.dispatch('go_idle', this);
            return 'SUCCESS';
        }

        // @ts-ignore
        function walk(this: Fighter, blackboard: Blackboard): BTStatus {
            // Logic for walk behavior
            this.sc.dispatch('go_walk', this, this.facing);
            this.x += this.facing === 'left' ? -Fighter.SPEED : Fighter.SPEED;
            blackboard.set('walking', true);
            return 'SUCCESS';
        }

        function isAttacking(this: Fighter): boolean {
            return this.isAttacking;
        }

        function isJumping(this: Fighter): boolean {
            return this.isJumping;
        }

        function isDucking(this: Fighter): boolean {
            return this.isDucking;
        }

        function faceYourFoe(this: Fighter, _blackboard: Blackboard): BTStatus {
            const theOther = $.modelAs<gamemodel>().theOtherFighter(this);
            let targetFacing: 'left' | 'right';
            if (theOther) {
                if (theOther.center_x > this.center_x) {
                    targetFacing = 'right';
                } else {
                    targetFacing = 'left';
                }
            }
            else return 'FAILED';

            if (this.facing === targetFacing) return 'SUCCESS';

            if (isJumping.apply(this)) return 'FAILED';

            this.facing = targetFacing;
            return 'SUCCESS';
        }

        function isFighting(this: Fighter): boolean {
            return this.isFighting;
        }

        function isNotBusy(this: Fighter, blackboard: Blackboard): boolean {
            return !(isAttacking.apply(this) || blackboard.actionInProgress);
        }

        function isWalking(this: Fighter, blackboard: Blackboard): boolean {
            return blackboard.get('walking');
        }

        return {
            type: 'Sequence', children: [
                { type: 'Condition', condition: isFighting },
                {
                    type: 'Selector',
                    children: [
                        {
                            type: 'Sequence',
                            children: [
                                { type: 'Condition', condition: isDucking },
                                { type: 'Wait', wait_propname: 'ducking', wait_time: 30 },
                                { type: 'Action', action: idle },
                            ],
                        },
                        {
                            type: 'Sequence',
                            children: [
                                { type: 'Condition', condition: isWalking },
                                { type: 'Action', action: walk },
                                { type: 'Wait', wait_propname: 'walking', wait_time: 8 },
                                { type: 'Action', action: (blackboard: Blackboard) => { blackboard.set('walking', false); return 'SUCCESS'; } },
                            ],
                        },
                        {
                            type: 'Sequence',
                            children: [
                                { type: 'Condition', condition: isNotBusy },
                                { type: 'Condition', condition: isAttacking, modifier: 'NOT' },
                                {
                                    type: 'Selector',
                                    children: [
                                        {
                                            type: 'Sequence', children: [
                                                { type: 'Condition', condition: isJumping },
                                                { type: 'Condition', condition: isPlayerInKickRange },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: jumpkick } },
                                            ]
                                        },
                                        {
                                            type: 'Sequence', children: [
                                                { type: 'Condition', condition: isJumping, modifier: 'NOT' },
                                                { type: 'Action', action: faceYourFoe },
                                                {
                                                    type: 'RandomSelector',
                                                    currentchild_propname: 'currentAttackMove',
                                                    children: [
                                                        {
                                                            type: 'Sequence',
                                                            children: [
                                                                { type: 'Condition', condition: isPlayerInPunchRange },
                                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: punch } },
                                                            ],
                                                        },
                                                        {
                                                            type: 'Sequence',
                                                            children: [
                                                                { type: 'Condition', condition: isPlayerInKickRange },
                                                                {
                                                                    type: 'Selector', children: [
                                                                        {
                                                                            type: 'Sequence', children: [
                                                                                { type: 'Condition', condition: isPlayerDucking },
                                                                                { type: 'Action', action: duckkick },
                                                                            ]
                                                                        },
                                                                        { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: highkick } },
                                                                    ]
                                                                },
                                                            ],
                                                        },
                                                        {
                                                            type: 'Action', action: () => { return 'FAILED'; } // Don't do anything and go for defensive move instead
                                                        },
                                                    ],
                                                },
                                            ]
                                        }
                                    ]
                                },
                            ]
                        },
                        {
                            type: 'Sequence',
                            children: [
                                { type: 'Condition', condition: isAttacking, modifier: 'NOT' },
                                { type: 'Condition', condition: isJumping, modifier: 'NOT' },
                                {
                                    type: 'RandomSelector',
                                    currentchild_propname: 'currentDefenseMove',
                                    children: [
                                        {
                                            type: 'Sequence',
                                            children: [
                                                { type: 'Condition', condition: isOrWasPlayerHighKicking },
                                                { type: 'Condition', condition: isPlayerInKickRange },
                                                { type: 'Action', action: duck },
                                            ]
                                        },
                                        {
                                            type: 'Sequence',
                                            children: [
                                                { type: 'Condition', condition: isNotBusy },
                                                { type: 'Condition', condition: isPlayerFarAway },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: jump } },
                                            ]
                                        },
                                        {
                                            type: 'Sequence',
                                            children: [
                                                { type: 'Condition', condition: isNotBusy },
                                                { type: 'Condition', condition: isPlayerInKickRange },
                                                { type: 'Condition', condition: isOrWasPlayerLowOrDuckKicking },
                                                { type: 'Action', action: straightJump },
                                            ]
                                        },
                                        {
                                            type: 'Sequence',
                                            children: [
                                                { type: 'Condition', condition: isNotBusy },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: walk } },
                                            ]
                                        },
                                        {
                                            type: 'Sequence',
                                            children: [
                                                { type: 'Condition', condition: isNotBusy },
                                                { type: 'Condition', condition: isJumping, modifier: 'NOT' },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
                                                { type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: idle } },
                                            ]
                                        },
                                    ]
                                },
                            ]
                        }
                    ]
                }
            ]
        };
    }
}
