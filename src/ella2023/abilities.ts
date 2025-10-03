import { GameplayCommandBuffer } from 'bmsx/ecs/gameplay_command_buffer';
import { Ability, AbilityContext, AbilityCoroutine, AbilityId, AbilitySpec } from 'bmsx/gas/gastypes';
import { Fighter, FIGHTER_CORE_ABILITY_IDS } from './fighter';
import type { AttackType, FighterCoreAbilityName } from './fighter';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';

const ATTACK_FINISH_EVENT = (attackType: AttackType) => `fighter.attack.animation.${attackType}.finished`;

function abilityIdForAttack(attackType: AttackType): AbilityId {
	return `fighter.attack.${attackType}` as AbilityId;
}

type DirectionPayload = { dir?: 'left' | 'right' };

class FighterWalkAbility extends Ability {
	public constructor(private readonly fighter: Fighter) { super(FIGHTER_CORE_ABILITY_IDS.walk, 'ignore'); }

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		const intentPayload = (ctx.intent?.payload ?? {}) as DirectionPayload;
		const requestedDirection = intentPayload.dir;
		const direction: 'left' | 'right' = requestedDirection === 'left' || requestedDirection === 'right'
			? requestedDirection
			: (this.fighter.facing === 'left' || this.fighter.facing === 'right') ? this.fighter.facing : 'right';

		this.fighter.facing = direction;
		this.dispatchModeEvent(ctx, 'mode.locomotion.walk', { direction });

		let firstTick = true;
		while (true) {
			const asc = ctx.asc;
			const grounded = asc.hasTag('state.grounded');
			const combatDisabled = asc.hasTag('state.combat_disabled');
			const attacking = asc.hasTag('state.attacking');
			const ducking = asc.hasTag('state.ducking');
			if (!grounded || combatDisabled || attacking || ducking) break;

			const walking = asc.hasTag('state.walking');
			if (firstTick) {
				const controller = this.fighter.sc;
				const fighterControl = controller?.get_statemachine('fighter_control');
				const grounded = fighterControl?.states?.['_grounded'];
				console.warn('[debug] walk ability first tick', {
					fc: fighterControl?.currentid,
					fcChild: fighterControl?.states?.[fighterControl.currentid ?? '']?.currentid,
					fcInitial: fighterControl?.definition.initial,
					groundedInitial: grounded?.definition?.initial,
					walking,
				});
			}
			if (!walking && !firstTick) {
				console.warn('[debug] walk ability continuing without walking tag', {
					frame: ctx.asc.parentid,
				});
			}

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

class FighterWalkStopAbility extends Ability {
	public constructor() { super(FIGHTER_CORE_ABILITY_IDS.walk_stop, 'ignore'); }

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent(ctx, 'mode.locomotion.idle');
	}
}

class FighterDuckHoldAbility extends Ability {
	public constructor() { super(FIGHTER_CORE_ABILITY_IDS.duck_hold); }

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent(ctx, 'mode.control.duck');
	}
}

class FighterDuckReleaseAbility extends Ability {
	public constructor() { super(FIGHTER_CORE_ABILITY_IDS.duck_release); }

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		this.dispatchModeEvent(ctx, 'mode.locomotion.idle');
	}
}

class FighterJumpAbility extends Ability {
	public constructor(private readonly fighter: Fighter) { super(FIGHTER_CORE_ABILITY_IDS.jump); }

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		const payload = (ctx.intent?.payload ?? {}) as { direction?: 'left' | 'right' };
		const direction = payload.direction;
		if (direction === 'left' || direction === 'right') this.fighter.facing = direction;
		this.dispatchModeEvent(ctx, 'mode.control.jump', direction ? { direction } : undefined);
	}
}

class FighterAttackAbility extends Ability {
	protected readonly fighter: Fighter;
	protected readonly attackType: AttackType;

	public constructor(fighter: Fighter, attackType: AttackType, id: AbilityId) {
		super(id);
		this.fighter = fighter;
		this.attackType = attackType;
	}

	public override canActivate(ctx: AbilityContext): boolean {
		if (!super.canActivate(ctx)) return false;
		if (this.fighter.isAttacking) return false;
		return true;
	}

	public override *activate(ctx: AbilityContext): AbilityCoroutine {
		const fighter = this.fighter;
		const attackType = this.attackType;
		if (!fighter.performingStoerheidsdans) {
			this.dispatchModeEvent(ctx, 'mode.action.attack', { attackType });
		} else {
			fighter.performAttack(attackType);
		}
		ctx.emit?.('fighter.attack.started', { id: this.id, attackType });
		yield { type: 'waitEvent', name: ATTACK_FINISH_EVENT(attackType), scope: 'self' };
		if (fighter.performingStoerheidsdans) {
			fighter.completeAttack(attackType);
		} else if (attackType !== 'flyingkick') {
			this.dispatchModeEvent(ctx, 'mode.action.complete', { attackType });
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
		this.dispatchModeEvent(ctx, 'flyingkick_end');
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
		factory: _fighter => new FighterWalkStopAbility(),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.duck_hold,
			requiredTags: ['state.grounded'],
			blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
		},
		factory: _fighter => new FighterDuckHoldAbility(),
	},
	{
		spec: {
			id: FIGHTER_CORE_ABILITY_IDS.duck_release,
			requiredTags: ['state.ducking'],
		},
		factory: _fighter => new FighterDuckReleaseAbility(),
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
	const asc = fighter.getUniqueComponent(AbilitySystemComponent);

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
