import { $, Component, WorldObjectEventPayloads, Identifier, ScreenBoundaryComponent, State, StateMachineBlueprint, assign_fsm, attach_components, build_fsm, id2partial_sdef, insavegame, subscribesToParentScopedEvent, type StateTransition, type RevivableObjectArgs, type ComponentAttachOptions } from 'bmsx';
import { fsmHandler } from 'bmsx/fsm/fsmdecorators';
import { Fighter } from './fighter';
import { EILA_START_HP } from './gameconstants';
import { Action } from './inputmapping';
import { EilaEventService } from './worldmodule';

export type EilaAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick';

@insavegame
export class JumpingWhileLeavingScreenComponent extends Component {
	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.enabled = false; // Disabled by default
	}

	/**
	 * Event handler for the 'leavingScreen' event.
	 * @param emitter - The ID of the world object emitting the event.
	 * @param d - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object.
	 */
	@subscribesToParentScopedEvent('leavingScreen')
	public onLeavingScreen(_event_name: string, emitter: Eila, { d }: WorldObjectEventPayloads['leavingScreen']) {
		if (d === 'left') {
			emitter.facing = 'right';
		}
		else emitter.facing = 'left';
	}
}

@insavegame
@assign_fsm('player_animation')
@attach_components(ScreenBoundaryComponent, JumpingWhileLeavingScreenComponent)
export class Eila extends Fighter {
	public static readonly ANIMATION_FSM_ID = 'player_animation';

	@build_fsm()
	public static bouw_eila(): StateMachineBlueprint {
		return Eila.bouw('player_animation');
	}

	public static bouw(animation_machine_name: Identifier): StateMachineBlueprint {
		function default_input_processor(this: Fighter): StateTransition | string | void {
			if (this.isAIed) return; // AIed fighters don't process input

			// const priorityActions = $.getPressedActions(this.player_index, { pressed: true, consumed: false, actionsByPriority: ['duck', 'punch', 'highkick', 'lowkick', 'jump_right', 'jump_left', 'right', 'left', 'jump',] });

			const priorityActions = $.checkActionsTriggered(this.player_index,
				{ def: 'duck[p]', id: 'duck' },
				{ def: 'punch[wp{6}]', id: 'punch' },
				{ def: '?wp{6}(highkick)', id: 'highkick' },
				{ def: '?wp{6}(lowkick)', id: 'lowkick' },
				{ def: 'jump_right[j]', id: 'jump_right' },
				{ def: 'jump_left[j]', id: 'jump_left' },
				{ def: 'right[p]', id: 'right' },
				{ def: 'left[p]', id: 'left' },
				{ def: 'jump[j]', id: 'jump' },
			);

			// If no actions are pressed, switch to idle
			if (priorityActions.length === 0) {
				return '../idle';
			}

			for (const action of priorityActions) {
				switch (action as Action) {
					case 'right':
					case 'left':
						this.facing = action as typeof this.facing;

						this.x += action === 'right' ? Fighter.SPEED : -Fighter.SPEED;
						return '../walk';
					case 'jump_left':
						this.facing = 'left';
						$.consumeAction(this.player_index, 'jump')
						return { state_id: '../jump', args: true };
					case 'jump_right':
						this.facing = 'right';
						$.consumeAction(this.player_index, 'jump')
						return { state_id: '../jump', args: true };
					case 'duck':
						return `../${action}`; // Do not consume the duck action, as it would immediately make the fighter stand up again
					case 'punch':
					case 'highkick':
					case 'lowkick':
					case 'jump':
						$.input.getPlayerInput(this.player_index).consumeAction(action);
						return `../${action}`;
				}
			}
		}

		function attack(this: Fighter, attackType: string, ducking: boolean = false) {
			this.sc.dispatch_event(`animate_${attackType}`, this);
			this.doAttackFlow(attackType, $.get<EilaEventService>('eila_events').theOtherFighter(this));
			this.attacking = true;
			this.currentAttackType = attackType;
			if (ducking) {
				this.ducking = true;
			}
		}

		const attacks = {
			punch: {
				entering_state: function (this: Fighter) { attack.call(this, 'punch'); },
				exiting_state: attackExit,
			},
			highkick: {
				entering_state: function (this: Fighter) { attack.call(this, 'highkick'); },
				exiting_state: attackExit,
			},
			lowkick: {
				entering_state: function (this: Fighter) { attack.call(this, 'lowkick'); },
				exiting_state: attackExit,
			},
			duckkick: {
				entering_state: function (this: Fighter) {
					attack.call(this, 'duckkick', true);
				},
				exiting_state(this: Fighter) {
					attackExit.apply(this);
					this.ducking = false;
				},
			},
		} as id2partial_sdef;

		function duck_input_processor(this: Fighter): StateTransition | string | void {
			if (this.isAIed) return; // AIed fighters don't process input

			const priorityActions = $.checkActionsTriggered(this.player_index,
				{ def: 'duck[p]', id: 'duck' },
				{ def: 'lowkick[wp{6}]', id: 'lowkick' },
				{ def: 'left[p]', id: 'left' },
				{ def: 'right[p]', id: 'right' },
			);

			if (priorityActions.includes('lowkick')) {
				$.consumeAction(this.player_index, 'lowkick');
				this.sc.dispatch_event('go_duckkick', this);
				return;
			}
			else if (!priorityActions.includes('duck')) {
				this.sc.dispatch_event('go_idle', this);
				return;
			}
			else if (priorityActions.includes('left')) {
				this.facing = 'left';
				return;
			}
			else if (priorityActions.includes('right')) {
				this.facing = 'right';
				return;
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
				$go_idle: {
					if(this: Fighter, state: State) { return !state.matches_state_path('stoerheidsdans') && !state.matches_state_path('nagenieten') && !state.matches_state_path('humiliated'); },
					switch: 'idle',
				},
				$go_walk: 'walk',
				$go_punch: 'punch',
				$go_highkick: 'highkick',
				$go_lowkick: 'lowkick',
				$go_duckkick: 'duckkick',
				$go_duck: 'duck',
				$go_jump: 'jump',
				$go_stoerheidsdans: 'stoerheidsdans',
				$go_humiliated: 'humiliated',
			},
			states: {
				_idle: {
					process_input: default_input_processor,
					entering_state(this: Fighter) {
						this.sc.dispatch_event('animate_idle', this);
						this.attacking = false;
						this.attacked_while_jumping = false;
					},
				},
				humiliated: {
					entering_state(this: Fighter) {
						this.hittable = false;
						this.fighting = false;
						this.resetVerticalPosition();
						this.sc.dispatch_event('animate_humiliated', this);
					},
					exiting_state(this: Fighter) {
						this.hittable = true;
						this.fighting = true;
					},
				},
				stoerheidsdans: {
					enable_tape_autotick: false,
					ticks2advance_tape: 1,
					tape_data: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
					repetitions: 2,
					auto_rewind_tape_after_end: false,
					on: {
						$animationEnd: {
							do(state: State) {
								++state.ticks;
							},
						},
					},
					entering_state(this: Fighter, state: State) {
						this.fighting = false;
						// Used to reset the animation to idle when the fighter is about to start the 'stoerheidsdans' (e.g. when the fighter was just jumping and the animation needs to be reset to make sure the stoerheidsdans actually starts).
						this.sc.dispatch_event('animate_idle', this);
						this.resetVerticalPosition();
						++state.ticks; // Perform the first attack immediately so that the 'animationEnd' event is fired after the first attack to make sure the next attack is performed via the 'animationEnd' event handler.
					},
					tape_next(this: Fighter, state: State, tape_rewound: boolean) {
						if (tape_rewound) return;
						this.facing = (this.facing === 'left' ? 'right' : 'left');
						this.sc.dispatch_event(`animate_${state.current_tape_value}`, this);
					},
					tape_end(this: Fighter) {
						this.facing = (this.facing === 'left' ? 'right' : 'left');
						return '/nagenieten';
					},
				},
				nagenieten: {
					entering_state(this: Fighter) {
						this.sc.dispatch_event('animate_idle', this);
						this.fighting = false;
					},
				},
				au: {
					entering_state(this: Fighter) {
						this.sc.pause_statemachine(statemachine);
					},
					exiting_state(this: Fighter) {
						this.sc.resume_statemachine(statemachine);
					}
				},
				doetau: {
					entering_state(this: Fighter) {
						this.sc.pause_statemachine(statemachine);
					},
					exiting_state(this: Fighter) {
						this.sc.resume_statemachine(statemachine);
					}
				},
				walk: {
					process_input: default_input_processor,
					entering_state(this: Fighter) {
						if (!this.sc.matches_state_path(statemachine + '.walk')) {
							this.sc.dispatch_event('animate_walk', this);
						}
						this.attacking = false;
					},
				},
				...attacks,
				duck: {
					process_input: duck_input_processor,
					entering_state(this: Fighter) {
						this.sc.dispatch_event('animate_duck', this);
						this.ducking = true;
					},
					exiting_state(this: Fighter) {
						this.ducking = false;
					},
				},
				jump: {
					automatic_reset_mode: 'tree',
					entering_state(this: Fighter, _state: State, directional: boolean = false): StateTransition {
						this.sc.dispatch_event('animate_jump', this);
						this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = true;
						this.jumping = true;
						this.attacked_while_jumping = false;
						return { state_id: 'jump_up', args: directional };
					},
					exiting_state(this: Fighter) {
						this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = false;
						this.jumping = false;
					},
					process_input(this: Fighter) {
						if (this.isAIed) return; // AIed fighters don't process input
						const kickActions = $.getPressedActions(this.player_index, { pressed: true, consumed: false, filter: ['lowkick', 'highkick'] });
						if (kickActions.length > 0) {
							// Consume all kick actions
							kickActions.forEach(action => $.consumeAction(this.player_index, action));
							this.sc.dispatch_event('go_flyingkick', this.id);
						}
					},
					states: {
						_jump_up: {
							ticks2advance_tape: Fighter.JUMP_DURATION / 2,
							entering_state(this: Fighter, state: State, directional: boolean = false) {
								state.data.directional = directional;
							},
							tick(this: Fighter, state: State) {
								this.y -= Fighter.JUMP_SPEED;
								if (state.data.directional) {
									if (this.facing === 'left') {
										this.x -= Fighter.SPEED;
									} else {
										this.x += Fighter.SPEED;
									}
								}
							},
							tape_next(state: State) {
								return { state_id: '../jump_down', args: state.data.directional };
							},
						},
						jump_down: {
							ticks2advance_tape: Fighter.JUMP_DURATION / 2,
							entering_state(this: Fighter, state: State, directional: boolean = false) {
								state.data.directional = directional;
							},
							tick(this: Fighter, state: State) {
								this.y += Fighter.JUMP_SPEED;

								if (state.data.directional) {
									if (this.facing === 'left') {
										this.x -= Fighter.SPEED;
									} else {
										this.x += Fighter.SPEED;
									}
								}
							},
							tape_next(this: Fighter, _state: State) {
								return '/idle';
							},
						},
						flyingkick: {
							is_concurrent: true,
							states: {
								_normal: {
									on: {
										$go_flyingkick: {
											if(this: Fighter) { return !this.attacked_while_jumping; },
											to: '../flyingkick',
										},
									},
								},
								flyingkick: {
									on: {
										flyingkick_end: '../normal',
									},
									entering_state(this: Fighter, _state: State) {
										this.sc.dispatch_event('animate_flyingkick', this);
										this.doAttackFlow('flyingkick', $.get<EilaEventService>('eila_events').theOtherFighter(this));
										this.attacking = true;
										this.attacked_while_jumping = true;
									},
									exiting_state(this: Fighter) {
										this.sc.dispatch_event('animate_jump', this);
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

	constructor(opts?: RevivableObjectArgs & { id?: Identifier }) {
		super({ ...opts ?? {}, id: opts?.id ?? 'player' });
		this.hp = EILA_START_HP;
	}

	// No custom enumerateDrawOptions needed; base sprite handled by SpriteObject
};
