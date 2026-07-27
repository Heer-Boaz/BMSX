import { LuaHandlerCache, isLuaHandlerFunction } from '../language/lua/interpreter/handler_cache';
import { convertToError, LuaValue, LuaTable, isLuaTable, createLuaTable, LuaNativeValue, isLuaFunctionValue, isPlainObject, resolveNativeTypeName, LuaFunctionValue } from '../language/lua/interpreter/value';
import type { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, valueIsHeap, valueIsNumber, valueIsString, valueTag, ValueTag, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { LuaInteropAdapter, LuaMarshalContext } from '../language/lua/interpreter/interop';
import type { RuntimeSourceState } from './sources';

export interface HandlerFn extends Function {
	(...args: unknown[]): unknown;
	__hid: string;
	__hmod: string;
	__hpath?: string;
	__rebind(fn: Closure): void;
}

export type HandlerCallFn = (
	fn: Closure,
	thisArg: unknown,
	args: ReadonlyArray<unknown>,
) => unknown;

export type HandlerErrorReporter = (
	error: unknown,
	meta: { hid: string; moduleId: string; path?: string },
) => never;

type HandlerRecord = {
	handler: HandlerFn;
	moduleId: string;
	key: string;
	path?: string;
	current: { fn: Closure };
};

export class HandlerCache {
	private readonly byClosure = new WeakMap<Closure, HandlerFn>();
	private readonly byHid = new Map<string, HandlerRecord>();
	private readonly byModule = new Map<string, Map<string, HandlerRecord>>();
	private readonly byHandler = new WeakMap<HandlerFn, HandlerRecord>();
	private readonly anonCounters = new Map<string, number>();

	constructor(
		private readonly callClosure: HandlerCallFn,
		private readonly reportError: HandlerErrorReporter,
	) {}

	public getOrCreate(fn: Closure, ctx: { moduleId: string; path?: ReadonlyArray<string> }): HandlerFn {
		const cached = this.byClosure.get(fn);
		if (cached) {
			return cached;
		}

		const moduleId = this.normalizeModuleId(ctx.moduleId);
		const pathText = this.pathToText(ctx.path);
		const key = this.resolveKey(moduleId, ctx.path);
		const hid = this.buildHid(moduleId, key);
		const existing = this.byHid.get(hid);
		if (existing) {
			this.byClosure.set(fn, existing.handler);
			existing.current = { fn };
			existing.handler.__rebind(fn);
			return existing.handler;
		}

		const handler = this.createHandler(hid, moduleId, pathText, fn);
		const record: HandlerRecord = {
			handler,
			moduleId,
			key,
			path: pathText,
			current: { fn },
		};
		this.byClosure.set(fn, handler);
		this.byHid.set(hid, record);
		this.index(moduleId, key, record);
		this.byHandler.set(handler, record);
		return handler;
	}

	public rebind(moduleId: string, path: ReadonlyArray<string>, fn: Closure): void {
		const normalizedModule = this.normalizeModuleId(moduleId);
		const key = this.resolveReusableKey(normalizedModule, path);
		if (!key) {
			return;
		}
		const hid = this.buildHid(normalizedModule, key);
		const record = this.byHid.get(hid);
		if (!record) {
			return;
		}
		record.current = { fn };
		record.handler.__rebind(fn);
		this.byClosure.set(fn, record.handler);
	}

	public unwrap(handler: HandlerFn): { fn: Closure } | undefined {
		return this.byHandler.get(handler)?.current;
	}

	// disable-next-line single_line_method_pattern -- module disposal is the public lifecycle term for unloading cached handlers.
	public disposeByModule(moduleId: string): void {
		this.unloadModule(moduleId);
	}

	public unloadModule(moduleId: string): void {
		const normalizedModule = this.normalizeModuleId(moduleId);
		const bucket = this.byModule.get(normalizedModule);
		if (!bucket) {
			return;
		}
		for (const [key, record] of bucket.entries()) {
			this.byHid.delete(this.buildHid(normalizedModule, key));
			this.byHandler.delete(record.handler);
		}
		bucket.clear();
		this.byModule.delete(normalizedModule);
		this.anonCounters.delete(normalizedModule);
	}

	private createHandler(
		hid: string,
		moduleId: string,
		path: string | undefined,
		fn: Closure,
	): HandlerFn {
		let currentFn = fn;
		const cache = this;

		const handler = function handler(this: unknown, ...args: unknown[]) {
			try {
				return cache.callClosure(currentFn, this, args);
			} catch (error) {
				cache.reportError(error, { hid, moduleId, path });
			}
		} as unknown as HandlerFn;

		Object.defineProperties(handler, {
			__hid: { value: hid, enumerable: false, writable: false, configurable: false },
			__hmod: { value: moduleId, enumerable: false, writable: false, configurable: false },
			__hpath: { value: path, enumerable: false, writable: false, configurable: true },
			__rebind: {
				value: (nextFn: Closure) => {
					currentFn = nextFn;
					cache.byClosure.set(nextFn, handler);
				},
				enumerable: false,
				writable: false,
				configurable: false,
			},
		});

		return handler;
	}

	private resolveKey(moduleId: string, path: ReadonlyArray<string> | undefined): string {
		const normalizedPath = this.pathToText(path);
		if (normalizedPath) {
			return normalizedPath;
		}

		const next = (this.anonCounters.get(moduleId) ?? 0) + 1;
		this.anonCounters.set(moduleId, next);
		return `anon::${next}`;
	}

	private resolveReusableKey(moduleId: string, path: ReadonlyArray<string> | undefined): string | undefined {
		const normalizedPath = this.pathToText(path);
		if (normalizedPath) {
			return normalizedPath;
		}
		const bucket = this.byModule.get(moduleId);
		if (!bucket) {
			return undefined;
		}
		for (const [key, record] of bucket.entries()) {
			if (!record.path) {
				return key;
			}
		}
		return undefined;
	}

	private index(moduleId: string, key: string, record: HandlerRecord): void {
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Map<string, HandlerRecord>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.set(key, record);
	}

	private normalizeModuleId(moduleId: string): string {
		if (!moduleId || moduleId.length === 0) {
			return 'unknown';
		}
		return moduleId;
	}

	private pathToText(path: ReadonlyArray<string> | undefined): string | undefined {
		if (!path || path.length === 0) {
			return undefined;
		}
		let result = '';
		for (let index = 0; index < path.length; index += 1) {
			const segment = path[index];
			result += `${segment.length}:${segment}`;
			if (index < path.length - 1) {
				result += '|';
			}
		}
		return result;
	}

	private buildHid(moduleId: string, key: string): string {
		return `${moduleId}::${key}`;
	}
}

type TableMarshalVisited = { get(table: Table): unknown | undefined; set(table: Table, value: unknown): void };

function reserveTableHashSize(entryCount: number): number {
	if (entryCount <= 0) {
		return 0;
	}
	return Math.max(4, entryCount * 2);
}


export class RuntimeLuaTooling {
	public readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	public readonly closureHandlerCache = new HandlerCache(
		(fn, thisArg, args) => this.invokeClosureHandler(fn, thisArg, args),
		(error, meta) => this.handleClosureHandlerError(error, meta),
	);
	public readonly luaJsBridge: LuaJsBridge;
	public luaInterpreter!: LuaInterpreter;
	public readonly tableIds = new WeakMap<Table, number>();
	public nextTableId = 1;

	constructor(
		public readonly runtime: Runtime,
		public readonly sources: RuntimeSourceState,
	) {
		this.luaJsBridge = new LuaJsBridge(this);
	}

	private callLuaFunctionPrepared(fn: LuaFunctionValue, luaArgs: ReadonlyArray<LuaValue>): unknown[] {
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		const baseCtx = buildMarshalContext(this.sources);
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaJsBridge.convertFromLua(results[i], extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private invokeClosureHandler(fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs = this.runtime.luaScratch.values.acquire();
		try {
			if (thisArg !== undefined) {
				callArgs.push(hostValueToRuntime(this, thisArg));
			}
			for (let index = 0; index < args.length; index += 1) {
				callArgs.push(hostValueToRuntime(this, args[index]));
			}
			const results = this.runtime.callClosure(fn, callArgs);
			if (results.length === 0) {
				return undefined;
			}
			const ctx = buildMarshalContext(this.sources);
			return runtimeValueToHost(this, results[0], ctx, new WeakMap());
		} finally {
			this.runtime.luaScratch.values.release(callArgs);
		}
	}

	private invokeLuaHandler(fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const luaArgs = this.runtime.luaScratch.values.acquire() as unknown as LuaValue[];
		try {
			if (thisArg !== undefined) {
				luaArgs.push(this.luaJsBridge.toLua(thisArg));
			}
			for (let index = 0; index < args.length; index += 1) {
				luaArgs.push(this.luaJsBridge.toLua(args[index]));
			}
			const results = this.callLuaFunctionPrepared(fn, luaArgs);
			return results.length > 0 ? results[0] : undefined;
		} finally {
			this.runtime.luaScratch.values.release(luaArgs as unknown as Value[]);
		}
	}

	private prepareHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): Error {
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		return wrappedError;
	}

	private handleClosureHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): never {
		throw this.prepareHandlerError(error, meta);
	}

	private handleLuaHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): never {
		const wrappedError = this.prepareHandlerError(error, meta);
		this.luaInterpreter.recordFaultCallStack();
		throw wrappedError;
	}
}

export class LuaJsBridge implements LuaInteropAdapter {
	// Assign stable ids to Lua tables during a marshal pass so handler caches and snapshots don't collide on object identity
	// across conversions; paths in marshal contexts stay deterministic.
	private readonly tableIds = new WeakMap<LuaTable, number>();
	private nextTableId = 1;

	constructor(private readonly bridge: RuntimeLuaTooling) {
	}

	public describeMarshalSegment(key: LuaValue): string {
		if (typeof key === 'string') {
			return key;
		}
		if (typeof key === 'number') {
			return String(key);
		}
		return null;
	}

	public convertFromLua(value: LuaValue, context?: LuaMarshalContext): unknown {
		if (!context) {
			context = buildMarshalContext(this.bridge.sources);
		}
		return this.luaValueToJsWithVisited(value, context, new WeakMap<LuaTable, unknown>());
	}

	public luaValueToJsWithVisited(
		value: LuaValue,
		context: LuaMarshalContext,
		visited: WeakMap<LuaTable, unknown>,
	): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaFunctionValue(value)) {
			return this.bridge.luaHandlerCache.getOrCreate(value, {
				moduleId: context.moduleId,
				path: context.path.slice(),
			});
		}
		if (value instanceof LuaNativeValue) {
			return value.native;
		}
		if (isLuaTable(value)) {
			return this.convertLuaTableToJs(value, context, visited);
		}
		return null;
	}

	public convertLuaTableToJs(
		table: LuaTable,
		context: LuaMarshalContext,
		visited: WeakMap<LuaTable, unknown>,
	): unknown {
		// Preserve identity for cycles/repeated references during one marshal pass.
		const cached = visited.get(table);
		if (cached !== undefined) {
			return cached;
		}
		const tableId = this.getOrAssignTableId(table);
		// Carry the marshal path forward so diagnostics point to the logical location inside the Lua object graph.
		const tableContext = extendMarshalContext(context, `table${tableId}`);
		const nativeRef = table.get('__native');
		if (nativeRef !== null) {
			if (nativeRef instanceof LuaNativeValue) {
				return nativeRef.native;
			}
			return nativeRef;
		}
		// start repeated-sequence-acceptable -- Table marshaling keeps the shape scan inline to avoid per-table shape objects.
		let entryCount = 0;
		let numericCount = 0;
		let hasOtherEntries = false;
		let maxNumericIndex = 0;
		table.forEachEntry((key) => {
			entryCount += 1;
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				numericCount += 1;
				if (key > maxNumericIndex) {
					maxNumericIndex = key;
				}
				return;
			}
			hasOtherEntries = true;
		});
		// end repeated-sequence-acceptable
		if (entryCount === 0) {
			const empty: Record<string, unknown> = {};
			visited.set(table, empty);
			return empty;
		}
		if (!hasOtherEntries && numericCount > 0) {
			const result: unknown[] = new Array(maxNumericIndex);
			visited.set(table, result);
			for (let index = 1; index <= maxNumericIndex; index += 1) {
				const nextContext = extendMarshalContext(tableContext, String(index));
				result[index - 1] = this.luaValueToJsWithVisited(table.get(index), nextContext, visited);
			}
			return result;
		}
		const objectResult: Record<string, unknown> = {};
		visited.set(table, objectResult);
		table.forEachEntry((key, entryValue) => {
			const segment = this.describeMarshalSegment(key);
			objectResult[String(key)] = this.luaValueToJsWithVisited(
				entryValue,
				segment ? extendMarshalContext(tableContext, segment) : tableContext,
				visited,
			);
		});
		return objectResult;
	}

	public getOrAssignTableId(table: LuaTable): number {
		const existing = this.tableIds.get(table);
		if (existing) {
			return existing;
		}
		const id = this.nextTableId;
		this.tableIds.set(table, id);
		this.nextTableId += 1;
		return id;
	}

	public toLua(value: unknown): LuaValue {
		if (value == null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return value;
		}
		if (value instanceof LuaNativeValue) {
			return value;
		}
		if (Array.isArray(value)) {
			return this.wrapNativeValue(value);
		}
		if (typeof value === 'object') {
			if (isPlainObject(value)) {
				const record = value as Record<string, unknown>;
				const table = createLuaTable();
				for (const [prop, entry] of Object.entries(record)) {
					table.set(prop, this.toLua(entry));
				}
				return table;
			}
			if (value instanceof Map) {
				const table = createLuaTable();
				for (const [key, entry] of value.entries()) {
					table.set(this.toLua(key), this.toLua(entry));
				}
				return table;
			}
			if (value instanceof Set) {
				const table = createLuaTable();
				let index = 1;
				for (const entry of value.values()) {
					table.set(index, this.toLua(entry));
					index += 1;
				}
				return table;
			}
			return this.wrapNativeValue(value);
		}
		if (typeof value === 'function') {
			if (isLuaHandlerFunction(value)) {
				const binding = this.bridge.luaHandlerCache.unwrap(value);
				if (binding) {
					return binding.fn;
				}
			}
			return this.wrapNativeValue(value);
		}
		return null;
	}

	public wrapNativeValue(value: object | Function): LuaNativeValue {
		return this.bridge.luaInterpreter.getOrCreateNativeValue(value, resolveNativeTypeName(value));
	}
}

export function extendMarshalContext(ctx: LuaMarshalContext, segment: string): LuaMarshalContext {
	if (!segment) {
		return ctx;
	}
	return {
		moduleId: ctx.moduleId,
		path: ctx.path.concat(segment),
	};
}

export function buildMarshalContext(sources: RuntimeSourceState): LuaMarshalContext {
	return { moduleId: sources.activeLuaSources.entry_path, path: [] };
}

export function describeMarshalSegment(bridge: RuntimeLuaTooling, key: Value): string {
	if (valueIsString(key)) {
		return bridge.runtime.machine.cpu.stringPool.toString(asStringId(key));
	}
	if (valueIsNumber(key)) {
		return String(key);
	}
	return null;
}

function stringifyKey(bridge: RuntimeLuaTooling, key: Value): string {
	if (valueIsString(key)) {
		return bridge.runtime.machine.cpu.stringPool.toString(asStringId(key));
	}
	return String(key);
}

function runtimeTableToHost(bridge: RuntimeLuaTooling, table: Table, context: LuaMarshalContext, visited: TableMarshalVisited): unknown {
	const cached = visited.get(table);
	if (cached) {
		return cached;
	}
	const tableId = getOrAssignTableId(bridge, table);
	const tableContext = extendMarshalContext(context, `table${tableId}`);
	let entryCount = 0;
	let numericCount = 0;
	let hasOtherEntries = false;
	let maxNumericIndex = 0;
	// start repeated-sequence-acceptable -- Runtime table marshaling keeps this scan direct and allocation-free.
	table.forEachEntry((key) => {
		entryCount += 1;
		if (valueIsNumber(key) && Number.isInteger(key) && key >= 1) {
			numericCount += 1;
			if (key > maxNumericIndex) {
				maxNumericIndex = key;
			}
			return;
		}
		hasOtherEntries = true;
	});
	// end repeated-sequence-acceptable
	if (entryCount === 0) {
		const empty: Record<string, unknown> = {};
		visited.set(table, empty);
		return empty;
	}
	if (!hasOtherEntries && numericCount > 0) {
		const result: unknown[] = new Array(maxNumericIndex);
		visited.set(table, result);
		for (let index = 1; index <= maxNumericIndex; index += 1) {
			const nextContext = extendMarshalContext(tableContext, String(index));
			result[index - 1] = runtimeValueToHost(bridge, table.get(index), nextContext, visited);
		}
		return result;
	}
	const objectResult: Record<string, unknown> = {};
	visited.set(table, objectResult);
	table.forEachEntry((key, entryValue) => {
		const segment = describeMarshalSegment(bridge, key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[stringifyKey(bridge, key)] = runtimeValueToHost(bridge, entryValue, nextContext, visited);
	});
	return objectResult;
}

export function getOrAssignTableId(bridge: RuntimeLuaTooling, table: Table): number {
	const existing = bridge.tableIds.get(table);
	if (existing) {
		return existing;
	}
	const id = bridge.nextTableId;
	bridge.tableIds.set(table, id);
	bridge.nextTableId = id + 1;
	return id;
}

export function hostValueToRuntime(bridge: RuntimeLuaTooling, value: unknown): Value {
	if (value == null) {
		return null;
	}
	if (typeof value === 'boolean' || typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string') {
		return bridge.runtime.internString(value);
	}
	if (valueIsHeap(value)) {
		return value;
	}
	if (Array.isArray(value)) {
		const table = bridge.runtime.machine.cpu.createTable(value.length, 0);
		for (let index = 0; index < value.length; index += 1) {
			table.setInteger(index + 1, hostValueToRuntime(bridge, value[index]));
		}
		return table;
	}
	if (isPlainObject(value)) {
		const record = value as Record<string, unknown>;
		let entryCount = 0;
		for (const prop in record) {
			if (!Object.prototype.hasOwnProperty.call(record, prop)) {
				continue;
			}
			const entry = record[prop];
			if (entry == null) {
				continue;
			}
			entryCount += 1;
		}
		const table = bridge.runtime.machine.cpu.createTable(0, reserveTableHashSize(entryCount));
		for (const prop in record) {
			if (!Object.prototype.hasOwnProperty.call(record, prop)) {
				continue;
			}
			const entry = record[prop];
			if (entry == null) {
				continue;
			}
			table.set(bridge.runtime.internString(prop), hostValueToRuntime(bridge, entry));
		}
		return table;
	}
	if (value instanceof Map) {
		const table = bridge.runtime.machine.cpu.createTable(0, reserveTableHashSize(value.size));
		for (const [key, entry] of value.entries()) {
			table.set(hostValueToRuntime(bridge, key), hostValueToRuntime(bridge, entry));
		}
		return table;
	}
	throw new Error('Host functions and opaque host objects cannot cross into the BMSX CPU.');
}

export function runtimeValueToHost(bridge: RuntimeLuaTooling, value: Value, context: LuaMarshalContext, visited: TableMarshalVisited): unknown {
	switch (valueTag(value)) {
		case ValueTag.Nil:
			return null;
		case ValueTag.False:
			return false;
		case ValueTag.True:
			return true;
		case ValueTag.Number:
			return value as number;
		case ValueTag.String:
			return bridge.runtime.machine.cpu.stringPool.toString(asStringId(value as StringValue));
		case ValueTag.Table:
			return runtimeTableToHost(bridge, value as Table, context, visited);
		case ValueTag.Closure:
			return bridge.closureHandlerCache.getOrCreate(value as Closure, {
				moduleId: context.moduleId,
				path: context.path,
			});
		case ValueTag.BuiltinFunction:
			throw new Error('BMSX builtin functions do not cross the IDE tooling boundary.');
	}
}
