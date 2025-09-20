import { $, Service } from 'bmsx';
import { ECSystem, TickGroup } from 'bmsx/ecs/ecsystem';
import { registerEcsPipelineExtension } from 'bmsx/ecs/extensions';
import { DefaultECSPipelineRegistry as ECSReg, type NodeSpec } from 'bmsx/ecs/pipeline';
import type { World } from 'bmsx/core/world';
import type { Identifier } from 'bmsx';
import type { Fighter, AttackType } from './fighter';
import type { Action } from './inputmapping';
import type { PlayerInput } from 'bmsx/input/playerinput';

export const ELLA_ABILITY_INPUT_SERVICE_ID = 'ella_ability_input';
const ELLA_ABILITY_INPUT_SYSTEM_ID = 'ella.fighterAbilityInput';

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
		if (!fighter || fighter.isAIed) return;
		const actionList = actions ?? DEFAULT_ATTACK_ACTIONS;
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

			const playerInput = this.tryGetPlayerInput(binding.playerIndex);
			if (!playerInput) continue;

			for (const action of binding.actions) {
				const state = playerInput.getActionState(action);
				if (!state.justpressed || state.consumed) continue;

				if (this.handleAttackAction(fighter, action)) {
					playerInput.consumeAction(state);
				}
			}
		}
	}

	private tryGetPlayerInput(index: number): PlayerInput | null {
		try {
			return $.input.getPlayerInput(index) ?? null;
		} catch {
			return null;
		}
	}

	private handleAttackAction(fighter: Fighter, action: AttackAction): boolean {
		const attempts = this.resolveAttemptOrder(fighter, action);
		for (const attempt of attempts) {
			if (fighter.tryActivateAttackAbility(attempt)) {
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
				if (fighter.isJumping) order.push('flyingkick');
				order.push('highkick');
				return order;
			}
			case 'lowkick': {
				const order: AttackType[] = [];
				if (fighter.isJumping) {
					order.push('flyingkick');
				}
				else if (fighter.isDucking) {
					order.push('duckkick');
				}
				order.push('lowkick');
				return order;
			}
			default:
				return [];
		}
	}
}

export class FighterAbilityInputSystem extends ECSystem {
	constructor(priority: number = 24) {
		super(TickGroup.Simulation, priority);
	}

	update(_world: World): void {
		const svc = $.get<FighterAbilityInputService>(ELLA_ABILITY_INPUT_SERVICE_ID) ?? null;
		svc?.update();
	}
}

export function registerFighterForAbilityInput(fighter: Fighter, actions?: AttackAction[]): void {
	const service = $.get<FighterAbilityInputService>(ELLA_ABILITY_INPUT_SERVICE_ID) ?? null;
	service?.registerFighter(fighter, actions);
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
				group: TickGroup.Simulation,
				defaultPriority: 24,
				create: (priority: number) => new FighterAbilityInputSystem(priority),
			});
		}
		pipelineDescriptorRegistered = true;
	}
	if (!pipelineExtensionRegistered) {
		registerEcsPipelineExtension((): NodeSpec[] => [{
			ref: ELLA_ABILITY_INPUT_SYSTEM_ID,
			when: () => $.has(ELLA_ABILITY_INPUT_SERVICE_ID as Identifier),
		}]);
		pipelineExtensionRegistered = true;
	}
}
