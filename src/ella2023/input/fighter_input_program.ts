import type { InputAbilityProgram } from 'bmsx/gas/input_ability_dsl';

export const FIGHTER_INPUT_PROGRAM: InputAbilityProgram = {
	schema: 1,
	bindings: [
		{
			name: 'WalkLeft',
			priority: 10,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled', 'state.ducking'],
				},
			},
	on: {
		press: 'left[j] && right[!p]',
		hold: 'left[h] && right[!p]',
		release: 'left[jr] && right[!p]',
			},
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.locomotion.walk', payload: { dir: 'left' }, source: 'input.ial' } },
					{ 'input.consume': ['left'] },
				],
				hold: { 'ability.request': { id: 'fighter.locomotion.walk', payload: { dir: 'left' }, source: 'input.ial' } },
				release: { 'ability.request': { id: 'fighter.locomotion.walk_stop', source: 'input.ial' } },
			},
		},
		{
			name: 'WalkRight',
			priority: 10,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled', 'state.ducking'],
				},
			},
	on: {
		press: 'right[j] && left[!p]',
		hold: 'right[h] && left[!p]',
		release: 'right[jr] && left[!p]',
			},
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.locomotion.walk', payload: { dir: 'right' }, source: 'input.ial' } },
					{ 'input.consume': ['right'] },
				],
				hold: { 'ability.request': { id: 'fighter.locomotion.walk', payload: { dir: 'right' }, source: 'input.ial' } },
				release: { 'ability.request': { id: 'fighter.locomotion.walk_stop', source: 'input.ial' } },
			},
		},
		{
			name: 'Duck',
			priority: 9,
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
				press: [
					{ 'ability.request': { id: 'fighter.control.duck_hold', source: 'input.ial' } },
					{ 'input.consume': ['duck'] },
				],
				release: { 'ability.request': { id: 'fighter.control.duck_release', source: 'input.ial' } },
			},
		},
		{
			name: 'JumpRight',
			priority: 8,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j] && right[p] && left[!p]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.control.jump', payload: { direction: 'right' }, source: 'input.ial' } },
					{ 'input.consume': ['jump'] },
				],
			},
		},
		{
			name: 'JumpLeft',
			priority: 8,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j] && left[p] && right[!p]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.control.jump', payload: { direction: 'left' }, source: 'input.ial' } },
					{ 'input.consume': ['jump'] },
				],
			},
		},
		{
			name: 'NeutralJump',
			priority: 7,
			when: {
				tags: {
					all: ['state.grounded'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
			on: { press: 'jump[j]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.control.jump', source: 'input.ial' } },
					{ 'input.consume': ['jump'] },
				],
			},
		},
		{
			name: 'AirborneFlyingKick',
			priority: 6,
			when: {
				tags: {
					all: ['state.airborne'],
					not: ['state.attacking', 'state.combat_disabled'],
				},
			},
	on: { press: 'highkick[wp{6}] || lowkick[wp{6}]' },
			do: {
				press: [
					{ 'ability.request': { id: 'fighter.attack.flyingkick', payload: { attackType: 'flyingkick' }, source: 'input.ial' } },
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
					{ 'ability.request': { id: 'fighter.attack.punch', payload: { attackType: 'punch' }, source: 'input.ial' } },
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
					{ 'ability.request': { id: 'fighter.attack.highkick', payload: { attackType: 'highkick' }, source: 'input.ial' } },
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
					{ 'ability.request': { id: 'fighter.attack.duckkick', payload: { attackType: 'duckkick' }, source: 'input.ial' } },
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
					{ 'ability.request': { id: 'fighter.attack.lowkick', payload: { attackType: 'lowkick' }, source: 'input.ial' } },
					{ 'input.consume': ['lowkick'] },
				],
			},
		},
	],
};
