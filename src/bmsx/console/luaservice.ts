import { Service } from '../core/service';
import { EventEmitter, type EventHandler, type EventPayload } from '../core/eventemitter';
import type { Identifier } from '../rompack/rompack';
import type { LuaInterpreter } from '../lua/runtime.ts';
import type { LuaFunctionValue, LuaValue } from '../lua/value.ts';
import { LuaTable } from '../lua/value.ts';
import { LuaRuntimeError, LuaError } from '../lua/errors.ts';

export interface LuaServiceInterop {
	callLuaFunctionWithInterpreter(fn: LuaFunctionValue, args: unknown[], interpreter: LuaInterpreter): unknown[];
	luaValueToJs(value: LuaValue): unknown;
}

export type LuaServiceDefinition = {
	id: Identifier;
	table: LuaTable;
	interpreter: LuaInterpreter;
	autoActivate: boolean;
	stateMachines: Identifier[];
	eventHandlers: Map<string, LuaFunctionValue>;
	hooks: {
		boot?: LuaFunctionValue;
		activate?: LuaFunctionValue;
		deactivate?: LuaFunctionValue;
		dispose?: LuaFunctionValue;
		tick?: LuaFunctionValue;
		getState?: LuaFunctionValue;
		setState?: LuaFunctionValue;
	};
};

function isLuaFunction(value: unknown): value is LuaFunctionValue {
	if (!value || typeof value !== 'object') {
		return false;
	}
	return typeof (value as { call?: unknown }).call === 'function';
}

function readOptionalFunction(table: LuaTable, candidates: string[]): LuaFunctionValue | undefined {
	for (const key of candidates) {
		const value = table.get(key);
		if (value === undefined || value === null) continue;
		if (!isLuaFunction(value)) {
			throw new Error(`[LuaService] Field '${key}' must be a function.`);
		}
		return value;
	}
	return undefined;
}

function readBoolean(table: LuaTable, candidates: string[], defaultValue: boolean): boolean {
	for (const key of candidates) {
		const value = table.get(key);
		if (value === undefined || value === null) continue;
		if (typeof value !== 'boolean') {
			throw new Error(`[LuaService] Field '${key}' must be boolean.`);
		}
		return value;
	}
	return defaultValue;
}

function toIdentifierArray(raw: unknown, context: string): Identifier[] {
	if (raw === undefined || raw === null) return [];
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) {
			throw new Error(`[LuaService] ${context} contains an empty string.`);
		}
		return [trimmed as Identifier];
	}
	if (Array.isArray(raw)) {
		const result: Identifier[] = [];
		for (let index = 0; index < raw.length; index += 1) {
			const value = raw[index];
			if (typeof value !== 'string') {
				throw new Error(`[LuaService] ${context}[${index}] must be a string.`);
			}
			const trimmed = value.trim();
			if (!trimmed) {
				throw new Error(`[LuaService] ${context}[${index}] must not be empty.`);
			}
			result.push(trimmed as Identifier);
		}
		return result;
	}
	throw new Error(`[LuaService] ${context} must be a string or an array of strings.`);
}

function readStateMachineList(table: LuaTable, interop: LuaServiceInterop): Identifier[] {
	const value = table.get('machines') ?? table.get('state_machines') ?? table.get('stateMachines');
	if (value instanceof LuaTable) {
		return toIdentifierArray(interop.luaValueToJs(value), 'machines');
	}
	if (typeof value === 'string' || Array.isArray(value)) {
		return toIdentifierArray(value, 'machines');
	}
	if (value === undefined || value === null) {
		return [];
	}
	throw new Error('[LuaService] machines must be declared as a string, array, or table.');
}

function readEventHandlers(table: LuaTable, interop: LuaServiceInterop): Map<string, LuaFunctionValue> {
	const result = new Map<string, LuaFunctionValue>();
	const value = table.get('events');
	if (!(value instanceof LuaTable)) {
		return result;
	}
	for (const [rawKey, rawHandler] of value.entriesArray()) {
		const eventName = interop.luaValueToJs(rawKey);
		if (typeof eventName !== 'string' || eventName.trim().length === 0) {
			throw new Error('[LuaService] events must be keyed by non-empty strings.');
		}
		if (!isLuaFunction(rawHandler)) {
			throw new Error(`[LuaService] Event '${eventName}' must reference a function.`);
		}
		result.set(eventName, rawHandler as LuaFunctionValue);
	}
	return result;
}

export function buildLuaServiceDefinition(params: {
	table: LuaTable;
	interpreter: LuaInterpreter;
	interop: LuaServiceInterop;
}): LuaServiceDefinition {
	const { table, interpreter, interop } = params;
	const idValue = table.get('id');
	if (typeof idValue !== 'string' || idValue.trim().length === 0) {
		throw new Error('[LuaService] Service table must define a non-empty string id.');
	}
	const hooks = {
		boot: readOptionalFunction(table, ['on_boot', 'boot', 'initialize']),
		activate: readOptionalFunction(table, ['on_activate', 'activate']),
		deactivate: readOptionalFunction(table, ['on_deactivate', 'deactivate']),
		dispose: readOptionalFunction(table, ['on_dispose', 'dispose']),
		tick: readOptionalFunction(table, ['on_tick', 'tick', 'update']),
		getState: readOptionalFunction(table, ['get_state', 'getState', 'serialize']),
		setState: readOptionalFunction(table, ['set_state', 'setState', 'deserialize']),
	};
	const autoActivate = readBoolean(table, ['auto_activate', 'autoActivate'], true);
	const stateMachines = readStateMachineList(table, interop);
	const eventHandlers = readEventHandlers(table, interop);
	return {
		id: idValue.trim() as Identifier,
		table,
		interpreter,
		autoActivate,
		stateMachines,
		eventHandlers,
		hooks,
	};
}

export class LuaServiceHost extends Service {
	private readonly interop: LuaServiceInterop;
	private readonly definition: LuaServiceDefinition;
	private readonly interpreter: LuaInterpreter;
	private readonly luaSelf: LuaTable;
	private booted = false;

	constructor(options: { interop: LuaServiceInterop; definition: LuaServiceDefinition }) {
		super({ id: options.definition.id, deferBind: true });
		this.interop = options.interop;
		this.definition = options.definition;
		this.interpreter = options.definition.interpreter;
		this.luaSelf = options.definition.table;
		if (this.definition.eventHandlers.size > 0) {
			this.enableEvents();
		}
		this.installStateMachines();
		this.bind();
		if (this.definition.autoActivate) {
			this.activate();
		}
	}

	public tick(deltaSeconds: number): void {
		if (!this.active) return;
		const tickFn = this.definition.hooks.tick;
		if (!tickFn) return;
		this.invokeLuaFunction(tickFn, 'on_tick', deltaSeconds);
	}

	public override bind(): void {
		super.bind();
		this.registerEventHandlers();
		if (!this.booted) {
			this.invokeHookOnce('boot', this.definition.hooks.boot);
		}
	}

	public override activate(): void {
		super.activate();
		const handler = this.definition.hooks.activate;
		if (handler) {
			this.invokeLuaFunction(handler, 'on_activate');
		}
	}

	public override deactivate(): void {
		const handler = this.definition.hooks.deactivate;
		if (handler) {
			this.invokeLuaFunction(handler, 'on_deactivate');
		}
		super.deactivate();
	}

	public override dispose(): void {
		const handler = this.definition.hooks.dispose;
		if (handler) {
			this.invokeLuaFunction(handler, 'on_dispose');
		}
		EventEmitter.instance.removeSubscriber(this);
		super.dispose();
	}

	public override getState(): unknown {
		const handler = this.definition.hooks.getState;
		if (!handler) return undefined;
		return this.invokeLuaFunction(handler, 'get_state');
	}

	public override setState(state: unknown): void {
		const handler = this.definition.hooks.setState;
		if (!handler) return;
		this.invokeLuaFunction(handler, 'set_state', state);
	}

	private invokeHookOnce(label: string, fn: LuaFunctionValue | undefined): void {
		if (this.booted) return;
		if (!fn) return;
		this.invokeLuaFunction(fn, label);
		this.booted = true;
	}

	private installStateMachines(): void {
		for (const machine of this.definition.stateMachines) {
			this.sc.add_statemachine(machine, this.id);
		}
	}

	private registerEventHandlers(): void {
		if (this.definition.eventHandlers.size === 0) return;
		for (const [eventName, handler] of this.definition.eventHandlers.entries()) {
			const callback: EventHandler<EventPayload> = (event, emitter, payload) => {
				this.invokeLuaFunction(handler, `event '${eventName}'`, event, emitter, payload);
			};
			EventEmitter.instance.on(eventName, callback, this);
		}
	}

	private invokeLuaFunction(fn: LuaFunctionValue, label: string, ...args: unknown[]): unknown {
		try {
			const results = this.interop.callLuaFunctionWithInterpreter(fn, [this.luaSelf, ...args], this.interpreter);
			return results.length > 0 ? results[0] : undefined;
		} catch (error) {
			this.rethrowLuaError(error, label);
		}
	}

	private rethrowLuaError(error: unknown, label: string): never {
		const prefix = `[LuaService:${this.id}] ${label} failed: `;
		if (error instanceof LuaRuntimeError) {
			const wrapped = new LuaRuntimeError(prefix + error.message, error.chunkName, error.line, error.column);
			(wrapped as { cause?: unknown }).cause = error;
			throw wrapped;
		}
		if (error instanceof LuaError) {
			const wrapped = new LuaRuntimeError(prefix + error.message, error.chunkName, error.line, error.column);
			(wrapped as { cause?: unknown }).cause = error;
			throw wrapped;
		}
		throw new Error(prefix + String(error));
	}
}
