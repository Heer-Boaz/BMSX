import { $ } from '../core/game';
import type { World } from '../core/world';
import type { PlayerInput } from '../input/playerinput';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import type { WorldObject } from '../core/object/worldobject';
import { InputAbilityComponent } from './inputabilitycomponent';
import { compileProgram, type CompiledProgram, type EvalContext, type PatternPredicate } from './input_ability_compiler';
import { isInputAbilityProgram, type InputAbilityProgram } from './input_ability_dsl';

export class InputAbilitySystem extends ECSystem {
	private readonly compiledById = new Map<string, CompiledProgram>();
	private readonly inlineCompiled = new WeakMap<InputAbilityProgram, CompiledProgram>();
	private readonly resolvedPrograms = new Map<string, InputAbilityProgram>();
	private readonly missingProgramIds = new Set<string>();
	private readonly patternCache = new Map<string, PatternPredicate>();
	private readonly customMatchScratch: boolean[] = [];

	constructor(priority = 0) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'inputAbilitySystem';
	}

	public override update(world: World): void {
		const objects = world.activeObjects;
		for (let i = 0; i < objects.length; i++) {
			const obj = objects[i]!;
			if (!this.isEligibleObject(obj)) continue;

			const component = obj.getUniqueComponent(InputAbilityComponent);
			if (!component) continue;

			const program = this.resolveCompiledProgram(component);
			if (!program) continue;

			const componentPlayerIndex = component.playerIndex ?? 0;
			const fallbackPlayerIndex = this.extractObjectPlayerIndex(obj) ?? 0;
			const playerIndex = componentPlayerIndex > 0 ? componentPlayerIndex : fallbackPlayerIndex;
			if (!playerIndex) continue;

			const input = $.input.getPlayerInput(playerIndex);
			if (!input) continue;

			const asc = obj.getUniqueComponent(AbilitySystemComponent);
			if (!asc) continue;

			const ownerId = asc.ownerId ?? obj.id;

			const ctx: EvalContext = {
				ownerId,
				playerIndex,
				hasTag: (tag: string) => asc.hasGameplayTag(tag),
				matchesMode: (path: string) => (obj.sc ? obj.sc.matches_state_path(path) ?? false : false),
				pushActivate: (id, payload, source) => {
					GameplayCommandBuffer.instance.push({ kind: 'ActivateAbility', owner: ownerId, abilityId: id, payload, source });
				},
				consume: (actions: string[]) => {
					for (let idx = 0; idx < actions.length; idx++) {
						input.consumeAction(actions[idx]!);
					}
				},
				pushEvent: (event, payload) => {
					GameplayCommandBuffer.instance.push({ kind: 'dispatchEvent', target_id: obj.id, event, emitter_id: ownerId, payload });
				},
			};

			this.evaluateProgram(program, input, ctx);
		}
	}

	private isEligibleObject(obj: WorldObject): boolean {
		if (obj.disposeFlag) return false;
		if (obj.active === false) return false;
		if (!obj.tickEnabled) return false;
		return true;
	}

	private evaluateProgram(program: CompiledProgram, input: PlayerInput, ctx: EvalContext): void {
		const bindings = program.bindings;
		for (let i = 0; i < bindings.length; i++) {
			const binding = bindings[i]!;
			if (!binding.predicate(ctx)) continue;

			const pressMatched = binding.press ? binding.press(input) : false;
			const holdMatched = binding.hold ? binding.hold(input) : false;
			const releaseMatched = binding.release ? binding.release(input) : false;

			const customEdges = binding.customEdges;
			const scratch = this.ensureScratch(customEdges.length);
			for (let j = 0; j < customEdges.length; j++) {
				scratch[j] = customEdges[j]!.match(input);
			}

			let matched = false;
			if (pressMatched && binding.pressEffect) {
				binding.pressEffect(ctx);
				matched = true;
			}
			if (holdMatched && binding.holdEffect) {
				binding.holdEffect(ctx);
				matched = true;
			}
			if (releaseMatched && binding.releaseEffect) {
				binding.releaseEffect(ctx);
				matched = true;
			}

			for (let j = 0; j < customEdges.length; j++) {
				if (!scratch[j]) continue;
				const effect = customEdges[j]!.effect;
				if (effect) {
					effect(ctx);
					matched = true;
				} else {
					matched = true;
				}
			}

			if (matched && program.evalMode === 'first') return;
		}
	}

	private ensureScratch(size: number): boolean[] {
		if (this.customMatchScratch.length < size) {
			const previousLength = this.customMatchScratch.length;
			this.customMatchScratch.length = size;
			for (let i = previousLength; i < size; i++) this.customMatchScratch[i] = false;
		}
		return this.customMatchScratch;
	}

	private resolveCompiledProgram(component: InputAbilityComponent): CompiledProgram | null {
		if (component.program) {
			let compiled = this.inlineCompiled.get(component.program);
			if (!compiled) {
				compiled = compileProgram(component.program, pattern => this.parsePattern(pattern));
				this.inlineCompiled.set(component.program, compiled);
			}
			return compiled;
		}

		const programId = component.programId;
		if (!programId) return null;

		let compiled = this.compiledById.get(programId);
		if (compiled) return compiled;

		const program = this.resolveProgramById(programId);
		if (!program) return null;

		compiled = compileProgram(program, pattern => this.parsePattern(pattern));
		this.compiledById.set(programId, compiled);
		return compiled;
	}

	private resolveProgramById(programId: string): InputAbilityProgram | null {
		const cached = this.resolvedPrograms.get(programId);
		if (cached) return cached;
		if (this.missingProgramIds.has(programId)) return null;

		const rompack = $.rompack;
		const data = rompack?.data?.[programId as keyof typeof rompack.data];
		if (!isInputAbilityProgram(data)) {
			this.missingProgramIds.add(programId);
			console.warn(`[InputAbilitySystem] Program '${programId}' not found or invalid.`);
			return null;
		}

		this.resolvedPrograms.set(programId, data);
		return data;
	}

	private extractObjectPlayerIndex(obj: WorldObject): number | undefined {
		if (!Object.prototype.hasOwnProperty.call(obj, 'player_index')) return undefined;
		const candidate = (obj as { player_index?: unknown }).player_index;
		if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
		return undefined;
	}

	private parsePattern(pattern: string): PatternPredicate {
		let predicate = this.patternCache.get(pattern);
		if (predicate) return predicate;
		predicate = (input: PlayerInput) => input.checkActionTriggered(pattern);
		this.patternCache.set(pattern, predicate);
		return predicate;
	}
}
