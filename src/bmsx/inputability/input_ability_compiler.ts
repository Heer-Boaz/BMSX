import type { AbilityId, AbilityRequestResult } from '../gas/gastypes';
import type { PlayerInput } from '../input/playerinput';
import type { InputAbilityProgram, Binding, Effect, AbilityRequestDescriptor, EmitGameplayDescriptor } from './input_ability_dsl';

export interface EvalContext {
	ownerId: string;
	playerIndex: number;
	hasTag: (tag: string) => boolean;
	matchesMode: (path: string) => boolean;
	requestAbility: (id: AbilityId, opts?: { payload?: Record<string, unknown>; source?: string }) => AbilityRequestResult;
	consume: (actions: string[]) => void;
	pushEvent?: (event: string, payload?: Record<string, unknown>) => void;
	onAbilityRequestFailed?: (id: AbilityId, reason: string) => void;
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
	const press = binding.on?.press ? parse(binding.on.press) : undefined;
	const hold = binding.on?.hold ? parse(binding.on.hold) : undefined;
	const release = binding.on?.release ? parse(binding.on.release) : undefined;
	const customEffects = compileCustomEffects(binding);
	const customEdges = (binding.on?.custom ?? []).map(item => ({
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
		pressEffect: compileEffectList(binding.do?.press),
		holdEffect: compileEffectList(binding.do?.hold),
		releaseEffect: compileEffectList(binding.do?.release),
		customEdges,
	};
}

function compilePredicate(binding: Binding): (ctx: EvalContext) => boolean {
	const when = binding.when;
	if (!when) return () => true;

	const tagPred = when.tags;
	const modePred = when.mode;

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

		if (modePred) {
			const items = Array.isArray(modePred) ? modePred : [modePred];
			for (let i = 0; i < items.length; i++) {
				const entry = items[i]!;
				const path = entry.path ?? '';
				const matches = path !== '' ? ctx.matchesMode(path) : false;
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

function compileEffectList(spec: Effect | Effect[] | undefined): EffectExecutor | undefined {
	if (!spec) return undefined;
	const entries = Array.isArray(spec) ? spec : [spec];
	const executors: EffectExecutor[] = [];
	for (let i = 0; i < entries.length; i++) {
		executors.push(compileEffect(entries[i]!));
	}
	if (executors.length === 0) throw new Error(`Empty effect list in ${JSON.stringify(spec)}`);
	if (executors.length === 1) return executors[0];
	return (ctx: EvalContext) => {
		for (let i = 0; i < executors.length; i++) {
			executors[i](ctx);
		}
	};
}

function compileEffect(effect: Effect): EffectExecutor {
	if (isAbilityRequest(effect)) {
		const spec = effect['ability.request'];
		if (!spec) throw new Error(`Missing ability request in effect ${JSON.stringify(effect)}`);
		if (typeof spec === 'string') {
			return (ctx: EvalContext) => { ctx.requestAbility(spec); };
		}
		return (ctx: EvalContext) => { ctx.requestAbility(spec.id, { payload: spec.payload, source: spec.source }); };
	}
	if (isInputConsume(effect)) {
		const actions = Array.isArray(effect['input.consume']) ? effect['input.consume'] : [effect['input.consume']];
		if (actions.length === 0) throw new Error(`Empty actions in input.consume effect ${JSON.stringify(effect)}`);
		return (ctx: EvalContext) => ctx.consume(actions);
	}
	if (isGameplayEmit(effect)) {
		const { event, payload } = effect['emit.gameplay'];
		if (!event) throw new Error(`Missing event name in emit.gameplay effect ${JSON.stringify(effect)}`);
		return (ctx: EvalContext) => { if (ctx.pushEvent) ctx.pushEvent(event, payload); };
	}
	if (isNestedCommands(effect)) {
		const nested = compileEffectList(effect.commands);
		if (!nested) throw new Error(`Empty commands in nested effect ${JSON.stringify(effect)}`);
		return nested;
	}
	return () => undefined;
}

function isAbilityRequest(effect: Effect): effect is { 'ability.request': AbilityId | AbilityRequestDescriptor } {
	return Object.prototype.hasOwnProperty.call(effect, 'ability.request');
}

function isInputConsume(effect: Effect): effect is { 'input.consume': string | string[] } {
	return Object.prototype.hasOwnProperty.call(effect, 'input.consume');
}

function isGameplayEmit(effect: Effect): effect is { 'emit.gameplay': EmitGameplayDescriptor } {
	return Object.prototype.hasOwnProperty.call(effect, 'emit.gameplay');
}

function isNestedCommands(effect: Effect): effect is { commands: Effect[] } {
	return Object.prototype.hasOwnProperty.call(effect, 'commands');
}
