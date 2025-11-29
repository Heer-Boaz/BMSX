import { $, assign_fsm, build_fsm, Identifier, insavegame, new_area, ProhibitLeavingScreenComponent, SpriteObject, State, StateMachineBlueprint, vec3, Collision2DSystem, type RevivableObjectArgs, type vec2, type Direction, type EventPayload, Component, type ComponentAttachOptions, type WorldObjectEventPayloads, type TimelineFrameEventPayload, type TimelineEndEventPayload, attach_components } from 'bmsx';
import { create_gameevent, type GameEvent } from 'bmsx/core/game_event';
import { FIGHTER_TIMELINES } from './fighter_fsms';
import { SpriteComponent } from 'bmsx/component/sprite_component';
import { VERTICAL_POSITION_FIGHTERS } from './gameconstants';
import { BitmapId } from './resourceids';
import type { Eila } from './eila';
import {
	FIGHTER_ATTACK_ABILITY_IDS,
	FIGHTER_CORE_ABILITY_IDS,
	type FighterAbilityId,
	type FighterAttackAbilityId,
	type FighterAttackType,
	type FighterCoreAbilityName,
} from './ability_catalog';
export { FIGHTER_ATTACK_ABILITY_IDS, FIGHTER_CORE_ABILITY_IDS } from './ability_catalog';
export type { FighterCoreAbilityName } from './ability_catalog';

type StoerheidsdansStateData = { expectedAnimation: string | null };
type JumpStateData = { direction: Direction };

export type AttackType = FighterAttackType;


export type HitMarkerType = 'player_hit' | 'enemy_hit' | 'poef';

export type HitMarkerInfo = {
	type: HitMarkerType,
	pos: vec2, // Offset from the fighter's position
};

function getDamage(attackType: AttackType): number {
	switch (attackType) {
		default:
			return 10;
	}
}

@insavegame
@attach_components(ProhibitLeavingScreenComponent)
@assign_fsm('hitanimation')
export abstract class Fighter extends SpriteObject {
	public static readonly ATTACK_DURATION = 15;
	public static readonly JUMP_SPEED = 2;
	public static readonly JUMP_DURATION = 60;
	public static readonly SPEED = 2;
	public _aied: boolean = false;
	public get isAIed(): boolean { return this._aied; }
	public previousAttackType: AttackType | null = null;
	public currentAttackType: AttackType | null = null;
	public pendingWalkDirection?: Direction;
	public pendingAttackPayload?: { attackType?: AttackType };
	public pendingJumpPayload?: { direction?: Direction | null; directional?: boolean | string };
	private _activeAnimationTimeline?: string;
	private readonly stateTags: Set<string> = new Set();
	private readonly tagFacade = {
		add_tags: (...tags: string[]) => this.addTags(...tags),
		remove_tags: (...tags: string[]) => this.removeTags(...tags),
		has_gameplay_tag: (tag: string) => this.hasTag(tag),
	};

	public get isAttacking(): boolean { return this.stateTags.has('state.attacking'); }
	public get isJumping(): boolean { return this.stateTags.has('state.airborne'); }
	public get isDucking(): boolean { return this.stateTags.has('state.ducking'); }
	public get isFighting(): boolean { return !this.stateTags.has('state.combat_disabled'); }
	public get hasUsedAirborneAttack(): boolean { return this.stateTags.has('state.airborne.attackUsed'); }
	public get abilitysystem(): typeof this.tagFacade { return this.tagFacade; }

	public addTags(...tags: string[]): void {
		for (const tag of tags) this.stateTags.add(tag);
	}

	public removeTags(...tags: string[]): void {
		for (const tag of tags) this.stateTags.delete(tag);
	}

	public hasTag(tag: string): boolean {
		return this.stateTags.has(tag);
	}

	public applyWalkFacing(_state: State | undefined, payload: { direction?: Direction } | undefined): void {
		if (!payload) return;
		const { direction } = payload;
		if (direction === 'left' || direction === 'right') this.facing = direction;
	}

	protected play_animation_timeline(id: string): void {
		this._activeAnimationTimeline = id;
		this.play_timeline(id);
	}

	protected handle_animation_timeline_end(id: string): void {
		if (this._activeAnimationTimeline === id) {
			this._activeAnimationTimeline = undefined;
		}
	}

	public skip_animation_to_end(): void {
		const id = this._activeAnimationTimeline;
		if (!id) return;
		const timeline = this.get_timeline(id)!;
		this.seek_timeline(id, Math.max(0, timeline.length - 1));
	}

	@build_fsm('hitanimation')
	static bouw_hitanimation_fsm(): StateMachineBlueprint {
		return {
			is_concurrent: true,
			states: {
				_geen_au: {
				},
				doet_au: {
					entering_state(this: Fighter) {
						this.sc.pause_all_except('hitanimation');
					},
					exiting_state(this: Fighter) {
						this.sc.resume_all_statemachines();
						// No emit here, because the player that was hit needs to be able to recuperate from the hit first, so that the attacking player can't hit them again immediately.
					},
				},
				wel_au: {
					entering_state(this: Fighter) {
						this.sc.pause_all_except('hitanimation');
						this.play_timeline('fighter.hitanimation');
					},
					on: {
						['timeline.frame.fighter.hitanimation']: {
							do(this: Fighter, _state: State, event: GameEvent<'timeline.frame', TimelineFrameEventPayload<number>>) {
								const delta = typeof event.frame_value === 'number' ? event.frame_value : 0;
								this.x_nonotify += delta;
							},
						},
						['timeline.end.fighter.hitanimation']: {
							do(this: Fighter, _state: State, _event: GameEvent<'timeline.end', TimelineEndEventPayload>) {
								this.sc.transition_to('hitanimation:/geen_au');
							},
						},
					},
					exiting_state(this: Fighter) {
						this.sc.resume_all_statemachines();
						$.emit_gameplay('i_was_hit', this, { fighter: this }); // Allow the player to recuperate from the hit quickly.
						$.emit_gameplay('hit_animation_end', this, { fighter: this }); // The Game Model will handle the hit animation end event, which will hide the hit marker and determine if the fighter is down.
					},
				},
			}
		};
	}

	protected currentHitMarker: HitMarkerInfo;
	public override set facing(v: Direction) {
		this._facing = v;
		// Drive sprite horizontal flip from facing. Default art faces left; mirror when facing right.
		this.flip_h = (v !== 'left');
	}
	public hp: number;

	public performingStoerheidsdans!: boolean;
	public readonly walkSpeed: number = Fighter.SPEED;

	constructor(opts: RevivableObjectArgs & { id: Identifier; fsm_id?: Identifier; facing?: 'left' | 'right'; playerIndex?: number }) {
		super(opts);
		for (const definition of FIGHTER_TIMELINES) {
			this.define_timeline(definition);
		}
		this.getOrCreateCollider().setLocalArea(new_area(0, 0, 0, 0)); // Default; updated via sprite metadata when set
		this.facing = opts.facing ?? 'right';
		this.currentHitMarker = null;
		this.player_index = opts.playerIndex ?? 1;
		// No producers; base sprite handled by SpriteComponent via SpriteRenderSystem
	}

	public override activate(): void {
		super.activate();
		// Seed locomotion and animation so tags and sprites are valid on the first frame.
		const locomotion = create_gameevent({ type: 'mode.locomotion.idle', emitter: this });
		this.sc.dispatch_event(locomotion);
		const animateIdle = create_gameevent({ type: 'animate_idle', emitter: this });
		this.sc.dispatch_event(animateIdle);
	}

	public getAbilityId<Name extends FighterCoreAbilityName>(name: Name): typeof FIGHTER_CORE_ABILITY_IDS[Name] {
		return FIGHTER_CORE_ABILITY_IDS[name];
	}

	public requestAbility(abilityId: FighterAbilityId, payload?: Record<string, unknown>): boolean {
		const event = create_gameevent({ type: `effect.${abilityId}`, emitter: this, ...(payload ?? {}) });
		this.sc.dispatch_event(event);
		return true;
	}

	public tryActivateAttackAbility(attackType: AttackType): boolean {
		const abilityId = this.getAttackAbilityId(attackType);
		const event = create_gameevent({ type: `effect.${abilityId}`, emitter: this, attackType });
		this.sc.dispatch_event(event);
		return true;
	}

	public canActivateAttackAbility(_attackType: AttackType): boolean {
		return true;
	}

	public getAttackAbilityId(attackType: AttackType): FighterAttackAbilityId {
		return FIGHTER_ATTACK_ABILITY_IDS[attackType];
	}

	public startAttack(_state: State, payload?: { attackType?: AttackType }): void {
		if (!payload) {
			throw new Error('[Fighter] startAttack invoked without payload.');
		}
		const attackType = payload.attackType;
		if (!attackType) {
			throw new Error('[Fighter] startAttack invoked without attack type.');
		}
		this.currentAttackType = attackType;
		const attackEvent = create_gameevent({ type: `animate_${attackType}`, emitter: this });
		this.sc.dispatch_event(attackEvent);
	}

	public finishAttack(_state: State, payload?: { attackType?: AttackType }): void {
		let resolved: AttackType | null = null;
		if (payload && payload.attackType) {
			resolved = payload.attackType;
		} else if (this.currentAttackType) {
			resolved = this.currentAttackType;
		}
		if (resolved === null) {
			throw new Error('[Fighter] finishAttack invoked without attack type.');
		}
		this.previousAttackType = resolved;
		this.currentAttackType = null;
		this.hideHitMarker();
	}

	public doAttackFlow(attackType: AttackType, opponent: Fighter | null): boolean {
		if (!opponent) {
			$.apply_vibration_effect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: 0.5 });
			return false;
		}
		const hitVec2 = this.attackHitsOpponent(attackType, opponent);
		let hit: boolean = false;
		if (hitVec2) {
			this.handleHittingOpponent(attackType, opponent, hitVec2);
			opponent.handleBeingHit(attackType, this);
			$.apply_vibration_effect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: .6 });
			$.apply_vibration_effect(opponent.player_index, { effect: 'dual-rumble', duration: 100, intensity: 1 });
			hit = true;
		}
		else {
			$.apply_vibration_effect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: 0.5 });
		}
		return hit;
	}

	public completeAttack(attackType: AttackType): void {
		this.finishAttack(undefined, { attackType });
	}

	public getAttackOpponent(): Fighter | null {
		return null; // ERROR: to be implemented in subclasses
	}

	public attackHitsOpponent(attackType: AttackType, opponent: Fighter): vec2 | null {
		// Check if the fighter is facing the opponent
		const middlepoint = this.middlepoint;
		const opponentMiddlepoint = opponent.middlepoint;
		if (this.facing === 'left' && middlepoint.x < opponentMiddlepoint.x) { return null; }
		if (this.facing === 'right' && middlepoint.x > opponentMiddlepoint.x) { return null; }

		// Check if the attack is allowed to hit the opponent
		switch (attackType) {
			case 'highkick':
				if (opponent.isDucking) { return null; }
				break;
			case 'lowkick':
			case 'duckkick':
				if (opponent.isJumping) { return null; }
				break;
		}
		const centroid = Collision2DSystem.getCollisionCentroid(this, opponent);
		if (!centroid) return null;
		return { x: centroid[0], y: centroid[1] };
	}

	public handleHittingOpponent(attackType: AttackType, _opponent: Fighter, hitVec2: vec2) {
		const hitMarkerInfo = this.determineHitMarker(attackType, hitVec2);
		this.showHitMarker(hitMarkerInfo);
	}

	public handleBeingHit(attackType: AttackType, opponent: Fighter) {
		this.sc.transition_to('hitanimation:/wel_au');
		opponent.sc.transition_to('hitanimation:/doet_au');
		this.hp -= getDamage(attackType);
		const weaponClass = (attackType === 'punch') ? 'light' : 'heavy';
		$.emit_gameplay('combat.hit', this, { result: 'hit', weaponClass, actorId: opponent.id, targetId: this.id });
	}

	// queueRenderSubmissions removed; rendering handled by GenericRendererComponent producer

	override onspawn(spawningPos?: vec3): void {
		super.onspawn(spawningPos);
		this.performingStoerheidsdans = false;
		this.resetVerticalPosition();
	}

	public override ondespawn(): void {
		super.ondespawn();
	}

	public override dispose(): void {
		super.dispose();
	}

	public resetVerticalPosition(): void {
		this.y_nonotify = VERTICAL_POSITION_FIGHTERS - this.sy;
	}

	public walkTick(): void {
		let dx = 0;
		if (this.facing === 'left') dx = -this.walkSpeed;
		else if (this.facing === 'right') dx = this.walkSpeed;
		this.pos.x += dx;
	}

	private _hitSprite?: SpriteComponent;
	protected applyHitMarker(hitMarker: HitMarkerInfo | null): void {
		// Toggle a secondary SpriteComponent for the hit marker
		if (!hitMarker) {
			if (this._hitSprite) this._hitSprite.enabled = false;
			return;
		}
		if (!this._hitSprite) {
			this._hitSprite = new SpriteComponent({ parent_or_id: this });
			this.add_component(this._hitSprite);
			this._hitSprite.collider_local_id = null;
		}
		let imgid: string = BitmapId.poef;
		switch (hitMarker.type) {
			case 'player_hit': imgid = BitmapId.au_p1; break;
			case 'enemy_hit': imgid = BitmapId.au_p2; break;
		}
		this._hitSprite.imgid = imgid;
		// Convert world-space hit position to local offset relative to this object
		const dx = hitMarker.pos.x - this.x;
		const dy = hitMarker.pos.y - this.y;
		this._hitSprite.offset = { x: dx, y: dy, z: 100 };
		this._hitSprite.enabled = true;
	}

	determineHitMarker(_attackType: AttackType, hitVec2: vec2): HitMarkerInfo {
		return { type: (this.id === 'player') ? 'enemy_hit' : 'player_hit', pos: { ...hitVec2, z: this.z + 100 } };
	}

	showHitMarker(hitMarkerInfo: HitMarkerInfo) {
		this.currentHitMarker = hitMarkerInfo;
		this.applyHitMarker(hitMarkerInfo);
	}

	hideHitMarker() {
		this.currentHitMarker = null;
		this.applyHitMarker(null);
	}

	public startJump(state?: State, payload?: EventPayload & { direction?: Direction | null; directional?: boolean | string }): void {
		if (!state) throw new Error('[Eila] startJump invoked without state context.');
		const data = state.data as JumpStateData;
		data.direction = payload?.direction;
		this.get_unique_component(JumpingWhileLeavingScreenComponent).enabled = true;
	}

	public finishJump(): void {
		this.get_unique_component(JumpingWhileLeavingScreenComponent).enabled = false;
		this.resetVerticalPosition();
	}

	public jumpAscendingTick(state?: State): void {
		if (!state) throw new Error('[Eila] jumpAscendingTick invoked without state context.');
	}

	public jumpDescendingTick(state?: State): void {
		if (!state) throw new Error('[Eila] jumpDescendingTick invoked without state context.');
	}

	public canStartFlyingKick(): boolean {
		return this.isJumping && !this.stateTags.has('state.airborne.attackUsed');
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

	public enterStoerheidsdans(state?: State): void {
		if (!state) throw new Error('[Eila] enterStoerheidsdans invoked without state context.');
		this.performingStoerheidsdans = true;
		this.resetVerticalPosition();
		$.emit('animate_idle', this);
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = null;
		state.ticks += 1;
	}

	public handleStoerAnimationEnd(state?: State, event?: GameEvent<'animationEnd', { animation_name?: string }>): void {
		if (!state || !event?.animation_name) return;
		const data = state.data as StoerheidsdansStateData;
		if (data.expectedAnimation !== event.animation_name) return;
		data.expectedAnimation = null;
		this.completeAttack(event.animation_name as AttackType);
		state.ticks += 1;
	}

	public handleStoerTimelineFrame(state?: State, event?: TimelineFrameEventPayload): void {
		if (!state || event?.rewound) return;
		const nextAnimation = event?.frame_value;
		const data = state.data as StoerheidsdansStateData;
		data.expectedAnimation = typeof nextAnimation === 'string' ? nextAnimation : null;
		this.facing = this.facing === 'left' ? 'right' : 'left';
		if (typeof nextAnimation === 'string') {
			const attack = nextAnimation as AttackType;
			const event = create_gameevent({ type: 'mode.action.attack', attackType: attack, emitter: this });
			this.sc.dispatch_event(event);
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
		$.emit('animate_idle', this);
	}

	public enterHumiliated(): void {
		this.hittable = false;
		this.resetVerticalPosition();
	}

	public exitHumiliated(): void {
		this.hittable = true;
	}
}
@insavegame
export class JumpingWhileLeavingScreenComponent extends Component {
	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.enabled = false;
	}

	public onLeavingScreen(event: GameEvent): void {
		const emitter = event.emitter as Eila;
		const detail = event as GameEvent<'screen.leaving', WorldObjectEventPayloads['screen.leaving']>;
		const { d } = detail;
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
