import { has_own } from '../utils/has_own';
import type { PlayerInput } from '../input/playerinput';
import type {
	InputActionEffectProgram,
	Binding,
	Effect,
	ActionEffectTriggerDescriptor,
	EmitGameplayDescriptor,
} from './input_action_effect_dsl';
import { create_gameevent, type GameEvent } from '../core/game_event';
import type { ActionEffectId } from './effect_types';
import type { ActionEffectComponent } from '../component/actioneffectcomponent';
import type { WorldObject } from '../core/object/worldobject';
import { ActionEffectRegistry } from './effect_registry';

export interface BindingExecutionEnv {
	owner: WorldObject;
	ownerId: string;
	playerIndex: number;
	input: PlayerInput;
	effects?: ActionEffectComponent;
	queuedEvents: GameEvent[];
}

export type PatternPredicate = (input: PlayerInput) => boolean;
export type EffectExecutor = (env: BindingExecutionEnv) => void;

export interface CompiledCustomEdge {
	name: string;
	match: PatternPredicate;
	effect?: EffectExecutor;
}

type BindingAnalysis = {
	usesEffectTriggers: boolean;
};

export interface CompiledBinding {
	name?: string;
	priority: number;
	predicate: (env: BindingExecutionEnv) => boolean;
	press?: PatternPredicate;
	hold?: PatternPredicate;
	release?: PatternPredicate;
	pressEffect?: EffectExecutor;
	holdEffect?: EffectExecutor;
	releaseEffect?: EffectExecutor;
	customEdges: CompiledCustomEdge[];
	usesEffectTriggers: boolean;
}

export interface CompiledProgram {
	evalMode: 'first' | 'all';
	priority: number;
	bindings: CompiledBinding[];
	usesEffectTriggers: boolean;
}

export type PatternParser = (pattern: string) => PatternPredicate;

export function compileProgram(program: InputActionEffectProgram, parse: PatternParser): CompiledProgram {
	const progPriority = program.priority ?? 0;
	const evalMode = program.eval ?? 'first';
	const bindings = program.bindings ?? [];

	const compiledEntries = bindings.map((binding, index) => ({
		index,
		compiled: compileBinding(binding, parse),
	}));

	compiledEntries.sort((a, b) => {
		const prio = b.compiled.priority - a.compiled.priority;
		if (prio !== 0) return prio;
		return a.index - b.index;
	});

	let usesEffectTriggers = false;
	for (let i = 0; i < compiledEntries.length; i++) {
		const entry = compiledEntries[i]!;
		if (entry.compiled.usesEffectTriggers) usesEffectTriggers = true;
	}

	return {
		evalMode,
		priority: progPriority,
		bindings: compiledEntries.map(entry => entry.compiled),
		usesEffectTriggers,
	};
}

function compileBinding(binding: Binding, parse: PatternParser): CompiledBinding {
	const priority = binding.priority ?? 0;
	const analysis: BindingAnalysis = {
		usesEffectTriggers: false,
	};
	const predicate = compilePredicate(binding);
	if (!binding.on) {
		throw new Error(`[InputActionEffectCompiler] Binding '${binding.name ?? '(unnamed)'}' is missing an 'on' clause.`);
	}
	const press = binding.on.press ? parse(binding.on.press) : undefined;
	const hold = binding.on.hold ? parse(binding.on.hold) : undefined;
	const release = binding.on.release ? parse(binding.on.release) : undefined;
	const customEntries = binding.on.custom ?? [];
	const customEffects = compileCustomEffects(binding, analysis);
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
		pressEffect: compileEffectList(binding.do?.press, 'press', analysis),
		holdEffect: compileEffectList(binding.do?.hold, 'hold', analysis),
		releaseEffect: compileEffectList(binding.do?.release, 'release', analysis),
		customEdges,
		usesEffectTriggers: analysis.usesEffectTriggers,
	};
}

function compilePredicate(binding: Binding): (env: BindingExecutionEnv) => boolean {
	const when = binding.when;
	if (!when) return () => true;

	const modePred = when.mode;
	const modeItems = modePred ? (Array.isArray(modePred) ? modePred : [modePred]) : undefined;
	if (modeItems) {
		for (let i = 0; i < modeItems.length; i++) {
			const item = modeItems[i]!;
			if (!item.path) {
				throw new Error(`[InputActionEffectCompiler] 'mode' clause missing 'path' in binding '${binding.name ?? '(unnamed)'}'.`);
			}
		}
	}

	if (!modeItems) return () => true;

	return (env: BindingExecutionEnv) => {
		for (let i = 0; i < modeItems.length; i++) {
			const entry = modeItems[i]!;
			const entryPath = entry.path!;
			const matches = env.owner.sc.matches_state_path(entryPath);
			if (entry.not) {
				if (matches) return false;
			} else if (!matches) {
				return false;
			}
		}
		return true;
	};
}

function compileCustomEffects(binding: Binding, analysis: BindingAnalysis): Map<string, EffectExecutor> {
	const map = new Map<string, EffectExecutor>();
	const table = binding.do ?? {};
	for (const key of Object.keys(table)) {
		if (key === 'press' || key === 'hold' || key === 'release') continue;
		map.set(key, compileEffectList(table[key], key, analysis));
	}
	return map;
}

function compileEffectList(spec: Effect | Effect[], slot?: string, analysis?: BindingAnalysis): EffectExecutor {
	if (!spec) return undefined;
	const entries = Array.isArray(spec) ? spec : [spec];
	const executors: EffectExecutor[] = [];
	for (let i = 0; i < entries.length; i++) {
		executors.push(compileEffect(entries[i]!, slot, analysis));
	}
	if (executors.length === 0) throw new Error(`Empty effect list in slot '${slot ?? 'unknown'}'.`);
	if (executors.length === 1) return executors[0];
	return (env: BindingExecutionEnv) => {
		for (let i = 0; i < executors.length; i++) {
			executors[i](env);
		}
	};
}

function compileEffect(effect: Effect, slot?: string, analysis?: BindingAnalysis): EffectExecutor {
	if (isEffectTrigger(effect)) {
		if (analysis) analysis.usesEffectTriggers = true;
		const spec = effect['effect.trigger'];
		if (!spec) throw new Error(`Missing effect trigger in effect ${JSON.stringify(effect)}`);
		if (typeof spec === 'string') {
			return (env: BindingExecutionEnv) => {
				executeEffectTrigger(env, spec as ActionEffectId);
			};
		}
		return (env: BindingExecutionEnv) => {
			if (spec.payload === undefined) executeEffectTrigger(env, spec.id as ActionEffectId);
			else executeEffectTrigger(env, spec.id as ActionEffectId, spec.payload);
		};
	}
	if (isInputConsume(effect)) {
		const actions = Array.isArray(effect['input.consume']) ? effect['input.consume'] : [effect['input.consume']];
		if (actions.length === 0) throw new Error(`Empty actions in input.consume effect ${JSON.stringify(effect)}`);
		return (env: BindingExecutionEnv) => {
			for (let i = 0; i < actions.length; i++) {
				env.input.consumeAction(actions[i]!);
			}
		};
	}
	if (isGameplayEmit(effect)) {
		const { event, payload } = effect['emit.gameplay'];
		if (!event) throw new Error(`Missing event name in emit.gameplay effect ${JSON.stringify(effect)}`);
		return (env: BindingExecutionEnv) => {
			const evt = create_gameevent({ type: event, ...(payload ?? {}) });
			env.queuedEvents.push(evt);
		};
	}
	if (isNestedCommands(effect)) {
		const nested = compileEffectList(effect.commands, slot, analysis);
		if (!nested) throw new Error(`Empty commands in nested effect ${JSON.stringify(effect)}`);
		return nested;
	}
	throw new Error(`[InputActionEffectCompiler] Unknown effect in slot '${slot ?? 'unknown'}': ${JSON.stringify(effect)}`);
}

function executeEffectTrigger(env: BindingExecutionEnv, id: ActionEffectId, payload?: unknown) {
	const effects = env.effects;
	if (!effects) {
		throw new Error(`[InputActionEffectCompiler] Effect trigger '${id}' attempted without ActionEffectComponent on '${env.ownerId}'.`);
	}
	const result = effects.trigger(id, payload);
	return result;
}

type ValidationContext = {
	programId: string;
	bindingName: string;
	slot: string;
};

export function validateProgramEffects(program: InputActionEffectProgram, programId: string): void {
	const bindings = program.bindings;
	for (let index = 0; index < bindings.length; index++) {
		const binding = bindings[index]!;
		const bindingName = binding.name ? binding.name : `#${index}`;
		const table = binding.do;
		if (!table) {
			throw new Error(`[InputActionEffectProgramValidation] Program '${programId}' binding '${bindingName}' missing effect table.`);
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
function validateEffectSpec(spec: Effect | Effect[], ctx: ValidationContext): void {
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
	if (isEffectTrigger(effect)) {
		const descriptor = effect['effect.trigger'];
		if (!descriptor) {
			throw new Error(`[InputActionEffectProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' missing effect trigger descriptor.`);
		}
		let effectId: ActionEffectId;
		let payload: unknown;
		if (typeof descriptor === 'string') {
			effectId = descriptor as ActionEffectId;
			payload = undefined;
		} else {
			const id = descriptor.id;
			if (!id) {
				throw new Error(`[InputActionEffectProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' effect trigger missing id.`);
			}
			effectId = id as ActionEffectId;
			payload = descriptor.payload;
		}
		try {
			ActionEffectRegistry.instance.validate(effectId, payload);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`[InputActionEffectProgramValidation] Program '${ctx.programId}' binding '${ctx.bindingName}' slot '${ctx.slot}' effect '${effectId}' validation failed: ${message}`);
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

function isEffectTrigger(effect: Effect): effect is { 'effect.trigger': ActionEffectId | ActionEffectTriggerDescriptor } {
	return has_own(effect, 'effect.trigger');
}

function isInputConsume(effect: Effect): effect is { 'input.consume': string | string[] } {
	return has_own(effect, 'input.consume');
}

function isGameplayEmit(effect: Effect): effect is { 'emit.gameplay': EmitGameplayDescriptor } {
	return has_own(effect, 'emit.gameplay');
}

function isNestedCommands(effect: Effect): effect is { commands: Effect[] } {
	return has_own(effect, 'commands');
}
