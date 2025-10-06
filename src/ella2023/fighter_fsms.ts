import { build_fsm, type StateMachineBlueprint } from 'bmsx';
import type { StateActionSpec } from 'bmsx/fsm/fsmtypes';

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

const fighterControlBlueprint: StateMachineBlueprint = {
	id: 'fighter_control',
	input_eval: 'first',
	on: {
		'mode.locomotion.idle': {
			if: {
				and: [
					{ state_not_matches: './stoerheidsdans' },
					{ state_not_matches: './nagenieten' },
					{ state_not_matches: './humiliated' },
				],
			},
			switch: './_grounded/_idle',
		},
		'mode.locomotion.walk': {
			if: {
				and: [
					{ state_not_matches: './stoerheidsdans' },
					{ state_not_matches: './nagenieten' },
					{ state_not_matches: './humiliated' },
				],
			},
			to: './_grounded/walk',
		},
		'mode.action.attack': {
			do: [
				{
					when: {
						value_equals: {
							left: '@payload.attackType',
							equals: 'flyingkick',
						},
					},
					then: {
						when: {
							value_equals: {
								left: '@self.hasUsedAirborneAttack',
								equals: false,
							},
						},
						then: { switch: './airborne/_jump/flyingkick/active' },
					},
					else: './_grounded/attack',
				},
			],
		},
		'mode.control.duck': './_grounded/duck',
		'mode.control.jump': './airborne/_jump',
		'mode.control.stoerheidsdans': './stoerheidsdans',
		'mode.impact.humiliated': './humiliated',
	},
	states: {
		_grounded: {
			entering_state: [
				{ tags: { add: ['state.grounded'], remove: ['state.airborne', 'state.airborne.attackUsed'] } },
			],
			states: {
				_idle: {
					entering_state: [
						{ emit: 'animate_idle' },
						{ tags: { add: ['state.idle'], remove: ['state.attacking', 'state.walking'] } },
					],
					exiting_state: [
						{ tags: { remove: ['state.idle'] } },
					],
				},
				walk: {
					entering_state: [
						{ invoke: { fn: '@self.applyWalkFacing', payload: { direction: '@self.facing' } } },
						{ tags: { add: ['state.walking'], remove: ['state.attacking', 'state.idle'] } },
						{ emit: 'animate_walk' },
					],
					tick: { invoke: { fn: '@self.walkTick' } },
					on: {
						'mode.locomotion.walk': {
							do: [
								{ invoke: { fn: '@self.applyWalkFacing' } },
							],
						},
					},
					exiting_state: [
						{ tags: { remove: ['state.walking'] } },
					],
				},
				duck: {
					entering_state: [
						{ tags: { add: ['state.ducking'], remove: ['state.attacking'] } },
						{ emit: 'animate_duck' },
					],
					exiting_state: [
						{ tags: { remove: ['state.ducking'] } },
					],
				},
				attack: {
					entering_state: [
						{ invoke: { fn: '@self.startAttack', payload: { attackType: '@payload.attackType' } } },
						{ tags: { add: ['state.attacking'] } },
					],
					on: {
						animationEnd: {
							if: {
								value_equals: {
									left: '@payload.animation_name',
									equals: '@self.currentAttackType',
								},
							},
							do: [
								{
									when: { value_equals: { left: '@self.currentAttackType', equals: 'duckkick' } },
									then: { switch: '/_grounded/duck' },
									else: '/_grounded/_idle',
								},
							],
						},
					},
					exiting_state: [
						{ invoke: { fn: '@self.finishAttack', payload: { attackType: '@self.currentAttackType' } } },
						{ tags: { remove: ['state.attacking'] } },
					],
				},
			},
		},
		airborne: {
			states: {
				_jump: {
					automatic_reset_mode: 'tree',
					entering_state: [
						{ tags: { add: ['state.airborne'], remove: ['state.grounded', 'state.airborne.attackUsed'] } },
						{ invoke: { fn: '@self.startJump' } },
						{ emit: 'animate_jump' },
					],
					exiting_state: [
						{ tags: { remove: ['state.airborne', 'state.airborne.attackUsed'], add: ['state.grounded'] } },
						{ invoke: { fn: '@self.finishJump' } },
					],
					states: {
						_ascending: {
							ticks2advance_tape: 30,
							tick: {
								invoke: { fn: '@self.jumpAscendingTick' },
							},
							tape_next: '../descending',
						},
						descending: {
							ticks2advance_tape: 30,
							tick: {
								invoke: { fn: '@self.jumpDescendingTick' },
							},
							tape_next: '/_grounded/_idle',
						},
						flyingkick: {
							is_concurrent: true,
							states: {
								_ready: {},
								active: {
									entering_state: [
										{ invoke: { fn: '@self.performAttack', payload: { attackType: 'flyingkick' } } },
										{ tags: { add: ['state.attacking', 'state.airborne.attackUsed'] } },
									],
									exiting_state: [
										{ invoke: { fn: '@self.completeAttack', payload: { attackType: 'flyingkick' } } },
										{ tags: { remove: ['state.attacking'] } },
										{ emit: 'animate_jump' },
									],
									on: {
										flyingkick_end: '../_ready',
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
			entering_state: [
				{ tags: { add: ['state.combat_disabled'], remove: ['state.attacking'] } },
				{ invoke: { fn: '@self.enterStoerheidsdans' } },
			],
			exiting_state: [
				{ tags: { remove: ['state.combat_disabled'] } },
			],
			on: {
				animationEnd: {
					do: [
						{ invoke: { fn: '@self.handleStoerAnimationEnd' } },
					],
				},
			},
			tape_next: {
				do: [
					{ invoke: { fn: '@self.handleStoerTapeNext' } },
				],
			},
			tape_end: {
				do: [
					{ invoke: { fn: '@self.completeStoerheidsdans' } },
				],
				to: '/_nagenieten',
			},
		},
		nagenieten: {
			entering_state: [
				{ tags: { add: ['state.combat_disabled'] } },
				{ invoke: { fn: '@self.startNagenieten' } },
			],
			exiting_state: [
				{ tags: { remove: ['state.combat_disabled'] } },
			],
		},
		humiliated: {
			entering_state: [
				{ tags: { add: ['state.combat_disabled', 'state.grounded'], remove: ['state.attacking', 'state.airborne'] } },
				{ invoke: { fn: '@self.enterHumiliated' } },
				{ emit: 'animate_humiliated' },
			],
			exiting_state: [
				{ tags: { remove: ['state.combat_disabled'] } },
				{ invoke: { fn: '@self.exitHumiliated' } },
			],
		},
	},
};

const playerAnimationBlueprint: StateMachineBlueprint = {
	id: 'player_animation',
	is_concurrent: true,
	on: {
		'$i_was_hit': {
			do: [
				{ set_ticks_to_last_frame: true },
			],
		},
		'$i_hit_face': {
			do: [
				{ set_ticks_to_last_frame: true },
			],
		},
		'$animationEnd': {
			do: [
				{
					when: {
						value_equals: { left: '@payload.animation_name', equals: 'highkick' },
					},
					then: {
						dispatch_event: { event: 'go_idle' },
					},
				},
				{
					when: {
						value_equals: { left: '@payload.animation_name', equals: 'punch' },
					},
					then: {
						dispatch_event: { event: 'go_idle' },
					},
				},
				{
					when: {
						value_equals: { left: '@payload.animation_name', equals: 'lowkick' },
					},
					then: {
						dispatch_event: { event: 'go_idle' },
					},
				},
				{
					when: {
						value_equals: { left: '@payload.animation_name', equals: 'flyingkick' },
					},
					then: {
						dispatch_event: { event: 'flyingkick_end' },
					},
				},
				{
					when: {
						and: [
							{ value_equals: { left: '@payload.animation_name', equals: 'duckkick' } },
							{ not: [{ value_equals: { left: '@self.performingStoerheidsdans', equals: true } }] },
						],
					},
					then: {
						dispatch_event: { event: 'go_duck' },
					},
				},
			],
		},
		'$animate_idle': { switch: '_idle' },
		'$animate_humiliated': 'humiliated',
		'$animate_walk': { force_leaf: 'walk/_walk1' },
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
			entering_state: [
				{ set_property: { target: 'imgid', value: '@self.animSprites.idle' } },
			],
		},
		walk: {
			automatic_reset_mode: 'subtree',
			states: {
				_walk1: {
					ticks2advance_tape: 8,
					entering_state: [
						{ set_property: { target: 'imgid', value: '@self.animSprites.walk' } },
					],
					tape_next: '../walk2',
				},
				walk2: {
					ticks2advance_tape: 8,
					entering_state: [
						{ set_property: { target: 'imgid', value: '@self.animSprites.walk_alt' } },
					],
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
			entering_state: [
				{ set_property: { target: 'imgid', value: '@self.animSprites.duck' } },
			],
		},
		jump: {
			entering_state: [
				{ set_property: { target: 'imgid', value: '@self.animSprites.jump' } },
			],
		},
		humiliated: {
			ticks2advance_tape: 300,
			entering_state: [
				{ set_property: { target: 'imgid', value: '@self.animSprites.humiliated' } },
				{ emit: { event: 'humiliated_animation_start', payload: { character: '@self.humiliatedCharacterId' } } },
			],
			tape_next: {
				emit: { event: 'humiliated_animation_end', payload: { character: '@self.humiliatedCharacterId' } },
			},
		},
	},
};

function createAttackAnimationState(name: string, weaponClass: 'light' | 'heavy', emitOnExit: boolean = false): StateMachineBlueprint {
	const finishedEmit: StateActionSpec = {
		emit: {
			event: `fighter.attack.animation.${name}.finished`,
			scope: 'self',
			payload: { attackType: name },
		},
	};
	const state: StateMachineBlueprint = {
		ticks2advance_tape: 15,
		entering_state: [
			{ set_property: { target: 'imgid', value: `@self.animSprites.${name}` } },
			{ emit: { event: 'combat.attack', payload: { animation_name: name, weaponClass } } },
		],
		tape_next: [
			{ emit: { event: 'animationEnd', payload: { animation_name: name } } },
			finishedEmit,
		],
	};
	if (emitOnExit) {
		state.exiting_state = [finishedEmit];
	}
	return state;
}

export default FighterFSMs;
