import { $, BTStatus, BTVisualizer, BehaviorTreeDefinition, Blackboard, WaitForActionCompletionDecorator, assign_bt, assign_fsm, attach_components, build_bt, insavegame, vec3, type RevivableObjectArgs } from 'bmsx';
import { JumpingWhileLeavingScreenComponent } from './eila';
import { Fighter } from "./fighter";
import { SINTERKLAAS_START_HP } from './gameconstants';
import { EilaEventService } from './worldmodule';
import { BitmapId } from "./resourceids";
import { registerFighterAbilities } from './abilities';

function theOtherFighter(f: Fighter) {
	return $.get<EilaEventService>('eila_events').theOtherFighter(f);
}
export type SinterklaasAttackType = 'punch' | 'lowkick' | 'highkick' | 'flyingkick' | 'mijter_throw';

@insavegame
@assign_fsm('fighter_control', 'player_animation')
@assign_bt('sinterklaasBT')
@attach_components(JumpingWhileLeavingScreenComponent, BTVisualizer)
export class Sinterklaas extends Fighter {
	public readonly animSprites = {
		idle: BitmapId.sint_idle,
		walk: BitmapId.sint_walk,
		walk_alt: BitmapId.sint_idle,
		highkick: BitmapId.sint_highkick,
		lowkick: BitmapId.sint_lowkick,
		punch: BitmapId.sint_punch,
		duckkick: BitmapId.sint_flyingkick,
		flyingkick: BitmapId.sint_flyingkick,
		duck: BitmapId.sint_duckorjump,
		jump: BitmapId.sint_duckorjump,
		humiliated: BitmapId.sint_humiliated_1,
	};
	public readonly humiliatedCharacterId = 'sinterklaas';

	constructor(opts?: RevivableObjectArgs & { aied: boolean }) {
		super({ id: 'sinterklaas', fsm_id: undefined, facing: 'right', playerIndex: 2 });
		this.hp = SINTERKLAAS_START_HP;
		this._aied = opts?.aied ?? false;
	}

	// Base rendering handled by Fighter.enumerateDrawOptions

	override onspawn(spawningPos?: vec3): void {
		super.onspawn(spawningPos);
		registerFighterAbilities(this);
		// Note: this is a hack to make sure the sinterklaasBT is initialized before the sinterklaasBT can be stopped.
		if (!this.isAIed) { // Only the player can control Sinterklaas
			this.btreecontexts['sinterklaasBT'].running = false;
		}
		else {
			this.btreecontexts['sinterklaasBT'].running = true;
		}
	}

	protected override getAttackOpponent(): Fighter | null {
		return $.get<EilaEventService>('eila_events')?.theOtherFighter(this) ?? null;
	}


	@build_bt('sinterklaasBT')
	public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
		function getOpponentRange(this: Fighter): [number, number] {
			const theOther = theOtherFighter(this);

			if (theOther) {
				const dx = Math.abs(theOther.center_x - this.center_x);
				const dy = Math.abs(theOther.center_y - this.center_y);

				// Check if the player is within range
				return [dx, dy];
			}
			return [Number.MAX_VALUE, Number.MAX_VALUE];
		}

		function isPlayerInPunchRange(this: Fighter): boolean {
			const [dx] = getOpponentRange.apply(this);
			const RANGE = (this.sx / 5) * 3; // Define the range

			if (dx <= RANGE) {
				return true;
			}

			return false;
		}

		function isPlayerInKickRange(this: Fighter): boolean {
			const [dx] = getOpponentRange.apply(this);
			const RANGE = (this.sx / 4) * 3; // Define the range

			if (dx <= RANGE) {
				return true;
			}

			return false;
		}

		function isPlayerFarAway(this: Fighter): boolean {
			const [dx] = getOpponentRange.apply(this);
			const RANGE = this.sx * 2.5; // Define the range

			if (dx >= RANGE) {
				return true;
			}

			return false;
		}

		function isPlayerDucking(this: Fighter): boolean {
			// Logic to check if the player is ducking
			const theOther = theOtherFighter(this);
			if (theOther) {
				return theOther.isDucking;
			}
			return false;
		}

		function isOrWasPlayerHighKicking(this: Fighter): boolean {
			// Logic to check if the player is ducking
			const theOther = theOtherFighter(this);
			if (theOther) {
				return theOther.currentAttackType === 'highkick' || theOther.previousAttackType === 'highkick';
			}
			return false;
		}

		function isOrWasPlayerLowOrDuckKicking(this: Fighter): boolean {
			// Logic to check if the player is ducking
			const theOther = theOtherFighter(this);
			if (theOther) {
				return theOther.currentAttackType === 'lowkick' || theOther.previousAttackType === 'lowkick' || theOther.currentAttackType === 'duckkick' || theOther.previousAttackType === 'duckkick';
			}
			return false;
		}

		// @ts-ignore
		function isPlayerAttacking(this: Fighter): boolean {
			// Logic to check if the player is attacking
			const theOther = theOtherFighter(this);
			if (theOther) {
				return theOther.isAttacking;
			}
			return false;
		}

		function punch(this: Fighter): BTStatus {
			if (isAttacking.apply(this)) return 'RUNNING';
			if (!this.canActivateAttackAbility('punch')) return 'FAILED';
			return this.tryActivateAttackAbility('punch') ? 'SUCCESS' : 'FAILED';
		}

		function highkick(this: Fighter): BTStatus {
			if (isAttacking.apply(this)) return 'RUNNING';
			if (!this.canActivateAttackAbility('highkick')) return 'FAILED';
			return this.tryActivateAttackAbility('highkick') ? 'SUCCESS' : 'FAILED';
		}

		function duckkick(this: Fighter): BTStatus {
			if (isAttacking.apply(this)) return 'RUNNING';
			if (!this.canActivateAttackAbility('duckkick')) return 'FAILED';
			return this.tryActivateAttackAbility('duckkick') ? 'SUCCESS' : 'FAILED';
		}

		// @ts-ignore
		function duck(this: Fighter): BTStatus {
			this.sc.dispatch_event('mode.control.duck', this);
			return 'SUCCESS';
		}

		function jump(this: Fighter): BTStatus {
			if (this.isJumping) return 'RUNNING';
			this.sc.dispatch_event('mode.control.jump', this, this.facing);
			return 'SUCCESS';
		}

		function straightJump(this: Fighter): BTStatus {
			if (this.isJumping) return 'RUNNING';
			this.sc.dispatch_event('mode.control.jump', this, undefined);
			return 'SUCCESS';
		}

		function jumpkick(this: Fighter): BTStatus {
			if (isAttacking.apply(this)) return 'RUNNING';
			if (!this.canActivateAttackAbility('flyingkick')) return 'FAILED';
			return this.tryActivateAttackAbility('flyingkick') ? 'SUCCESS' : 'FAILED';
		}

		function idle(this: Fighter): BTStatus {
			// Logic for idle behavior
			this.sc.dispatch_event('mode.locomotion.idle', this);
			return 'SUCCESS';
		}

		function walk(this: Fighter, blackboard: Blackboard): BTStatus {
			// Logic for walk behavior
			this.sc.dispatch_event('mode.locomotion.walk', this, this.facing);
			this.x += this.facing === 'left' ? -Fighter.SPEED : Fighter.SPEED;
			blackboard.set('walking', true);
			return 'SUCCESS';
		}

		function isAttacking(this: Fighter): boolean {
			return this.isAttacking;
		}

		function isJumping(this: Fighter): boolean {
			return this.isJumping;
		}

		function isDucking(this: Fighter): boolean {
			return this.isDucking;
		}

		function faceYourFoe(this: Fighter, _blackboard: Blackboard): BTStatus {
			const theOther = theOtherFighter(this);
			let targetFacing: 'left' | 'right';
			if (theOther) {
				if (theOther.center_x > this.center_x) {
					targetFacing = 'right';
				} else {
					targetFacing = 'left';
				}
			}
			else return 'FAILED';

			if (this.facing === targetFacing) return 'SUCCESS';

			if (isJumping.apply(this)) return 'FAILED';

			this.facing = targetFacing;
			return 'SUCCESS';
		}

		function isFighting(this: Fighter): boolean {
			return this.isFighting;
		}

		function isNotBusy(this: Fighter, blackboard: Blackboard): boolean {
			return !(isAttacking.apply(this) || blackboard.actionInProgress);
		}

		function isWalking(this: Fighter, blackboard: Blackboard): boolean {
			return blackboard.get('walking');
		}

		return {
			type: 'Sequence', children: [
				{ type: 'Condition', condition: isFighting },
				{
					type: 'Selector',
					children: [
						{
							type: 'Sequence',
							children: [
								{ type: 'Condition', condition: isDucking },
								{ type: 'Wait', wait_propname: 'ducking', wait_time: 30 },
								{ type: 'Action', action: idle },
							],
						},
						{
							type: 'Sequence',
							children: [
								{ type: 'Condition', condition: isWalking },
								{ type: 'Action', action: walk },
								{ type: 'Wait', wait_propname: 'walking', wait_time: 8 },
								{ type: 'Action', action: (blackboard: Blackboard) => { blackboard.set('walking', false); return 'SUCCESS'; } },
							],
						},
						{
							type: 'Sequence',
							children: [
								{ type: 'Condition', condition: isNotBusy },
								{ type: 'Condition', condition: isAttacking, modifier: 'NOT' },
								{
									type: 'Selector',
									children: [
										{
											type: 'Sequence', children: [
												{ type: 'Condition', condition: isJumping },
												{ type: 'Condition', condition: isPlayerInKickRange },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: jumpkick } },
											]
										},
										{
											type: 'Sequence', children: [
												{ type: 'Condition', condition: isJumping, modifier: 'NOT' },
												{ type: 'Action', action: faceYourFoe },
												{
													type: 'RandomSelector',
													currentchild_propname: 'currentAttackMove',
													children: [
														{
															type: 'Sequence',
															children: [
																{ type: 'Condition', condition: isPlayerInPunchRange },
																{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: punch } },
															],
														},
														{
															type: 'Sequence',
															children: [
																{ type: 'Condition', condition: isPlayerInKickRange },
																{
																	type: 'Selector', children: [
																		{
																			type: 'Sequence', children: [
																				{ type: 'Condition', condition: isPlayerDucking },
																				{ type: 'Action', action: duckkick },
																			]
																		},
																		{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: highkick } },
																	]
																},
															],
														},
														{
															type: 'Action', action: () => { return 'FAILED'; } // Don't do anything and wo for defensive move instead
														},
													],
												},
											]
										}
									]
								},
							]
						},
						{
							type: 'Sequence',
							children: [
								{ type: 'Condition', condition: isAttacking, modifier: 'NOT' },
								{ type: 'Condition', condition: isJumping, modifier: 'NOT' },
								{
									type: 'RandomSelector',
									currentchild_propname: 'currentDefenseMove',
									children: [
										{
											type: 'Sequence',
											children: [
												{ type: 'Condition', condition: isOrWasPlayerHighKicking },
												{ type: 'Condition', condition: isPlayerInKickRange },
												{ type: 'Action', action: duck },
											]
										},
										{
											type: 'Sequence',
											children: [
												{ type: 'Condition', condition: isNotBusy },
												{ type: 'Condition', condition: isPlayerFarAway },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: jump } },
											]
										},
										{
											type: 'Sequence',
											children: [
												{ type: 'Condition', condition: isNotBusy },
												{ type: 'Condition', condition: isPlayerInKickRange },
												{ type: 'Condition', condition: isOrWasPlayerLowOrDuckKicking },
												{ type: 'Action', action: straightJump },
											]
										},
										{
											type: 'Sequence',
											children: [
												{ type: 'Condition', condition: isNotBusy },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: walk } },
											]
										},
										{
											type: 'Sequence',
											children: [
												{ type: 'Condition', condition: isNotBusy },
												{ type: 'Condition', condition: isJumping, modifier: 'NOT' },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: faceYourFoe } },
												{ type: 'Decorator', decorator: WaitForActionCompletionDecorator, child: { type: 'Action', action: idle } },
											]
										},
									]
								},
							]
						}
					]
				}
			]
		};
	}
}
