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

    @build_fsm()
    public static bouw_eila(): StateMachineBlueprint {
        return Player.bouw('player_animation', 'Player');
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

        const statemachine = animation_machine_name;
        return {
            states: {
                _idle: {
                    on: {
                        $go_idle: 'idle',
                        $go_walk: {
                            do(this: Fighter) {
                                this.sc.to('walk');
                            },
                        },
                        $go_punch: 'punch',
                        $go_highkick: 'highkick',
                        $go_lowkick: 'lowkick',
                        $go_duckkick: 'duckkick',
                        $go_duck: 'duck',
                        $go_jump: 'jump',
                    },
                    process_input: default_input_processor,
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.idle');
                        this.attacking = false;
                    },
                },
                humiliated: {
                    enter(this: Fighter) {
                        this.hittable = false;
                        this.resetVerticalPosition();
                        this.sc.to(statemachine + '.humiliated');
                    },
                    exit(this: Fighter) {
                        this.hittable = true;
                    }
                },
                stoerheidsdans: {
                    auto_tick: false,
                    ticks2move: 1,
                    tape: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
                    repetitions: 2,
                    enter(this: Fighter, state: sstate) {
                        state.reset();
                        this.resetVerticalPosition();
                        this.sc.to(`${statemachine}.${state.current_tape_value}`);
                        this.facing = (this.facing === 'left' ? 'right' : 'left');
                    },
                    run(this: Fighter, state: sstate) {
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
                    enter(this: Fighter) {
                        this.sc.to(`${statemachine}.idle`);
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
                    },
                },
                highkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.highkick');
                        this.doAttackFlow('highkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                    },
                    exit(this: Fighter) {
                        this.attacking = false;
                    }
                },
                lowkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.lowkick');
                        this.doAttackFlow('lowkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                    },
                    exit(this: Fighter) {
                        this.attacking = false;
                    }
                },
                duckkick: {
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.duckkick');
                        this.doAttackFlow('dickkick', $.modelAs<gamemodel>().theOtherFighter(this));
                        this.attacking = true;
                    },
                    exit(this: Fighter) {
                        this.attacking = false;
                    }
                },
                duck: {
                    process_input(this: Fighter) {
                        if (this.isAIed) return; // AIed fighters don't process input
                        const pressedActions = $.input.getPlayerInput(this.playerIndex).getPressedActions();
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
                    },
                    enter(this: Fighter) {
                        this.sc.to(statemachine + '.duck');
                    },
                },
                jump: {
                    enter(this: Fighter, state: sstate, directional: boolean = false) {
                        state.reset(true);
                        this.sc.to(`${class_name}.jump.jump_up`, directional);
                        this.sc.to(statemachine + '.jump');
                        this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
                        this.jumping = true;
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
                            this.sc.dispatch('flyingkick', this.id);
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
                                        $go_flyingkick: 'flyingkick',
                                        $flyingkick: 'flyingkick',
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
                                    },
                                    exit(this: Fighter) {
                                        this.sc.machines[statemachine].to('jump');
                                        this.attacking = false;
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
                i_hit_face: {
                    do(state: sstate) {
                        state.current.setTicksNoSideEffect(state.current.definition.ticks2move - 1);
                    }
                }
            },
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
                        $.event_emitter.emit('animationEnd', this, 'highkick');
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
                        $.event_emitter.emit('animationEnd', this, 'lowkick');
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
                        $.event_emitter.emit('animationEnd', this, 'punch');
                        this.sc.switch('player_animation.idle');
                    }
                },
                duckkick: {
                    ticks2move: Player.ATTACK_DURATION,
                    enter(this: Player, state: sstate) {
                        state.reset();
                        SM.play(AudioId.kick);
                        this.imgid = BitmapId.eila_duckkick;
                    },
                    next(this: Player) {
                        this.sc.switch('player_animation.duck');
                        $.event_emitter.emit('animationEnd', this, 'duckkick');
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
                        $.event_emitter.emit('animationEnd', this, 'flyingkick');
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
