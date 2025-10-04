import { $, GameplayCommandBuffer, InputAbilityComponent, assign_fsm, attach_components, build_fsm, Identifier, insavegame, new_area, ProhibitLeavingScreenComponent, SpriteObject, State, StateMachineBlueprint, vec3, Collision2DSystem, type RevivableObjectArgs, type vec2, type Direction } from 'bmsx';
import type { AbilityId } from 'bmsx/gas/gastypes';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';
import { SpriteComponent } from 'bmsx/component/sprite_component';
import { VERTICAL_POSITION_FIGHTERS } from './gameconstants';
import { BitmapId } from './resourceids';
import { FIGHTER_INPUT_PROGRAM } from './input/fighter_input_program';

export type AttackType = string;

export type HitMarkerType = 'player_hit' | 'enemy_hit' | 'poef';

export type HitMarkerInfo = {
	type: HitMarkerType,
	pos: vec2, // Offset from the fighter's position
};

const CORE_ABILITY_IDS = {
	walk: 'fighter.locomotion.walk',
	walk_stop: 'fighter.locomotion.walk_stop',
	duck_hold: 'fighter.control.duck_hold',
	duck_release: 'fighter.control.duck_release',
	jump: 'fighter.control.jump',
} as const;

export type FighterCoreAbilityName = keyof typeof CORE_ABILITY_IDS;

export const FIGHTER_CORE_ABILITY_IDS: { [K in FighterCoreAbilityName]: AbilityId } = CORE_ABILITY_IDS as { [K in FighterCoreAbilityName]: AbilityId };

function getDamage(attackType: AttackType): number {
	switch (attackType) {
		default:
			return 10;
	}
}

@insavegame
@attach_components(ProhibitLeavingScreenComponent, AbilitySystemComponent, InputAbilityComponent)
@assign_fsm('hitanimation')
export abstract class Fighter extends SpriteObject {
	public static readonly ATTACK_DURATION = 15;
	public static readonly JUMP_SPEED = 2;
	public static readonly JUMP_DURATION = 60;
	public static readonly SPEED = 2;
	private _fighting: boolean = true;
	private _attacking: boolean = false;
	private _jumping: boolean = false;
	private _ducking: boolean = false;
	public attacked_while_jumping: boolean = false;
	public _aied: boolean = false;
	public previousAttackType: AttackType = null;
	public currentAttackType: AttackType = null;
	public get isAttacking(): boolean { return this._attacking; }
	public get isJumping(): boolean { return this._jumping; }
	public get isDucking(): boolean { return this._ducking; }
	public get isFighting(): boolean { return this._fighting; }
	public get isAIed(): boolean { return this._aied; }

	protected setFightingState(active: boolean, force: boolean = false): void {
		if (!force && this._fighting === active) return;
		this._fighting = active;
	}

	protected setAttackingState(active: boolean, force: boolean = false): void {
		if (!force && this._attacking === active) return;
		this._attacking = active;
	}

	protected setJumpingState(active: boolean, force: boolean = false): void {
		if (!force && this._jumping === active) return;
		this._jumping = active;
	}

	protected setDuckingState(active: boolean, force: boolean = false): void {
		if (!force && this._ducking === active) return;
		this._ducking = active;
	}

	public configureWalkState({ state, payload }: { state: State; payload?: { direction?: Direction } | Direction }): void {
		if (!state) return;
		const resolved = (typeof payload === 'string') ? payload : payload?.direction;
		const direction: Direction | null = (resolved === 'left' || resolved === 'right') ? resolved : null;
	const data = (state.data ??= {} as Record<string, unknown>);
	if (direction) {
		(data as { direction?: Direction }).direction = direction;
		(data as { speedX?: number }).speedX = direction === 'right' ? this.walkSpeed : -this.walkSpeed;
	} else if ((data as { direction?: Direction }).direction === undefined) {
		(data as { direction?: Direction }).direction = this.facing ?? 'right';
		(data as { speedX?: number }).speedX = (this.facing === 'left' ? -1 : 1) * this.walkSpeed;
	}
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
					tape_data: [-1, 1],
					repetitions: 10,
					enable_tape_autotick: true,
					ticks2advance_tape: 1,
					entering_state(this: Fighter) {
						this.sc.pause_all_except('hitanimation');
					},
					tape_next(this: Fighter, state: State) {
						this.x_nonotify += state.current_tape_value;
					},
					tape_end(this: Fighter) {
						this.sc.transition_to('hitanimation:/geen_au');
					},
					exiting_state(this: Fighter) {
						this.sc.resume_all_statemachines();
						$.emitGameplay('i_was_hit', this); // Allow the player to recuperate from the hit quickly.
						$.emitGameplay('hit_animation_end', this); // The Game Model will handle the hit animation end event, which will hide the hit marker and determine if the fighter is down.
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
		this.getOrCreateCollider().setLocalArea(new_area(0, 0, 0, 0)); // Default; updated via sprite metadata when set
		this.facing = opts.facing ?? 'right';
		this.currentHitMarker = null;
		this.player_index = opts.playerIndex ?? 1;
		// No producers; base sprite handled by SpriteComponent via SpriteRenderSystem
	}

	public override activate(): void {
		super.activate();
		const inputAbility = this.getUniqueComponent(InputAbilityComponent);
		if (!inputAbility) throw new Error(`Fighter ${this.id} has no InputAbilityComponent and that's bad! Probably a bug in the @attach_components decorator or the order in which activate() is called relative to component attachment.`);

		inputAbility.playerIndex = this.player_index ?? 1;
		inputAbility.program = FIGHTER_INPUT_PROGRAM;

		// Seed locomotion and animation so tags and sprites are valid on the first frame.
		this.sc.dispatch_event('mode.locomotion.idle', this);
		this.sc.dispatch_event('animate_idle', this);
	}

	public getAbilityId(name: FighterCoreAbilityName): AbilityId {
		return FIGHTER_CORE_ABILITY_IDS[name];
	}

	public requestAbility(abilityId: AbilityId, payload?: Record<string, unknown>): boolean {
		const asc = this.getUniqueComponent(AbilitySystemComponent);
		const res = asc.requestAbility(abilityId, { source: 'input.fsm', payload });
		return res.ok;
	}

	public tryActivateAttackAbility(attackType: AttackType): boolean {
		const abilityId = this.getAttackAbilityId(attackType);
		const asc = this.getUniqueComponent(AbilitySystemComponent);
		const result = asc.requestAbility(abilityId, { source: 'fighter.attack', payload: { attackType } });
		return result.ok;
	}

	public canActivateAttackAbility(attackType: AttackType): boolean {
		const abilityId = this.getAttackAbilityId(attackType);
		const asc = this.getUniqueComponent(AbilitySystemComponent);
		return asc.canActivateReason(abilityId) === null;
	}

	public getAttackAbilityId(attackType: AttackType): AbilityId {
		return `fighter.attack.${attackType}` as AbilityId;
	}

	public startAttack(attackType: AttackType): void {
		this.setAttackingState(true);
		this.currentAttackType = attackType;
		if (attackType === 'duckkick') this.setDuckingState(true);
		if (attackType === 'flyingkick') {
			this.attacked_while_jumping = true;
		}
		const opponent = this.getAttackOpponent();
		this.sc.dispatch_event(`animate_${attackType}`, this);
		this.doAttackFlow(attackType, opponent);
	}

	public finishAttack(attackType: AttackType): void {
		this.previousAttackType = attackType;
		this.currentAttackType = null;
		this.setAttackingState(false);
		if (attackType === 'duckkick') this.setDuckingState(false);
		if (attackType === 'flyingkick') {
			this.attacked_while_jumping = false;
		}
	}

	public doAttackFlow(attackType: AttackType, opponent: Fighter | null): boolean {
		if (!opponent) {
			$.applyVibrationEffect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: 0.5 });
			return false;
		}
		const hitVec2 = this.attackHitsOpponent(attackType, opponent);
		let hit: boolean = false;
		if (hitVec2) {
			this.handleHittingOpponent(attackType, opponent, hitVec2);
			opponent.handleBeingHit(attackType, this);
			$.applyVibrationEffect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: .6 });
			$.applyVibrationEffect(opponent.player_index, { effect: 'dual-rumble', duration: 100, intensity: 1 });
			hit = true;
		}
		else {
			$.applyVibrationEffect(this.player_index, { effect: 'dual-rumble', duration: 50, intensity: 0.5 });
		}
		return hit;
	}

	public performAttack(attackType: AttackType): void {
		this.startAttack(attackType);
	}

	public completeAttack(attackType: AttackType): void {
		this.finishAttack(attackType);
	}

	protected getAttackOpponent(): Fighter | null {
		return null;
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
		$.emitGameplay('combat.hit', this, { result: 'hit', weaponClass, actorId: opponent.id, targetId: this.id });
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

	public walkTick(state: State): void {
		const data = state.data as { speedX?: number };
		let dx = 0;
		if (typeof data.speedX === 'number') dx = data.speedX;
		else if (this.facing === 'left') dx = -this.walkSpeed;
		else if (this.facing === 'right') dx = this.walkSpeed;
	if (dx === 0) {
		return;
	}
	GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: this.id, delta: { x: dx, y: 0, z: 0 } });
	}

	private _hitSprite?: SpriteComponent;
	protected applyHitMarker(hitMarker: HitMarkerInfo | null): void {
		// Toggle a secondary SpriteComponent for the hit marker
		if (!hitMarker) {
			if (this._hitSprite) this._hitSprite.enabled = false;
			return;
		}
		if (!this._hitSprite) {
			this._hitSprite = new SpriteComponent({ parentid: this.id });
			this.addComponent(this._hitSprite);
			this._hitSprite.colliderLocalId = null;
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
}
