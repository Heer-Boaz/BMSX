import { $ } from '../core/engine_core';
import type { PlayerInput } from '../input/playerinput';
import { ECSystem, TickGroup } from './ecsystem';
import type { WorldObject } from '../core/object/worldobject';
import { InputIntentComponent, type InputIntentBinding, type InputIntentEdgeAssignment } from '../component/inputintentcomponent';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import { InputActionEffectComponent } from '../component/inputactioneffectcomponent';
import {
	compileProgram,
	validateProgramEffects,
	type CompiledProgram,
	type CompiledBinding,
	type BindingExecutionEnv,
	type PatternPredicate,
	type EffectExecutor,
} from '../action_effects/input_action_effect_compiler';
import { isInputActionEffectProgram, type InputActionEffectProgram } from '../action_effects/input_action_effect_dsl';
import { filter_iterable } from '../utils/filter_iterable';
import { deep_clone } from '../utils/deep_clone';
import { tokenKeyFromAsset, tokenKeyFromId } from '../util/asset_tokens';

type IntentEdge = 'press' | 'hold' | 'release';

let assetProgramsValidated = false;

function validatePrimaryAssetsOnBoot(): void {
	if (assetProgramsValidated) return;
	const data = $.assets.data;
	const entries = $.asset_source.list('data');
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const key = tokenKeyFromAsset(entry);
		const value = (data as Record<string, unknown>)[key];
		if (!isInputActionEffectProgram(value)) continue;
		validateProgramEffects(value, entry.resid);
	}
	assetProgramsValidated = true;
}

export class InputActionEffectSystem extends ECSystem {
	private readonly compiledById = new Map<string, CompiledProgram>();
	private readonly inlineCompiled = new WeakMap<InputActionEffectProgram, CompiledProgram>();
	private readonly validatedInlinePrograms = new WeakSet<InputActionEffectProgram>();
	private readonly resolvedPrograms = new Map<string, InputActionEffectProgram>();
	private readonly missingProgramIds = new Set<string>();
	private readonly patternCache = new Map<string, PatternPredicate>();
	private readonly patternCacheMax = 256;
	private readonly customMatchScratch: boolean[] = [];
	private readonly bindingLatch = new Map<string, boolean>();
	private readonly frameLatchTouched = new Set<string>();

	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		validatePrimaryAssetsOnBoot();
		this.__ecsId = 'inputActionEffectSystem';
	}

	public override update(): void {
		this.frameLatchTouched.clear();
		this.processInputIntents();
		// InputActionEffect programs run early (TickGroup.Input) so FSM/input checks see consumed events and effect triggers immediately.
		this.processInputActionPrograms();
		const latchedKeys = Array.from(this.bindingLatch.keys());
		for (let idx = 0; idx < latchedKeys.length; idx++) {
			const key = latchedKeys[idx]!;
			if (!this.frameLatchTouched.has(key)) this.bindingLatch.delete(key);
		}
	}

	private processInputIntents(): void {
		const world = $.world;
		for (const [owner, component] of filter_iterable(world.objects_with_components(InputIntentComponent, { scope: 'active' }), ([obj]) => this.isEligibleObject(obj))) {
			if (!component.bindings || component.bindings.length === 0) continue;
			const input = this.resolveIntentPlayerInput(component, owner);
			if (!input) continue;
			for (let index = 0; index < component.bindings.length; index++) {
				const binding = component.bindings[index]!;
				this.evaluateIntentBinding(owner, input, binding);
			}
		}
	}

	private processInputActionPrograms(): void {
		for (let [obj, component] of filter_iterable($.world.objects_with_components(InputActionEffectComponent, { scope: 'active' }), (item: [ WorldObject, InputActionEffectComponent]) => this.isEligibleObject(item[0]))) {
			const program = this.resolveCompiledProgram(component);
			const programKey = this.resolveProgramKey(component, obj);
			const componentId = component.id;

			const playerIndex = obj.player_index;
			const input = $.input.getPlayerInput(playerIndex);

			const effects = obj.get_unique_component(ActionEffectComponent);
			// Programs that emit effects require ActionEffectComponent on the same object; we fail fast to keep wiring predictable.
			if (!effects && program.usesEffectTriggers) {
				throw new Error(`[InputActionEffectSystem] Program '${programKey}' triggers effects but object '${obj.id}' (component '${componentId}') has no ActionEffectComponent.`);
			}

			const ownerId = effects ? (effects.parent.id ?? obj.id) : obj.id;

			const env: BindingExecutionEnv = {
				owner: obj,
				ownerId,
				playerIndex,
				input,
				effects,
				queuedCommands: [],
				queuedEvents: [],
			};

			this.evaluateProgram(program, env, programKey);
			const queuedCommands = env.queuedCommands;
			for (let idx = 0; idx < queuedCommands.length; idx++) {
				const cmd = queuedCommands[idx]!;
				obj.dispatch_command(cmd.event, cmd.payload);
			}
			const queuedEvents = env.queuedEvents;
			for (let idx = 0; idx < queuedEvents.length; idx++) {
				const evt = queuedEvents[idx]!;
				obj.emit_gameplay_fact(evt);
			}
		}
	}

	private evaluateIntentBinding(owner: WorldObject, input: PlayerInput, binding: InputIntentBinding): void {
		const action = binding.action?.trim();
		if (!action) {
			return;
		}
		const state = input.getActionState(action);
		if (state.justpressed && binding.press) {
			this.runIntentAssignments(owner, input, binding, 'press', binding.press);
		}
		if (state.pressed && binding.hold) {
			this.runIntentAssignments(owner, input, binding, 'hold', binding.hold);
		}
		if (state.justreleased && binding.release) {
			this.runIntentAssignments(owner, input, binding, 'release', binding.release);
		}
	}

	private runIntentAssignments(
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

	private resolveIntentPlayerInput(component: InputIntentComponent, owner: WorldObject): PlayerInput {
		const explicitIndex = component.playerIndex ?? 0;
		const fallback = (owner as { player_index?: number }).player_index ?? 0;
		const resolved = explicitIndex > 0 ? explicitIndex : fallback;
		// Require a positive player index; avoids silently reading player 0 (unset) and keeps intent bindings deterministic.
		if (resolved <= 0) {
			throw new Error(`[InputActionEffectSystem] Unable to resolve player index for object '${owner.id ?? '<unknown>'}'.`);
		}
		return $.input.getPlayerInput(resolved);
	}

	private resolveProgramKey(component: InputActionEffectComponent, owner: WorldObject): string {
		if (component.program_id) return component.program_id;
		return `inline:${owner.id}`;
	}

	private describeInlineProgram(component: InputActionEffectComponent): string {
		let ownerId: string;
		if (component.parent.id) {
			ownerId = component.parent.id;
		} else {
			ownerId = '<unattached>';
		}
		let componentId: string;
		if (component.id) {
			componentId = component.id;
		} else if (component.id_local) {
			componentId = component.id_local;
		} else {
			componentId = component.constructor.name;
		}
		return `inline:${ownerId}:${componentId}`;
	}

	private isEligibleObject(obj: WorldObject): boolean {
		if (obj.dispose_flag) return false;
		if (obj.active === false) return false;
		if (!obj.tick_enabled) return false;
		return true;
	}

	private evaluateProgram(
		program: CompiledProgram,
		env: BindingExecutionEnv,
		programKey: string,
	): void {
		const { input } = env;
		const bindings = program.bindings;
		for (let i = 0; i < bindings.length; i++) {
			const binding = bindings[i]!;
			if (!binding.predicate(env)) continue;

			const bindingKey = this.makeBindingKey(env.ownerId, programKey, env.playerIndex, binding, i);
			const armed = this.bindingLatch.get(bindingKey) === true;
			if (armed) this.frameLatchTouched.add(bindingKey);

			const pressMatched = binding.press ? binding.press(input) : false;
			const holdMatched = binding.hold ? binding.hold(input) : false;
			const releaseMatched = binding.release ? binding.release(input) : false;
			const customEdges = binding.customEdges;
			if (!armed && !pressMatched && !holdMatched && !releaseMatched && customEdges.length === 0) continue;

			const scratch = this.ensureScratch(customEdges.length);
			for (let j = 0; j < customEdges.length; j++) {
				scratch[j] = customEdges[j]!.match(input);
			}

			let matched = false;
			const runEffect = (effect: EffectExecutor): boolean => {
				if (!effect) return false;
				effect(env);
				return true;
			};

			if (pressMatched) {
				matched = true;
				if (binding.pressEffect) {
					if (runEffect(binding.pressEffect)) {
						this.bindingLatch.set(bindingKey, true);
						this.frameLatchTouched.add(bindingKey);
					}
				} else {
					this.bindingLatch.set(bindingKey, true);
					this.frameLatchTouched.add(bindingKey);
				}
			}
			if (holdMatched) {
				matched = true;
				if (binding.holdEffect) runEffect(binding.holdEffect);
				this.bindingLatch.set(bindingKey, true);
				this.frameLatchTouched.add(bindingKey);
			}
			if (releaseMatched && armed) {
				if (binding.releaseEffect && runEffect(binding.releaseEffect)) {
					matched = true;
				} else if (binding.releaseEffect === undefined) {
					matched = true;
				}
				this.bindingLatch.delete(bindingKey);
			}

			for (let j = 0; j < customEdges.length; j++) {
				if (!scratch[j]) continue;
				const effect = customEdges[j]!.effect;
				if (effect) {
					if (runEffect(effect)) matched = true;
				} else {
					matched = true;
				}
			}

			if (matched && program.evalMode === 'first') return;
		}
	}

	private makeBindingKey(ownerId: string, programKey: string, playerIndex: number, binding: CompiledBinding, index: number): string {
		const name = binding.name ?? `#${index}`;
		return `${ownerId}|${programKey}|p${playerIndex}|${name}|${index}`;
	}

	private ensureScratch(size: number): boolean[] {
		if (this.customMatchScratch.length < size) {
			const previousLength = this.customMatchScratch.length;
			this.customMatchScratch.length = size;
			for (let i = previousLength; i < size; i++) this.customMatchScratch[i] = false;
		}
		return this.customMatchScratch;
	}

	private resolveCompiledProgram(component: InputActionEffectComponent): CompiledProgram {
		if (component.program) {
			const program = component.program;
			if (!this.validatedInlinePrograms.has(program)) {
				const inlineId = this.describeInlineProgram(component);
				validateProgramEffects(program, inlineId);
				this.validatedInlinePrograms.add(program);
			}
			let compiled = this.inlineCompiled.get(program);
			if (!compiled) {
				compiled = compileProgram(program, pattern => this.parsePattern(pattern));
				this.inlineCompiled.set(program, compiled);
			}
			return compiled;
		}

		const programId = component.program_id;
		if (!programId) {
			const hostId = component.parent.id ?? component.id ?? '<unknown object>';
			throw new Error(`[InputActionEffectSystem] Component '${component.constructor.name}' on '${hostId}' is missing both an inline program and a programId.`);
		}

		let compiled = this.compiledById.get(programId);
		if (compiled) return compiled;

		const program = this.resolveProgramById(programId);

		compiled = compileProgram(program, pattern => this.parsePattern(pattern));
		this.compiledById.set(programId, compiled);
		return compiled;
	}

	private resolveProgramById(programId: string): InputActionEffectProgram {
		const cached = this.resolvedPrograms.get(programId);
		if (cached) return cached;
		if (this.missingProgramIds.has(programId)) {
			throw new Error(`[InputActionEffectSystem] Program '${programId}' is marked as missing.`);
		}

		const data = $.assets.data[tokenKeyFromId(programId) as keyof typeof $.assets.data];
		if (!isInputActionEffectProgram(data)) {
			this.missingProgramIds.add(programId);
			throw new Error(`[InputActionEffectSystem] Program '${programId}' not found or invalid.`);
		}

		this.resolvedPrograms.set(programId, data);
		return data;
	}

	private parsePattern(pattern: string): PatternPredicate {
		let predicate = this.patternCache.get(pattern);
		if (predicate) return predicate;
		predicate = (input: PlayerInput) => input.checkActionTriggered(pattern);
		this.patternCache.set(pattern, predicate);
		if (this.patternCache.size > this.patternCacheMax) {
			const iterator = this.patternCache.keys();
			const firstKey = iterator.next().value as string;
			if (firstKey !== undefined && firstKey !== pattern) this.patternCache.delete(firstKey);
		}
		return predicate;
	}
}
