import { $, TickGroup, type World } from 'bmsx';
import { ECSystem } from 'bmsx/ecs/ecsystem';
import type { PlayerInput } from 'bmsx/input/playerinput';
import { Fighter } from '../fighter';

export class PlayerInputToAbilitySystem extends ECSystem {
	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'playerInputAbility';
	}

	public override update(world: World): void {
		for (const obj of world.objects({ scope: 'current' })) {
			if (!(obj instanceof Fighter)) continue;
			if (!obj.tickEnabled || obj.active === false || obj.disposeFlag) continue;
			if (obj.isAIed) continue;
			const playerIndex = obj.player_index;
			if (!playerIndex) continue;
			const input = $.input.getPlayerInput(playerIndex);
			if (!input) continue;
			this.processFighterInput(obj, input);
		}
	}

	private processFighterInput(fighter: Fighter, input: PlayerInput): void {
		const tags = {
			combatDisabled: fighter.hasGameplayTag('state.combat_disabled'),
			attacking: fighter.hasGameplayTag('state.attacking'),
			grounded: fighter.hasGameplayTag('state.grounded'),
			airborne: fighter.hasGameplayTag('state.airborne'),
			ducking: fighter.hasGameplayTag('state.ducking'),
		};

		const canAct = !tags.combatDisabled;
		this.handleLocomotion(fighter, input, tags, canAct);
		this.handleDuck(fighter, input, tags, canAct);
		this.handleJump(fighter, input, tags, canAct);
		this.handleAttacks(fighter, input, tags, canAct);
	}

	private handleLocomotion(
		fighter: Fighter,
		input: PlayerInput,
		tags: { combatDisabled: boolean; attacking: boolean; grounded: boolean; ducking: boolean; },
		canAct: boolean,
	): void {
		const left = input.getActionState('left');
		const right = input.getActionState('right');
		const canMoveLaterally = canAct && tags.grounded && !tags.attacking && !tags.ducking;
		const walking = fighter.sc?.matches_state_path('fighter_control:/_grounded/walk') ?? false;

		if (canMoveLaterally) {
			if (left?.justpressed && !left.consumed && !(right?.pressed)) {
				fighter.requestAbility(fighter.getAbilityId('walk'), { dir: 'left' });
				input.consumeAction('left');
			} else if (right?.justpressed && !right.consumed && !(left?.pressed)) {
				fighter.requestAbility(fighter.getAbilityId('walk'), { dir: 'right' });
				input.consumeAction('right');
			}
		}

		const noDirectionPressed = !(left?.pressed) && !(right?.pressed);
		if (walking && noDirectionPressed) {
			fighter.requestAbility(fighter.getAbilityId('walk_stop'));
		}
	}

	private handleDuck(
		fighter: Fighter,
		input: PlayerInput,
		tags: { ducking: boolean; grounded: boolean; combatDisabled: boolean; attacking: boolean; },
		canAct: boolean,
	): void {
		const duck = input.getActionState('duck');
		const allowDuck = canAct && tags.grounded && !tags.attacking;
		if (duck?.justpressed && !duck.consumed && allowDuck) {
			fighter.requestAbility(fighter.getAbilityId('duck_hold'));
			input.consumeAction('duck');
		}
		if (duck?.justreleased && tags.ducking) {
			fighter.requestAbility(fighter.getAbilityId('duck_release'));
		}
	}

	private handleJump(
		fighter: Fighter,
		input: PlayerInput,
		tags: { grounded: boolean; combatDisabled: boolean; attacking: boolean; },
		canAct: boolean,
	): void {
		if (!canAct || !tags.grounded || tags.attacking) return;

		if (input.checkActionTriggered('jump_right[j]')) {
			fighter.requestAbility(fighter.getAbilityId('jump'), { direction: 'right' });
			input.consumeActions('jump');
			return;
		}
		if (input.checkActionTriggered('jump_left[j]')) {
			fighter.requestAbility(fighter.getAbilityId('jump'), { direction: 'left' });
			input.consumeActions('jump');
			return;
		}
		if (input.checkActionTriggered('jump[j]')) {
			fighter.requestAbility(fighter.getAbilityId('jump'));
			input.consumeActions('jump');
		}
	}

	private handleAttacks(
		fighter: Fighter,
		input: PlayerInput,
		tags: { combatDisabled: boolean; attacking: boolean; airborne: boolean; ducking: boolean; },
		canAct: boolean,
	): void {
		if (!canAct) return;

		const punch = !tags.attacking && !tags.airborne && input.checkActionTriggered('punch[wp{6}]');
		if (punch) {
			fighter.requestAbility(fighter.getAttackAbilityId('punch'), { attackType: 'punch' });
			input.consumeActions('punch');
		}

		const highKick = input.checkActionTriggered('highkick[wp{6}]');
		const lowKick = input.checkActionTriggered('lowkick[wp{6}]');

		if (tags.airborne && !tags.attacking && (highKick || lowKick)) {
			if (fighter.canActivateAttackAbility('flyingkick')) {
				fighter.requestAbility(fighter.getAttackAbilityId('flyingkick'), { attackType: 'flyingkick' });
			}
			if (highKick) input.consumeActions('highkick');
			if (lowKick) input.consumeActions('lowkick');
			return;
		}

		if (!tags.attacking && !tags.airborne && highKick) {
			fighter.requestAbility(fighter.getAttackAbilityId('highkick'), { attackType: 'highkick' });
			input.consumeActions('highkick');
		}

		if (!tags.attacking && lowKick) {
			const attack = tags.ducking ? 'duckkick' : 'lowkick';
			fighter.requestAbility(fighter.getAttackAbilityId(attack), { attackType: attack });
			input.consumeActions('lowkick');
		}
	}
}
