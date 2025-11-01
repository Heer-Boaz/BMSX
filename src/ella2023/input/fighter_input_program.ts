import type { InputAbilityProgram } from 'bmsx/gas/input_ability_dsl';

export const FIGHTER_INPUT_PROGRAM: InputAbilityProgram = {
	schema: 1,
	bindings: [
		{
			name: 'Walk',
			priority: 10,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled', 'state.ducking'],
				},
			},
			on: {
				custom: [
					{ name: 'left', pattern: 'left[h] && right[!p] && duck[!p] && jump[!p]' },
					{ name: 'right', pattern: 'right[h] && left[!p] && duck[!p] && jump[!p]' },
				],
				release: '(left[jr] && right[!p] && duck[!p] && jump[!p]) || (right[jr] && left[!p] && duck[!p] && jump[!p])',
			},
			do: {
				left: { 'ability.request': { id: 'fighter.locomotion.walk', payload: { direction: 'left' } } },
				right: { 'ability.request': { id: 'fighter.locomotion.walk', payload: { direction: 'right' } } },
				release: { 'ability.request': { id: 'fighter.locomotion.walk_stop' } },
			},
		},
		{
			name: 'Duck',
			priority: 20,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: {
				press: 'duck[j]',
				release: 'duck[jr]',
			},
			do: {
				press: { 'ability.request': { id: 'fighter.control.duck_hold' } },
				release: { 'ability.request': { id: 'fighter.control.duck_release' } },
			},
		},
		{
			name: 'JumpRight',
			priority: 30,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j] && right[wp{6}] && left[!p]' },
			do: {
				press: { 'ability.request': { id: 'fighter.control.jump', payload: { direction: 'right' } } },
			},
		},
		{
			name: 'JumpLeft',
			priority: 30,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j] && left[wp{6}] && right[!p]' },
			do: {
				press: { 'ability.request': { id: 'fighter.control.jump', payload: { direction: 'left' } } },
			},
		},
		{
			name: 'NeutralJump',
			priority: 25,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j]' },
			do: {
				press: { 'ability.request': { id: 'fighter.control.jump' } },
			},
		},
		{
			name: 'AirborneFlyingKick',
			priority: 6,
			when: {
				tags: {
					all: ['state.airborne'],
					not: ['state.attacking', 'state.combat_disabled', 'state.airborne.attackUsed'],
				},
			},
			on: { press: 'highkick[wp{6}] || lowkick[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.flyingkick', payload: { attackType: 'flyingkick' } } },
					{ 'input.consume': ['highkick', 'lowkick'] },
				],
			},
		},
		{
			name: 'Punch',
			priority: 5,
			when: {
				tags: {
					not: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
				},
			},
			on: { press: 'punch[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.punch', payload: { attackType: 'punch' } } },
					{ 'input.consume': ['punch'] },
				],
			},
		},
		{
			name: 'HighKick',
			priority: 5,
			when: {
				tags: {
					not: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
				},
			},
			on: { press: 'highkick[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.highkick', payload: { attackType: 'highkick' } } },
					{ 'input.consume': ['highkick'] },
				],
			},
		},
		{
			name: 'DuckKick',
			priority: 5,
			when: {
				tags: {
					all: ['state.ducking'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'lowkick[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.duckkick', payload: { attackType: 'duckkick' } } },
					{ 'input.consume': ['lowkick'] },
				],
			},
		},
		{
			name: 'LowKick',
			priority: 4,
			when: {
				tags: {
					not: ['state.attacking', 'state.airborne', 'state.combat_disabled', 'state.ducking'],
				},
			},
			on: { press: 'lowkick[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.lowkick', payload: { attackType: 'lowkick' } } },
					{ 'input.consume': ['lowkick'] },
				],
			},
		},
		{
			name: 'WalkBrakeWhenNoDir',
			priority: 0,
			when: {
				tags: {
					all: ['state.grounded', 'state.walking'],
					not: ['state.combat_disabled'],
				},
			},
			on: { hold: 'left[!p] && right[!p]' },
			do: {
				hold: { 'ability.request': { id: 'fighter.locomotion.walk_stop' } },
			},
		},
	],
};
