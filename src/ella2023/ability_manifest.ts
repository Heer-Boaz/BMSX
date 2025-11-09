import type { Direction } from 'bmsx';
import { abilityActions, defineAbility, type Schema } from 'bmsx/gas/ability_registry';
import type { AbilityActionContext } from 'bmsx/gas/gameplay_ability';
import { Fighter, type AttackType } from './fighter';
import { FIGHTER_ATTACK_ABILITY_IDS, FIGHTER_CORE_ABILITY_IDS } from './ability_catalog';

declare module 'bmsx/gas/gastypes' {
	interface AbilityPayloadTable {
		[FIGHTER_CORE_ABILITY_IDS.walk]: { direction: Direction };
		[FIGHTER_CORE_ABILITY_IDS.walk_stop]: undefined;
		[FIGHTER_CORE_ABILITY_IDS.duck_hold]: undefined;
		[FIGHTER_CORE_ABILITY_IDS.duck_release]: undefined;
		[FIGHTER_CORE_ABILITY_IDS.jump]: { direction?: Direction };
		[FIGHTER_ATTACK_ABILITY_IDS.punch]: { attackType: 'punch' };
		[FIGHTER_ATTACK_ABILITY_IDS.highkick]: { attackType: 'highkick' };
		[FIGHTER_ATTACK_ABILITY_IDS.lowkick]: { attackType: 'lowkick' };
		[FIGHTER_ATTACK_ABILITY_IDS.duckkick]: { attackType: 'duckkick' };
		[FIGHTER_ATTACK_ABILITY_IDS.flyingkick]: { attackType: 'flyingkick' };
	}
}

function isLeftOrRight(value: unknown): value is Direction {
	if (value === 'left') return true;
	if (value === 'right') return true;
	return false;
}

const walkSchema: Schema<{ direction: Direction }> = {
	validate(value: unknown): value is { direction: Direction } {
		if (value === null) return false;
		if (typeof value !== 'object') return false;
		const payload = value as { direction?: unknown };
		const direction = payload.direction;
		if (!isLeftOrRight(direction)) return false;
		return true;
	},
	describe: "{ direction: 'left' | 'right' }",
};

const jumpSchema: Schema<{ direction?: Direction }> = {
	validate(value: unknown): value is { direction?: Direction } {
		if (value === undefined) return true;
		if (value === null) return false;
		if (typeof value !== 'object') return false;
		const payload = value as { direction?: unknown };
		const direction = payload.direction;
		if (direction === undefined) return true;
		if (isLeftOrRight(direction)) return true;
		return false;
	},
	describe: "{ direction?: 'left' | 'right' }",
};

function attackSchema(expected: AttackType): Schema<{ attackType: AttackType }> {
	return {
		validate(value: unknown): value is { attackType: AttackType } {
			if (value === null) return false;
			if (typeof value !== 'object') return false;
			const payload = value as { attackType?: unknown };
			const attackType = payload.attackType;
			if (attackType !== expected) return false;
			return true;
		},
		describe: `{ attackType: '${expected}' }`,
	};
}

function ensureFighterOwner(ctx: AbilityActionContext, actionId: string): Fighter {
	const owner = ctx.owner;
	if (owner instanceof Fighter) return owner;
	throw new Error(`[AbilityActions] '${actionId}' requires Fighter owner.`);
}

function resolveAttackType(params: Record<string, unknown> | undefined, actionId: string): AttackType {
	if (!params) {
		throw new Error(`[AbilityActions] '${actionId}' invoked without params.`);
	}
	const payload = params as { attackType?: unknown };
	const { attackType } = payload;
	if (
		attackType === 'punch' ||
		attackType === 'highkick' ||
		attackType === 'lowkick' ||
		attackType === 'duckkick' ||
		attackType === 'flyingkick'
	) {
		return attackType;
	}
	throw new Error(`[AbilityActions] '${actionId}' received invalid attackType '${String(attackType)}'.`);
}

abilityActions.register('fighter.attack.tryHit', (ctx, params) => {
	const fighter = ensureFighterOwner(ctx, 'fighter.attack.tryHit');
	const attackType = resolveAttackType(params, 'fighter.attack.tryHit');
	const opponent = fighter.getAttackOpponent();
	fighter.doAttackFlow(attackType, opponent);
});

abilityActions.register('fighter.attack.hideMarker', ctx => {
	const fighter = ensureFighterOwner(ctx, 'fighter.attack.hideMarker');
	fighter.hideHitMarker();
});

defineAbility(FIGHTER_CORE_ABILITY_IDS.walk, { schema: walkSchema });

defineAbility(FIGHTER_CORE_ABILITY_IDS.walk_stop);

defineAbility(FIGHTER_CORE_ABILITY_IDS.duck_hold);

defineAbility(FIGHTER_CORE_ABILITY_IDS.duck_release);

defineAbility(FIGHTER_CORE_ABILITY_IDS.jump, { schema: jumpSchema });

defineAbility(FIGHTER_ATTACK_ABILITY_IDS.punch, { schema: attackSchema('punch') });

defineAbility(FIGHTER_ATTACK_ABILITY_IDS.highkick, { schema: attackSchema('highkick') });

defineAbility(FIGHTER_ATTACK_ABILITY_IDS.lowkick, { schema: attackSchema('lowkick') });

defineAbility(FIGHTER_ATTACK_ABILITY_IDS.duckkick, { schema: attackSchema('duckkick') });

defineAbility(FIGHTER_ATTACK_ABILITY_IDS.flyingkick, { schema: attackSchema('flyingkick') });
