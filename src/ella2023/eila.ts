import { $, Component, WorldObjectEventPayloads, Identifier, ScreenBoundaryComponent, assign_fsm, attach_components, insavegame, subscribesToParentScopedEvent, State, type ComponentAttachOptions, type EventPayload, type RevivableObjectArgs, type Direction, GameplayCommandBuffer, V3 } from 'bmsx';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';
import { BitmapId } from './resourceids';
import { Fighter } from './fighter';
import { EILA_START_HP } from './gameconstants';
import { EilaEventService } from './worldmodule';
import { registerFighterAbilities } from './abilities';

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

	public override activate(): void {
		super.activate();
		registerFighterAbilities(this);
	}

	override onspawn(spawningPos?: Parameters<Fighter['onspawn']>[0]): void {
		super.onspawn(spawningPos);
	}

	public startJump(state?: State, payload?: EventPayload & { direction?: Direction | null; directional?: boolean | string }): void {
		if (!state) throw new Error('[Eila] startJump invoked without state context.');
		const data = state.data as JumpStateData;
		let direction: Direction;
		if (payload.direction === 'left' || payload.direction === 'right') {
			direction = payload.direction;
		}
		else if (typeof payload.directional === 'string' && (payload.directional === 'left' || payload.directional === 'right')) {
			direction = payload.directional;
		}
		else if (payload.directional) {
			direction = this.facing;
		}
		data.direction = direction;
		this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = true;
	}

	public finishJump(): void {
		this.getUniqueComponent(JumpingWhileLeavingScreenComponent).enabled = false;
		this.resetVerticalPosition();
	}

	public jumpAscendingTick(state?: State): void {
		if (!state) throw new Error('[Eila] jumpAscendingTick invoked without state context.');
		const data = state.data as JumpStateData;
		const dx = this.resolveJumpHorizontal(data);
		GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: this.id, delta: V3.of(dx, -Fighter.JUMP_SPEED, 0), space: 'world' });
	}

	public jumpDescendingTick(state?: State): void {
		if (!state) throw new Error('[Eila] jumpDescendingTick invoked without state context.');
		const data = state.data as JumpStateData;
		const dx = this.resolveJumpHorizontal(data);
		GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: this.id, delta: V3.of(dx, Fighter.JUMP_SPEED, 0), space: 'world' });
	}

	public canStartFlyingKick(): boolean {
		const asc = this.getUniqueComponent(AbilitySystemComponent);
		return this.isJumping && !asc.hasGameplayTag('state.airborne.attackUsed');
	}

	public onFlyingKickEntered(): void {
		this.startAttack(undefined, { attackType: 'flyingkick' });
	}

	public onFlyingKickExited(): void {
		this.finishAttack(undefined, { attackType: 'flyingkick' });
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

	public enterStoerheidsdans(state?: State): void {
		if (!state) throw new Error('[Eila] enterStoerheidsdans invoked without state context.');
		this.performingStoerheidsdans = true;
		this.resetVerticalPosition();
		$.emitPresentation('animate_idle', this);
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = null;
		state.ticks += 1;
	}

	public handleStoerAnimationEnd(state?: State, payload?: EventPayload & { animation_name?: string }): void {
		if (!state || !payload?.animation_name) return;
		const data = state.data as StoerheidsdansStateData;
		if (data.expectedAnimation !== payload.animation_name) return;
		data.expectedAnimation = null;
		this.completeAttack(payload.animation_name as EilaAttackType);
		state.ticks += 1;
	}

	public handleStoerTapeNext(state?: State, payload?: EventPayload & { tape_rewound: boolean }): void {
		if (!state || payload?.tape_rewound) return;
		const nextAnimation = state.current_tape_value;
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = typeof nextAnimation === 'string' ? nextAnimation : null;
		this.facing = this.facing === 'left' ? 'right' : 'left';
		if (typeof nextAnimation === 'string') {
			const attack = nextAnimation as EilaAttackType;
			this.sc.dispatch_event('mode.action.attack', this, { attackType: attack });
		}
	}

	public completeStoerheidsdans(state?: State): string {
		if (!state) throw new Error('[Eila] completeStoerheidsdans invoked without state context.');
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = null;
		this.facing = this.facing === 'left' ? 'right' : 'left';
		this.performingStoerheidsdans = false;
		return '/_nagenieten';
	}

	public startNagenieten(): void {
		$.emitPresentation('animate_idle', this);
	}

	public enterHumiliated(): void {
		this.hittable = false;
		this.resetVerticalPosition();
	}

	public exitHumiliated(): void {
		this.hittable = true;
	}

	protected override getAttackOpponent(): Fighter | null {
		return $.get<EilaEventService>('eila_events')?.theOtherFighter(this) ?? null;
	}
}
