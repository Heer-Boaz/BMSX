import { Direction, Identifier, SM, ScreenBoundaryComponent, StateMachineBlueprint, assign_fsm, attach_components, build_fsm, insavegame, sstate, subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from '../bmsx/bmsx';
import { AudioId, BitmapId } from './resourceids';
import { Fighter } from './fighter';
import { gamemodel } from './gamemodel';
import { Action } from './inputmapping';

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
    public onLeavingScreen(_event_name: string, emitter: Eila, d: Direction, _old_x_or_y: number) {
        if (d === 'left') {
            emitter.facing = 'right';
        }
        else emitter.facing = 'left';
    }
}

@insavegame
@assign_fsm('player_animation')
@attach_components(JumpingWhileLeavingScreenComponent)
export class Eila extends Fighter {

    @build_fsm()
    public static bouw_eila(): StateMachineBlueprint {
        return Eila.bouw('player_animation', 'Eila');
    }

    public static bouw(animation_machine_name: Identifier, class_name: string): StateMachineBlueprint {
        function default_input_processor(this: Fighter) {
            if (this.isAIed) return; // AIed fighters don't process input

            const priorityActions = $.input.getPlayerInput(this.playerIndex).getPressedActions({ pressed: true, consumed: false, actionsByPriority: ['duck', 'right', 'left', 'jump', 'punch', 'highkick', 'lowkick'] });

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
                            this.x += action === 'right' ? Fighter.SPEED : -Fighter.SPEED;
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
                        $.input.getPlayerInput(this.playerIndex).consumeAction(action);
                        this.sc.to(action);
                        break;
                    case 'jump':
                        $.input.getPlayerInput(this.playerIndex).consumeAction(action);
                        this.sc.to('jump', false); // Actions 'left' and 'right' have higher priority than 'jump' and thus directonal jumps are handled in the 'left' and 'right' cases
                        break;
                    // case 'stoer':
                    //     this.state.to('stoerheidsdans');
                    //     break;
                }
            }
        }

        function attackExit(this: Fighter) {
            this.attacking = false;
            this.previousAttackType = this.currentAttackType;
            this.currentAttackType = null;
        }

        const statemachine = animation_machine_name;
        return {
            on: {
                $go_idle: '<this>.idle',
                $go_walk: '<this>.walk',
                $go_punch: '<this>.punch',
                $go_highkick: '<this>.highkick',
                $go_lowkick: '<this>.lowkick',
                $go_duckkick: '<this>.duckkick',
                $go_duck: '<this>.duck',
                $go_jump: '<this>.jump',
            },
            states: {
                _idle: {
                    process_input: default_input_processor,
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.idle');
                        this.attacking = false;
                        this.attacked_while_jumping = false;
                    },
                },
                humiliated: {
                    enter(this: Fighter) {
                        this.hittable = false;
                        this.fighting = false;
                        this.resetVerticalPosition();
                        this.sc.to(statemachine + '.humiliated');
                    },
                    exit(this: Fighter) {
                        this.hittable = true;
                        this.fighting = true;
                    }
                },
                stoerheidsdans: {
                    auto_tick: false,
                    ticks2move: 1,
                    tape: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
                    repetitions: 2,
                    auto_rewind_tape_after_end: false,
                    enter(this: Fighter, state: sstate) {
                        this.fighting = false;
                        state.reset();
                        this.resetVerticalPosition();
                    },
                    run(this: Fighter, state: sstate) {
                        // Lelijk
                        if (this.sc.machines[statemachine].is(`idle`)) {
                            ++state.ticks;
                        }
                    },
                    next(this: Fighter, state: sstate, tape_rewound: boolean) {
                        if (tape_rewound) return;
                        this.sc.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    end(this: Fighter) {
                        this.sc.to('nagenieten');
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                },
                nagenieten: {
                    enter(this: Fighter) {
                        this.sc.to(`${statemachine}.idle`);
                        this.fighting = false;
                    },
                },
                au: {
                    enter(this: Fighter) {
                        this.sc.pause_statemachine(statemachine + '');
                    },
                    exit(this: Fighter) {
                        this.sc.resume_statemachine(statemachine + '');
                    }
                },
                doetau: {
                    enter(this: Fighter) {
                        this.sc.pause_statemachine(statemachine + '');
                    },
                    exit(this: Fighter) {
                        this.sc.resume_statemachine(statemachine + '');
                    }
                },
                walk: {
                    process_input: default_input_processor,
                    enter(this: Fighter) {
                        if (!this.sc.is(statemachine + '.walk')) {
                            this.sc.to(statemachine + '.walk');
                        }
                        this.attacking = false;
                    },
                },
                punch: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.punch');
                        this.doAttackFlow('punch', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                        this.currentAttackType = 'punch';
                    },
                    exit: attackExit,
                },
                highkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.highkick');
                        this.doAttackFlow('highkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                        this.currentAttackType = 'highkick';
                    },
                    exit: attackExit,
                },
                lowkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.lowkick');
                        this.doAttackFlow('lowkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                        this.currentAttackType = 'lowkick';
                    },
                    exit: attackExit,
                },
                duckkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.duckkick');
                        this.doAttackFlow('dickkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                        this.ducking = true;
                        this.currentAttackType = 'duckkick';
                    },
                    exit(this: Fighter) {
                        attackExit.apply(this);
                        this.ducking = false;
                    },
                },
                duck: {
                    process_input(this: Fighter) {
                        if (this.isAIed) return; // AIed fighters don't process input
                        const pressedActions = $.getPressedActions(this.playerIndex);
                        const actionMap = new Map();

                        // Create a map of actions for efficient lookup
                        pressedActions.forEach(action => actionMap.set(action.action, true));

                        if (actionMap.get('lowkick')) {
                            $.consumeAction(this.playerIndex, 'lowkick');
                            this.sc.dispatch('go_duckkick', this);
                            return;
                        }
                        // Search whether the `duck` action was NOT pressed
                        else if (!actionMap.get('duck')) {
                            this.sc.dispatch('go_idle', this);
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
                    },
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.duck');
                        this.ducking = true;
                    },
                    exit(this: Fighter) {
                        this.ducking = false;
                    },
                },
                jump: {
                    enter(this: Fighter, state: sstate, directional: boolean = false) {
                        state.reset(true);
                        this.sc.to(`${class_name}.jump.jump_up`, directional);
                        this.sc.to(statemachine + '.jump');
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                        this.jumping = true;
                        this.attacked_while_jumping = false;
                    },
                    exit(this: Fighter) {
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
                        this.jumping = false;
                    },
                    process_input(this: Fighter) {
                        if (this.isAIed) return; // AIed fighters don't process input
                        const kickActions = $.input.getPlayerInput(this.playerIndex).getPressedActions({ pressed: true, consumed: false, filter: ['lowkick', 'highkick'] });
                        if (kickActions.length > 0) {
                            // Consume all kick actions
                            kickActions.forEach(action => $.input.getPlayerInput(this.playerIndex).consumeAction(action));
                            this.sc.dispatch('go_flyingkick', this.id);
                        }

                    },
                    states: {
                        _jump_up: {
                            ticks2move: Fighter.JUMP_DURATION / 2,
                            enter(this: Fighter, state: sstate, directional: boolean = false) {
                                state.reset();
                                state.data.directional = directional;
                            },
                            run(this: Fighter, state: sstate) {
                                this.y -= Fighter.JUMP_SPEED;
                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Fighter.SPEED;
                                    } else {
                                        this.x += Fighter.SPEED;
                                    }
                                }
                            },
                            next(this: Fighter, state: sstate) {
                                this.sc.switch(`${class_name}.jump.jump_down`, state.data.directional);
                            },
                        },
                        jump_down: {
                            ticks2move: Fighter.JUMP_DURATION / 2,
                            enter(this: Fighter, state: sstate, directional: boolean = false) {
                                state.reset();
                                state.data.directional = directional;
                            },
                            run(this: Fighter, state: sstate) {
                                this.y += Fighter.JUMP_SPEED;

                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Fighter.SPEED;
                                    } else {
                                        this.x += Fighter.SPEED;
                                    }
                                }
                            },
                            next(this: Fighter) {
                                this.sc.to('idle');
                            },
                        },
                        flyingkick: {
                            parallel: true,
                            states: {
                                _normal: {
                                    on: {
                                        $go_flyingkick: {
                                            if(this: Fighter) { return !this.attacked_while_jumping; },
                                            to: 'flyingkick',
                                        },
                                    },
                                },
                                flyingkick: {
                                    on: {
                                        flyingkick_end: 'normal',
                                    },
                                    enter(this: Fighter, _state: sstate) {
                                        this.sc.machines[statemachine].to('flyingkick');
                                        this.doAttackFlow('flyingkick', $.modelAs<gamemodel>().theOtherFighter(this));
                                        this.attacking = true;
                                        this.attacked_while_jumping = true;
                                    },
                                    exit(this: Fighter) {
                                        this.sc.machines[statemachine].to('jump');
                                        attackExit.call(this);
                                    },
                                },
                            },
                        },
                    },
                },
            }
        }
    }

    @subscribesToSelfScopedEvent('animationEnd')
    public handleAnimationEndEvent(event_name: string, _emitter: Eila, animation_name: string): void {
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
                            this.sc.to('player_animation.idle');
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

    @build_fsm('player_animation')
    public static buildAnimationFsm(): StateMachineBlueprint {
        return {
            parallel: true,
            on: {
                $i_was_hit: {
                    do(state: sstate) {
                        state.current.setTicksNoSideEffect(state.current.definition.ticks2move - 1);
                    }
                }
            },
            states: {
                _idle: {
                    run: () => { },
                    enter(this: Eila) {
                        this.imgid = BitmapId.eila_idle;
                    },
                },
                walk: {
                    run(this: Eila) { },
                    enter(this: Eila, state: sstate) {
                        state.resetSubmachine();
                        this.imgid = BitmapId.eila_walk;
                    },
                    states: {
                        _walk1: {
                            ticks2move: 8,
                            enter(this: Eila, state: sstate) {
                                this.imgid = BitmapId.eila_walk;
                                state.reset();
                            },
                            next(this: Eila) {
                                this.sc.switch('player_animation.walk.walk2');
                            }
                        },
                        walk2: {
                            ticks2move: 8,
                            enter(this: Eila, state: sstate) {
                                this.imgid = BitmapId.eila_idle;
                                state.reset();
                            },
                            next(this: Eila) {
                                this.sc.switch('player_animation.walk.walk1');
                            }
                        },
                    }
                },
                highkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: sstate, hit: boolean) {
                        state.reset();
                        this.imgid = BitmapId.eila_highkick;
                        SM.play(AudioId.kick);
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Eila) {
                        $.event_emitter.emit('animationEnd', this, 'highkick');
                        this.sc.switch('player_animation.idle');
                    }
                },
                lowkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_lowkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Eila) {
                        $.event_emitter.emit('animationEnd', this, 'lowkick');
                        this.sc.switch('player_animation.idle');
                    }
                },
                punch: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.punch);
                        this.imgid = BitmapId.eila_punch;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Eila) {
                        $.event_emitter.emit('animationEnd', this, 'punch');
                        this.sc.switch('player_animation.idle');
                    }
                },
                duckkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: sstate) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_duckkick;
                    },
                    next(this: Eila) {
                        this.sc.switch('player_animation.duck');
                        $.event_emitter.emit('animationEnd', this, 'duckkick');
                    }
                },
                flyingkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: sstate, hit: boolean) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_flyingkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Eila) {
                        this.sc.switch('player_animation.jump');
                        $.event_emitter.emit('animationEnd', this, 'flyingkick');
                    }
                },
                duck: {
                    run: () => { },
                    enter(this: Eila) { this.imgid = BitmapId.eila_duck; },
                },
                jump: {
                    run: () => { },
                    enter(this: Eila) { this.imgid = BitmapId.eila_jump; },
                },
                humiliated: {
                    ticks2move: 300,
                    enter(this: Eila, state: sstate) {
                        state.reset();
                        SM.play(AudioId.stuk);
                        this.imgid = BitmapId.eila_humiliated;
                    },
                    next(this: Eila) {
                        $.event_emitter.emit('humiliated_animation_end', this, 'eila');
                    }
                },
            }
        };
    }

    constructor() {
        super('player', undefined, 'left', 1);
        this.hp = gamemodel.EILA_START_HP;
    }

    override paint(): void {
        super.paint();
    }
};
