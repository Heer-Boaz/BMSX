import type { InputAbilityProgram } from 'bmsx/gas/input_ability_dsl';
import { FIGHTER_ATTACK_ABILITY_IDS, FIGHTER_CORE_ABILITY_IDS } from '../ability_catalog';

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
				left: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.walk, payload: { direction: 'left' } } },
				right: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.walk, payload: { direction: 'right' } } },
				release: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.walk_stop } },
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
				press: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.duck_hold } },
				release: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.duck_release } },
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
				press: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.jump, payload: { direction: 'right' } } },
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
				press: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.jump, payload: { direction: 'left' } } },
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
				press: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.jump } },
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
					{ 'ability.request': { id: FIGHTER_ATTACK_ABILITY_IDS.flyingkick, payload: { attackType: 'flyingkick' } } },
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
					{ 'ability.request': { id: FIGHTER_ATTACK_ABILITY_IDS.punch, payload: { attackType: 'punch' } } },
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
					{ 'ability.request': { id: FIGHTER_ATTACK_ABILITY_IDS.highkick, payload: { attackType: 'highkick' } } },
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
					{ 'ability.request': { id: FIGHTER_ATTACK_ABILITY_IDS.duckkick, payload: { attackType: 'duckkick' } } },
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
					{ 'ability.request': { id: FIGHTER_ATTACK_ABILITY_IDS.lowkick, payload: { attackType: 'lowkick' } } },
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
				hold: { 'ability.request': { id: FIGHTER_CORE_ABILITY_IDS.walk_stop } },
			},
		},
	],
};
