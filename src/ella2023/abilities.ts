import { fromIntent, literal } from 'bmsx';
import './ability_manifest';
import type { GameplayAbilityDefinition } from 'bmsx/gas/gameplay_ability';
import type { AbilityId } from 'bmsx/gas/gastypes';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';
import { Fighter, FIGHTER_CORE_ABILITY_IDS, type AttackType } from './fighter';

const CORE_ABILITIES: GameplayAbilityDefinition[] = [
	{
		id: FIGHTER_CORE_ABILITY_IDS.walk,
		unique: 'restart',
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ type: 'dispatch', event: 'mode.locomotion.walk', payload: { direction: fromIntent('direction') } },
			{ type: 'waitTag', tag: 'state.walking', present: true },
			{ type: 'waitTag', tag: 'state.walking', present: false },
		],
		cancel: [
			{ type: 'dispatch', event: 'mode.locomotion.idle' },
		],
	},
	{
		id: FIGHTER_CORE_ABILITY_IDS.walk_stop,
		activation: [
			{ type: 'dispatch', event: 'mode.locomotion.idle' },
		],
	},
	{
		id: FIGHTER_CORE_ABILITY_IDS.duck_hold,
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ type: 'dispatch', event: 'mode.control.duck' },
		],
	},
	{
		id: FIGHTER_CORE_ABILITY_IDS.duck_release,
		requiredTags: ['state.ducking'],
		activation: [
			{ type: 'dispatch', event: 'mode.locomotion.idle' },
		],
	},
	{
		id: FIGHTER_CORE_ABILITY_IDS.jump,
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.combat_disabled'],
		activation: [
			{ type: 'dispatch', event: 'mode.control.jump', payload: { direction: fromIntent('direction', { optional: true }) } },
		],
	},
];

const ATTACK_ABILITIES: GameplayAbilityDefinition[] = [
	createAttackAbility('punch'),
	createAttackAbility('highkick'),
	createAttackAbility('lowkick'),
	createAttackAbility('duckkick'),
	createFlyingKickAbility(),
];

const ALL_ABILITIES: readonly GameplayAbilityDefinition[] = [...CORE_ABILITIES, ...ATTACK_ABILITIES];

export function registerFighterAbilities(fighter: Fighter): void {
	const asc = fighter.getUniqueComponent(AbilitySystemComponent);
	for (const ability of ALL_ABILITIES) asc.revokeAbility(ability.id);
	for (const ability of ALL_ABILITIES) asc.grantAbility(ability);
}

export function getCoreAbilityId(name: keyof typeof FIGHTER_CORE_ABILITY_IDS): AbilityId {
	return FIGHTER_CORE_ABILITY_IDS[name];
}

function createAttackAbility(attack: Exclude<AttackType, 'flyingkick'>): GameplayAbilityDefinition {
	const id = abilityIdForAttack(attack);
	return {
		id,
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ type: 'dispatch', event: 'mode.action.attack', payload: { attackType: literal(attack) } },
			{ type: 'emit', event: 'fighter.attack.started', payload: { id: literal(id), attackType: literal(attack) }, lane: 'gameplay' },
			{ type: 'waitEvent', event: 'window.attackActive.start', scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'call', action: 'fighter.attack.tryHit', params: { attackType: literal(attack) } },
			{ type: 'waitEvent', event: 'window.attackActive.end', scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'call', action: 'fighter.attack.hideMarker' },
			{ type: 'waitEvent', event: `fighter.attack.animation.${attack}.finished`, scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'emit', event: 'fighter.attack.completed', payload: { id: literal(id), attackType: literal(attack) }, lane: 'gameplay' },
		],
	};
}

function createFlyingKickAbility(): GameplayAbilityDefinition {
	const attack: AttackType = 'flyingkick';
	const id = abilityIdForAttack(attack);
	return {
		id,
		requiredTags: ['state.airborne'],
		blockedTags: ['state.attacking', 'state.airborne.attackUsed', 'state.combat_disabled'],
		activation: [
			{ type: 'dispatch', event: 'mode.action.attack', payload: { attackType: literal(attack) } },
			{ type: 'emit', event: 'fighter.attack.started', payload: { id: literal(id), attackType: literal(attack) }, lane: 'gameplay' },
			{ type: 'waitEvent', event: 'window.attackActive.start', scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'call', action: 'fighter.attack.tryHit', params: { attackType: literal(attack) } },
			{ type: 'waitEvent', event: 'window.attackActive.end', scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'call', action: 'fighter.attack.hideMarker' },
			{ type: 'waitEvent', event: 'fighter.attack.animation.flyingkick.finished', scope: { kind: 'self' }, lane: 'gameplay' },
			{ type: 'emit', event: 'fighter.attack.completed', payload: { id: literal(id), attackType: literal(attack) }, lane: 'gameplay' },
		],
	};
}

function abilityIdForAttack(attack: AttackType): `fighter.attack.${AttackType}` {
	return `fighter.attack.${attack}` as `fighter.attack.${AttackType}`;
}
