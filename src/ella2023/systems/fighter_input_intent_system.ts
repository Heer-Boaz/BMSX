import { $, TickGroup, type Direction, type World } from 'bmsx';
import { ECSystem } from 'bmsx/ecs/ecsystem';
import { GameplayCommandBuffer } from 'bmsx/ecs/gameplay_command_buffer';
import type { PlayerInput } from 'bmsx/input/playerinput';
import { Fighter } from '../fighter';

type FighterIntentRuntimeState = {
	walkDirection: Direction | null;
	duckActive: boolean;
};

function ensureState(cache: Map<string, FighterIntentRuntimeState>, id: string): FighterIntentRuntimeState {
	let state = cache.get(id);
	if (!state) {
		state = { walkDirection: null, duckActive: false };
		cache.set(id, state);
	}
	return state;
}

/**
 * Translates per-player input into gameplay intents (ability requests, locomotion events, movement commands).
 * Runs during the Input phase so downstream systems consume a deterministic command stream.
 */
export class FighterInputIntentSystem extends ECSystem {
	private readonly state = new Map<string, FighterIntentRuntimeState>();

	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'fighterInputIntent';
	}

	private enqueueEvent(fighter: Fighter, event: string, payload?: unknown): void {
		GameplayCommandBuffer.instance.push({
			kind: 'dispatchEvent',
			target_id: fighter.id,
			emitter_id: fighter.id,
			event,
			payload,
		});
	}

	public override update(world: World): void {
		const seen = new Set<string>();
		for (const obj of world.objects({ scope: 'current' })) {
			if (!(obj instanceof Fighter)) continue;
			if (!obj.tickEnabled || obj.active === false || obj.disposeFlag) continue;
			const playerIndex = obj.player_index;
			const input = playerIndex ? $.input.getPlayerInput(playerIndex) : null;
			seen.add(obj.id);
			this.processFighter(obj, input, ensureState(this.state, obj.id), obj.isAIed);
		}
		for (const id of this.state.keys()) {
			if (!seen.has(id)) this.state.delete(id);
		}
	}

	private processFighter(fighter: Fighter, input: PlayerInput | null, runtime: FighterIntentRuntimeState, isAIControlled: boolean): void {
		const tags = {
			combatDisabled: fighter.hasGameplayTag('state.combat_disabled'),
			attacking: fighter.hasGameplayTag('state.attacking'),
			grounded: fighter.hasGameplayTag('state.grounded'),
			airborne: fighter.hasGameplayTag('state.airborne'),
			ducking: fighter.hasGameplayTag('state.ducking'),
		};

		const canAct = !tags.combatDisabled;

		if (!isAIControlled && input) {
			const duckAction = input.getActionState('duck');
			const leftAction = input.getActionState('left');
			const rightAction = input.getActionState('right');
			const canMoveLaterally = canAct && tags.grounded && !tags.attacking && !tags.ducking;

			this.handleDuckIntent(fighter, duckAction, tags, runtime);
			this.updateMovementIntentFromInput(fighter, leftAction, rightAction, duckAction, tags, runtime, canMoveLaterally);
			this.handleJumpIntent(fighter, input, tags, canAct);
			this.handleAttackIntents(fighter, input, tags, canAct);
		} else if (isAIControlled) {
			runtime.duckActive = false;
		}

		this.syncWalkDirectionFromState(fighter, runtime, isAIControlled);
		this.emitMovementCommand(fighter, runtime, tags);
	}

	private handleDuckIntent(
		fighter: Fighter,
		duckAction: ReturnType<PlayerInput['getActionState']>,
		tags: { ducking: boolean; grounded: boolean; combatDisabled: boolean; attacking: boolean; airborne: boolean; },
		runtime: FighterIntentRuntimeState,
	): void {
		const allowDuck = tags.grounded && !tags.combatDisabled && !tags.attacking;
		const wantsDuck = duckAction?.pressed && !duckAction.consumed;
		const wasDuckIntent = runtime.duckActive;
		if (wantsDuck && allowDuck && !wasDuckIntent) {
			this.enqueueEvent(fighter, 'mode.control.duck');
			runtime.duckActive = true;
			return;
		}

		const shouldRelease = (!wantsDuck && (tags.ducking || wasDuckIntent)) || (!allowDuck && wasDuckIntent);
		if (shouldRelease) {
			this.enqueueEvent(fighter, 'mode.locomotion.idle');
			runtime.duckActive = false;
		}
	}

	private updateMovementIntentFromInput(
		fighter: Fighter,
		leftAction: ReturnType<PlayerInput['getActionState']>,
		rightAction: ReturnType<PlayerInput['getActionState']>,
		duckAction: ReturnType<PlayerInput['getActionState']>,
		tags: { combatDisabled: boolean; attacking: boolean; grounded: boolean; ducking: boolean; airborne: boolean; },
		runtime: FighterIntentRuntimeState,
		canMoveLaterally: boolean,
	): void {
		const leftPressed = leftAction?.pressed && !leftAction.consumed;
		const rightPressed = rightAction?.pressed && !rightAction.consumed;
		const wantsLeft = canMoveLaterally && leftPressed && !rightPressed;
		const wantsRight = canMoveLaterally && rightPressed && !leftPressed;
		const needsIdle = runtime.walkDirection !== null && (!canMoveLaterally || (!wantsLeft && !wantsRight));

		if (wantsLeft || wantsRight) {
			const desiredDir: Direction = wantsLeft ? 'left' : 'right';
			if (fighter.facing !== desiredDir) fighter.facing = desiredDir;
			if (runtime.walkDirection !== desiredDir) {
				this.enqueueEvent(fighter, 'mode.locomotion.walk', { direction: desiredDir });
				runtime.walkDirection = desiredDir;
			}
		} else if (needsIdle) {
			this.enqueueEvent(fighter, 'mode.locomotion.idle');
			runtime.walkDirection = null;
		}

		if ((tags.ducking || runtime.duckActive) && duckAction?.pressed) {
			if (leftPressed && fighter.facing !== 'left') fighter.facing = 'left';
			else if (rightPressed && fighter.facing !== 'right') fighter.facing = 'right';
		}

		if (!canMoveLaterally && runtime.walkDirection !== null) runtime.walkDirection = null;
	}

	private handleJumpIntent(
		fighter: Fighter,
		input: PlayerInput,
		tags: { grounded: boolean; combatDisabled: boolean; attacking: boolean; },
		canAct: boolean,
	): void {
		if (!canAct || !tags.grounded || tags.attacking) return;

		if (input.checkActionTriggered('jump_right[j]')) {
			fighter.facing = 'right';
			this.enqueueEvent(fighter, 'mode.control.jump', { direction: 'right' });
			input.consumeActions('jump');
			return;
		}
		if (input.checkActionTriggered('jump_left[j]')) {
			fighter.facing = 'left';
			this.enqueueEvent(fighter, 'mode.control.jump', { direction: 'left' });
			input.consumeActions('jump');
			return;
		}
		if (input.checkActionTriggered('jump[j]')) {
			this.enqueueEvent(fighter, 'mode.control.jump', {});
			input.consumeActions('jump');
		}
	}

	private handleAttackIntents(
		fighter: Fighter,
		input: PlayerInput,
		tags: { combatDisabled: boolean; attacking: boolean; airborne: boolean; ducking: boolean; },
		canAct: boolean,
	): void {
		if (!canAct) return;

		const punchIntent = !tags.attacking && !tags.airborne && input.checkActionTriggered('punch[wp{6}]');
		if (punchIntent) {
			fighter.requestAbility(fighter.getAttackAbilityId('punch'), { attackType: 'punch' });
			input.consumeActions('punch');
		}

		const highKickIntent = input.checkActionTriggered('highkick[wp{6}]');
		const lowKickIntent = input.checkActionTriggered('lowkick[wp{6}]');

		if (tags.airborne && !tags.attacking && (highKickIntent || lowKickIntent)) {
			if (fighter.canActivateAttackAbility(fighter.getAttackAbilityId('flyingkick'))) {
				fighter.requestAbility(fighter.getAttackAbilityId('flyingkick'), { attackType: 'flyingkick' });
			}
			if (highKickIntent) input.consumeActions('highkick');
			if (lowKickIntent) input.consumeActions('lowkick');
			return;
		}

		if (!tags.attacking && !tags.airborne && highKickIntent) {
			fighter.requestAbility(fighter.getAttackAbilityId('highkick'), { attackType: 'highkick' });
			input.consumeActions('highkick');
		}

		if (!tags.attacking && lowKickIntent) {
			const attack = tags.ducking ? 'duckkick' : 'lowkick';
			fighter.requestAbility(fighter.getAttackAbilityId(attack), { attackType: attack });
			input.consumeActions('lowkick');
		}
	}

	private syncWalkDirectionFromState(fighter: Fighter, runtime: FighterIntentRuntimeState, isAIControlled: boolean): void {
		const controller = fighter.sc;
		if (!controller?.matches_state_path) return;
		const walking = controller.matches_state_path('fighter_control:/_grounded/walk');
		if (walking) {
			if (runtime.walkDirection === null) {
				const facing = fighter.facing === 'left' || fighter.facing === 'right' ? fighter.facing : 'right';
				runtime.walkDirection = facing;
			}
		} else if (isAIControlled && runtime.walkDirection !== null) {
			runtime.walkDirection = null;
		}
	}

	private emitMovementCommand(
		fighter: Fighter,
		runtime: FighterIntentRuntimeState,
		tags: { combatDisabled: boolean; attacking: boolean; grounded: boolean; ducking: boolean; airborne: boolean; },
	): void {
		const dir = runtime.walkDirection;
		if (!dir) return;
		if (tags.combatDisabled || tags.attacking || tags.ducking || !tags.grounded) return;
		const speed = fighter.walkSpeed ?? Fighter.SPEED;
		const deltaX = dir === 'right' ? speed : -speed;
		GameplayCommandBuffer.instance.push({ kind: 'moveby2d', target_id: fighter.id, space: 'world', delta: { x: deltaX, y: 0, z: 0 } });
	}
}
