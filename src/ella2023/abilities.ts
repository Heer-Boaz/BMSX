import { $ } from 'bmsx';
import { Ability, AbilityContext, AbilityCoroutine, AbilityId, AbilitySpec } from 'bmsx/gas/gastypes';
import { Fighter } from './fighter';
import { EilaEventService } from './worldmodule';
import type { AttackType } from './fighter';

const ATTACK_FINISH_EVENT = (attackType: AttackType) => `fighter.attack.animation.${attackType}.finished`;

function abilityIdForAttack(attackType: AttackType): AbilityId {
	return `fighter.attack.${attackType}` as AbilityId;
}

abstract class BaseFighterAbility implements Ability {
	public abstract readonly id: AbilityId;
	protected constructor(protected readonly fighter: Fighter) { }
	public canActivate(_ctx: AbilityContext): boolean {
		return this.fighter?.isFighting ?? false;
	}
	public abstract activate(ctx: AbilityContext): AbilityCoroutine;
}

class FighterAttackAbility extends BaseFighterAbility {
	public readonly id: AbilityId;
	public constructor(fighter: Fighter, private readonly attackType: AttackType, id: AbilityId) {
		super(fighter);
		this.id = id;
	}

	public override canActivate(ctx: AbilityContext): boolean {
		if (!super.canActivate(ctx)) return false;
		if (this.fighter.attacking) return false;
		return true;
	}

	public *activate(ctx: AbilityContext): AbilityCoroutine {
		const fighter = this.fighter;
		const attackType = this.attackType as AttackType;
		fighter.startAttack(attackType);
		if (!fighter.performingStoerheidsdans) {
			fighter.sc.dispatch_event('go_attack', fighter, { attackType });
		}
		fighter.sc.dispatch_event(`animate_${this.attackType}`, fighter);
		const opponent = $.get<EilaEventService>('eila_events')?.theOtherFighter(fighter) ?? null;
		fighter.doAttackFlow(this.attackType, opponent);
		ctx.emit?.('fighter.attack.started', { id: this.id, attackType: this.attackType });
		yield { type: 'waitEvent', name: ATTACK_FINISH_EVENT(this.attackType), scope: 'self' };
		fighter.finishAttack(attackType);
		if (!fighter.performingStoerheidsdans && attackType !== 'flyingkick') {
			fighter.sc.dispatch_event('go_idle', fighter);
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
		this.fighter.sc.dispatch_event('animate_jump', this.fighter);
		this.fighter.sc.dispatch_event('flyingkick_end', this.fighter);
	}
}

const ABILITY_SPECS: Record<AbilityId, AbilitySpec> = {
	'fighter.attack.punch': {
		id: 'fighter.attack.punch',
		blockedTags: ['state.attacking', 'state.airborne'],
	},
	'fighter.attack.highkick': {
		id: 'fighter.attack.highkick',
		blockedTags: ['state.attacking', 'state.airborne'],
	},
	'fighter.attack.lowkick': {
		id: 'fighter.attack.lowkick',
		blockedTags: ['state.attacking', 'state.airborne'],
	},
	'fighter.attack.duckkick': {
		id: 'fighter.attack.duckkick',
		blockedTags: ['state.attacking', 'state.airborne'],
	},
	'fighter.attack.flyingkick': {
		id: 'fighter.attack.flyingkick',
		blockedTags: ['state.attacking'],
		requiredTags: ['state.airborne'],
	},
};

export const FIGHTER_ATTACK_ABILITY_IDS = Object.keys(ABILITY_SPECS) as AbilityId[];

export function registerFighterAbilities(fighter: Fighter): void {
	const asc = fighter.getAbilitySystem();
	if (!asc) return;

	for (const id of FIGHTER_ATTACK_ABILITY_IDS) {
		asc.revokeAbility(id);
	}

	asc.grantAbility(ABILITY_SPECS['fighter.attack.punch'], () => new FighterAttackAbility(fighter, 'punch', abilityIdForAttack('punch')));
	asc.grantAbility(ABILITY_SPECS['fighter.attack.highkick'], () => new FighterAttackAbility(fighter, 'highkick', abilityIdForAttack('highkick')));
	asc.grantAbility(ABILITY_SPECS['fighter.attack.lowkick'], () => new FighterAttackAbility(fighter, 'lowkick', abilityIdForAttack('lowkick')));
	asc.grantAbility(ABILITY_SPECS['fighter.attack.duckkick'], () => new FighterAttackAbility(fighter, 'duckkick', abilityIdForAttack('duckkick')));
	asc.grantAbility(ABILITY_SPECS['fighter.attack.flyingkick'], () => new FighterFlyingKickAbility(fighter, abilityIdForAttack('flyingkick')));

	fighter.addGameplayTag('state.grounded');
	fighter.removeGameplayTag('state.airborne');
	fighter.removeGameplayTag('state.attacking');
}
