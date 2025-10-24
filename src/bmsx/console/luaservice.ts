import { Service } from '../core/service';
import { EventEmitter, type EventHandler, type EventLane, type EventPayload } from '../core/eventemitter';
import type { Identifier, Identifiable } from '../rompack/rompack';
import type { LuaInterpreter } from '../lua/runtime.ts';
import type { LuaFunctionValue, LuaValue } from '../lua/value.ts';
import { LuaTable } from '../lua/value.ts';
import { LuaRuntimeError, LuaError } from '../lua/errors.ts';

export interface LuaServiceInterop {
	callLuaFunctionWithInterpreter(fn: LuaFunctionValue, args: unknown[], interpreter: LuaInterpreter): unknown[];
	jsToLua(value: unknown, interpreter: LuaInterpreter): LuaValue;
	luaValueToJs(value: LuaValue): unknown;
}

type LuaServiceFunction = LuaFunctionValue | undefined;

export type LuaServiceEventScope = 'global' | 'self' | 'emitter';

export type LuaServiceEventHandlerDefinition = {
	event: string;
	scope: LuaServiceEventScope;
	emitterId: Identifier | null;
	lane: EventLane | 'any';
	persistent: boolean;
	handler: LuaFunctionValue;
	debugLabel: string;
};

export type LuaServiceBlueprint = {
	id: Identifier;
	chunkName: string;
	assetId: string | null;
	path?: string | null;
	interpreter: LuaInterpreter;
	luaInstance: LuaTable;
	autoActivate: boolean;
	autoBind: boolean;
	tickEnabled: boolean;
	eventHandlingEnabled: boolean;
	dependencies: Identifier[];
	stateMachineIds: Identifier[];
	onBoot: LuaServiceFunction;
	onActivate: LuaServiceFunction;
	onDeactivate: LuaServiceFunction;
	onDispose: LuaServiceFunction;
	onTick: LuaServiceFunction;
	onGetState: LuaServiceFunction;
	onSetState: LuaServiceFunction;
	eventHandlers: LuaServiceEventHandlerDefinition[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value) return false;
	if (typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function asFunction(value: unknown): LuaFunctionValue | undefined {
	if (!value) return undefined;
	if (typeof value !== 'object') return undefined;
	const candidate = value as { call?: unknown };
	if (typeof candidate.call === 'function') return value as LuaFunctionValue;
	return undefined;
}

function asStringArray(input: unknown, context: string): Identifier[] {
	if (input === undefined || input === null) return [];
	const result: Identifier[] = [];
	if (Array.isArray(input)) {
		for (let index = 0; index < input.length; index += 1) {
			const entry = input[index];
			if (typeof entry !== 'string') {
				throw new Error(`[LuaServiceBlueprint] ${context}[${index}] must be a string.`);
			}
			const trimmed = entry.trim();
			if (trimmed.length === 0) {
				throw new Error(`[LuaServiceBlueprint] ${context}[${index}] must not be empty.`);
			}
			result.push(trimmed as Identifier);
		}
		return result;
	}
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (trimmed.length === 0) {
			throw new Error(`[LuaServiceBlueprint] ${context} must not be empty.`);
		}
		return [trimmed as Identifier];
	}
	throw new Error(`[LuaServiceBlueprint] ${context} must be a string or an array of strings.`);
}

function normalizeScope(raw: unknown, context: string): LuaServiceEventScope {
	if (raw === undefined || raw === null) return 'global';
	if (typeof raw !== 'string') {
		throw new Error(`[LuaServiceBlueprint] ${context} scope must be a string.`);
	}
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === 'global' || trimmed === 'all' || trimmed === 'world') return 'global';
	if (trimmed === 'self') return 'self';
	if (trimmed === 'emitter') return 'emitter';
	throw new Error(`[LuaServiceBlueprint] ${context} scope '${raw}' is not supported.`);
}

function normalizeLane(raw: unknown, context: string): EventLane | 'any' {
	if (raw === undefined || raw === null) return 'any';
	if (typeof raw !== 'string') {
		throw new Error(`[LuaServiceBlueprint] ${context} lane must be a string.`);
	}
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === 'any') return 'any';
	if (trimmed === 'gameplay') return 'gameplay';
	if (trimmed === 'presentation') return 'presentation';
	throw new Error(`[LuaServiceBlueprint] ${context} lane '${raw}' is not supported.`);
}

function extractBoolean(source: Record<string, unknown>, keys: string[], defaultValue: boolean): boolean {
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			const value = source[key];
			if (typeof value !== 'boolean') {
				throw new Error(`[LuaServiceBlueprint] Field '${key}' must be boolean.`);
			}
			return value;
		}
	}
	return defaultValue;
}

function extractFunction(source: Record<string, unknown>, keys: string[]): LuaServiceFunction {
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
		const fn = asFunction(source[key]);
		if (!fn) {
			throw new Error(`[LuaServiceBlueprint] Field '${key}' must be a function.`);
		}
		return fn;
	}
	return undefined;
}

function extractString(source: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
		const value = source[key];
		if (value === undefined || value === null) return null;
		if (typeof value !== 'string') {
			throw new Error(`[LuaServiceBlueprint] Field '${key}' must be a string.`);
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	return null;
}

function resolveHandlerFromTable(table: LuaTable, name: string): LuaFunctionValue {
	const value = table.get(name);
	const fn = asFunction(value);
	if (!fn) {
		throw new Error(`[LuaServiceBlueprint] Handler '${name}' must be a function on the service table.`);
	}
	return fn;
}

function parseEventDescriptor(
	eventName: string,
	rawDescriptor: unknown,
	table: LuaTable,
	location: string
): LuaServiceEventHandlerDefinition {
	let handler: LuaFunctionValue | undefined;
	let scope: LuaServiceEventScope = 'global';
	let emitter: Identifier | null = null;
	let lane: EventLane | 'any' = 'any';
	let persistent = false;
	if (typeof rawDescriptor === 'string') {
		handler = resolveHandlerFromTable(table, rawDescriptor);
	} else if (rawDescriptor && typeof rawDescriptor === 'object') {
		const shape = rawDescriptor as Record<string, unknown>;
		if (Object.prototype.hasOwnProperty.call(shape, 'handler')) {
			const candidate = shape['handler'];
			if (typeof candidate === 'string') {
				handler = resolveHandlerFromTable(table, candidate);
			} else {
				handler = asFunction(candidate);
			}
		}
		if (!handler && Object.prototype.hasOwnProperty.call(shape, 'callback')) {
			const candidate = shape['callback'];
			if (typeof candidate === 'string') {
				handler = resolveHandlerFromTable(table, candidate);
			} else {
				handler = asFunction(candidate);
			}
		}
		if (!handler) {
			const candidate = shape['fn'] ?? shape['function'];
			if (typeof candidate === 'string') {
				handler = resolveHandlerFromTable(table, candidate);
			} else {
				handler = asFunction(candidate);
			}
		}
		if (shape['scope'] !== undefined) {
			scope = normalizeScope(shape['scope'], location);
		}
		if (shape['target'] !== undefined) {
			scope = normalizeScope(shape['target'], location);
		}
		if (shape['emitter'] !== undefined) {
			if (typeof shape['emitter'] !== 'string') {
				throw new Error(`[LuaServiceBlueprint] ${location} emitter must be a string.`);
			}
			emitter = shape['emitter'].trim() as Identifier;
		}
		if (shape['lane'] !== undefined) {
			lane = normalizeLane(shape['lane'], location);
		}
		if (shape['persistent'] !== undefined) {
			if (typeof shape['persistent'] !== 'boolean') {
				throw new Error(`[LuaServiceBlueprint] ${location} persistent flag must be boolean.`);
			}
			persistent = shape['persistent'];
		}
	} else {
		handler = asFunction(rawDescriptor);
	}
	if (!handler) {
		throw new Error(`[LuaServiceBlueprint] ${location} requires a handler function.`);
	}
	if (scope === 'emitter' && (!emitter || emitter.length === 0)) {
		throw new Error(`[LuaServiceBlueprint] ${location} scope 'emitter' requires an emitter id.`);
	}
	return {
		event: eventName,
		scope,
		emitterId: emitter,
		lane,
		persistent,
		handler,
		debugLabel: `${location} (${eventName})`,
	};
}

function parseEventHandlers(source: Record<string, unknown>, table: LuaTable, chunkName: string): LuaServiceEventHandlerDefinition[] {
	const eventsRaw = source['events'] ?? source['subscriptions'] ?? null;
	if (!eventsRaw) return [];
	const handlers: LuaServiceEventHandlerDefinition[] = [];
	if (Array.isArray(eventsRaw)) {
		for (let index = 0; index < eventsRaw.length; index += 1) {
			const entry = eventsRaw[index];
			if (!entry || typeof entry !== 'object') {
				throw new Error(`[LuaServiceBlueprint] events[${index}] must be a table.`);
			}
			const descriptor = entry as Record<string, unknown>;
			const eventNameRaw = descriptor['event'] ?? descriptor['name'];
			if (typeof eventNameRaw !== 'string') {
				throw new Error(`[LuaServiceBlueprint] events[${index}] requires an 'event' name.`);
			}
			const eventName = eventNameRaw.trim();
			if (eventName.length === 0) {
				throw new Error(`[LuaServiceBlueprint] events[${index}] event name must not be empty.`);
			}
			const def = parseEventDescriptor(eventName, descriptor, table, `${chunkName} events[${index}]`);
			handlers.push(def);
		}
		return handlers;
	}
	if (isPlainObject(eventsRaw)) {
		for (const key of Object.keys(eventsRaw)) {
			const descriptor = (eventsRaw as Record<string, unknown>)[key];
			const name = key.trim();
			if (name.length === 0) {
				throw new Error('[LuaServiceBlueprint] events keys must not be empty.');
			}
			const def = parseEventDescriptor(name, descriptor, table, `${chunkName} events.${key}`);
			handlers.push(def);
		}
		return handlers;
	}
	throw new Error('[LuaServiceBlueprint] events must be an array or table.');
}

export function buildLuaServiceBlueprint(params: {
	table: LuaTable;
	chunkName: string;
	assetId: string | null;
	path?: string | null;
	interpreter: LuaInterpreter;
	interop: LuaServiceInterop;
}): LuaServiceBlueprint {
	const { table, chunkName, assetId, path, interpreter, interop } = params;
	const rawObject = interop.luaValueToJs(table);
	if (!isPlainObject(rawObject)) {
		throw new Error('[LuaServiceBlueprint] Service script must return a table.');
	}
	const source = rawObject;
	const idRaw = extractString(source, ['id', 'service_id', 'identifier']);
	if (!idRaw) {
		throw new Error('[LuaServiceBlueprint] Service blueprint requires an id.');
	}
	const autoActivate = extractBoolean(source, ['auto_activate', 'autoActivate'], true);
	const autoBindDefault = autoActivate ? false : true;
	const autoBind = extractBoolean(source, ['auto_bind', 'autoBind'], autoBindDefault);
	const tickEnabled = extractBoolean(source, ['tick_enabled', 'tickEnabled'], false);
	const eventHandlingEnabled = extractBoolean(source, ['eventhandling_enabled', 'eventHandlingEnabled'], false);
	const dependencies = asStringArray(source['dependencies'] ?? source['requires'], 'dependencies');
	const stateMachineIds = asStringArray(source['machines'] ?? source['state_machines'] ?? source['fsms'], 'machines');
	const onBoot = extractFunction(source, ['on_boot', 'initialize', 'onBoot']);
	const onActivate = extractFunction(source, ['on_activate', 'activate', 'onActivate']);
	const onDeactivate = extractFunction(source, ['on_deactivate', 'deactivate', 'onDeactivate']);
	const onDispose = extractFunction(source, ['on_dispose', 'dispose', 'onDispose']);
	const onTick = extractFunction(source, ['tick', 'on_tick', 'onTick']);
	const onGetState = extractFunction(source, ['get_state', 'getState', 'serialize']);
	const onSetState = extractFunction(source, ['set_state', 'setState', 'deserialize']);
	const eventHandlers = parseEventHandlers(source, table, chunkName);
	return {
		id: idRaw as Identifier,
		chunkName,
		assetId,
		path,
		interpreter,
		luaInstance: table,
		autoActivate,
		autoBind,
		tickEnabled,
		eventHandlingEnabled,
		dependencies,
		stateMachineIds,
		onBoot,
		onActivate,
		onDeactivate,
		onDispose,
		onTick,
		onGetState,
		onSetState,
		eventHandlers,
	};
}

export class LuaServiceHost extends Service {
	private bridge: LuaServiceInterop;
	private blueprint: LuaServiceBlueprint;
	private interpreter: LuaInterpreter;
	private luaSelf: LuaTable;

	constructor(config: { blueprint: LuaServiceBlueprint; bridge: LuaServiceInterop }) {
		super({ id: config.blueprint.id, deferBind: true });
		this.bridge = config.bridge;
		this.blueprint = config.blueprint;
		this.interpreter = config.blueprint.interpreter;
		this.luaSelf = config.blueprint.luaInstance;
		this.tickEnabled = config.blueprint.tickEnabled;
		if (config.blueprint.eventHandlingEnabled) {
			this.enableEvents();
		}
		this.installStateMachines(config.blueprint.stateMachineIds);
		const shouldActivate = config.blueprint.autoActivate;
		if (shouldActivate) {
			this.activate();
		}
		else {
			if (config.blueprint.autoBind) {
				this.bind();
			}
			if (config.blueprint.eventHandlingEnabled) {
				this.enableEvents();
			}
		}
	}

	public reconfigure(blueprint: LuaServiceBlueprint, restoredState?: unknown): void {
		const wasActive = this.active;
		this.blueprint = blueprint;
		this.interpreter = blueprint.interpreter;
		this.luaSelf = blueprint.luaInstance;
		this.tickEnabled = blueprint.tickEnabled;
		if (blueprint.eventHandlingEnabled) this.enableEvents();
		else this.disableEvents();
		this.installStateMachines(blueprint.stateMachineIds);
		if (wasActive) {
			this.bind();
			if (restoredState !== undefined) {
				this.setState(restoredState);
			}
			this.enableEvents();
			this.invokeLifecycle(blueprint.onActivate, 'on_activate');
		}
		else if (blueprint.autoActivate) {
			this.activate();
			if (restoredState !== undefined) {
				this.setState(restoredState);
			}
		}
		else {
			if (blueprint.autoBind) {
				this.bind();
				if (blueprint.eventHandlingEnabled) {
					this.enableEvents();
				}
			}
			if (restoredState !== undefined) {
				this.setState(restoredState);
			}
		}
	}

	public override bind(): void {
		EventEmitter.instance.removeSubscriber(this);
		super.bind();
		this.installEventHandlers();
		this.invokeLifecycle(this.blueprint.onBoot, 'on_boot');
	}

	public override activate(): void {
		super.activate();
		this.invokeLifecycle(this.blueprint.onActivate, 'on_activate');
	}

	public override deactivate(): void {
		this.invokeLifecycle(this.blueprint.onDeactivate, 'on_deactivate');
		super.deactivate();
	}

	public override dispose(): void {
		this.invokeLifecycle(this.blueprint.onDispose, 'on_dispose');
		super.dispose();
	}

	public tick(deltaSeconds: number): void {
		if (!this.active) return;
		if (!this.blueprint.onTick) return;
		this.invokeLifecycle(this.blueprint.onTick, 'tick', deltaSeconds);
	}

	public override getState(): unknown {
		if (!this.blueprint.onGetState) return undefined;
		return this.invokeLifecycle(this.blueprint.onGetState, 'get_state');
	}

	public override setState(state: unknown): void {
		if (!this.blueprint.onSetState) return;
		this.invokeLifecycle(this.blueprint.onSetState, 'set_state', state);
	}

	private installStateMachines(machineIds: Identifier[]): void {
		for (let index = 0; index < machineIds.length; index += 1) {
			const machineId = machineIds[index];
			this.sc.add_statemachine(machineId, this.id);
		}
	}

	private installEventHandlers(): void {
		for (let index = 0; index < this.blueprint.eventHandlers.length; index += 1) {
			const definition = this.blueprint.eventHandlers[index];
			const listener: EventHandler<EventPayload> = (event_name, emitter, payload) => {
				this.handleEvent(definition, event_name, emitter, payload);
			};
			const options: { emitter?: Identifier; persistent?: boolean; lane?: EventLane } = {};
			if (definition.scope === 'self') {
				options.emitter = this.id;
			} else if (definition.scope === 'emitter' && definition.emitterId) {
				options.emitter = definition.emitterId;
			}
			if (definition.persistent) options.persistent = true;
			if (definition.lane !== 'any') options.lane = definition.lane;
			EventEmitter.instance.on(definition.event, listener, this, options);
		}
	}

	private handleEvent(definition: LuaServiceEventHandlerDefinition, eventName: string, emitter: Identifiable, payload?: EventPayload): void {
		const args: unknown[] = [this.luaSelf, eventName, emitter, payload];
		this.invokeHandler(definition.handler, definition.debugLabel, args);
	}

	private invokeLifecycle(fn: LuaServiceFunction, label: string, ...args: unknown[]): unknown {
		if (!fn) return undefined;
		return this.invokeHandler(fn, label, [this.luaSelf, ...args]);
	}

	private invokeHandler(fn: LuaFunctionValue, label: string, args: unknown[]): unknown {
		try {
			const results = this.bridge.callLuaFunctionWithInterpreter(fn, args, this.interpreter);
			return results.length > 0 ? results[0] : undefined;
		}
		catch (error) {
			this.rethrowLuaError(error, label);
		}
		return undefined;
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
