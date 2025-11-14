import { $ } from '../core/game';
import type { WorldObject } from '../core/object/worldobject';
import { ECSystem, TickGroup } from './ecsystem';
import type { PlayerInput } from '../input/playerinput';
import { InputIntentComponent, type InputIntentBinding, type InputIntentEdgeAssignment } from '../component/inputintentcomponent';
import { deep_clone } from 'bmsx/utils/deep_clone';
import { filter_iterable } from 'bmsx/utils/filter_iterable';

type IntentEdge = 'press' | 'hold' | 'release';

export class InputIntentSystem extends ECSystem {
	constructor(priority = 5) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'inputIntentSystem';
	}

	public override update(): void {
		const world = $.world;
		if (!world) return;
		for (const [owner, component] of filter_iterable(world.objectsWithComponents(InputIntentComponent, { scope: 'active' }), ([obj]) => this.isEligibleObject(obj))) {
			if (!component.bindings || component.bindings.length === 0) {
				continue;
			}
			const input = this.resolvePlayerInput(component, owner);
			if (!input) {
				continue;
			}
			for (let index = 0; index < component.bindings.length; index++) {
				const binding = component.bindings[index]!;
				this.evaluateBinding(owner, input, binding);
			}
		}
	}

	private evaluateBinding(owner: WorldObject, input: PlayerInput, binding: InputIntentBinding): void {
		const action = binding.action?.trim();
		if (!action) {
			return;
		}
		const state = input.getActionState(action);
		if (state.justpressed && binding.press) {
			this.runAssignments(owner, input, binding, 'press', binding.press);
		}
		if (state.pressed && binding.hold) {
			this.runAssignments(owner, input, binding, 'hold', binding.hold);
		}
		if (state.justreleased && binding.release) {
			this.runAssignments(owner, input, binding, 'release', binding.release);
		}
	}

	private runAssignments(
		owner: WorldObject,
		input: PlayerInput,
		binding: InputIntentBinding,
		edge: IntentEdge,
		spec: InputIntentEdgeAssignment,
	): void {
		const assignments = Array.isArray(spec) ? spec : [spec];
		for (let i = 0; i < assignments.length; i++) {
			const assignment = assignments[i];
			if (!assignment) continue;
			const path = assignment.path?.trim();
			if (!path) continue;
			const shouldClear = assignment.clear === true || (assignment.value === undefined && edge === 'release');
			const resolvedValue = shouldClear
				? undefined
				: assignment.value === undefined
					? edge === 'hold' || edge === 'press'
						? true
						: undefined
					: assignment.value;
			this.assignOwnerPath(owner, path, resolvedValue, shouldClear);
			if (assignment.consume === true) {
				input.consumeAction(binding.action);
			}
		}
	}

	private assignOwnerPath(owner: WorldObject, path: string, value: unknown, clear: boolean): void {
		const segments = path.split('.');
		if (segments.length === 0) return;
		let target: Record<string, unknown> = owner as unknown as Record<string, unknown>;
		for (let index = 0; index < segments.length - 1; index++) {
			const key = segments[index]!;
			let next = target[key];
			if (!next || typeof next !== 'object') {
				next = {};
				target[key] = next as never;
			}
			target = next as Record<string, unknown>;
		}
		const finalKey = segments[segments.length - 1]!;
		if (clear) {
			if (Array.isArray(target)) {
				delete (target as unknown as Record<string, unknown>)[finalKey];
			} else {
				delete target[finalKey];
			}
			return;
		}
		if (value && typeof value === 'object') {
			target[finalKey] = deep_clone(value as Record<string, unknown>);
			return;
		}
		target[finalKey] = value as never;
	}

	private resolvePlayerInput(component: InputIntentComponent, owner: WorldObject): PlayerInput | null {
		const explicitIndex = component.playerIndex ?? 0;
		const fallback = (owner as { player_index?: number }).player_index ?? 0;
		const resolved = explicitIndex > 0 ? explicitIndex : fallback;
		if (resolved <= 0) {
			throw new Error(`[InputIntentSystem] Unable to resolve player index for object '${owner.id ?? '<unknown>'}'.`);
		}
		return $.input.getPlayerInput(resolved);
	}

	private isEligibleObject(owner: WorldObject): boolean {
		if (owner.disposeFlag) return false;
		if (owner.active === false) return false;
		if (!owner.tickEnabled) return false;
		return true;
	}
}
