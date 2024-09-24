import { Direction, Identifier, SM, ScreenBoundaryComponent, StateMachineBlueprint, assign_fsm, attach_components, build_fsm, insavegame, State, subscribesToParentScopedEvent, subscribesToSelfScopedEvent, type StateTransition } from '../bmsx/bmsx';
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
        return Eila.bouw('player_animation');
    }

    public static bouw(animation_machine_name: Identifier): StateMachineBlueprint {
        function default_input_processor(this: Fighter): StateTransition | string | void {
            if (this.isAIed) return; // AIed fighters don't process input

            const priorityActions = $.getPressedActions(this.player_index,{ pressed: true, consumed: false, actionsByPriority: ['duck', 'punch', 'highkick', 'lowkick', 'jump_right', 'jump_left', 'right', 'left', 'jump',] });

            // If no actions are pressed, switch to idle
            if (priorityActions.length === 0) {
                return 'idle';
            }

            for (const actionObject of priorityActions) {
                const { action } = actionObject;

                switch (action as Action) {
                    case 'right':
                    case 'left':
                        this.facing = action as typeof this.facing;

                        // Check for combined jump left/right action
                        // if (priorityActions.some(action => action.action === 'jump')) {
                        //     return { state_id: 'jump', args: true };
                        // }
                        // else {
                            this.x += action === 'right' ? Fighter.SPEED : -Fighter.SPEED;
                            return 'walk';
                        // }
                    case 'jump_left':
                        this.facing = 'left';
                        $.consumeAction(this.player_index, 'jump')
                        return { state_id: 'jump', args: true };
                    case 'jump_right':
                        this.facing = 'right';
                        $.consumeAction(this.player_index, 'jump')
                        return { state_id: 'jump', args: true };
                    case 'duck':
                        return action; // Do not consume the duck action, as it would immediately make the fighter stand up again
                    case 'punch':
                    case 'highkick':
                    case 'lowkick':
                    case 'jump':
                        $.input.getPlayerInput(this.player_index).consumeAction(action);
                        return action;
                }
            }
        }

        function attack(this: Fighter, attackType: string, ducking: boolean = false) {
            this.sc.do(`animate_${attackType}`, this);
            this.doAttackFlow(attackType, $.modelAs<gamemodel>().theOtherFighter(this));
            this.attacking = true;
            this.currentAttackType = attackType;
            if (ducking) {
                this.ducking = true;
            }
        }

        const attacks = {
            punch: {
                enter: function (this: Fighter) { attack.call(this, 'punch'); },
                exit: attackExit,
            },
            highkick: {
                enter: function (this: Fighter) { attack.call(this, 'highkick'); },
                exit: attackExit,
            },
            lowkick: {
                enter: function (this: Fighter) { attack.call(this, 'lowkick'); },
                exit: attackExit,
            },
            duckkick: {
                enter: function (this: Fighter) { attack.call(this, 'duckkick', true); },
                exit(this: Fighter) {
                    attackExit.apply(this);
                    this.ducking = false;
                },
            },
        };

        function attackExit(this: Fighter) {
            this.attacking = false;
            this.previousAttackType = this.currentAttackType;
            this.currentAttackType = null;
        }

        const statemachine = animation_machine_name;
        return {
            on: {
                $go_idle: {
                    if(this: Fighter, state: State) { return !state.is('stoerheidsdans') && !state.is('nagenieten') && !state.is('humiliated'); },
                    switch: '#this.idle',
                },
                $go_walk: '#this.walk',
                $go_punch: '#this.punch',
                $go_highkick: '#this.highkick',
                $go_lowkick: '#this.lowkick',
                $go_duckkick: '#this.duckkick',
                $go_duck: '#this.duck',
                $go_jump: '#this.jump',
                $go_stoerheidsdans: '#this.stoerheidsdans',
                $go_humiliated: '#this.humiliated',
            },
            states: {
                _idle: {
                    process_input: default_input_processor,
                    enter(this: Fighter) {
                        this.sc.do('animate_idle', this);
                        this.attacking = false;
                        this.attacked_while_jumping = false;
                    },
                },
                humiliated: {
                    enter(this: Fighter) {
                        this.hittable = false;
                        this.fighting = false;
                        this.resetVerticalPosition();
                        this.sc.do('animate_humiliated', this);
                    },
                    exit(this: Fighter) {
                        this.hittable = true;
                        this.fighting = true;
                    },
                },
                stoerheidsdans: {
                    auto_tick: false,
                    ticks2move: 1,
                    tape: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
                    repetitions: 2,
                    auto_rewind_tape_after_end: false,
                    on: {
                        $animationEnd: {
                            do(state: State) {
                                ++state.ticks;
                            },
                        },
                    },
                    enter(this: Fighter, state: State) {
                        this.fighting = false;
                        // Used to reset the animation to idle when the fighter is about to start the 'stoerheidsdans' (e.g. when the fighter was just jumping and the animation needs to be reset to make sure the stoerheidsdans actually starts).
                        this.sc.do('animate_idle', this);
                        this.resetVerticalPosition();
                        ++state.ticks; // Perform the first attack immediately so that the 'animationEnd' event is fired after the first attack to make sure the next attack is performed via the 'animationEnd' event handler.
                    },
                    next(this: Fighter, state: State, tape_rewound: boolean) {
                        if (tape_rewound) return;
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                        this.sc.do(`animate_${state.current_tape_value}`, this);
                    },
                    end(this: Fighter) {
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                        return 'nagenieten';
                    },
                },
                nagenieten: {
                    enter(this: Fighter) {
                        this.sc.do('animate_idle', this);
                        this.fighting = false;
                    },
                },
                au: {
                    enter(this: Fighter) {
                        this.sc.pause_statemachine(statemachine);
                    },
                    exit(this: Fighter) {
                        this.sc.resume_statemachine(statemachine);
                    }
                },
                doetau: {
                    enter(this: Fighter) {
                        this.sc.pause_statemachine(statemachine);
                    },
                    exit(this: Fighter) {
                        this.sc.resume_statemachine(statemachine);
                    }
                },
                walk: {
                    process_input: default_input_processor,
                    enter(this: Fighter) {
                        if (!this.sc.is(statemachine + '.walk')) {
                            this.sc.do('animate_walk', this);
                        }
                        this.attacking = false;
                    },
                },
                ...attacks,
                duck: {
                    process_input(this: Fighter) {
                        if (this.isAIed) return; // AIed fighters don't process input
                        const pressedActions = $.getPressedActions(this.player_index);
                        const actionMap = new Map();

                        // Create a map of actions for efficient lookup
                        pressedActions.forEach(action => actionMap.set(action.action, true));

                        if (actionMap.get('lowkick')) {
                            $.consumeAction(this.player_index, 'lowkick');
                            this.sc.do('go_duckkick', this);
                            return;
                        }
                        // Search whether the `duck` action was NOT pressed
                        else if (!actionMap.get('duck')) {
                            this.sc.do('go_idle', this);
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
                        this.sc.do('animate_duck', this);
                        this.ducking = true;
                    },
                    exit(this: Fighter) {
                        this.ducking = false;
                    },
                },
                jump: {
                    auto_reset: 'tree',
                    enter(this: Fighter, _state: State, directional: boolean = false): StateTransition {
                        this.sc.do('animate_jump', this);
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                        this.jumping = true;
                        this.attacked_while_jumping = false;
                        return { state_id: '#this.jump_up', args: directional };
                    },
                    exit(this: Fighter) {
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
                        this.jumping = false;
                    },
                    process_input(this: Fighter) {
                        if (this.isAIed) return; // AIed fighters don't process input
                        const kickActions = $.getPressedActions(this.player_index, { pressed: true, consumed: false, filter: ['lowkick', 'highkick'] });
                        if (kickActions.length > 0) {
                            // Consume all kick actions
                            kickActions.forEach(action => $.consumeAction(this.player_index, action));
                            this.sc.do('go_flyingkick', this.id);
                        }

                    },
                    states: {
                        _jump_up: {
                            ticks2move: Fighter.JUMP_DURATION / 2,
                            enter(this: Fighter, state: State, directional: boolean = false) {
                                state.data.directional = directional;
                            },
                            run(this: Fighter, state: State) {
                                this.y -= Fighter.JUMP_SPEED;
                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Fighter.SPEED;
                                    } else {
                                        this.x += Fighter.SPEED;
                                    }
                                }
                            },
                            next(state: State) {
                                return { state_id: 'jump_down', args: state.data.directional };
                            },
                        },
                        jump_down: {
                            ticks2move: Fighter.JUMP_DURATION / 2,
                            enter(this: Fighter, state: State, directional: boolean = false) {
                                state.data.directional = directional;
                            },
                            run(this: Fighter, state: State) {
                                this.y += Fighter.JUMP_SPEED;

                                if (state.data.directional) {
                                    if (this.facing === 'left') {
                                        this.x -= Fighter.SPEED;
                                    } else {
                                        this.x += Fighter.SPEED;
                                    }
                                }
                            },
                            next(this: Fighter, _state: State) {
                                return '#root.idle';
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
                                    enter(this: Fighter, _state: State) {
                                        this.sc.do('animate_flyingkick', this);
                                        this.doAttackFlow('flyingkick', $.modelAs<gamemodel>().theOtherFighter(this));
                                        this.attacking = true;
                                        this.attacked_while_jumping = true;
                                    },
                                    exit(this: Fighter) {
                                        this.sc.do('animate_jump', this);
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
                        this.sc.do('go_idle', this);
                        break;
                    case 'flyingkick':
                        this.sc.do('flyingkick_end', this.id);
                        break;
                    case 'duckkick':
                        if (!this.sc.is('stoerheidsdans')) {
                            this.sc.do('go_duck', this);
                        }
                        else {
                            this.sc.do('animate_idle', this);
                        }
                        break;
                }
                break;
        }
    }

    @build_fsm('player_animation')
    public static buildAnimationFsm(): StateMachineBlueprint {
        return {
            parallel: true,
            on: {
                $i_was_hit: {
                    do(state: State) {
                        // This is needed to quickly end the animation of the attack action.
                        // Must be done after the state machine is resumed, otherwise the event will not be handled.
                        // It will allow the player to recuperate first, before the next attack can be done by the opponent.
                        state.current.setTicksNoSideEffect(state.current.definition.ticks2move - 1);
                    }
                },
                $animate_idle: '#this.idle',
                $animate_humiliated: '#this.humiliated',
                $animate_walk: '#this.walk',
                $animate_punch: '#this.punch',
                $animate_highkick: '#this.highkick',
                $animate_flyingkick: '#this.flyingkick',
                $animate_lowkick: '#this.lowkick',
                $animate_duckkick: '#this.duckkick',
                $animate_duck: '#this.duck',
                $animate_jump: '#this.jump',
            },
            states: {
                _idle: {
                    enter(this: Eila) {
                        this.imgid = BitmapId.eila_idle;
                    },
                },
                walk: {
                    auto_reset: 'subtree', // Reset to the first state of the subtree when the state is entered and reset the states in the subtree
                    enter(this: Eila) {
                        this.imgid = BitmapId.eila_walk;
                    },
                    states: {
                        _walk1: {
                            ticks2move: 8,
                            enter(this: Eila) {
                                this.imgid = BitmapId.eila_walk;
                            },
                            next: () => 'walk2',
                        },
                        walk2: {
                            ticks2move: 8,
                            enter(this: Eila) {
                                this.imgid = BitmapId.eila_idle;
                            },
                            next: () => 'walk1',
                        },
                    }
                },
                highkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: State, hit: boolean) {
                        this.imgid = BitmapId.eila_highkick;
                        SM.play(AudioId.kick);
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Fighter, _state: State) {
                        $.emit('animationEnd', this, 'highkick');
                    },
                },
                lowkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: State, hit: boolean) {
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_lowkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Fighter, _state: State) {
                        $.emit('animationEnd', this, 'lowkick');
                    },
                },
                punch: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: State, hit: boolean) {
                        SM.play(AudioId.punch);
                        this.imgid = BitmapId.eila_punch;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Fighter, _state: State) {
                        $.emit('animationEnd', this, 'punch');
                    }
                },
                duckkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila) {
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_duckkick;
                    },
                    next(this: Fighter, _state: State) {
                        $.emit('animationEnd', this, 'duckkick');
                    }
                },
                flyingkick: {
                    ticks2move: Eila.ATTACK_DURATION,
                    enter(this: Eila, state: State, hit: boolean) {
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_flyingkick;
                        if (hit) state.setTicksNoSideEffect(state.definition.ticks2move - 1);
                    },
                    next(this: Fighter, _state: State) {
                        $.emit('animationEnd', this, 'flyingkick');
                    }
                },
                duck: {
                    enter(this: Eila) { this.imgid = BitmapId.eila_duck; },
                },
                jump: {
                    enter(this: Eila) { this.imgid = BitmapId.eila_jump; },
                },
                humiliated: {
                    ticks2move: 300,
                    enter(this: Eila) {
                        SM.play(AudioId.stuk);
                        this.imgid = BitmapId.eila_humiliated;
                    },
                    next(this: Eila) {
                        $.emit('humiliated_animation_end', this, 'eila');
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
