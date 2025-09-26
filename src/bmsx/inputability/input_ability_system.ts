import { $ } from '../core/game';
import type { PlayerInput } from '../input/playerinput';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import type { WorldObject } from '../core/object/worldobject';
import { InputAbilityComponent } from './inputabilitycomponent';
import { compileProgram, type CompiledProgram, type CompiledBinding, type EvalContext, type PatternPredicate, type EffectExecutor } from './input_ability_compiler';
import { isInputAbilityProgram, type InputAbilityProgram } from './input_ability_dsl';
import { filterIterable } from '../utils/utils';

export class InputAbilitySystem extends ECSystem {
	private readonly compiledById = new Map<string, CompiledProgram>();
	private readonly inlineCompiled = new WeakMap<InputAbilityProgram, CompiledProgram>();
	private readonly resolvedPrograms = new Map<string, InputAbilityProgram>();
	private readonly missingProgramIds = new Set<string>();
	private readonly patternCache = new Map<string, PatternPredicate>();
	private readonly customMatchScratch: boolean[] = [];
	private readonly bindingLatch = new Map<string, boolean>();

	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'inputAbilitySystem';
	}

	public override update(): void {
		for (let [obj, component] of filterIterable($.world.objectsWithComponents(InputAbilityComponent, { scope: 'active' }), (item: [ WorldObject, InputAbilityComponent]) => this.isEligibleObject(item[0]))) {
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
			let abilityStats = { issued: false, success: false };
			const ctx = {} as EvalContext;
			ctx.ownerId = ownerId;
			ctx.playerIndex = playerIndex;
			ctx.hasTag = (tag: string) => asc.hasGameplayTag(tag);
			ctx.matchesMode = (path: string) => obj.sc.matches_state_path(path);
			ctx.consume = (actions: string[]) => {
				for (let idx = 0; idx < actions.length; idx++) {
					input.consumeAction(actions[idx]!);
				}
			};
			ctx.pushEvent = (event, payload) => {
				GameplayCommandBuffer.instance.push({ kind: 'dispatchEvent', target_id: obj.id, event, emitter_id: ownerId, payload });
			};
			ctx.onAbilityRequestFailed = (id, reason) => {
				console.warn('[InputAbilitySystem] ability request failed', { ownerId, playerIndex, abilityId: id, reason });
			};
			ctx.requestAbility = (id, opts) => {
				const res = asc.requestAbility(id, opts ?? {});
				abilityStats.issued = true;
				if (res.ok) {
					abilityStats.success = true;
				} else {
					const reason = 'reason' in res ? res.reason : 'unknown';
					ctx.onAbilityRequestFailed?.(id, reason);
				}
				return res;
			};

			this.evaluateProgram(program, input, ctx, programKey, () => {
				abilityStats = { issued: false, success: false };
			}, () => abilityStats);
		}
	}

	private resolveProgramKey(component: InputAbilityComponent, owner: WorldObject): string {
		if (component.programId) return component.programId;
		return `inline:${owner.id}`;
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
		resetAbilityStats: () => void,
		getAbilityStats: () => { issued: boolean; success: boolean },
	): void {
		const bindings = program.bindings;
		for (let i = 0; i < bindings.length; i++) {
			const binding = bindings[i]!;
			if (!binding.predicate(ctx)) continue;

			const bindingKey = this.makeBindingKey(ctx.ownerId, programKey, binding, i);
			const armed = this.bindingLatch.get(bindingKey) === true;

			const pressMatched = binding.press ? binding.press(input) : false;
			const holdMatched = binding.hold ? binding.hold(input) : false;
			const releaseMatched = binding.release ? binding.release(input) : false;

			const customEdges = binding.customEdges;
			const scratch = this.ensureScratch(customEdges.length);
			for (let j = 0; j < customEdges.length; j++) {
				scratch[j] = customEdges[j]!.match(input);
			}

			let matched = false;
			const runEffect = (effect: EffectExecutor | undefined) => {
				resetAbilityStats();
				if (!effect) return { executed: false, abilityIssued: false, abilitySuccess: false };
				effect(ctx);
				const stats = getAbilityStats();
				return { executed: true, abilityIssued: stats.issued, abilitySuccess: stats.success };
			};

			if (pressMatched && binding.pressEffect) {
				const result = runEffect(binding.pressEffect);
				matched = true;
				if (result.executed) {
					if (result.abilityIssued) {
						if (result.abilitySuccess) this.bindingLatch.set(bindingKey, true);
						else this.bindingLatch.delete(bindingKey);
					} else {
						this.bindingLatch.set(bindingKey, true);
					}
				}
			}
			if (holdMatched && binding.holdEffect) {
				const result = runEffect(binding.holdEffect);
				matched = true;
				if (result.executed) {
					if (result.abilityIssued) {
						if (result.abilitySuccess) this.bindingLatch.set(bindingKey, true);
					} else {
						this.bindingLatch.set(bindingKey, true);
					}
				}
			}
			if (releaseMatched && binding.releaseEffect && armed) {
				const result = runEffect(binding.releaseEffect);
				if (result.executed) matched = true;
				this.bindingLatch.delete(bindingKey);
			}

			for (let j = 0; j < customEdges.length; j++) {
				if (!scratch[j]) continue;
				const effect = customEdges[j]!.effect;
				if (effect) {
					runEffect(effect);
					matched = true;
				} else {
					matched = true;
				}
			}

			if (matched && program.evalMode === 'first') return;
		}
	}

	private makeBindingKey(ownerId: string, programKey: string, binding: CompiledBinding, index: number): string {
		const name = binding.name ?? `#${index}`;
		return `${ownerId}|${programKey}|${name}`;
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
			let compiled = this.inlineCompiled.get(component.program);
			if (!compiled) {
				compiled = compileProgram(component.program, pattern => this.parsePattern(pattern));
				this.inlineCompiled.set(component.program, compiled);
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
		return predicate;
	}
}
