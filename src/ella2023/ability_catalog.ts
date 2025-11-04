export type FighterAttackType = 'punch' | 'highkick' | 'lowkick' | 'duckkick' | 'flyingkick';

export const FIGHTER_ATTACK_ABILITY_IDS = {
	punch: 'fighter.attack.punch',
	highkick: 'fighter.attack.highkick',
	lowkick: 'fighter.attack.lowkick',
	duckkick: 'fighter.attack.duckkick',
	flyingkick: 'fighter.attack.flyingkick',
} as const satisfies Record<FighterAttackType, `fighter.attack.${FighterAttackType}`>;

export type FighterAttackAbilityId = typeof FIGHTER_ATTACK_ABILITY_IDS[FighterAttackType];

export const FIGHTER_CORE_ABILITY_IDS = {
	walk: 'fighter.locomotion.walk',
	walk_stop: 'fighter.locomotion.walk_stop',
	duck_hold: 'fighter.control.duck_hold',
	duck_release: 'fighter.control.duck_release',
	jump: 'fighter.control.jump',
} as const;

export type FighterCoreAbilityName = keyof typeof FIGHTER_CORE_ABILITY_IDS;
export type FighterCoreAbilityId = typeof FIGHTER_CORE_ABILITY_IDS[FighterCoreAbilityName];

export type FighterAbilityId = FighterCoreAbilityId | FighterAttackAbilityId;

export const FIGHTER_ABILITY_GRANT_ORDER: readonly FighterAbilityId[] = [
	FIGHTER_CORE_ABILITY_IDS.walk,
	FIGHTER_CORE_ABILITY_IDS.walk_stop,
	FIGHTER_CORE_ABILITY_IDS.duck_hold,
	FIGHTER_CORE_ABILITY_IDS.duck_release,
	FIGHTER_CORE_ABILITY_IDS.jump,
	FIGHTER_ATTACK_ABILITY_IDS.punch,
	FIGHTER_ATTACK_ABILITY_IDS.highkick,
	FIGHTER_ATTACK_ABILITY_IDS.lowkick,
	FIGHTER_ATTACK_ABILITY_IDS.duckkick,
	FIGHTER_ATTACK_ABILITY_IDS.flyingkick,
] as const;
