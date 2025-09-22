import { $ } from 'bmsx/core/game';
import { ECSystem, TickGroup } from 'bmsx/ecs/ecsystem';
import { registerEcsPipelineExtension } from 'bmsx/ecs/extensions';
import { DefaultECSPipelineRegistry as ECSReg, type NodeSpec } from 'bmsx/ecs/pipeline';
import type { World } from 'bmsx/core/world';
import type { Identifier } from 'bmsx/rompack/rompack';
import { Fighter } from './fighter';
import type { AttackType } from './fighter';
import type { Action } from './inputmapping';
import { Service } from 'bmsx/core/service';

export const ELLA_ABILITY_INPUT_SERVICE_ID = 'ella_ability_input';
const ELLA_ABILITY_INPUT_SYSTEM_ID = 'ella.fighterAbilityInput';
const ELLA_LOCOMOTION_SYSTEM_ID = 'ella.fighterLocomotion';

const DEFAULT_ATTACK_ACTIONS: AttackAction[] = ['punch', 'highkick', 'lowkick'];

type AttackAction = Extract<Action, 'punch' | 'highkick' | 'lowkick'>;

type FighterBinding = {
	fighter: Fighter;
	playerIndex: number;
	actions: AttackAction[];
};

export class FighterAbilityInputService extends Service {
	private readonly bindings = new Map<Identifier, FighterBinding>();

	constructor() {
		super({ id: ELLA_ABILITY_INPUT_SERVICE_ID });
	}

	public registerFighter(fighter: Fighter, actions?: AttackAction[]): void {
		if (fighter.isAIed) return;
		const actionList = actions ? [...actions] : [...DEFAULT_ATTACK_ACTIONS];
		this.bindings.set(fighter.id, { fighter, playerIndex: fighter.player_index, actions: actionList });
	}

	public unregisterFighter(id: Identifier): void {
		this.bindings.delete(id);
	}

	public update(): void {
		if (!this.tickEnabled) return;
		for (const [id, binding] of this.bindings) {
			const fighter = binding.fighter;
			if (!fighter || fighter.disposeFlag || !fighter.active) {
				this.bindings.delete(id);
				continue;
			}
			if (!this.isCombatReady(fighter) || this.isAttacking(fighter)) continue;

			const playerInput = $.input.getPlayerInput(binding.playerIndex);

			const actions = $.checkActionsTriggered(binding.playerIndex,
				{ def: 'punch[wp{6}]', id: 'punch' },
				{ def: '?wp{6}(highkick)', id: 'highkick' },
				{ def: '?wp{6}(lowkick)', id: 'lowkick' },
			);

			// Process each action in the binding
			for (const action of actions) {
				if (this.handleAttackAction(fighter, action as AttackAction)) {
					playerInput.consumeAction(action);
				}
			}
		}
	}

	private handleAttackAction(fighter: Fighter, action: AttackAction): boolean {
		const attempts = this.resolveAttemptOrder(fighter, action);
		const asc = fighter.getAbilitySystem();
		if (!asc) return false;
		for (const attempt of attempts) {
			const abilityId = fighter.getAttackAbilityId(attempt);
			const result = asc.requestAbility(abilityId, {
				source: 'input',
				payload: { attackType: attempt }
			});
			if (result.ok) {
				return true;
			}
		}
		return false;
	}

	private resolveAttemptOrder(fighter: Fighter, action: AttackAction): AttackType[] {
		switch (action) {
			case 'punch':
				return ['punch'];
			case 'highkick': {
				const order: AttackType[] = [];
				if (this.isAirborne(fighter)) order.push('flyingkick');
				order.push('highkick');
				return order;
			}
			case 'lowkick': {
				const order: AttackType[] = [];
				if (this.isAirborne(fighter)) {
					order.push('flyingkick');
				}
				else if (this.isDucking(fighter)) {
					order.push('duckkick');
				}
				order.push('lowkick');
				return order;
			}
			default:
				return [];
		}
	}

	private isCombatReady(fighter: Fighter): boolean {
		return !fighter.hasGameplayTag('state.combat_disabled');
	}

	private isAttacking(fighter: Fighter): boolean {
		return fighter.hasGameplayTag('state.attacking');
	}

	private isAirborne(fighter: Fighter): boolean {
		return fighter.hasGameplayTag('state.airborne');
	}

	private isDucking(fighter: Fighter): boolean {
		return fighter.hasGameplayTag('state.ducking');
	}
}

export class FighterAbilityInputSystem extends ECSystem {
	constructor(priority: number = 24) {
		super(TickGroup.Input, priority);
	}

	update(_world: World): void {
		const svc = $.get<FighterAbilityInputService>(ELLA_ABILITY_INPUT_SERVICE_ID) ?? null;
		svc?.update();
	}
}

export class FighterLocomotionSystem extends ECSystem {
	constructor(priority: number = 12) {
		super(TickGroup.Physics, priority);
	}

	update(world: World): void {
		for (const obj of world.activeObjects) {
			if (!(obj instanceof Fighter)) continue;
			if (obj.hasGameplayTag('state.airborne')) continue;
			const dir = obj.desiredWalkDir;
			if (dir === 0) continue;
			obj.x_nonotify += dir * Fighter.SPEED;
		}
	}
}

export function registerFighterForAbilityInput(fighter: Fighter, actions?: AttackAction[]): void {
	const service = $.get<FighterAbilityInputService>(ELLA_ABILITY_INPUT_SERVICE_ID) ?? null;
	service.registerFighter(fighter, actions);
}

export function unregisterFighterFromAbilityInput(fighter: Fighter): void {
	const service = $.get<FighterAbilityInputService>(ELLA_ABILITY_INPUT_SERVICE_ID) ?? null;
	service?.unregisterFighter(fighter.id);
}

let pipelineDescriptorRegistered = false;
let pipelineExtensionRegistered = false;

export function ensureAbilityInputPipelineRegistered(): void {
	if (!pipelineDescriptorRegistered) {
		if (!ECSReg.get(ELLA_ABILITY_INPUT_SYSTEM_ID)) {
			ECSReg.register({
				id: ELLA_ABILITY_INPUT_SYSTEM_ID,
				group: TickGroup.Input,
				defaultPriority: 24,
				create: (priority: number) => new FighterAbilityInputSystem(priority),
			});
		}
		if (!ECSReg.get(ELLA_LOCOMOTION_SYSTEM_ID)) {
			ECSReg.register({
				id: ELLA_LOCOMOTION_SYSTEM_ID,
				group: TickGroup.Physics,
				defaultPriority: 12,
				create: (priority: number) => new FighterLocomotionSystem(priority),
			});
		}
		pipelineDescriptorRegistered = true;
	}
	if (!pipelineExtensionRegistered) {
		registerEcsPipelineExtension((): NodeSpec[] => [
			{ ref: ELLA_ABILITY_INPUT_SYSTEM_ID },
			{ ref: ELLA_LOCOMOTION_SYSTEM_ID },
		]);
		pipelineExtensionRegistered = true;
	}
}
