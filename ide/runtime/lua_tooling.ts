import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import { LuaHandlerCache, isLuaHandlerFunction } from '../language/lua/interpreter/handler_cache';
import { convertToError, LuaValue, LuaTable, isLuaTable, createLuaTable, LuaNativeValue, isLuaFunctionValue, isPlainObject, isHostCallable, resolveNativeTypeName, LuaFunctionValue } from '../language/lua/interpreter/value';
import type { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import type { LuaInteropAdapter, LuaMarshalContext } from '../language/lua/interpreter/interop';
import type { SuspendedGuestSession } from '../../tooling/ts/runtime/suspended_guest';
import type { RuntimeSourceState } from './sources';

export class RuntimeLuaTooling {
	private readonly luaCallArgs = new ScratchBuffer<LuaValue[]>(() => []);
	private luaCallDepth = 0;
	public readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	public readonly luaJsBridge: LuaJsBridge;
	public luaInterpreter!: LuaInterpreter;

	constructor(
		public readonly sources: RuntimeSourceState,
		public readonly suspendedGuest: SuspendedGuestSession,
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

	private invokeLuaHandler(fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const luaArgs = this.luaCallArgs.get(this.luaCallDepth);
		this.luaCallDepth += 1;
		luaArgs.length = 0;
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
			luaArgs.length = 0;
			this.luaCallDepth -= 1;
		}
	}

	private prepareHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): Error {
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		return wrappedError;
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
		if (isHostCallable(value)) {
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
	return { moduleId: sources.activeLuaSources.entrySourcePath, path: [] };
}
