import { $, assign_fsm, attach_components, build_fsm, Identifier, insavegame, new_area, ProhibitLeavingScreenComponent, SpriteObject, State, StateMachineBlueprint, vec3, Collision2DSystem, type RevivableObjectArgs, type vec2 } from 'bmsx';
import type { AbilityId } from 'bmsx/gas/gastypes';
import { AbilitySystemComponent } from 'bmsx/component/abilitysystemcomponent';
import { SpriteComponent } from 'bmsx/component/sprite_component';
import { VERTICAL_POSITION_FIGHTERS } from './gameconstants';
import { BitmapId } from './resourceids';
import { registerFighterForAbilityInput, unregisterFighterFromAbilityInput } from './abilityinputservice';

export type AttackType = string;

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
@attach_components(ProhibitLeavingScreenComponent, AbilitySystemComponent)
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
	private _facing: 'left' | 'right';
	public get facing(): 'left' | 'right' { return this._facing; }
	public set facing(v: 'left' | 'right') {
		this._facing = v;
		// Drive sprite horizontal flip from facing. Default art faces left; mirror when facing right.
		this.flip_h = (v !== 'left');
	}
	public hp: number;
	/**
	 * The player index of the fighter.
	 */
	public player_index: number;

	public performingStoerheidsdans!: boolean;
	private _desiredWalkDir: -1 | 0 | 1 = 0;
	public get desiredWalkDir(): -1 | 0 | 1 { return this._desiredWalkDir; }
	public set desiredWalkDir(v: -1 | 0 | 1) { this._desiredWalkDir = v; }

	constructor(opts: RevivableObjectArgs & { id: Identifier; fsm_id?: Identifier; facing?: 'left' | 'right'; playerIndex?: number }) {
		super(opts);
		this.getOrCreateCollider().setLocalArea(new_area(0, 0, 0, 0)); // Default; updated via sprite metadata when set
		this.facing = opts.facing ?? 'right';
		this.currentHitMarker = null;
		this.player_index = opts.playerIndex ?? 1;
		// No producers; base sprite handled by SpriteComponent via SpriteRenderSystem
	}

	public addGameplayTag(tag: string): void {
		this.getAbilitySystem()?.addTag(tag);
	}

	public removeGameplayTag(tag: string): void {
		this.getAbilitySystem()?.removeTag(tag);
	}

	public hasGameplayTag(tag: string): boolean {
		return this.getAbilitySystem()?.hasGameplayTag(tag) ?? false;
	}

	public getAbilitySystem(): AbilitySystemComponent | null {
		return this.getUniqueComponent(AbilitySystemComponent) ?? null;
	}

	public tryActivateAttackAbility(attackType: AttackType): boolean {
		const abilityId = this.getAttackAbilityId(attackType);
		const asc = this.getAbilitySystem();
		if (!asc) return false;
		const result = asc.requestAbility(abilityId, { source: 'fighter.attack' });
		return result.ok;
	}

	public canActivateAttackAbility(attackType: AttackType): boolean {
		const abilityId = this.getAttackAbilityId(attackType);
		const asc = this.getAbilitySystem();
		if (!asc) return false;
		return asc.canActivateReason(abilityId) === null;
	}

	private resolveDirectionInput(directionOrPayload?: { direction?: 'left' | 'right' | null } | 'left' | 'right' | null): 'left' | 'right' | null {
		if (!directionOrPayload) return null;
		if (typeof directionOrPayload === 'string') {
			return directionOrPayload === 'left' || directionOrPayload === 'right' ? directionOrPayload : null;
		}
		const dir = directionOrPayload.direction;
		return dir === 'left' || dir === 'right' ? dir : null;
	}

	public setDesiredWalkDirection(direction: 'left' | 'right' | null): void {
		if (direction === 'left') {
			this.facing = 'left';
			this._desiredWalkDir = -1;
			return;
		}
		if (direction === 'right') {
			this.facing = 'right';
			this._desiredWalkDir = 1;
			return;
		}
		this._desiredWalkDir = 0;
	}

	public beginWalk(directionOrPayload?: { direction?: 'left' | 'right' | null } | 'left' | 'right' | null): void {
		const resolved = this.resolveDirectionInput(directionOrPayload) ?? (this.facing ?? 'right');
		this.setDesiredWalkDirection(resolved);
		this.setAttackingState(false);
	}

	public endWalk(): void {
		this.setDesiredWalkDirection(null);
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
		this.setDesiredWalkDirection(null);
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
		registerFighterForAbilityInput(this);
	}

	public override ondespawn(): void {
		unregisterFighterFromAbilityInput(this);
		super.ondespawn();
	}

	public override dispose(): void {
		unregisterFighterFromAbilityInput(this);
		super.dispose();
	}

	public resetVerticalPosition(): void {
		this.y_nonotify = VERTICAL_POSITION_FIGHTERS - this.sy;
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
