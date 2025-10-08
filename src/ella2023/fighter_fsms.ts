import { $, build_fsm, State, type StateMachineBlueprint, type EventPayload } from 'bmsx';
import type { Direction } from 'bmsx';
import type { StateTransition } from 'bmsx/fsm/fsmtypes';
import type { Fighter, AttackType } from './fighter';

class FighterFSMs {
	@build_fsm('fighter_control')
	public static buildFighterControl(): StateMachineBlueprint {
		return fighterControlBlueprint;
	}

	@build_fsm('player_animation')
	public static buildPlayerAnimation(): StateMachineBlueprint {
		return playerAnimationBlueprint;
	}
}

type AttackEventPayload = EventPayload & { attackType?: AttackType };
type AnimationEventPayload = EventPayload & { animation_name?: string };
type JumpEventPayload = EventPayload & { direction?: Direction | null; directional?: boolean | string };

const CONTROL_MACHINE_ID = 'fighter_control';
const STOER_STATE_PATH = `${CONTROL_MACHINE_ID}:/stoerheidsdans`;
const NAGENIETEN_STATE_PATH = `${CONTROL_MACHINE_ID}:/nagenieten`;
const HUMILIATED_STATE_PATH = `${CONTROL_MACHINE_ID}:/humiliated`;
const FLYING_KICK_STATE_PATH = '/airborne/_jump/flyingkick/active';
const GROUND_IDLE_STATE_PATH = '/_grounded/_idle';
const GROUND_WALK_STATE_PATH = '/_grounded/walk';
const GROUND_DUCK_STATE_PATH = '/_grounded/duck';
const GROUND_ATTACK_STATE_PATH = '/_grounded/attack';
const JUMP_STATE_PATH = '/airborne/_jump';

const fighterControlBlueprint: StateMachineBlueprint = {
	id: CONTROL_MACHINE_ID,
	// input_eval: 'first',
	on: {
		'mode.locomotion.idle': {
			if(this: Fighter) { return !isLocomotionLocked(this); },
		do(): StateTransition { return { path: GROUND_IDLE_STATE_PATH, transition_type: 'switch' }; },
		},
		'mode.locomotion.walk': {
			if(this: Fighter) { return !isLocomotionLocked(this); },
			do(_state: State, payload?: EventPayload & { direction?: Direction }): StateTransition {
				return { path: GROUND_WALK_STATE_PATH, transition_type: 'switch', payload };
			},
		},
		'mode.action.attack': {
			do(this: Fighter, _state: State, payload?: AttackEventPayload): StateTransition {
				const resolved = resolveAttackPayload(payload);
				if (resolved.attackType === 'flyingkick') {
					const asc = this.abilitySystem;
					if (asc.hasGameplayTag('state.airborne') && !asc.hasGameplayTag('state.airborne.attackUsed')) {
						return { path: FLYING_KICK_STATE_PATH, payload: resolved, transition_type: 'switch' };
					}
				}
				return { path: GROUND_ATTACK_STATE_PATH, payload: resolved, transition_type: 'switch' };
			},
		},
		'mode.control.duck': GROUND_DUCK_STATE_PATH,
		'mode.control.jump': {
			do(this: Fighter, _state: State, payload?: JumpEventPayload): StateTransition {
				return { path: JUMP_STATE_PATH, payload };
			},
		},
		'mode.control.stoerheidsdans': '/stoerheidsdans',
		'mode.impact.humiliated': '/humiliated',
	},
	states: {
		_grounded: {
			entering_state(this: Fighter) {
				this.abilitySystem.addTags('state.grounded');
				this.abilitySystem.removeTags('state.airborne', 'state.airborne.attackUsed');
			},
			states: {
				_idle: {
					entering_state(this: Fighter) {
						$.emitPresentation('animate_idle', this);
						this.abilitySystem.addTags('state.idle');
						this.abilitySystem.removeTags('state.attacking', 'state.walking');
					},
					exiting_state(this: Fighter) {
						this.abilitySystem.removeTags('state.idle');
					},
				},
				walk: {
					entering_state(this: Fighter, _state: State, payload?: EventPayload & { direction?: Direction }) {
						const resolved = resolveWalkPayload(this, payload);
						this.applyWalkFacing(undefined, resolved);
						this.abilitySystem.addTags('state.walking');
						this.abilitySystem.removeTags('state.attacking', 'state.idle');
						$.emitPresentation('animate_walk', this);
					},
					tick(this: Fighter) {
						this.walkTick();
					},
					on: {
						'mode.locomotion.walk': {
							do(this: Fighter, _state: State, payload?: EventPayload & { direction?: Direction }) {
								const resolved = resolveWalkPayload(this, payload);
								this.applyWalkFacing(undefined, resolved);
							},
						},
					},
					exiting_state(this: Fighter) {
						this.abilitySystem.removeTags('state.walking');
					},
				},
				duck: {
					entering_state(this: Fighter) {
						this.abilitySystem.addTags('state.ducking');
						this.abilitySystem.removeTags('state.attacking');
						$.emitPresentation('animate_duck', this);
					},
					exiting_state(this: Fighter) {
						this.abilitySystem.removeTags('state.ducking');
					},
				},
				attack: {
					entering_state(this: Fighter, state: State, payload?: AttackEventPayload) {
						const resolved = resolveAttackPayload(payload);
						this.abilitySystem.addTags('state.attacking');
						this.startAttack(state, resolved);
					},
					on: {
						animationEnd: {
							do(this: Fighter, _state: State, payload?: AnimationEventPayload): StateTransition | void {
								const animation = payload?.animation_name;
								if (!animation) return undefined;
								if (animation !== this.currentAttackType) return undefined;
								if (animation === 'duckkick') {
									return { path: GROUND_DUCK_STATE_PATH, transition_type: 'switch' };
								}
								return { path: GROUND_IDLE_STATE_PATH, transition_type: 'switch' };
							},
						},
					},
					exiting_state(this: Fighter, state: State, payload?: AttackEventPayload) {
						const resolved = resolveAttackPayload(payload ?? { attackType: this.currentAttackType });
						this.finishAttack(state, resolved);
						this.abilitySystem.removeTags('state.attacking');
					},
				},
			},
		},
		airborne: {
			states: {
				_jump: {
					automatic_reset_mode: 'tree',
					entering_state(this: Fighter, state: State, payload?: JumpEventPayload) {
						this.abilitySystem.addTags('state.airborne');
						this.abilitySystem.removeTags('state.grounded', 'state.airborne.attackUsed');
						this.startJump(state, payload);
						$.emitPresentation('animate_jump', this);
					},
					exiting_state(this: Fighter, _state: State) {
						this.abilitySystem.removeTags('state.airborne', 'state.airborne.attackUsed');
						this.abilitySystem.addTags('state.grounded');
						this.finishJump();
					},
					states: {
						_ascending: {
							ticks2advance_tape: 30,
							tick(this: Fighter, state: State) {
								this.jumpAscendingTick(state);
							},
							tape_next: '../descending',
						},
						descending: {
							ticks2advance_tape: 30,
							tick(this: Fighter, state: State) {
								this.jumpDescendingTick(state);
							},
							tape_next: GROUND_IDLE_STATE_PATH,
						},
						flyingkick: {
							is_concurrent: true,
							states: {
								_ready: {},
								active: {
									entering_state(this: Fighter) {
										this.abilitySystem.addTags('state.attacking', 'state.airborne.attackUsed');
										this.performAttack('flyingkick');
									},
									on: {
										flyingkick_end: '../_ready',
									},
									exiting_state(this: Fighter) {
										this.completeAttack('flyingkick');
										this.abilitySystem.removeTags('state.attacking');
										$.emitPresentation('animate_jump', this);
									},
								},
							},
						},
					},
				},
			},
		},
		stoerheidsdans: {
			enable_tape_autotick: false,
			ticks2advance_tape: 1,
			tape_data: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
			repetitions: 2,
			tape_playback_mode: 'once',
			data: { expectedAnimation: null },
			entering_state(this: Fighter, state: State) {
				this.abilitySystem.addTags('state.combat_disabled');
				this.abilitySystem.removeTags('state.attacking');
				this.enterStoerheidsdans(state);
			},
			exiting_state(this: Fighter) {
				this.abilitySystem.removeTags('state.combat_disabled');
			},
			on: {
				animationEnd: {
					do(this: Fighter, state: State, payload?: AnimationEventPayload) {
						this.handleStoerAnimationEnd(state, payload);
					},
				},
			},
			tape_next(this: Fighter, state: State, payload?: EventPayload & { tape_rewound: boolean }) {
				this.handleStoerTapeNext(state, payload);
			},
			tape_end(this: Fighter, state: State): StateTransition {
				return { path: this.completeStoerheidsdans(state) };
			},
		},
		nagenieten: {
			entering_state(this: Fighter) {
				this.abilitySystem.addTags('state.combat_disabled');
				this.startNagenieten();
			},
			exiting_state(this: Fighter) {
				this.abilitySystem.removeTags('state.combat_disabled');
			},
		},
		humiliated: {
			entering_state(this: Fighter) {
				this.abilitySystem.addTags('state.combat_disabled', 'state.grounded');
				this.abilitySystem.removeTags('state.attacking', 'state.airborne');
				this.enterHumiliated();
				$.emitPresentation('animate_humiliated', this);
			},
			exiting_state(this: Fighter) {
				this.abilitySystem.removeTags('state.combat_disabled');
				this.exitHumiliated();
			},
		},
	},
};

const playerAnimationBlueprint: StateMachineBlueprint = {
	id: 'player_animation',
	is_concurrent: true,
	on: {
		'$i_was_hit': {
			do(_state: State) {
				setTicksToLastFrame(_state);
			},
		},
		'$i_hit_face': {
			do(_state: State) {
				setTicksToLastFrame(_state);
			},
		},
		'$animationEnd': {
			do(this: Fighter, _state: State, payload?: AnimationEventPayload) {
				const animation = payload?.animation_name;
				if (!animation) return;
				switch (animation) {
					case 'highkick':
					case 'punch':
					case 'lowkick':
						this.sc.dispatch_event('go_idle', this);
						break;
					case 'flyingkick':
						this.sc.dispatch_event('flyingkick_end', this);
						break;
					case 'duckkick':
						if (!this.performingStoerheidsdans) {
							this.sc.dispatch_event('go_duck', this);
						}
						break;
				}
			},
		},
		'$animate_idle': '_idle',
		'$animate_humiliated': 'humiliated',
		'$animate_walk': {
			do(): StateTransition {
				return { path: 'walk/_walk1', transition_type: 'force_leaf' };
			},
		},
		'$animate_punch': 'punch',
		'$animate_highkick': 'highkick',
		'$animate_flyingkick': 'flyingkick',
		'$animate_lowkick': 'lowkick',
		'$animate_duckkick': 'duckkick',
		'$animate_duck': 'duck',
		'$animate_jump': 'jump',
	},
	states: {
		_idle: {
			entering_state(this: Fighter) {
				setSpriteFrame(this, 'idle');
			},
		},
		walk: {
			automatic_reset_mode: 'subtree',
			states: {
				_walk1: {
					ticks2advance_tape: 8,
					entering_state(this: Fighter) {
						setSpriteFrame(this, 'walk');
					},
					tape_next: '../walk2',
				},
				walk2: {
					ticks2advance_tape: 8,
					entering_state(this: Fighter) {
						setSpriteFrame(this, 'walk_alt');
					},
					tape_next: '../_walk1',
				},
			},
		},
		highkick: createAttackAnimationState('highkick', 'heavy'),
		lowkick: createAttackAnimationState('lowkick', 'heavy'),
		punch: createAttackAnimationState('punch', 'light'),
		duckkick: createAttackAnimationState('duckkick', 'light'),
		flyingkick: createAttackAnimationState('flyingkick', 'heavy', true),
		duck: {
			entering_state(this: Fighter) {
				setSpriteFrame(this, 'duck');
			},
		},
		jump: {
			entering_state(this: Fighter) {
				setSpriteFrame(this, 'jump');
			},
		},
		humiliated: {
			ticks2advance_tape: 300,
			entering_state(this: Fighter) {
				setSpriteFrame(this, 'humiliated');
				$.emitPresentation('humiliated_animation_start', this, this);
			},
			tape_next(this: Fighter) {
				$.emitPresentation('humiliated_animation_end', this, this);
			},
		},
	},
};

function isLocomotionLocked(self: Fighter): boolean {
	const controller = self.sc;
	if (!controller) {
		throw new Error(`[FighterFSMs] Fighter '${self.id}' has no state controller.`);
	}
	if (controller.matches_state_path(STOER_STATE_PATH)) return true;
	if (controller.matches_state_path(NAGENIETEN_STATE_PATH)) return true;
	if (controller.matches_state_path(HUMILIATED_STATE_PATH)) return true;
	return false;
}

function resolveAttackPayload(payload?: AttackEventPayload): AttackEventPayload {
	if (!payload || !payload.attackType) {
		throw new Error('[FighterFSMs] Attack payload missing attackType.');
	}
	return payload;
}

function resolveWalkPayload(self: Fighter, payload?: EventPayload & { direction?: Direction }): { direction: Direction } {
	const direction = payload && payload.direction ? payload.direction : self.facing;
	if (!direction) {
		throw new Error(`[FighterFSMs] Unable to resolve walk direction for fighter '${self.id}'.`);
	}
	return { direction };
}

function setTicksToLastFrame(state: State): void {
	if (!state) {
		throw new Error('[FighterFSMs] Cannot set ticks to last frame for undefined state.');
	}
	const current = state.current;
	if (!current) {
		throw new Error(`[FighterFSMs] Cannot set ticks to last frame for state '${state.path}' without active child state.`);
	}
	const definition = current.definition;
	if (!definition) {
		throw new Error(`[FighterFSMs] Cannot set ticks to last frame for state '${state.path}' without definition.`);
	}
	const ticksPerFrame = definition.ticks2advance_tape ?? 0;
	const targetTicks = ticksPerFrame > 0 ? ticksPerFrame - 1 : 0;
	current.setTicksNoSideEffect(targetTicks);
}

function getAnimSprites(self: Fighter): Record<string, string> {
	const candidate = (self as unknown as { animSprites?: Record<string, string> }).animSprites;
	if (!candidate) {
		throw new Error(`[FighterFSMs] Fighter '${self.id}' has no animation sprite map.`);
	}
	return candidate;
}

function setSpriteFrame(self: Fighter, frameKey: string): void {
	const sprites = getAnimSprites(self);
	const sprite = sprites[frameKey];
	if (!sprite) {
		throw new Error(`[FighterFSMs] Fighter '${self.id}' is missing sprite '${frameKey}'.`);
	}
	self.imgid = sprite;
}

function createAttackAnimationState(name: AttackType, weaponClass: 'light' | 'heavy', emitOnExit: boolean = false): StateMachineBlueprint {
	const state: StateMachineBlueprint = {
		ticks2advance_tape: 15,
		entering_state(this: Fighter) {
			setSpriteFrame(this, name);
			$.emitGameplay('combat.attack', this, { animation_name: name, weaponClass });
		},
		tape_next(this: Fighter) {
			$.emit('animationEnd', this, { animation_name: name });
			$.emitGameplay(`fighter.attack.animation.${name}.finished`, this, { attackType: name });
		},
	};
	if (emitOnExit) {
		state.exiting_state = function (this: Fighter) {
			$.emitGameplay(`fighter.attack.animation.${name}.finished`, this, { attackType: name });
		};
	}
	return state;
}

export default FighterFSMs;
