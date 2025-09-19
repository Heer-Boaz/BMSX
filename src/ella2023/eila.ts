import { $, Component, WorldObjectEventPayloads, ScreenBoundaryComponent, assign_fsm, attach_components, insavegame, subscribesToParentScopedEvent, type ComponentAttachOptions, type Identifier, type RevivableObjectArgs, type vec3 } from 'bmsx';
import { Fighter } from './fighter';
import { BitmapId } from './resourceids';
import { EILA_START_HP } from './gameconstants';
import { EilaEventService } from './worldmodule';
import { FighterAttackAbility } from './combatabilities';

export type EilaAttackType = 'punch' | 'lowkick' | 'highkick' | 'duckkick' | 'flyingkick';

@insavegame
export class JumpingWhileLeavingScreenComponent extends Component {
	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.enabled = false;
	}

	@subscribesToParentScopedEvent('leavingScreen')
	public onLeavingScreen(_event_name: string, emitter: Eila, { d }: WorldObjectEventPayloads['leavingScreen']) {
		emitter.facing = d === 'left' ? 'right' : 'left';
	}
}

@insavegame
@assign_fsm('player_animation', 'player_control')
@attach_components(ScreenBoundaryComponent, JumpingWhileLeavingScreenComponent)
export class Eila extends Fighter {
	public static readonly CONTROL_FSM_ID = 'player_control';
	public readonly animSprites: Record<string, BitmapId> = {
		idle: BitmapId.eila_idle,
		walk: BitmapId.eila_walk,
		walk_alt: BitmapId.eila_idle,
		highkick: BitmapId.eila_highkick,
		lowkick: BitmapId.eila_lowkick,
		punch: BitmapId.eila_punch,
		duckkick: BitmapId.eila_duckkick,
		flyingkick: BitmapId.eila_flyingkick,
		duck: BitmapId.eila_duck,
		jump: BitmapId.eila_jump,
		humiliated: BitmapId.eila_humiliated,
	};
	public readonly humiliatedCharacterId: string = 'eila';

	protected abilitiesRegistered = false;
	public walkDirection: 'left' | 'right' | null = null;
	public jumpDirection: 'left' | 'right' | null = null;

	constructor(opts?: RevivableObjectArgs & { id?: Identifier }) {
		super({ ...opts ?? {}, id: opts?.id ?? 'player' });
		this.hp = EILA_START_HP;
	}

	override onspawn(spawningPos?: vec3): void {
		super.onspawn(spawningPos);
		this.registerAbilities();
		this.walkDirection = null;
		this.jumpDirection = null;
	}

	protected registerAbilities(): void {
		if (this.abilitiesRegistered) return;
		const asc = this.abilitySystem;
		asc.grantAbility({ id: 'fighter.attack.punch', unique: 'restart', blockedTags: ['combat.attack.active'] },
			() => new FighterAttackAbility({ id: 'fighter.attack.punch', attackType: 'punch', waitEventName: 'fighter.attack.animation.punch.finished' }));
		asc.grantAbility({ id: 'fighter.attack.highkick', unique: 'restart', blockedTags: ['combat.attack.active'] },
			() => new FighterAttackAbility({ id: 'fighter.attack.highkick', attackType: 'highkick', waitEventName: 'fighter.attack.animation.highkick.finished' }));
		asc.grantAbility({ id: 'fighter.attack.lowkick', unique: 'restart', blockedTags: ['combat.attack.active'] },
			() => new FighterAttackAbility({ id: 'fighter.attack.lowkick', attackType: 'lowkick', waitEventName: 'fighter.attack.animation.lowkick.finished' }));
		asc.grantAbility({ id: 'fighter.attack.duckkick', unique: 'restart', requiredTags: ['fighter.state.ducking'], blockedTags: ['combat.attack.active'] },
			() => new FighterAttackAbility({ id: 'fighter.attack.duckkick', attackType: 'duckkick', waitEventName: 'fighter.attack.animation.duckkick.finished' }));
		asc.grantAbility({ id: 'fighter.attack.flyingkick', unique: 'ignore', requiredTags: ['fighter.state.jumping'], blockedTags: ['combat.attack.active'] },
			() => new FighterAttackAbility({ id: 'fighter.attack.flyingkick', attackType: 'flyingkick', waitEventName: 'fighter.attack.animation.flyingkick.finished', canActivate: f => !f.attacked_while_jumping }));
		this.abilitiesRegistered = true;
	}

	public override getCombatOpponent(): Fighter | null {
		const svc = $.get<EilaEventService>('eila_events');
		return svc?.theOtherFighter(this) ?? null;
	}
}
