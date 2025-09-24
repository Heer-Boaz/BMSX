import { GameplayCommandBuffer } from 'bmsx/ecs/gameplay_command_buffer';
import { Ability, AbilityContext, AbilityCoroutine, AbilityId, AbilitySpec } from 'bmsx/gas/gastypes';
import { Fighter, FIGHTER_CORE_ABILITY_IDS } from './fighter';
import type { AttackType, FighterCoreAbilityName } from './fighter';

const ATTACK_FINISH_EVENT = (attackType: AttackType) => `fighter.attack.animation.${attackType}.finished`;

function abilityIdForAttack(attackType: AttackType): AbilityId {
	return `fighter.attack.${attackType}` as AbilityId;
}

type DirectionPayload = { dir?: 'left' | 'right' };

abstract class BaseFighterAbility implements Ability {
	public abstract readonly id: AbilityId;
	protected constructor(protected readonly fighter: Fighter) { }
	public canActivate(_ctx: AbilityContext): boolean {
		return this.fighter?.isFighting ?? false;
	}
	protected dispatchModeEvent(event: string, payload?: unknown): void {
		GameplayCommandBuffer.instance.push({
			kind: 'dispatchEvent',
			target_id: this.fighter.id,
			emitter_id: this.fighter.id,
			event,
			payload,
		});
	}
	public abstract activate(ctx: AbilityContext): AbilityCoroutine;
}

class FighterWalkAbility extends BaseFighterAbility {
	public readonly id: AbilityId = FIGHTER_CORE_ABILITY_IDS.walk;

	public constructor(fighter: Fighter) {
		super(fighter);
	}

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		const intentPayload = (ctx.intent?.payload ?? {}) as DirectionPayload;
		const requestedDirection = intentPayload.dir;
		const direction: 'left' | 'right' = requestedDirection === 'left' || requestedDirection === 'right'
			? requestedDirection
			: (this.fighter.facing === 'left' || this.fighter.facing === 'right') ? this.fighter.facing : 'right';

		this.fighter.facing = direction;
		this.dispatchModeEvent('mode.locomotion.walk', { direction });

		let firstTick = true;
		while (true) {
			const asc = ctx.asc;
			const grounded = asc.hasTag('state.grounded');
			const combatDisabled = asc.hasTag('state.combat_disabled');
			const attacking = asc.hasTag('state.attacking');
			const ducking = asc.hasTag('state.ducking');
			if (!grounded || combatDisabled || attacking || ducking) break;

			const controller = this.fighter.sc;
			const stillWalking = controller?.matches_state_path('fighter_control:/_grounded/walk') ?? false;
			if (!stillWalking && !firstTick) break;

			const speed = this.fighter.walkSpeed ?? Fighter.SPEED;
			const deltaX = direction === 'right' ? speed : -speed;
			GameplayCommandBuffer.instance.push({
				kind: 'moveby2d',
				target_id: this.fighter.id,
				delta: { x: deltaX, y: 0, z: 0 },
				space: 'world',
			});

			firstTick = false;
			yield;
		}
	}
}

class FighterWalkStopAbility extends BaseFighterAbility {
	public readonly id: AbilityId = FIGHTER_CORE_ABILITY_IDS.walk_stop;

	public constructor(fighter: Fighter) {
		super(fighter);
	}

	public override *activate(_ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent('mode.locomotion.idle');
	}
}

class FighterDuckHoldAbility extends BaseFighterAbility {
	public readonly id: AbilityId = FIGHTER_CORE_ABILITY_IDS.duck_hold;

	public constructor(fighter: Fighter) {
		super(fighter);
	}

	public override *activate(_ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent('mode.control.duck');
	}
}

class FighterDuckReleaseAbility extends BaseFighterAbility {
	public readonly id: AbilityId = FIGHTER_CORE_ABILITY_IDS.duck_release;

	public constructor(fighter: Fighter) {
		super(fighter);
	}

	public override *activate(_ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent('mode.locomotion.idle');
	}
}

class FighterJumpAbility extends BaseFighterAbility {
	public readonly id: AbilityId = FIGHTER_CORE_ABILITY_IDS.jump;

	public constructor(fighter: Fighter) {
		super(fighter);
	}

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		const payload = (ctx.intent?.payload ?? {}) as { direction?: 'left' | 'right' };
		const direction = payload.direction;
		if (direction === 'left' || direction === 'right') this.fighter.facing = direction;
		this.dispatchModeEvent('mode.control.jump', direction ? { direction } : undefined);
	}
}

class FighterAttackAbility extends BaseFighterAbility {
	public readonly id: AbilityId;
	public constructor(fighter: Fighter, private readonly attackType: AttackType, id: AbilityId) {
		super(fighter);
		this.id = id;
	}

	public override canActivate(ctx: AbilityContext): boolean {
		if (!super.canActivate(ctx)) return false;
		if (this.fighter.isAttacking) return false;
		return true;
	}

	public *activate(ctx: AbilityContext): AbilityCoroutine {
		const fighter = this.fighter;
		const attackType = this.attackType as AttackType;
		if (!fighter.performingStoerheidsdans) {
			this.dispatchModeEvent('mode.action.attack', { attackType });
		} else {
			fighter.performAttack(attackType);
		}
		ctx.emit?.('fighter.attack.started', { id: this.id, attackType: this.attackType });
		yield { type: 'waitEvent', name: ATTACK_FINISH_EVENT(this.attackType), scope: 'self' };
		if (fighter.performingStoerheidsdans) {
			fighter.completeAttack(attackType);
		} else if (attackType !== 'flyingkick') {
			this.dispatchModeEvent('mode.action.complete', { attackType });
		}
		ctx.emit?.('fighter.attack.completed', { id: this.id, attackType });
	}
}

class FighterFlyingKickAbility extends FighterAttackAbility {
	public constructor(fighter: Fighter, id: AbilityId) {
		super(fighter, 'flyingkick', id);
	}

	public override canActivate(ctx: AbilityContext): boolean {
		if (!super.canActivate(ctx)) return false;
		if (!this.fighter.isJumping) return false;
		if (this.fighter.attacked_while_jumping) return false;
		return true;
	}

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		this.fighter.attacked_while_jumping = true;
		ctx.emit?.('fighter.attack.jumping', { id: this.id });
		yield* super.activate(ctx);
		this.dispatchModeEvent('flyingkick_end');
	}
}

type AbilityEntry = { spec: AbilitySpec; factory: (fighter: Fighter) => Ability };

const CORE_ABILITIES: AbilityEntry[] = [
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.walk,
			unique: 'restart',
			requiredTags: ['state.grounded'],
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterWalkAbility(fighter),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.walk_stop,
			unique: 'ignore',
		},
		factory: fighter => new FighterWalkStopAbility(fighter),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.duck_hold,
			requiredTags: ['state.grounded'],
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterDuckHoldAbility(fighter),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.duck_release,
			requiredTags: ['state.ducking'],
		},
		factory: fighter => new FighterDuckReleaseAbility(fighter),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.jump,
			requiredTags: ['state.grounded'],
			blockedTags: ['state.attacking', 'state.combat_disabled'],
		},
		factory: fighter => new FighterJumpAbility(fighter),
	},
];

const ATTACK_ABILITIES: AbilityEntry[] = [
	{
		spec: {
			id: abilityIdForAttack('punch'),
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterAttackAbility(fighter, 'punch', abilityIdForAttack('punch')),
	},
	{
		spec: {
			id: abilityIdForAttack('highkick'),
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterAttackAbility(fighter, 'highkick', abilityIdForAttack('highkick')),
	},
	{
		spec: {
			id: abilityIdForAttack('lowkick'),
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterAttackAbility(fighter, 'lowkick', abilityIdForAttack('lowkick')),
	},
	{
		spec: {
			id: abilityIdForAttack('duckkick'),
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: fighter => new FighterAttackAbility(fighter, 'duckkick', abilityIdForAttack('duckkick')),
	},
	{
		spec: {
			id: abilityIdForAttack('flyingkick'),
			blockedTags: ['state.attacking'],
			requiredTags: ['state.airborne'],
		},
		factory: fighter => new FighterFlyingKickAbility(fighter, abilityIdForAttack('flyingkick')),
	},
];

const ALL_ABILITIES: readonly AbilityEntry[] = [...CORE_ABILITIES, ...ATTACK_ABILITIES];

export const FIGHTER_ATTACK_ABILITY_IDS = ATTACK_ABILITIES.map(({ spec }) => spec.id);

function abilityIdsToRevoke(entries: readonly AbilityEntry[]): AbilityId[] {
	return entries.map(entry => entry.spec.id);
}

export function registerFighterAbilities(fighter: Fighter): void {
	const asc = fighter.getAbilitySystem();
	if (!asc) return;

	for (const id of abilityIdsToRevoke(ALL_ABILITIES)) {
		asc.revokeAbility(id);
	}

	for (const entry of ALL_ABILITIES) {
		asc.grantAbility(entry.spec, () => entry.factory(fighter));
	}
}

export function getCoreAbilityId(name: FighterCoreAbilityName): AbilityId {
	return FIGHTER_CORE_ABILITY_IDS[name];
}
