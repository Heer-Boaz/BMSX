import { hasOwn } from '../utils/utils';
import type { AbilityId, AbilityRequestOptions, AbilityRequestResult } from '../gas/gastypes';
import { abilityRegistry } from './ability_registry';
import type { PlayerInput } from '../input/playerinput';
import type { InputAbilityProgram, Binding, Effect, AbilityRequestDescriptor, EmitGameplayDescriptor } from './input_ability_dsl';
import { createGameEvent, type GameEvent } from '../core/game_event';

export interface EvalContext {
	owner_id: string;
	playerIndex: number;
	hasTag: (tag: string) => boolean;
	matchesMode: (path: string) => boolean;
	requestAbility: <Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>) => AbilityRequestResult;
	consume: (actions: string[]) => void;
	pushEvent?: (event: GameEvent) => void;
}

export type PatternPredicate = (input: PlayerInput) => boolean;
export type EffectExecutor = (ctx: EvalContext) => void;

export interface CompiledCustomEdge {
	name: string;
	match: PatternPredicate;
	effect?: EffectExecutor;
}

export interface CompiledBinding {
	name?: string;
	priority: number;
	predicate: (ctx: EvalContext) => boolean;
	press?: PatternPredicate;
	hold?: PatternPredicate;
	release?: PatternPredicate;
	pressEffect?: EffectExecutor;
	holdEffect?: EffectExecutor;
	releaseEffect?: EffectExecutor;
	customEdges: CompiledCustomEdge[];
}

export interface CompiledProgram {
	evalMode: 'first' | 'all';
	priority: number;
	bindings: CompiledBinding[];
}

export type PatternParser = (pattern: string) => PatternPredicate;

export function compileProgram(program: InputAbilityProgram, parse: PatternParser): CompiledProgram {
	const progPriority = program.priority ?? 0;
	const evalMode = program.eval ?? 'first';
	const bindings = (program.bindings ?? []);

	const compiledEntries = bindings.map((binding, index) => ({
		index,
		compiled: compileBinding(binding, parse),
	}));

	compiledEntries.sort((a, b) => {
		const prio = (b.compiled.priority - a.compiled.priority);
		if (prio !== 0) return prio;
		return a.index - b.index;
	});

	return {
		evalMode,
		priority: progPriority,
		bindings: compiledEntries.map(entry => entry.compiled),
	};
}

function compileBinding(binding: Binding, parse: PatternParser): CompiledBinding {
	const priority = binding.priority ?? 0;
	const predicate = compilePredicate(binding);
	if (!binding.on) {
		throw new Error(`[InputAbilityCompiler] Binding '${binding.name ?? '(unnamed)'}' is missing an 'on' clause.`);
	}
	const press = binding.on.press ? parse(binding.on.press) : undefined;
	const hold = binding.on.hold ? parse(binding.on.hold) : undefined;
	const release = binding.on.release ? parse(binding.on.release) : undefined;
	const customEntries = binding.on.custom ?? [];
	const customEffects = compileCustomEffects(binding);
	const customEdges = customEntries.map(item => ({
		name: item.name,
		match: parse(item.pattern),
		effect: customEffects.get(item.name),
	}));

	return {
		name: binding.name,
		priority,
		predicate,
		press,
		hold,
		release,
		pressEffect: compileEffectList(binding.do?.press, 'press'),
		holdEffect: compileEffectList(binding.do?.hold, 'hold'),
		releaseEffect: compileEffectList(binding.do?.release, 'release'),
		customEdges,
	};
}

function compilePredicate(binding: Binding): (ctx: EvalContext) => boolean {
	const when = binding.when;
	if (!when) return () => true;

	const tagPred = when.tags;
	const modePred = when.mode;
	const modeItems = modePred ? (Array.isArray(modePred) ? modePred : [modePred]) : undefined;
	if (modeItems) {
		for (let i = 0; i < modeItems.length; i++) {
			const item = modeItems[i]!;
			if (!item.path) {
				throw new Error(`[InputAbilityCompiler] 'mode' clause missing 'path' in binding '${binding.name ?? '(unnamed)'}'.`);
			}
		}
	}

	return (ctx: EvalContext) => {
		if (tagPred) {
			if (tagPred.all && tagPred.all.some(tag => !ctx.hasTag(tag))) return false;
			if (tagPred.any && tagPred.any.length > 0) {
				let anyOk = false;
				for (let i = 0; i < tagPred.any.length; i++) {
					if (ctx.hasTag(tagPred.any[i]!)) { anyOk = true; break; }
				}
				if (!anyOk) return false;
			}
			if (tagPred.not && tagPred.not.some(tag => ctx.hasTag(tag))) return false;
		}

		if (modeItems) {
			for (let i = 0; i < modeItems.length; i++) {
				const entry = modeItems[i]!;
				const entryPath = entry.path!;
				const matches = ctx.matchesMode(entryPath);
				if (entry.not) {
					if (matches) return false;
				} else if (!matches) {
					return false;
				}
			}
		}

		return true;
	};
}

function compileCustomEffects(binding: Binding): Map<string, EffectExecutor | undefined> {
	const map = new Map<string, EffectExecutor | undefined>();
	const table = binding.do ?? {};
	for (const key of Object.keys(table)) {
		if (key === 'press' || key === 'hold' || key === 'release') continue;
		map.set(key, compileEffectList(table[key]));
	}
	return map;
}

function compileEffectList(spec: Effect | Effect[] | undefined, slot?: string): EffectExecutor | undefined {
	if (!spec) return undefined;
	const entries = Array.isArray(spec) ? spec : [spec];
	const executors: EffectExecutor[] = [];
	for (let i = 0; i < entries.length; i++) {
		executors.push(compileEffect(entries[i]!, slot));
	}
	if (executors.length === 0) throw new Error(`Empty effect list in slot '${slot ?? 'unknown'}'.`);
	if (executors.length === 1) return executors[0];
	return (ctx: EvalContext) => {
		for (let i = 0; i < executors.length; i++) {
			executors[i](ctx);
		}
	};
}

function compileEffect(effect: Effect, slot?: string): EffectExecutor {
	if (isAbilityRequest(effect)) {
		const spec = effect['ability.request'];
		if (!spec) throw new Error(`Missing ability request in effect ${JSON.stringify(effect)}`);
		if (typeof spec === 'string') {
			return (ctx: EvalContext) => {
				const result = ctx.requestAbility(spec);
				if (result && result.ok === false) {
					const detail = result.reason ?? 'unknown';
					throw new Error(`[InputAbilityCompiler] Ability request '${spec}' for owner '${ctx.owner_id}' failed: ${detail}`);
				}
			};
		}
		return (ctx: EvalContext) => {
			if (spec.payload === undefined) {
				const result = ctx.requestAbility(spec.id);
				if (result && result.ok === false) {
					const detail = result.reason ?? 'unknown';
					throw new Error(`[InputAbilityCompiler] Ability request '${spec.id}' for owner '${ctx.owner_id}' failed: ${detail}`);
				}
			} else {
				const result = ctx.requestAbility(spec.id, { payload: spec.payload } as any);
				if (result && result.ok === false) {
					const detail = result.reason ?? 'unknown';
					throw new Error(`[InputAbilityCompiler] Ability request '${spec.id}' for owner '${ctx.owner_id}' failed: ${detail}`);
				}
			}
		};
	}
	if (isInputConsume(effect)) {
		const actions = Array.isArray(effect['input.consume']) ? effect['input.consume'] : [effect['input.consume']];
		if (actions.length === 0) throw new Error(`Empty actions in input.consume effect ${JSON.stringify(effect)}`);
		return (ctx: EvalContext) => ctx.consume(actions);
	}
	if (isGameplayEmit(effect)) {
		const { event, payload } = effect['emit.gameplay'];
		if (!event) throw new Error(`Missing event name in emit.gameplay effect ${JSON.stringify(effect)}`);
		return (ctx: EvalContext) => {
			if (!ctx.pushEvent) {
				throw new Error(`[InputAbilityCompiler] emit.gameplay used in slot '${slot ?? 'unknown'}' without pushEvent handler.`);
			}
			const evt = createGameEvent({ type: event, lane: 'gameplay', ...(payload ?? {}) });
			ctx.pushEvent(evt);
		};
	}
	if (isNestedCommands(effect)) {
		const nested = compileEffectList(effect.commands, slot);
		if (!nested) throw new Error(`Empty commands in nested effect ${JSON.stringify(effect)}`);
		return nested;
	}
	throw new Error(`[InputAbilityCompiler] Unknown effect in slot '${slot ?? 'unknown'}': ${JSON.stringify(effect)}`);
}

type ValidationContext = {
	programId: string;
	bindingName: string;
	slot: string;
};

export function validateProgramAbilities(program: InputAbilityProgram, programId: string): void {
	const bindings = program.bindings;
	for (let index = 0; index < bindings.length; index++) {
		const binding = bindings[index]!;
		const bindingName = binding.name ? binding.name : `#${index}`;
		const table = binding.do;
		if (!table) {
			throw new Error(`[InputAbilityProgramValidation] Program '${programId}' binding '${bindingName}' missing effect table.`);
		}
		validateEffectSpec(table.press, { programId, bindingName, slot: 'press' });
		validateEffectSpec(table.hold, { programId, bindingName, slot: 'hold' });
		validateEffectSpec(table.release, { programId, bindingName, slot: 'release' });
		const keys = Object.keys(table);
		for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
			const key = keys[keyIndex]!;
			if (key === 'press' || key === 'hold' || key === 'release') continue;
			const customSpec = table[key];
			if (!customSpec) continue;
			const slot = `custom:${key}`;
			validateEffectSpec(customSpec, { programId, bindingName, slot });
		}
	}
}
function validateEffectSpec(spec: Effect | Effect[] | undefined, ctx: ValidationContext): void {
	if (!spec) return;
	if (Array.isArray(spec)) {
		for (let i = 0; i < spec.length; i++) {
			const entry = spec[i]!;
			const slot = `${ctx.slot}[${i}]`;
			validateEffect(entry, { programId: ctx.programId, bindingName: ctx.bindingName, slot });
		}
		return;
	}
	validateEffect(spec, ctx);
}

function validateEffect(effect: Effect, ctx: ValidationContext): void {
	if (isAbilityRequest(effect)) {
		const descriptor = effect['ability.request'];
		if (!descriptor) {
			throw new Error(`[InputAbilityProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' missing ability request descriptor.`);
		}
		let abilityId: AbilityId;
		let payload: unknown;
		if (typeof descriptor === 'string') {
			abilityId = descriptor as AbilityId;
			payload = undefined;
		} else {
			const id = descriptor.id;
			if (!id) {
				throw new Error(`[InputAbilityProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' ability request missing id.`);
			}
			abilityId = id as AbilityId;
			payload = descriptor.payload;
		}
		try {
			abilityRegistry.validate(abilityId, payload);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`[InputAbilityProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' ability '${abilityId}' validation failed: ${message}`);
		}
		return;
	}
	if (isNestedCommands(effect)) {
		const commands = effect.commands;
		for (let i = 0; i < commands.length; i++) {
			const nested = commands[i]!;
			const slot = `${ctx.slot}.commands[${i}]`;
			validateEffect(nested, { programId: ctx.programId, bindingName: ctx.bindingName, slot });
		}
	}
}

function isAbilityRequest(effect: Effect): effect is { 'ability.request': AbilityId | AbilityRequestDescriptor } {
	return hasOwn(effect, 'ability.request');
}

function isInputConsume(effect: Effect): effect is { 'input.consume': string | string[] } {
	return hasOwn(effect, 'input.consume');
}

function isGameplayEmit(effect: Effect): effect is { 'emit.gameplay': EmitGameplayDescriptor } {
	return hasOwn(effect, 'emit.gameplay');
}

function isNestedCommands(effect: Effect): effect is { commands: Effect[] } {
	return hasOwn(effect, 'commands');
}
