import { $, Component, WorldObjectEventPayloads, Identifier, ScreenBoundaryComponent, assign_fsm, attach_components, insavegame, subscribesToParentScopedEvent, State, type ComponentAttachOptions, type EventPayload, type RevivableObjectArgs, type Direction, GameplayCommandBuffer, V3 } from 'bmsx';
import { BitmapId } from './resourceids';
import { Fighter } from './fighter';
import { EILA_START_HP } from './gameconstants';
import { registerFighterAbilities } from './abilities';
import { EilaEventService } from './worldmodule';

export type EilaAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick' | 'duckkick';

type StoerheidsdansStateData = { expectedAnimation: string | null };
type JumpStateData = { direction: Direction };

@insavegame
export class JumpingWhileLeavingScreenComponent extends Component {
	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.enabled = false;
	}

	@subscribesToParentScopedEvent('leavingScreen')
	public onLeavingScreen(_event_name: string, emitter: Eila, { d }: WorldObjectEventPayloads['leavingScreen']): void {
		if (emitter.isJumping) {
			switch (d) {
				case 'left':
					emitter.updateJumpDirection('right');
					break;
				case 'right':
					emitter.updateJumpDirection('left');
					break;
			}
		}
	}
}

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

	override onspawn(spawningPos?: Parameters<Fighter['onspawn']>[0]): void {
		super.onspawn(spawningPos);
		registerFighterAbilities(this);
	}

	public onIdleEntered(): void {
		this.setAttackingState(false);
		this.attacked_while_jumping = false;
		this.setJumpingState(false);
	}

	public onWalkEntered(): void {
		this.setAttackingState(false);
	}

	public onDuckEntered(): void {
		this.setDuckingState(true);
		this.setAttackingState(false);
	}

	public onDuckExited(): void {
		this.setDuckingState(false);
	}

	public startJump({ state, payload }: { state: State; payload?: EventPayload & { direction?: Direction | null; directional?: boolean | string } }): void {
		const data = state.data as JumpStateData;
		let direction: Direction;
		if (payload) {
			if (payload.direction === 'left' || payload.direction === 'right') {
				direction = payload.direction;
			}
			else if (typeof payload.directional === 'string' && (payload.directional === 'left' || payload.directional === 'right')) {
				direction = payload.directional;
			}
			else if (payload.directional) {
				direction = this.facing;
			}
		}
		data.direction = direction;
		this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = true;
		this.setJumpingState(true);
		this.attacked_while_jumping = false;
	}

	public finishJump(): void {
		this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = false;
		this.setJumpingState(false);
		this.resetVerticalPosition();
		this.attacked_while_jumping = false;
	}

	public jumpAscendingTick(state: State): void {
		const data = state.data as JumpStateData;
		const dx = this.resolveJumpHorizontal(data);
		GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: this.id, delta: V3.of(dx, -Fighter.JUMP_SPEED, 0), space: 'world' });
	}

	public jumpDescendingTick(state: State): void {
		const data = state.data as JumpStateData;
		const dx = this.resolveJumpHorizontal(data);
		GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: this.id, delta: V3.of(dx, Fighter.JUMP_SPEED, 0), space: 'world' });
	}

	public canStartFlyingKick(): boolean {
		return this.isJumping && !this.attacked_while_jumping;
	}

	public onFlyingKickEntered(): void {
		this.startAttack('flyingkick');
		this.attacked_while_jumping = true;
	}

	public onFlyingKickExited(): void {
		this.finishAttack('flyingkick');
	}

	public updateJumpDirection(direction: 'left' | 'right'): void {
		const controller = this.sc;
		if (!controller?.get_statemachine) return;
		const machine = controller.get_statemachine('fighter_control');
		const airborne = machine?.states?.['airborne'];
		const jump = airborne?.states?.['_jump'];
		if (!jump) return;
		const data = jump.data as JumpStateData;
		data.direction = direction;
	}

	private resolveJumpHorizontal(data: JumpStateData): number {
		const dir = data.direction ?? this.facing ?? 'right';
		if (dir === 'left') return -this.walkSpeed;
		if (dir === 'right') return this.walkSpeed;
		return 0;
	}

	public enterStoerheidsdans(state: State): void {
		this.performingStoerheidsdans = true;
		this.setFightingState(false);
		this.resetVerticalPosition();
		$.emitPresentation('animate_idle', this);
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = null;
		state.ticks += 1;
	}

	public handleStoerAnimationEnd({ state, payload }: { state: State; payload?: EventPayload & { animation_name?: string } }): void {
		if (!payload?.animation_name) return;
		const data = state.data as StoerheidsdansStateData;
		if (data.expectedAnimation !== payload.animation_name) return;
		data.expectedAnimation = null;
		this.completeAttack(payload.animation_name as EilaAttackType);
		state.ticks += 1;
	}

	public handleStoerTapeNext({ state, payload }: { state: State; payload: EventPayload & { tape_rewound: boolean } }): void {
		if (payload.tape_rewound) return;
		const nextAnimation = state.current_tape_value;
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = typeof nextAnimation === 'string' ? nextAnimation : null;
		this.facing = this.facing === 'left' ? 'right' : 'left';
		if (typeof nextAnimation === 'string') {
			const attack = nextAnimation as EilaAttackType;
			if (!this.requestAbility(this.getAttackAbilityId(attack), { attackType: attack })) {
				this.performAttack(attack);
			}
		}
	}

	public completeStoerheidsdans(state: State): string {
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = null;
		this.facing = this.facing === 'left' ? 'right' : 'left';
		this.performingStoerheidsdans = false;
		return '/_nagenieten';
	}

	public startNagenieten(): void {
		this.setFightingState(false);
		$.emitPresentation('animate_idle', this);
	}

	public enterHumiliated(): void {
		this.hittable = false;
		this.setFightingState(false);
		this.resetVerticalPosition();
		this.setAttackingState(false);
		this.setJumpingState(false);
		this.setDuckingState(false);
	}

	public exitHumiliated(): void {
		this.hittable = true;
		this.setFightingState(true);
		this.setJumpingState(false);
		this.setDuckingState(false);
		this.setAttackingState(false);
	}

	protected override getAttackOpponent(): Fighter | null {
		return $.get<EilaEventService>('eila_events')?.theOtherFighter(this) ?? null;
	}
}
