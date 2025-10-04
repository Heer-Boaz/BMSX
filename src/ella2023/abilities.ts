import { AbilityActionRegistry, abilityBlueprint, fromIntent, fromVar, literal } from 'bmsx';
import type { AbilityBlueprint } from 'bmsx';
import type { AbilityId } from 'bmsx/gas/gastypes';
import type { Direction } from 'bmsx';
import type { WorldObject } from 'bmsx/core/object/worldobject';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';
import { Fighter, FIGHTER_CORE_ABILITY_IDS, type AttackType } from './fighter';

const ATTACK_TYPES: readonly AttackType[] = ['punch', 'highkick', 'lowkick', 'duckkick', 'flyingkick'];
const ATTACK_TYPE_SET: ReadonlySet<string> = new Set<string>(ATTACK_TYPES);

const VAR_WALK_DIRECTION = 'locomotion.direction';
const VAR_JUMP_DIRECTION = 'jump.direction';
const VAR_ATTACK_CURRENT = 'combat.attack.current';

const fighterActions = new AbilityActionRegistry();

fighterActions.register('fighter.configureWalk', (ctx, params) => {
	const fighter = asFighter(ctx.owner);
	let direction: Direction;
	const input = readString(params, 'direction');
	if (isDirection(input)) {
		direction = input;
	} else {
		const facing = fighter.facing;
		if (isDirection(facing)) direction = facing;
		else direction = 'right';
	}
	fighter.facing = direction;
	ctx.vars[VAR_WALK_DIRECTION] = direction;
});

fighterActions.register('fighter.prepareJump', (ctx, params) => {
	const fighter = asFighter(ctx.owner);
	const input = readString(params, 'direction');
	if (isDirection(input)) {
		fighter.facing = input;
		ctx.vars[VAR_JUMP_DIRECTION] = input;
	} else {
		delete ctx.vars[VAR_JUMP_DIRECTION];
	}
});

fighterActions.register('fighter.dispatchJump', (ctx, _params) => {
	const stored = ctx.vars[VAR_JUMP_DIRECTION];
	let payload: Record<string, unknown> | undefined;
	if (typeof stored === 'string' && isDirection(stored)) {
		payload = { direction: stored } as Record<string, unknown>;
	}
	ctx.dispatchMode('mode.control.jump', payload, undefined);
});

fighterActions.register('fighter.beginAttack', (ctx, params) => {
	const fighter = asFighter(ctx.owner);
	const attack = resolveAttackType(params, ctx.vars);
	ctx.vars[VAR_ATTACK_CURRENT] = attack;
	const payload = { attackType: attack } as Record<string, unknown>;
	if (fighter.performingStoerheidsdans) {
		fighter.performAttack(attack);
	} else {
		ctx.dispatchMode('mode.action.attack', payload, undefined);
	}
});

fighterActions.register('fighter.completeAttack', (ctx, params) => {
	const fighter = asFighter(ctx.owner);
	const attack = resolveAttackType(params, ctx.vars);
	if (fighter.performingStoerheidsdans) {
		fighter.completeAttack(attack);
	} else if (attack !== 'flyingkick') {
		const payload = { attackType: attack } as Record<string, unknown>;
		ctx.dispatchMode('mode.action.complete', payload, undefined);
	}
	delete ctx.vars[VAR_ATTACK_CURRENT];
});

fighterActions.register('fighter.cancelAttack', (ctx, params) => {
	const fighter = asFighter(ctx.owner);
	const attack = resolveAttackType(params, ctx.vars);
	fighter.finishAttack(attack);
	delete ctx.vars[VAR_ATTACK_CURRENT];
});

fighterActions.register('fighter.noteFlyingKickSpent', (ctx, _params) => {
	const fighter = asFighter(ctx.owner);
	fighter.attacked_while_jumping = true;
	ctx.addTag('state.airborne.attackUsed');
});

fighterActions.register('fighter.clearFlyingKickSpent', (ctx, _params) => {
	const fighter = asFighter(ctx.owner);
	fighter.attacked_while_jumping = false;
	ctx.removeTag('state.airborne.attackUsed');
});

const CORE_BLUEPRINTS: AbilityBlueprint[] = [
	abilityBlueprint({
		id: FIGHTER_CORE_ABILITY_IDS.walk,
		unique: 'restart',
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ kind: 'call.action', action: 'fighter.configureWalk', params: { direction: fromIntent('payload.direction', undefined, true) } },
			{ kind: 'mode.dispatch', event: 'mode.locomotion.walk', payload: { direction: fromVar(VAR_WALK_DIRECTION, literal('right')) } },
		],
		onCancel: [
			{ kind: 'mode.dispatch', event: 'mode.locomotion.idle' },
		],
	}),
	abilityBlueprint({
		id: FIGHTER_CORE_ABILITY_IDS.walk_stop,
		unique: 'ignore',
		activation: [
			{ kind: 'mode.dispatch', event: 'mode.locomotion.idle' },
		],
	}),
	abilityBlueprint({
		id: FIGHTER_CORE_ABILITY_IDS.duck_hold,
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ kind: 'mode.dispatch', event: 'mode.control.duck' },
		],
	}),
	abilityBlueprint({
		id: FIGHTER_CORE_ABILITY_IDS.duck_release,
		requiredTags: ['state.ducking'],
		activation: [
			{ kind: 'mode.dispatch', event: 'mode.locomotion.idle' },
		],
	}),
	abilityBlueprint({
		id: FIGHTER_CORE_ABILITY_IDS.jump,
		requiredTags: ['state.grounded'],
		blockedTags: ['state.attacking', 'state.combat_disabled'],
		activation: [
			{ kind: 'call.action', action: 'fighter.prepareJump', params: { direction: fromIntent('payload.direction', undefined, true) } },
			{ kind: 'call.action', action: 'fighter.dispatchJump' },
		],
	}),
];

const ATTACK_BLUEPRINTS: AbilityBlueprint[] = [
	createAttackBlueprint('punch'),
	createAttackBlueprint('highkick'),
	createAttackBlueprint('lowkick'),
	createAttackBlueprint('duckkick'),
	createFlyingKickBlueprint(),
];

const ALL_BLUEPRINTS: readonly AbilityBlueprint[] = [...CORE_BLUEPRINTS, ...ATTACK_BLUEPRINTS];

export const FIGHTER_ATTACK_ABILITY_IDS: AbilityId[] = ATTACK_BLUEPRINTS.map(blueprint => blueprint.id);

export function registerFighterAbilities(fighter: Fighter): void {
	const asc = fighter.getUniqueComponent(AbilitySystemComponent);
	for (let i = 0; i < ALL_BLUEPRINTS.length; i++) {
		asc.revokeAbility(ALL_BLUEPRINTS[i]!.id);
	}
	for (let i = 0; i < ALL_BLUEPRINTS.length; i++) {
		asc.grantBlueprint(ALL_BLUEPRINTS[i]!, fighterActions);
	}
}

export function getCoreAbilityId(name: keyof typeof FIGHTER_CORE_ABILITY_IDS): AbilityId {
	return FIGHTER_CORE_ABILITY_IDS[name];
}

function createAttackBlueprint(attack: Exclude<AttackType, 'flyingkick'>): AbilityBlueprint {
	const id = abilityIdForAttack(attack);
	return abilityBlueprint({
		id,
		blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		activation: [
			{ kind: 'call.action', action: 'fighter.beginAttack', params: { attackType: literal(attack) } },
			{ kind: 'emit.gameplay', event: 'fighter.attack.started', payload: { id: literal(id), attackType: literal(attack) } },
			{ kind: 'wait.event', event: `fighter.attack.animation.${attack}.finished`, scope: { kind: 'self' } },
			{ kind: 'call.action', action: 'fighter.completeAttack', params: { attackType: literal(attack) } },
			{ kind: 'emit.gameplay', event: 'fighter.attack.completed', payload: { id: literal(id), attackType: literal(attack) } },
		],
		onCancel: [
			{ kind: 'call.action', action: 'fighter.cancelAttack', params: { attackType: literal(attack) } },
		],
	});
}

function createFlyingKickBlueprint(): AbilityBlueprint {
	const attack: AttackType = 'flyingkick';
	const id = abilityIdForAttack(attack);
	return abilityBlueprint({
		id,
		requiredTags: ['state.airborne'],
		blockedTags: ['state.attacking', 'state.airborne.attackUsed', 'state.combat_disabled'],
		activation: [
			{ kind: 'call.action', action: 'fighter.beginAttack', params: { attackType: literal(attack) } },
			{ kind: 'call.action', action: 'fighter.noteFlyingKickSpent' },
			{ kind: 'emit.gameplay', event: 'fighter.attack.started', payload: { id: literal(id), attackType: literal(attack) } },
			{ kind: 'wait.event', event: 'fighter.attack.animation.flyingkick.finished', scope: { kind: 'self' } },
			{ kind: 'call.action', action: 'fighter.completeAttack', params: { attackType: literal(attack) } },
			{ kind: 'mode.dispatch', event: 'flyingkick_end' },
			{ kind: 'emit.gameplay', event: 'fighter.attack.completed', payload: { id: literal(id), attackType: literal(attack) } },
		],
		onCancel: [
			{ kind: 'call.action', action: 'fighter.cancelAttack', params: { attackType: literal(attack) } },
			{ kind: 'call.action', action: 'fighter.clearFlyingKickSpent' },
		],
		onComplete: [
			{ kind: 'call.action', action: 'fighter.clearFlyingKickSpent' },
		],
	});
}

function asFighter(owner: WorldObject): Fighter {
	if (owner instanceof Fighter) return owner;
	const id = owner ? owner.id : '<unknown>';
	throw new Error(`[ella2023/abilities] Ability owner '${id}' is not a Fighter.`);
}

function isDirection(value: unknown): value is Direction {
	return value === 'left' || value === 'right';
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
	if (!source) return undefined;
	const value = source[key];
	return typeof value === 'string' ? value : undefined;
}

function resolveAttackType(params: Record<string, unknown> | undefined, vars: Record<string, unknown>): AttackType {
	const candidate = readString(params, 'attackType');
	if (candidate && ATTACK_TYPE_SET.has(candidate)) return candidate as AttackType;
	const fromVars = vars[VAR_ATTACK_CURRENT];
	if (typeof fromVars === 'string' && ATTACK_TYPE_SET.has(fromVars)) return fromVars as AttackType;
	throw new Error('[ella2023/abilities] Missing or invalid attackType for fighter ability.');
}

function abilityIdForAttack(attack: AttackType): AbilityId {
	return `fighter.attack.${attack}` as AbilityId;
}
