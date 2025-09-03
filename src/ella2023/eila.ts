import { $, Component, GameObjectEventPayloads, Identifier, RandomModulationParams, ScreenBoundaryComponent, State, StateMachineBlueprint, assign_fsm, attach_components, build_fsm, id2partial_sdef, insavegame, subscribesToParentScopedEvent, subscribesToSelfScopedEvent, type StateTransition } from '../bmsx';
import { Fighter } from './fighter';
import { Action } from './inputmapping';
import { EilaEventService, ExtendedModel } from './modelplugin';
import { AudioId, BitmapId } from './resourceids';

export type EilaAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick';

@insavegame
export class JumpingWhileLeavingScreenComponent extends Component {
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
	public onLeavingScreen(_event_name: string, emitter: Eila, { d, old_x_or_y }: GameObjectEventPayloads['leavingScreen']) {
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
				return 'idle';
			}

			for (const action of priorityActions) {
				switch (action as Action) {
					case 'right':
					case 'left':
						this.facing = action as typeof this.facing;

						this.x += action === 'right' ? Fighter.SPEED : -Fighter.SPEED;
						return 'walk';
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
			event_handlers: {
				$go_idle: {
					if(this: Fighter, state: State) { return !state.matches_state_path('stoerheidsdans') && !state.matches_state_path('nagenieten') && !state.matches_state_path('humiliated'); },
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
			substates: {
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
					event_handlers: {
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
						return 'nagenieten';
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
						this.getComponent(JumpingWhileLeavingScreenComponent).enabled = true;
						this.jumping = true;
						this.attacked_while_jumping = false;
						return { state_id: '#this.jump_up', args: directional };
					},
					exiting_state(this: Fighter) {
						this.getComponent(JumpingWhileLeavingScreenComponent).enabled = false;
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
					substates: {
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
								return { state_id: 'jump_down', args: state.data.directional };
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
								return '#root.idle';
							},
						},
						flyingkick: {
							is_concurrent: true,
							substates: {
								_normal: {
									event_handlers: {
										$go_flyingkick: {
											if(this: Fighter) { return !this.attacked_while_jumping; },
											to: 'flyingkick',
										},
									},
								},
								flyingkick: {
									event_handlers: {
										flyingkick_end: 'normal',
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

	@subscribesToSelfScopedEvent('animationEnd')
	public handleAnimationEndEvent(event_name: string, _emitter: Eila, { animation_name }: { animation_name: string }): void {
		switch (event_name) {
			case 'animationEnd':
				switch (animation_name) {
					case 'highkick':
					case 'punch':
					case 'lowkick':
						this.sc.dispatch_event('go_idle', this);
						break;
					case 'flyingkick':
						this.sc.dispatch_event('flyingkick_end', this.id);
						break;
					case 'duckkick':
						if (!this.sc.matches_state_path('stoerheidsdans')) {
							this.sc.dispatch_event('go_duck', this);
						}
						break;
				}
				break;
		}
	}

	@build_fsm('player_animation')
	public static buildAnimationFsm(): StateMachineBlueprint {
		return {
			is_concurrent: true,
			event_handlers: {
				$i_was_hit: {
					do(state: State) {
						// This is needed to quickly end the animation of the attack action.
						// Must be done after the state machine is resumed, otherwise the event will not be handled.
						// It will allow the player to recuperate first, before the next attack can be done by the opponent.
						state.current.setTicksNoSideEffect(state.current.definition.ticks2advance_tape - 1);
					}
				},
				$i_hit_face: {
					do(state: State) {
						state.current.setTicksNoSideEffect(state.current.definition.ticks2advance_tape - 1);
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
			substates: {
				_idle: {
					entering_state(this: Eila) {
						this.imgid = BitmapId.eila_idle;
					},
				},
				walk: {
					automatic_reset_mode: 'subtree', // Reset to the first state of the subtree when the state is entered and reset the states in the subtree
					entering_state(this: Eila) {
						this.imgid = BitmapId.eila_walk;
					},
					substates: {
						_walk1: {
							ticks2advance_tape: 8,
							entering_state(this: Eila) {
								this.imgid = BitmapId.eila_walk;
							},
							tape_next: () => 'walk2',
						},
						walk2: {
							ticks2advance_tape: 8,
							entering_state(this: Eila) {
								this.imgid = BitmapId.eila_idle;
							},
							tape_next: () => 'walk1',
						},
					}
				},
				highkick: {
					ticks2advance_tape: Eila.ATTACK_DURATION,
					entering_state(this: Eila, state: State, hit: boolean) {
						this.imgid = BitmapId.eila_highkick;
						$.emit('combat.attack', this, { weaponClass: 'heavy', actorId: this.id });
						if (hit) state.setTicksNoSideEffect(state.definition.ticks2advance_tape - 1);
					},
					tape_next(this: Fighter, _state: State) {
						$.emit('animationEnd', this, { animation_name: 'highkick' });
					},
				},
				lowkick: {
					ticks2advance_tape: Eila.ATTACK_DURATION,
					entering_state(this: Eila, state: State, hit: boolean) {
						$.emit('combat.attack', this, { weaponClass: 'heavy', actorId: this.id });
						this.imgid = BitmapId.eila_lowkick;
						if (hit) state.setTicksNoSideEffect(state.definition.ticks2advance_tape - 1);
					},
					tape_next(this: Fighter, _state: State) {
						$.emit('animationEnd', this, { animation_name: 'lowkick' });
					},
				},
				punch: {
					ticks2advance_tape: Eila.ATTACK_DURATION,
					entering_state(this: Eila, state: State, hit: boolean) {
						$.emit('combat.attack', this, { weaponClass: 'light', actorId: this.id });
						this.imgid = BitmapId.eila_punch;
						if (hit) state.setTicksNoSideEffect(state.definition.ticks2advance_tape - 1);
					},
					tape_next(this: Fighter, _state: State) {
						$.emit('animationEnd', this, { animation_name: 'punch' });
					}
				},
				duckkick: {
					ticks2advance_tape: Eila.ATTACK_DURATION,
					entering_state(this: Eila) {
						$.emit('combat.attack', this, { weaponClass: 'heavy', actorId: this.id });
						this.imgid = BitmapId.eila_duckkick;
					},
					tape_next(this: Fighter, _state: State) {
						$.emit('animationEnd', this, { animation_name: 'duckkick' });
					}
				},
				flyingkick: {
					ticks2advance_tape: Eila.ATTACK_DURATION,
					entering_state(this: Eila, state: State, hit: boolean) {
						$.emit('combat.attack', this, { weaponClass: 'heavy', actorId: this.id });
						this.imgid = BitmapId.eila_flyingkick;
						if (hit) state.setTicksNoSideEffect(state.definition.ticks2advance_tape - 1);
					},
					tape_next(this: Fighter, _state: State) {
						$.emit('animationEnd', this, { animation_name: 'flyingkick' });
					}
				},
				duck: {
					entering_state(this: Eila) { this.imgid = BitmapId.eila_duck; },
				},
				jump: {
					entering_state(this: Eila) { this.imgid = BitmapId.eila_jump; },
				},
				humiliated: {
					ticks2advance_tape: 300,
					entering_state(this: Eila) {
						$.playAudio(AudioId.stuk, $.rom.data['modulationparams'].attacksfx as RandomModulationParams);
						this.imgid = BitmapId.eila_humiliated;
					},
					tape_next(this: Eila) {
						$.emit('humiliated_animation_end', this, { character: 'eila' });
					}
				},
			}
		};
	}

	constructor() {
		super('player', undefined, 'left', 1);
		this.hp = $.modelAs<ExtendedModel>().constants.EILA_START_HP;
	}

	override paint(): void {
		super.paint();
	}
};
