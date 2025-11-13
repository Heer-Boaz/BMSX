import { $ } from '../core/game';
import type { PlayerInput } from '../input/playerinput';
import { ECSystem, TickGroup } from './ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import type { AbilityId, AbilityRequestOptions } from '../gas/gastypes';
import { GameplayCommandBuffer } from './gameplay_command_buffer';
import type { WorldObject } from '../core/object/worldobject';
import { InputAbilityComponent } from '../component/inputabilitycomponent';
import { compileProgram, validateProgramAbilities, type CompiledProgram, type CompiledBinding, type EvalContext, type PatternPredicate, type EffectExecutor } from '../gas/input_ability_compiler';
import { isInputAbilityProgram, type InputAbilityProgram } from '../gas/input_ability_dsl';
import { filter_iterable } from 'bmsx/utils/filter_iterable';
import type { GameEvent } from '../core/game_event';

let assetProgramsValidated = false;

function validateProgramAssetsOnBoot(): void {
	if (assetProgramsValidated) return;
	const rompack = $.rompack;
	if (!rompack) {
		throw new Error('[InputAbilitySystem] Rompack unavailable while validating input ability programs.');
	}
	const data = rompack.data;
	if (!data || typeof data !== 'object') {
		throw new Error('[InputAbilitySystem] Rompack data unavailable while validating input ability programs.');
	}
	const entries = Object.keys(data);
	for (let i = 0; i < entries.length; i++) {
		const key = entries[i]!;
		const value = (data as Record<string, unknown>)[key];
		if (!isInputAbilityProgram(value)) continue;
		validateProgramAbilities(value, key);
	}
	assetProgramsValidated = true;
}

export class InputAbilitySystem extends ECSystem {
	private readonly compiledById = new Map<string, CompiledProgram>();
	private readonly inlineCompiled = new WeakMap<InputAbilityProgram, CompiledProgram>();
	private readonly validatedInlinePrograms = new WeakSet<InputAbilityProgram>();
	private readonly resolvedPrograms = new Map<string, InputAbilityProgram>();
	private readonly missingProgramIds = new Set<string>();
	private readonly patternCache = new Map<string, PatternPredicate>();
	private readonly patternCacheMax = 256;
	private readonly customMatchScratch: boolean[] = [];
	private readonly bindingLatch = new Map<string, boolean>();
	private readonly frameLatchTouched = new Set<string>();

	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		validateProgramAssetsOnBoot();
		this.__ecsId = 'inputAbilitySystem';
	}

	public override update(): void {
		this.frameLatchTouched.clear();
		for (let [obj, component] of filter_iterable($.world.objectsWithComponents(InputAbilityComponent, { scope: 'active' }), (item: [ WorldObject, InputAbilityComponent]) => this.isEligibleObject(item[0]))) {
			const program = this.resolveCompiledProgram(component);

			const componentPlayerIndex = component.playerIndex ?? 0;
			const fallbackPlayerIndex = obj.player_index ?? 0;
			const playerIndex = componentPlayerIndex > 0 ? componentPlayerIndex : fallbackPlayerIndex;
			if (playerIndex <= 0) {
				const componentId = component.id ?? component.id_local ?? component.constructor.name;
				throw new Error(`[InputAbilitySystem] Unable to resolve player index for object '${obj.id}' (component '${componentId}').`);
			}

			const input = $.input.getPlayerInput(playerIndex);
			if (!input) continue;

			const asc = obj.getUniqueComponent(AbilitySystemComponent);
			if (!asc) {
				const componentId = component.id ?? component.id_local ?? component.constructor.name;
				throw new Error(`[InputAbilitySystem] AbilitySystemComponent missing on object '${obj.id}' (component '${componentId}').`);
			}

			const ownerId = asc.parentid ?? obj.id;

			const programKey = this.resolveProgramKey(component, obj);
			const queuedEvents: GameEvent[] = [];
			const ctx: EvalContext = {
				owner_id: ownerId,
				playerIndex,
				hasTag: (tag: string) => asc.hasGameplayTag(tag),
				matchesMode: (path: string) => obj.sc.matches_state_path(path),
				requestAbility: <Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>) => asc.requestAbility(id, opts),
				consume: (actions: string[]) => {
					for (let idx = 0; idx < actions.length; idx++) {
						input.consumeAction(actions[idx]!);
					}
				},
				pushEvent: (event: GameEvent) => {
					queuedEvents.push(event);
				},
			};

			this.evaluateProgram(program, input, ctx, programKey);
			for (let idx = 0; idx < queuedEvents.length; idx++) {
				const evt = queuedEvents[idx]!;
				if (!evt.emitter) evt.emitter = obj;
				GameplayCommandBuffer.instance.push({
					kind: 'emit',
					target_id: obj.id,
					event: evt,
				});
			}
		}
		const latchedKeys = Array.from(this.bindingLatch.keys());
		for (let idx = 0; idx < latchedKeys.length; idx++) {
			const key = latchedKeys[idx]!;
			if (!this.frameLatchTouched.has(key)) this.bindingLatch.delete(key);
		}
	}

	private resolveProgramKey(component: InputAbilityComponent, owner: WorldObject): string {
		if (component.programId) return component.programId;
		return `inline:${owner.id}`;
	}

	private describeInlineProgram(component: InputAbilityComponent): string {
		let ownerId: string;
		if (component.parentid) {
			ownerId = component.parentid;
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
		if (obj.disposeFlag) return false;
		if (obj.active === false) return false;
		if (!obj.tickEnabled) return false;
		return true;
	}

	private evaluateProgram(
		program: CompiledProgram,
		input: PlayerInput,
		ctx: EvalContext,
		programKey: string,
	): void {
			const bindings = program.bindings;
			for (let i = 0; i < bindings.length; i++) {
				const binding = bindings[i]!;
				if (!binding.predicate(ctx)) continue;

				const bindingKey = this.makeBindingKey(ctx.owner_id, programKey, ctx.playerIndex, binding, i);
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
			const runEffect = (effect: EffectExecutor | undefined): boolean => {
				if (!effect) return false;
				effect(ctx);
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

	private resolveCompiledProgram(component: InputAbilityComponent): CompiledProgram {
		if (component.program) {
			const program = component.program;
			if (!this.validatedInlinePrograms.has(program)) {
				const inlineId = this.describeInlineProgram(component);
				validateProgramAbilities(program, inlineId);
				this.validatedInlinePrograms.add(program);
			}
			let compiled = this.inlineCompiled.get(program);
			if (!compiled) {
				compiled = compileProgram(program, pattern => this.parsePattern(pattern));
				this.inlineCompiled.set(program, compiled);
			}
			return compiled;
		}

		const programId = component.programId;
		if (!programId) {
			const hostId = component.parentid ?? component.id ?? '<unknown object>';
			throw new Error(`[InputAbilitySystem] Component '${component.constructor.name}' on '${hostId}' is missing both an inline program and a programId.`);
		}

		let compiled = this.compiledById.get(programId);
		if (compiled) return compiled;

		const program = this.resolveProgramById(programId);

		compiled = compileProgram(program, pattern => this.parsePattern(pattern));
		this.compiledById.set(programId, compiled);
		return compiled;
	}

	private resolveProgramById(programId: string): InputAbilityProgram {
		const cached = this.resolvedPrograms.get(programId);
		if (cached) return cached;
		if (this.missingProgramIds.has(programId)) {
			throw new Error(`[InputAbilitySystem] Program '${programId}' is marked as missing.`);
		}

		const rompack = $.rompack;
		const rompackData = rompack.data;
		if (!rompackData) {
			throw new Error('[InputAbilitySystem] Rompack data unavailable while resolving programs.');
		}
		const data = rompackData[programId as keyof typeof rompackData];
		if (!isInputAbilityProgram(data)) {
			this.missingProgramIds.add(programId);
			throw new Error(`[InputAbilitySystem] Program '${programId}' not found or invalid.`);
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
			const firstKey = iterator.next().value as string | undefined;
			if (firstKey !== undefined && firstKey !== pattern) this.patternCache.delete(firstKey);
		}
		return predicate;
	}
}
