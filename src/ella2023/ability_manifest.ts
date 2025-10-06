import type { Direction } from 'bmsx';
import { defineAbility, type Schema } from 'bmsx/gas/ability_registry';
import type { AttackType } from './fighter';

declare module 'bmsx/gas/gastypes' {
	interface AbilityPayloadTable {
		'fighter.locomotion.walk': { direction: Direction };
		'fighter.locomotion.walk_stop': undefined;
		'fighter.control.duck_hold': undefined;
		'fighter.control.duck_release': undefined;
		'fighter.control.jump': { direction?: Direction };
		'fighter.attack.punch': { attackType: 'punch' };
		'fighter.attack.highkick': { attackType: 'highkick' };
		'fighter.attack.lowkick': { attackType: 'lowkick' };
		'fighter.attack.duckkick': { attackType: 'duckkick' };
		'fighter.attack.flyingkick': { attackType: 'flyingkick' };
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

defineAbility('fighter.locomotion.walk', { schema: walkSchema });

defineAbility('fighter.locomotion.walk_stop');

defineAbility('fighter.control.duck_hold');

defineAbility('fighter.control.duck_release');

defineAbility('fighter.control.jump', { schema: jumpSchema });

defineAbility('fighter.attack.punch', { schema: attackSchema('punch') });

defineAbility('fighter.attack.highkick', { schema: attackSchema('highkick') });

defineAbility('fighter.attack.lowkick', { schema: attackSchema('lowkick') });

defineAbility('fighter.attack.duckkick', { schema: attackSchema('duckkick') });

defineAbility('fighter.attack.flyingkick', { schema: attackSchema('flyingkick') });
