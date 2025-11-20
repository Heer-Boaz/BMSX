import { $, build_fsm, State, type StateMachineBlueprint, type GameEvent, type TimelineDefinition, type TimelineFrameEventPayload } from 'bmsx';
import type { Direction } from 'bmsx';
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

type AttackEventDetail = { attackType?: AttackType };
type AttackEvent = GameEvent<'mode.action.attack', AttackEventDetail>;
type AnimationEvent = GameEvent<'animationEnd', { animation_name?: string }>;
type JumpEventDetail = { direction?: Direction | null; directional?: boolean | string };
type JumpEvent = GameEvent<'mode.control.jump', JumpEventDetail>;
type WalkEvent = GameEvent<'mode.locomotion.walk', { direction?: Direction }>;
type TimelineFrameEvent = GameEvent<'timeline.frame', TimelineFrameEventPayload>;

const ATTACK_FRAMES: Record<AttackType, number> = {
	punch: 6,
	highkick: 8,
	lowkick: 7,
	duckkick: 6,
	flyingkick: 10,
};

const STATIC_TIMELINES: TimelineDefinition[] = [
	{ id: 'fighter.jump.ascending', frames: [0], ticks_per_frame: 30, playback_mode: 'once' },
	{ id: 'fighter.jump.descending', frames: [0], ticks_per_frame: 30, playback_mode: 'once' },
	{
		id: 'fighter.stoerheidsdans',
		frames: ['highkick', 'lowkick', 'duckkick', 'punch', 'punch'],
		repetitions: 2,
		playback_mode: 'once',
		ticks_per_frame: 0,
		autotick: false,
	},
	{ id: 'fighter.walk.step1', frames: [0], ticks_per_frame: 8, playback_mode: 'once' },
	{ id: 'fighter.walk.step2', frames: [0], ticks_per_frame: 8, playback_mode: 'once' },
	{ id: 'fighter.animation.humiliated', frames: [0], ticks_per_frame: 300, playback_mode: 'once' },
	{ id: 'fighter.hitanimation', frames: [-1, 1], repetitions: 10, playback_mode: 'once', ticks_per_frame: 1 },
];

const ATTACK_TIMELINES: TimelineDefinition[] = (Object.keys(ATTACK_FRAMES) as AttackType[]).map(name => createAttackTimelineDefinition(name));

export const FIGHTER_TIMELINES: TimelineDefinition[] = [...STATIC_TIMELINES, ...ATTACK_TIMELINES];

const TIMELINE_IDS = {
	jumpAscending: 'fighter.jump.ascending',
	jumpDescending: 'fighter.jump.descending',
	stoerheidsdans: 'fighter.stoerheidsdans',
	walkStep1: 'fighter.walk.step1',
	walkStep2: 'fighter.walk.step2',
	humiliated: 'fighter.animation.humiliated',
	hitAnimation: 'fighter.hitanimation',
} as const;

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
			do(this: Fighter): string | void {
				if (isLocomotionLocked(this)) return;
				return GROUND_IDLE_STATE_PATH;
			},
		},
		'mode.locomotion.walk': {
			do(this: Fighter, _state: State, event: WalkEvent): string | void {
				if (isLocomotionLocked(this)) return;
				const resolved = resolveWalkPayload(this, event);
				this.pendingWalkDirection = resolved.direction;
				return GROUND_WALK_STATE_PATH;
			},
		},
		'mode.action.attack': {
			do(this: Fighter, _state: State, event: AttackEvent): string {
				const resolved = resolveAttackPayload(event);
				this.pendingAttackPayload = resolved;
				if (resolved.attackType === 'flyingkick') {
					const asc = this.abilitysystem;
					if (asc.has_gameplay_tag('state.airborne') && !asc.has_gameplay_tag('state.airborne.attackUsed')) {
						return FLYING_KICK_STATE_PATH;
					}
				}
				return GROUND_ATTACK_STATE_PATH;
			},
		},
		'mode.control.duck': GROUND_DUCK_STATE_PATH,
		'mode.control.jump': {
			do(this: Fighter, _state: State, event: JumpEvent): string {
				this.pendingJumpPayload = { direction: event.direction ?? null, directional: event.directional };
				return JUMP_STATE_PATH;
			},
		},
		'mode.control.stoerheidsdans': '/stoerheidsdans',
		'mode.impact.humiliated': '/humiliated',
	},
	states: {
		_grounded: {
			entering_state(this: Fighter) {
				this.abilitysystem.add_tags('state.grounded');
				this.abilitysystem.remove_tags('state.airborne', 'state.airborne.attackUsed');
			},
			states: {
				_idle: {
					entering_state(this: Fighter) {
						$.emit('animate_idle', this);
						this.abilitysystem.add_tags('state.idle');
						this.abilitysystem.remove_tags('state.attacking', 'state.walking');
					},
					exiting_state(this: Fighter) {
						this.abilitysystem.remove_tags('state.idle');
					},
				},
				walk: {
					entering_state(this: Fighter) {
						const resolved = resolveWalkPayload(this, this.pendingWalkDirection ? { direction: this.pendingWalkDirection } : undefined);
						this.pendingWalkDirection = undefined;
						this.applyWalkFacing(undefined, resolved);
						this.abilitysystem.add_tags('state.walking');
						this.abilitysystem.remove_tags('state.attacking', 'state.idle');
						$.emit('animate_walk', this);
					},
					tick(this: Fighter) {
						this.walkTick();
					},
					on: {
						'mode.locomotion.walk': {
							do(this: Fighter, _state: State, event: WalkEvent) {
								const resolved = resolveWalkPayload(this, event);
								this.applyWalkFacing(undefined, resolved);
							},
						},
					},
					exiting_state(this: Fighter) {
						this.abilitysystem.remove_tags('state.walking');
					},
				},
				duck: {
					entering_state(this: Fighter) {
						this.abilitysystem.add_tags('state.ducking');
						this.abilitysystem.remove_tags('state.attacking');
						$.emit('animate_duck', this);
					},
					exiting_state(this: Fighter) {
						this.abilitysystem.remove_tags('state.ducking');
					},
				},
				attack: {
					entering_state(this: Fighter, state: State) {
						const pending = this.pendingAttackPayload;
						this.pendingAttackPayload = undefined;
						const resolved = resolveAttackPayload(pending);
						this.abilitysystem.add_tags('state.attacking');
						this.startAttack(state, resolved);
					},
					on: {
						animationEnd: {
							do(this: Fighter, _state: State, event: AnimationEvent): string | void {
								const animation = event.animation_name;
								if (!animation) return undefined;
								if (animation !== this.currentAttackType) return undefined;
								if (animation === 'duckkick') {
									return GROUND_DUCK_STATE_PATH;
								}
								return GROUND_IDLE_STATE_PATH;
							},
						},
					},
					exiting_state(this: Fighter, state: State) {
						const activeType = this.currentAttackType;
						const resolved = resolveAttackPayload(activeType ? { attackType: activeType } : undefined);
						this.finishAttack(state, resolved);
						this.hideHitMarker();
						this.abilitysystem.remove_tags('state.attacking');
					},
					},
			},
		},
		airborne: {
			states: {
					_jump: {
					entering_state(this: Fighter, state: State) {
							const childStates = state.states;
							if (!childStates) {
								throw new Error('[FighterFSMs] Jump state has no substates.');
							}
							const ascending = childStates._ascending;
							if (!ascending) {
								throw new Error('[FighterFSMs] Jump state missing _ascending substate.');
							}
						if (state.currentid !== '_ascending') {
							state.transition_to('_ascending');
						}
						const flyingKick = childStates.flyingkick;
							if (!flyingKick) {
								throw new Error('[FighterFSMs] Jump state missing flyingkick substate.');
							}
							flyingKick.transition_to('_ready');
							const flyingKickStates = flyingKick.states;
							if (!flyingKickStates || !flyingKickStates._ready) {
								throw new Error('[FighterFSMs] Flying kick state missing _ready substate.');
							}

							this.abilitysystem.add_tags('state.airborne');
							this.abilitysystem.remove_tags('state.grounded', 'state.airborne.attackUsed');
							const payload = this.pendingJumpPayload;
							this.pendingJumpPayload = undefined;
							this.startJump(state, payload);
							$.emit('animate_jump', this);
						},
					exiting_state(this: Fighter, _state: State) {
						this.abilitysystem.remove_tags('state.airborne', 'state.airborne.attackUsed');
						this.abilitysystem.add_tags('state.grounded');
						this.finishJump();
						},
					states: {
						_ascending: {
							entering_state(this: Fighter) {
								this.play_timeline(TIMELINE_IDS.jumpAscending);
							},
							tick(this: Fighter, state: State) {
								this.jumpAscendingTick(state);
							},
							on: {
								[`timeline.end.${TIMELINE_IDS.jumpAscending}`]: {
									do(this: Fighter) {
										return '../descending';
									},
								},
							},
						},
						descending: {
							entering_state(this: Fighter) {
								this.play_timeline(TIMELINE_IDS.jumpDescending);
							},
							tick(this: Fighter, state: State) {
								this.jumpDescendingTick(state);
							},
							on: {
								[`timeline.end.${TIMELINE_IDS.jumpDescending}`]: {
									do(this: Fighter) {
										return GROUND_IDLE_STATE_PATH;
									},
								},
							},
						},
						flyingkick: {
							is_concurrent: true,
							states: {
								_ready: {},
								active: {
									entering_state(this: Fighter, state: State) {
										const pending = this.pendingAttackPayload ?? { attackType: 'flyingkick' };
										this.pendingAttackPayload = undefined;
										const resolved = resolveAttackPayload(pending);
										this.abilitysystem.add_tags('state.attacking', 'state.airborne.attackUsed');
										this.startAttack(state, resolved);
									},
									on: {
										animationEnd: {
											do(this: Fighter, _state: State, event: AnimationEvent): string | void {
												const animation = event.animation_name;
												if (animation !== 'flyingkick') return;
												return '../_ready';
											},
										},
									},
									exiting_state(this: Fighter) {
										this.completeAttack('flyingkick');
										this.hideHitMarker();
										this.abilitysystem.remove_tags('state.attacking');
										$.emit('animate_jump', this);
									},
								},
							},
						},
					},
				},
			},
		},
		stoerheidsdans: {
			data: { expectedAnimation: null },
			entering_state(this: Fighter, state: State) {
				this.abilitysystem.add_tags('state.combat_disabled');
				this.abilitysystem.remove_tags('state.attacking');
				this.enterStoerheidsdans(state);
				this.play_timeline(TIMELINE_IDS.stoerheidsdans);
			},
			exiting_state(this: Fighter) {
				this.abilitysystem.remove_tags('state.combat_disabled');
			},
			on: {
				animationEnd: {
					do(this: Fighter, state: State, event: AnimationEvent) {
						this.handleStoerAnimationEnd(state, event);
					},
				},
				[`timeline.frame.${TIMELINE_IDS.stoerheidsdans}`]: {
					do(this: Fighter, state: State, event: TimelineFrameEvent) {
						this.handleStoerTimelineFrame(state, event);
					},
				},
				[`timeline.end.${TIMELINE_IDS.stoerheidsdans}`]: {
					do(this: Fighter, state: State) {
						return this.completeStoerheidsdans(state);
					},
				},
			},
		},
		nagenieten: {
			entering_state(this: Fighter) {
				this.abilitysystem.add_tags('state.combat_disabled');
				this.startNagenieten();
			},
			exiting_state(this: Fighter) {
				this.abilitysystem.remove_tags('state.combat_disabled');
			},
		},
		humiliated: {
			entering_state(this: Fighter) {
				this.abilitysystem.add_tags('state.combat_disabled', 'state.grounded');
				this.abilitysystem.remove_tags('state.attacking', 'state.airborne');
				this.enterHumiliated();
				$.emit('animate_humiliated', this);
			},
			exiting_state(this: Fighter) {
				this.abilitysystem.remove_tags('state.combat_disabled');
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
			do(this: Fighter) {
				this.skip_animation_to_end();
			},
		},
		'$i_hit_face': {
			do(this: Fighter) {
				this.skip_animation_to_end();
			},
		},
		'$animate_idle': '_idle',
		'$animate_humiliated': 'humiliated',
		'$animate_walk': {
			do(this: Fighter, state: State): string {
				restartWalkAnimation(state);
				return 'walk/_walk1';
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
			entering_state(this: Fighter, state: State) {
				const children = state.states;
				if (!children || !children._walk1) {
					throw new Error('[FighterFSMs] Walk animation state missing _walk1 substate.');
				}
				state.transition_to('_walk1');
			},
			states: {
				_walk1: {
					entering_state(this: Fighter) {
						setSpriteFrame(this, 'walk');
						this.play_animation_timeline(TIMELINE_IDS.walkStep1);
					},
					on: {
						[`timeline.end.${TIMELINE_IDS.walkStep1}`]: {
							do(this: Fighter) {
								this.handle_animation_timeline_end(TIMELINE_IDS.walkStep1);
								return '../walk2';
							},
						},
					},
				},
				walk2: {
					entering_state(this: Fighter) {
						setSpriteFrame(this, 'walk_alt');
						this.play_animation_timeline(TIMELINE_IDS.walkStep2);
					},
					on: {
						[`timeline.end.${TIMELINE_IDS.walkStep2}`]: {
							do(this: Fighter) {
								this.handle_animation_timeline_end(TIMELINE_IDS.walkStep2);
								return '../_walk1';
							},
						},
					},
				},
			},
		},
		highkick: createAttackAnimationState('highkick', 'heavy'),
		lowkick: createAttackAnimationState('lowkick', 'heavy'),
		punch: createAttackAnimationState('punch', 'light'),
		duckkick: createAttackAnimationState('duckkick', 'light'),
		flyingkick: createAttackAnimationState('flyingkick', 'heavy'),
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
			entering_state(this: Fighter) {
				setSpriteFrame(this, 'humiliated');
				$.emit('humiliated_animation_start', this, { fighter: this });
				this.play_animation_timeline(TIMELINE_IDS.humiliated);
			},
			on: {
				[`timeline.end.${TIMELINE_IDS.humiliated}`]: {
					do(this: Fighter) {
						this.handle_animation_timeline_end(TIMELINE_IDS.humiliated);
						$.emit('humiliated_animation_end', this, { fighter: this });
					},
				},
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

function resolveAttackPayload(payload?: AttackEvent | AttackEventDetail): AttackEventDetail {
	if (!payload || !payload.attackType) {
		throw new Error('[FighterFSMs] Attack payload missing attackType.');
	}
	return { attackType: payload.attackType };
}

function resolveWalkPayload(self: Fighter, payload?: WalkEvent | { direction?: Direction }): { direction: Direction } {
	const direction = payload && payload.direction ? payload.direction : self.facing;
	if (!direction) {
		throw new Error(`[FighterFSMs] Unable to resolve walk direction for fighter '${self.id}'.`);
	}
	return { direction };
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

function restartWalkAnimation(state: State): void {
	state.transition_to('walk/_walk1');
}

function createAttackAnimationState(name: AttackType, weaponClass: 'light' | 'heavy'): StateMachineBlueprint {
	const timelineId = `fighter.attack.${name}`;
	return {
		entering_state(this: Fighter) {
			setSpriteFrame(this, name);
			this.play_animation_timeline(timelineId);
			$.emit_gameplay('combat.attack', this, { animation_name: name, weaponClass });
		},
		on: {
			[`timeline.end.${timelineId}`]: {
				do(this: Fighter, _state: State) {
					this.handle_animation_timeline_end(timelineId);
					$.emit('animationEnd', this, { animation_name: name });
					$.emit_gameplay(`fighter.attack.animation.${name}.finished`, this, { attackType: name });
				},
			},
		},
	};
}

function createAttackTimelineDefinition(name: AttackType): TimelineDefinition {
	const configuredFrames = ATTACK_FRAMES[name];
	const totalFrames = configuredFrames > 0 ? configuredFrames : 1;
	const frames: number[] = [];
	for (let i = 0; i < totalFrames; i += 1) {
		frames.push(i);
	}
	const startFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(totalFrames * 0.32)));
	const endFrame = Math.max(startFrame, Math.min(totalFrames - 1, Math.floor(totalFrames * 0.55)));
	return {
		id: `fighter.attack.${name}`,
		frames,
		ticks_per_frame: 1,
		playback_mode: 'once',
		windows: [
			{
				name: 'attackActive',
				start: { frame: startFrame },
				end: { frame: endFrame },
				tag: 'attack.active',
			},
		],
		markers: [
			{ frame: 0, event: `fx.${name}.windup` },
		],
	};
}

export default FighterFSMs;
