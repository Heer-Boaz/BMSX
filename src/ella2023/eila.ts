import { $, Identifier, ScreenBoundaryComponent, assign_fsm, attach_components, insavegame, type RevivableObjectArgs } from 'bmsx';
import { BitmapId } from './resourceids';
import { Fighter, JumpingWhileLeavingScreenComponent } from './fighter';
import { EILA_START_HP } from './gameconstants';
import { EilaEventService } from './worldmodule';
import { registerFighterAbilities } from './abilities';

@insavegame
@assign_fsm('fighter_control', 'player_animation')
@attach_components(ScreenBoundaryComponent, JumpingWhileLeavingScreenComponent)
export class Eila extends Fighter {
	public static readonly ANIMATION_FSM_ID = 'player_animation';

	public readonly animSprites = {
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

	public readonly humiliatedCharacterId = 'eila';

	constructor(opts?: RevivableObjectArgs & { id?: Identifier }) {
		super({ ...opts ?? {}, id: opts?.id ?? 'player' });
		this.hp = EILA_START_HP;
	}

	public override activate(): void {
		super.activate();
		registerFighterAbilities(this);
	}

	public override getAttackOpponent(): Fighter | null {
		return $.get<EilaEventService>('eila_events')?.theOtherFighter(this) ?? null;
	}
}
