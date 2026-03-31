import { $ } from '../core/engine_core';
import { LuaSourceRange } from '../lua/syntax/lua_ast';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaHandlerCache, isLuaHandlerFunction } from '../lua/luahandler_cache';
import { LuaValue, LuaTable, isLuaTable, createLuaTable, LuaNativeValue, isLuaFunctionValue, isPlainObject, resolveNativeTypeName, isLuaNativeMemberHandle, LuaFunctionValue } from '../lua/luavalue';
import { Table, type Closure, type NativeFunction, type NativeObject, type Value, createNativeFunction, createNativeObject, isNativeFunction, isNativeObject } from './cpu';
import { Runtime } from './runtime';
import { LuaMarshalContext } from './types';
import { isStringValue, stringValueToString } from './string_pool';

export type LuaSnapshotObjects = Record<number, unknown>;
export type LuaSnapshotGraph = { root: unknown; objects: LuaSnapshotObjects };
export type LuaEntrySnapshot = Record<string, unknown> | LuaSnapshotGraph;

export interface LuaInteropAdapter {
	convertFromLua(value: LuaValue, context?: LuaMarshalContext): unknown;
	toLua(value: unknown): LuaValue;
}
type LuaSnapshotContext = { ids: WeakMap<LuaTable, number>; objects: LuaSnapshotObjects; nextId: number };

export class LuaJsBridge implements LuaInteropAdapter {
	private readonly luaHandlerCache: LuaHandlerCache;
	private readonly runtime: Runtime;
	// Assign stable ids to Lua tables during a marshal pass so handler caches and snapshots don't collide on object identity
	// across conversions; paths in marshal contexts stay deterministic.
	private readonly tableIds = new WeakMap<LuaTable, number>();
	private nextTableId = 1;

	constructor(runtime: Runtime, luaHandlerCache: LuaHandlerCache) {
		this.runtime = runtime;
		this.luaHandlerCache = luaHandlerCache;
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
			context = { moduleId: $.lua_sources.path2lua[Runtime.instance.currentPath].source_path, path: [] };
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
			return this.luaHandlerCache.getOrCreate(value, {
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
		const nativeRef = table.get('__native') ?? table.get('__native__');
		if (nativeRef !== null) {
			if (nativeRef instanceof LuaNativeValue) {
				return nativeRef.native;
			}
			return nativeRef;
		}
		const entries = table.entriesArray();
		if (entries.length === 0) {
			const empty: Record<string, unknown> = {};
			visited.set(table, empty);
			return empty;
		}
		const numericEntries: Array<{ key: number; value: LuaValue }> = [];
		const otherEntries: Array<{ key: LuaValue; value: LuaValue }> = [];
		let maxNumericIndex = 0;
		for (let i = 0; i < entries.length; i += 1) {
			const [key, entryValue] = entries[i];
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				numericEntries.push({ key, value: entryValue });
				if (key > maxNumericIndex) {
					maxNumericIndex = key;
				}
				continue;
			}
			otherEntries.push({ key, value: entryValue });
		}
		const hasOnlyNumeric = otherEntries.length === 0;
		if (hasOnlyNumeric && numericEntries.length > 0) {
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
		for (let index = 0; index < numericEntries.length; index += 1) {
			const entry = numericEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(
				entry.value,
				segment ? extendMarshalContext(tableContext, segment) : tableContext,
				visited,
			);
		}
		for (let index = 0; index < otherEntries.length; index += 1) {
			const entry = otherEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(
				entry.value,
				segment ? extendMarshalContext(tableContext, segment) : tableContext,
				visited,
			);
		}
		return objectResult;
	}

	public getOrAssignTableId(table: LuaTable): number {
		const existing = this.tableIds.get(table);
		if (existing !== undefined) {
			return existing;
		}
		const id = this.nextTableId;
		this.tableIds.set(table, id);
		this.nextTableId += 1;
		return id;
	}

	public toLua(value: unknown): LuaValue {
		if (value === undefined || value === null) {
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
				if (record.__bmsx_table__ === 'map' && Array.isArray(record.entries)) {
					const entries = record.entries as Array<{ key: unknown; value: unknown }>;
					const table = createLuaTable();
					for (const entry of entries) {
						const keyValue = this.deserializeLuaSnapshotKey(entry.key);
						if (keyValue === undefined || keyValue === null) {
							continue;
						}
						const valueValue = this.toLua(entry.value);
						table.set(keyValue, valueValue);
					}
					return table;
				}
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
				const binding = this.luaHandlerCache.unwrap(value);
				if (binding) {
					return binding.fn;
				}
			}
			return this.wrapNativeValue(value);
		}
		return null;
	}

	public wrapNativeValue(value: object | Function): LuaNativeValue {
		return this.runtime.interpreter.getOrCreateNativeValue(value, resolveNativeTypeName(value));
	}

	public serializeLuaSnapshotKey(key: LuaValue, ctx: LuaSnapshotContext): unknown {
		if (key === null || typeof key === 'boolean' || typeof key === 'number' || typeof key === 'string') {
			return key;
		}
		if (isLuaNativeMemberHandle(key)) {
			return {
				__native_member_handle__: true,
				target: (key as { target: object | Function }).target,
				path: Array.from((key as { path: ReadonlyArray<string> }).path),
			};
		}
		if (key instanceof LuaNativeValue) {
			return key.native;
		}
		if (isLuaFunctionValue(key)) {
			return undefined;
		}
		if (isLuaTable(key)) {
			return this.serializeLuaTableForSnapshot(key, ctx);
		}
		return this.serializeLuaValueForSnapshot(key, ctx);
	}

	public deserializeLuaSnapshotKey(raw: unknown, resolver?: (value: unknown) => LuaValue): LuaValue {
		if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
			return raw as LuaValue;
		}
		if (raw && typeof raw === 'object' && (raw as { __native_member_handle__?: boolean }).__native_member_handle__ === true) {
			const handleTarget = (raw as { target: object | Function }).target;
			const path = (raw as { path: ReadonlyArray<string> }).path;
			return this.runtime.interpreter.createNativeMemberHandle(handleTarget, path);
		}
		if (resolver) {
			return resolver(raw);
		}
		return this.deserializeLuaSnapshotValue(raw);
	}

	public parseSnapshotObjectId(text: string): number {
		const id = Number.parseInt(text, 10);
		if (!Number.isFinite(id)) {
			throw new Error(`[Runtime] Invalid Lua snapshot object id '${text}'.`);
		}
		return id;
	}

	public parseSnapshotReferenceId(raw: unknown): number {
		const id = Number(raw);
		if (!Number.isFinite(id)) {
			throw new Error(`[Runtime] Invalid Lua snapshot reference id '${String(raw)}'.`);
		}
		return id;
	}

	public deserializeLuaSnapshotValue(raw: unknown, resolveRef?: (id: number) => LuaTable): LuaValue {
		if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
			return raw as LuaValue;
		}
		if (isLuaTable(raw) || raw instanceof LuaNativeValue) {
			return raw as LuaValue;
		}
		if (resolveRef && raw && typeof raw === 'object' && 'r' in (raw as Record<string, unknown>)) {
			const refId = this.parseSnapshotReferenceId((raw as { r: unknown }).r);
			return resolveRef(refId);
		}
		if (Array.isArray(raw)) {
			const table = createLuaTable();
			for (let index = 0; index < raw.length; index += 1) {
				table.set(index + 1, this.deserializeLuaSnapshotValue(raw[index], resolveRef));
			}
			return table;
		}
		if (raw && typeof raw === 'object') {
			const record = raw as Record<string, unknown>;
			if (record.__bmsx_table__ === 'map' && Array.isArray((record as { entries?: unknown }).entries)) {
				const table = createLuaTable();
				this.applyLuaSnapshotPayload(table, record, value => this.deserializeLuaSnapshotValue(value, resolveRef));
				return table;
			}
			if (record.__native_member_handle__ === true) {
				const handleTarget = (record as { target: object | Function }).target;
				const path = (record as { path: ReadonlyArray<string> }).path;
				return this.runtime.interpreter.createNativeMemberHandle(handleTarget, path);
			}
			return this.wrapNativeValue(raw);
		}
		if (typeof raw === 'function') {
			return this.wrapNativeValue(raw);
		}
		return null;
	}

	public isLuaSnapshotGraph(value: unknown): value is LuaSnapshotGraph {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const record = value as Record<string, unknown>;
		return Object.prototype.hasOwnProperty.call(record, 'root') && Object.prototype.hasOwnProperty.call(record, 'objects');
	}

	public materializeLuaEntrySnapshot(snapshot: LuaEntrySnapshot): Array<[string, LuaValue]> {
		if (this.isLuaSnapshotGraph(snapshot)) {
			return this.deserializeLuaSnapshotGraph(snapshot);
		}
		const entries: Array<[string, LuaValue]> = [];
		for (const [name, value] of Object.entries(snapshot)) {
			entries.push([name, this.deserializeLuaSnapshotValue(value)]);
		}
		return entries;
	}

	public deserializeLuaSnapshotGraph(graph: LuaSnapshotGraph): Array<[string, LuaValue]> {
		const tableMap = new Map<number, LuaTable>();
		const ensureTable = (id: number): LuaTable => {
			let table = tableMap.get(id);
			if (table) {
				return table;
			}
			const created = createLuaTable();
			tableMap.set(id, created);
			return created;
		};
		const resolveSnapshotValue = (raw: unknown): LuaValue => this.deserializeLuaSnapshotValue(raw, ensureTable);

		for (const idText of Object.keys(graph.objects)) {
			const id = this.parseSnapshotObjectId(idText);
			ensureTable(id);
		}
		for (const [idText, payload] of Object.entries(graph.objects)) {
			const id = this.parseSnapshotObjectId(idText);
			this.applyLuaSnapshotPayload(ensureTable(id), payload, resolveSnapshotValue);
		}

		const rootRef = graph.root as unknown;
		const resolvedRoot = rootRef && typeof rootRef === 'object' && 'r' in (rootRef as Record<string, unknown>)
			? ensureTable(this.parseSnapshotReferenceId((rootRef as { r: unknown }).r))
			: rootRef;

		if (isLuaTable(resolvedRoot)) {
			const entries: Array<[string, LuaValue]> = [];
			for (const [key, value] of resolvedRoot.entriesArray()) {
				const stringKey = typeof key === 'string' ? key : String(key);
				entries.push([stringKey, value]);
			}
			return entries;
		}
		if (resolvedRoot && typeof resolvedRoot === 'object') {
			const entries: Array<[string, LuaValue]> = [];
			for (const [name, value] of Object.entries(resolvedRoot)) {
				entries.push([name, resolveSnapshotValue(value)]);
			}
			return entries;
		}
		return [];
	}

	public applyLuaSnapshotPayload(target: LuaTable, payload: unknown, resolve: (value: unknown) => LuaValue): void {
		if (Array.isArray(payload)) {
			for (let index = 0; index < payload.length; index += 1) {
				target.set(index + 1, resolve(payload[index]));
			}
			return;
		}
		if (!payload || typeof payload !== 'object') {
			return;
		}
		const record = payload as { __bmsx_table__?: unknown; entries?: Array<{ key: unknown; value: unknown }> } & Record<string, unknown>;
		if (record.__bmsx_table__ === 'map' && Array.isArray(record.entries)) {
			for (const entry of record.entries) {
				const keyValue = this.deserializeLuaSnapshotKey(entry.key, resolve);
				if (keyValue === undefined || keyValue === null) {
					continue;
				}
				const valueValue = resolve(entry.value);
				target.set(keyValue, valueValue);
			}
			return;
		}
		for (const [prop, entry] of Object.entries(record)) {
			if (prop === '__bmsx_table__') {
				continue;
			}
			const numericKey = Number.parseInt(prop, 10);
			const keyValue = Number.isFinite(numericKey) && String(numericKey) === prop ? numericKey : prop;
			const valueValue = resolve(entry);
			target.set(keyValue as LuaValue, valueValue);
		}
	}

	public applyLuaTableSnapshot(target: LuaTable, snapshot: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
		if (visited.has(target)) {
			return;
		}
		visited.add(target);
		target.setMetatable(snapshot.getMetatable());
		const entries = snapshot.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [key, value] = entries[index];
			if (isLuaTable(value)) {
				const current = target.get(key);
				if (isLuaTable(current)) {
					this.applyLuaTableSnapshot(current, value, visited);
					continue;
				}
			}
			target.set(key, value);
		}
	}

	public mergeLuaTablePreservingState(target: LuaTable, fresh: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
		if (visited.has(target)) {
			return;
		}
		visited.add(target);
		target.setMetatable(fresh.getMetatable());
		const seenKeys = new Set<LuaValue>();
		const entries = fresh.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [key, freshValue] = entries[index];
			seenKeys.add(key);
			const current = target.get(key);
			if (isLuaFunctionValue(freshValue)) {
				target.set(key, freshValue);
				continue;
			}
			if (isLuaTable(freshValue)) {
				if (isLuaTable(current)) {
					this.mergeLuaTablePreservingState(current, freshValue, visited);
					continue;
				}
				target.set(key, freshValue);
				continue;
			}
			if (current === null || isLuaFunctionValue(current)) {
				target.set(key, freshValue);
				continue;
			}
			if (isLuaTable(current)) {
				target.set(key, freshValue);
			}
		}
		const existing = target.entriesArray();
		for (let index = 0; index < existing.length; index += 1) {
			const [key, value] = existing[index];
			if (isLuaFunctionValue(value) && !seenKeys.has(key)) {
				target.set(key, null);
			}
		}
	}

	public createLuaSnapshotContext(): LuaSnapshotContext {
		return { ids: new WeakMap<LuaTable, number>(), objects: {}, nextId: 1 };
	}

	public serializeLuaValueForSnapshot(value: LuaValue, ctx: LuaSnapshotContext): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaNativeMemberHandle(value)) {
			return {
				__native_member_handle__: true,
				target: (value as { target: object | Function }).target,
				path: Array.from((value as { path: ReadonlyArray<string> }).path),
			};
		}
		if (value instanceof LuaNativeValue) {
			return value.native;
		}
		if (isLuaTable(value)) {
			return this.serializeLuaTableForSnapshot(value, ctx);
		}
		throw new Error('Unsupported Lua value encountered during snapshot serialization.');
	}

	public serializeLuaTableForSnapshot(table: LuaTable, ctx: LuaSnapshotContext): { r: number } {
		const existing = ctx.ids.get(table);
		if (existing !== undefined) {
			return { r: existing };
		}
		const id = ctx.nextId;
		ctx.nextId = id + 1;
		ctx.ids.set(table, id);
		ctx.objects[id] = this.buildLuaTableSnapshotPayload(table, ctx);
		return { r: id };
	}

	public buildLuaTableSnapshotPayload(table: LuaTable, ctx: LuaSnapshotContext): unknown {
		const entries = table.entriesArray();
		if (entries.length === 0) {
			return {};
		}
		const numericEntries = new Map<number, unknown>();
		const objectEntries: Record<string, unknown> = {};
		const complexEntries: Array<{ key: unknown; value: unknown }> = [];
		let hasStringKey = false;
		let maxNumericIndex = 0;
		let hasComplexKeys = false;
		for (const [key, entryValue] of entries) {
			if (isLuaFunctionValue(entryValue)) {
				continue;
			}
			if (typeof key === 'string' && key.toLowerCase() === '__index') {
				continue;
			}
			let serializedEntry: unknown;
			try {
				if (entryValue instanceof LuaNativeValue) {
					serializedEntry = entryValue.native;
				} else {
					serializedEntry = this.serializeLuaValueForSnapshot(entryValue, ctx);
				}
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[Runtime] Skipping Lua table entry '${String(key)}' during snapshot:`, error);
				}
				continue;
			}
			let serializedKey: unknown;
			try {
				serializedKey = this.serializeLuaSnapshotKey(key, ctx);
			} catch (error) {
				if ($.debug) {
					console.warn(`[Runtime] Skipping Lua table key '${String(key)}' during snapshot:`, error);
				}
				continue;
			}
			if (serializedKey === undefined) {
				continue;
			}
			complexEntries.push({ key: serializedKey, value: serializedEntry });
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				numericEntries.set(key, serializedEntry);
				if (key > maxNumericIndex) {
					maxNumericIndex = key;
				}
				continue;
			}
			if (typeof key === 'string') {
				hasStringKey = true;
				objectEntries[key] = serializedEntry;
				continue;
			}
			hasComplexKeys = true;
		}
		const numericCount = numericEntries.size;
		const isSequential = numericCount > 0 && !hasStringKey && numericCount === maxNumericIndex;
		const needsMap = hasComplexKeys || (numericCount > 0 && (!isSequential || hasStringKey));
		if (needsMap) {
			return {
				__bmsx_table__: 'map',
				entries: complexEntries,
			};
		}
		if (isSequential) {
			const result: unknown[] = new Array(maxNumericIndex);
			for (let index = 1; index <= maxNumericIndex; index += 1) {
				const entry = numericEntries.get(index);
				result[index - 1] = entry === undefined ? null : entry;
			}
			return result;
		}
		for (const [numericKey, numericValue] of numericEntries.entries()) {
			objectEntries[String(numericKey)] = numericValue;
		}
		return objectEntries;
	}

	public wrapDynamicChunkFunctions(
		moduleId: string,
		environment: LuaEnvironment,
		path: string,
	): void {
		const filter = (fn: LuaFunctionValue) => this.isFunctionFromChunk(fn, path);
		const visited = new WeakSet<LuaTable>();
		const entries = environment.entries();
		for (let index = 0; index < entries.length; index += 1) {
			const [name, value] = entries[index];
			const wrapped = this.wrapFunctionsInValue(moduleId, value, [name], visited, { filter });
			if (wrapped !== value) {
				const resolved = environment.resolve(name);
				if (resolved !== null) {
					resolved.assignExisting(name, wrapped);
					continue;
				}
				environment.set(name, wrapped);
			}
		}
	}

	public wrapFunctionByPath(
		moduleId: string,
		root: LuaEnvironment,
		segments: ReadonlyArray<string>,
	): void {
		if (segments.length === 0) {
			return;
		}
		let owner: LuaTable | LuaEnvironment = root;
		for (let index = 0; index < segments.length - 1; index += 1) {
			const nextValue = owner instanceof LuaEnvironment ? owner.get(segments[index]) : owner.get(segments[index]);
			if (!isLuaTable(nextValue)) {
				return;
			}
			owner = nextValue;
		}
		const leafKey = segments[segments.length - 1];
		const currentValue = owner instanceof LuaEnvironment ? owner.get(leafKey) : owner.get(leafKey);
		const visited = new WeakSet<LuaTable>();
		const wrapped = this.wrapFunctionsInValue(moduleId, currentValue, segments, visited);
		if (wrapped === currentValue) {
			return;
		}
		if (owner instanceof LuaEnvironment) {
			const resolvedOwner = owner.resolve(leafKey);
			if (resolvedOwner !== null) {
				resolvedOwner.assignExisting(leafKey, wrapped);
				return;
			}
			owner.set(leafKey, wrapped);
		} else {
			owner.set(leafKey, wrapped);
		}
	}

	public wrapFunctionsInValue(
		moduleId: string,
		value: LuaValue,
		path: ReadonlyArray<string>,
		visited: WeakSet<LuaTable>,
		options?: { filter?: (fn: LuaFunctionValue) => boolean },
	): LuaValue {
		if (isLuaFunctionValue(value)) {
			if (options?.filter && !options.filter(value)) {
				return value;
			}
			return this.runtime.luaFunctionRedirectCache.getOrCreate(moduleId, path, value);
		}
		if (!isLuaTable(value)) {
			return value;
		}
		if (visited.has(value)) {
			return value;
		}
		visited.add(value);
		const entries = value.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [rawKey, entry] = entries[index];
			const segment = typeof rawKey === 'string' ? rawKey : String(rawKey);
			const wrapped = this.wrapFunctionsInValue(moduleId, entry, [...path, segment], visited, options);
			if (wrapped !== entry) {
				value.set(rawKey, wrapped);
			}
		}
		return value;
	}

	public isFunctionFromChunk(fn: LuaFunctionValue, path: string): boolean {
		const candidate = fn as { getSourceRange?: () => LuaSourceRange };
		if (typeof candidate.getSourceRange !== 'function') {
			return false;
		}
		try {
			const range = candidate.getSourceRange();
			if (!range || typeof range.path !== 'string') {
				return false;
			}
			return range.path === path;
		}
		catch {
			return false;
		}
	}

	public wrapLuaExecutionResults(moduleId: string, results: LuaValue[]): void {
		if (results.length === 0) {
			return;
		}
		const visited = new WeakSet<LuaTable>();
		for (let index = 0; index < results.length; index += 1) {
			const wrapped = this.wrapFunctionsInValue(moduleId, results[index], ['return', String(index)], visited);
			results[index] = wrapped;
		}
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

export function buildMarshalContext(runtime: Runtime): LuaMarshalContext {
	let moduleId = 'runtime';
	const currentPath = runtime.currentPath;
	if (currentPath) {
		const binding = $.lua_sources.path2lua[currentPath];
		if (binding) {
			moduleId = binding.source_path;
		}
	}
	return { moduleId, path: [] };
}

export function describeMarshalSegment(key: Value): string {
	if (isStringValue(key)) {
		return stringValueToString(key);
	}
	if (typeof key === 'number') {
		return String(key);
	}
	return null;
}

function resolveNativeKey(key: Value): string {
	if (isStringValue(key)) {
		return stringValueToString(key);
	}
	if (typeof key === 'number' && Number.isInteger(key)) {
		return String(key);
	}
	return null;
}

function isBlockedGameTimingProperty(target: object, key: string): boolean {
	return target === $ && (key === 'deltatime' || key === 'deltatime_seconds');
}

function parseNativeKeyFromString(runtime: Runtime, key: string): Value {
	const numeric = Number(key);
	if (Number.isInteger(numeric) && String(numeric) === key) {
		return numeric;
	}
	return runtime.internString(key);
}

function nativeKeysEqual(left: Value, right: Value): boolean {
	if (left === right) {
		return true;
	}
	if (isStringValue(left) && isStringValue(right)) {
		return stringValueToString(left) === stringValueToString(right);
	}
	if (typeof left === 'number' && isStringValue(right)) {
		return String(left) === stringValueToString(right);
	}
	if (isStringValue(left) && typeof right === 'number') {
		return stringValueToString(left) === String(right);
	}
	return false;
}

function collectNativeKeys(runtime: Runtime, raw: object): Value[] {
	const keys: Value[] = [];
	if (Array.isArray(raw)) {
		const arr = raw as unknown[];
		const arrRecord = arr as unknown as Record<string, unknown>;
		for (let index = 0; index < arr.length; index += 1) {
			const value = arr[index];
			if (value === undefined || value === null) {
				continue;
			}
			keys.push(index + 1);
		}
		const ownKeys = Object.keys(arr);
		for (const key of ownKeys) {
			const numeric = Number(key);
			if (Number.isInteger(numeric) && String(numeric) === key && numeric >= 0 && numeric < arr.length) {
				continue;
			}
			const value = arrRecord[key];
			if (value === undefined || value === null) {
				continue;
			}
			keys.push(parseNativeKeyFromString(runtime, key));
		}
		return keys;
	}
	const obj = raw as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (value === undefined || value === null) {
			continue;
		}
		keys.push(parseNativeKeyFromString(runtime, key));
	}
	return keys;
}

function buildNativeNextEntry(runtime: Runtime, raw: object): (after: Value) => [Value, Value] | null {
	return (after: Value): [Value, Value] | null => {
		const keys = collectNativeKeys(runtime, raw);
		if (keys.length === 0) {
			return null;
		}
		let nextIndex = 0;
		if (after !== null) {
			nextIndex = -1;
			for (let index = 0; index < keys.length; index += 1) {
				if (nativeKeysEqual(keys[index], after)) {
					nextIndex = index + 1;
					break;
				}
			}
			if (nextIndex < 0 || nextIndex >= keys.length) {
				return null;
			}
		}
		const key = keys[nextIndex];
		const value = readNativeRawValue(raw, key);
		return [key, toRuntimeValue(runtime, value)];
	};
}

function readNativeRawValue(raw: object, key: Value): unknown {
	if (Array.isArray(raw)) {
		if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
			return (raw as unknown[])[key - 1];
		}
		const rawRecord = raw as unknown as Record<string, unknown>;
		const prop = isStringValue(key) ? stringValueToString(key) : String(key);
		return rawRecord[prop];
	}
	const rawRecord = raw as unknown as Record<string, unknown>;
	const prop = isStringValue(key) ? stringValueToString(key) : String(key);
	return rawRecord[prop];
}

function stringifyKey(key: Value): string {
	if (isStringValue(key)) {
		return stringValueToString(key);
	}
	return String(key);
}

function tableToNative(runtime: Runtime, table: Table, context: LuaMarshalContext, visited: WeakMap<Table, unknown>): unknown {
	const cached = visited.get(table);
	if (cached !== undefined) {
		return cached;
	}
	const tableId = getOrAssignTableId(runtime, table);
	const tableContext = extendMarshalContext(context, `table${tableId}`);
	const entries = table.entriesArray();
	if (entries.length === 0) {
		const empty: Record<string, unknown> = {};
		visited.set(table, empty);
		return empty;
	}
	const numericEntries: Array<{ key: number; value: Value }> = [];
	const otherEntries: Array<{ key: Value; value: Value }> = [];
	let maxNumericIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const [key, entryValue] = entries[index];
		if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
			numericEntries.push({ key, value: entryValue });
			if (key > maxNumericIndex) {
				maxNumericIndex = key;
			}
			continue;
		}
		otherEntries.push({ key, value: entryValue });
	}
	const hasOnlyNumeric = otherEntries.length === 0;
	if (hasOnlyNumeric && numericEntries.length > 0) {
		const result: unknown[] = new Array(maxNumericIndex);
		visited.set(table, result);
		for (let index = 1; index <= maxNumericIndex; index += 1) {
			const nextContext = extendMarshalContext(tableContext, String(index));
			result[index - 1] = toNativeValue(runtime, table.get(index), nextContext, visited);
		}
		return result;
	}
	const objectResult: Record<string, unknown> = {};
	visited.set(table, objectResult);
	for (let index = 0; index < numericEntries.length; index += 1) {
		const entry = numericEntries[index];
		const segment = describeMarshalSegment(entry.key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[stringifyKey(entry.key)] = toNativeValue(runtime, entry.value, nextContext, visited);
	}
	for (let index = 0; index < otherEntries.length; index += 1) {
		const entry = otherEntries[index];
		const segment = describeMarshalSegment(entry.key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[stringifyKey(entry.key)] = toNativeValue(runtime, entry.value, nextContext, visited);
	}
	return objectResult;
}

export function getOrAssignTableId(runtime: Runtime, table: Table): number {
	const existing = runtime.tableIds.get(table);
	if (existing !== undefined) {
		return existing;
	}
	const id = runtime.nextTableId;
	runtime.tableIds.set(table, id);
	runtime.nextTableId = id + 1;
	return id;
}

export function nextNativeEntry(runtime: Runtime, target: NativeObject, after: Value): [Value, Value] | null {
	if (target.nextEntry) {
		return target.nextEntry(after);
	}
	return buildNativeNextEntry(runtime, target.raw)(after);
}

export function getOrCreateAssetsNativeObject(runtime: Runtime): NativeObject {
	const assets = $.assets;
	const cached = runtime.nativeObjectCache.get(assets);
	if (cached) {
		return cached;
	}
	const assetMapKeys = new Set<string>(['img', 'audio', 'model', 'data', 'audioevents']);
	const wrapper = createNativeObject(assets, {
		get: (key) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to retrieve an asset that did not use a string or integer key.');
			}
			const rawValue = assets[prop];
			if (rawValue === undefined) {
				throw new Error(`Asset '${prop}' does not exist.`);
			}
			if (assetMapKeys.has(prop)) {
				return getOrCreateAssetMapNativeObject(runtime, rawValue as Record<string, unknown>);
			}
			if (typeof rawValue === 'function') {
				return getOrCreateNativeMethod(runtime, assets, prop);
			}
			return toRuntimeValue(runtime, rawValue);
		},
		set: (key, entryValue) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.');
			}
			if (entryValue === null) {
				delete assets[prop];
				return;
			}
			const ctx = buildMarshalContext(runtime);
			assets[prop] = toNativeValue(runtime, entryValue, ctx, new WeakMap());
		},
		nextEntry: buildNativeNextEntry(runtime, assets),
	});
	runtime.nativeObjectCache.set(assets, wrapper);
	return wrapper;
}

export function getOrCreateAssetMapNativeObject(runtime: Runtime, map: Record<string, unknown>): NativeObject {
	const cached = runtime.nativeObjectCache.get(map);
	if (cached) {
		return cached;
	}
	const wrapper = createNativeObject(map, {
		get: (key) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to retrieve an asset that did not use a string or integer key.');
			}
			const rawValue = map[prop];
			if (rawValue === undefined) {
				throw new Error(`Asset '${prop}' does not exist.`);
			}
			if (typeof rawValue === 'function') {
				return getOrCreateNativeMethod(runtime, map, prop);
			}
			return toRuntimeValue(runtime, rawValue);
		},
		set: (key, entryValue) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.');
			}
			if (entryValue === null) {
				delete map[prop];
				return;
			}
			const ctx = buildMarshalContext(runtime);
			map[prop] = toNativeValue(runtime, entryValue, ctx, new WeakMap());
		},
		nextEntry: buildNativeNextEntry(runtime, map),
	});
	runtime.nativeObjectCache.set(map, wrapper);
	return wrapper;
}

export function toRuntimeValue(runtime: Runtime, value: unknown): Value {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === 'boolean' || typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string') {
		return runtime.internString(value);
	}
	if (isNativeObject(value as Value)) {
		return value as Value;
	}
	if (isNativeFunction(value as Value)) {
		return value as Value;
	}
	if (value instanceof Table) {
		return value;
	}
	if (Array.isArray(value)) {
		return getOrCreateNativeObject(runtime, value);
	}
	if (typeof value === 'function') {
		return getOrCreateNativeFunction(runtime, value);
	}
	if (isPlainObject(value)) {
		const table = new Table(0, 0);
		for (const [prop, entry] of Object.entries(value)) {
			table.set(runtime.internString(prop), toRuntimeValue(runtime, entry));
		}
		return table;
	}
	if (value instanceof Map) {
		const table = new Table(0, 0);
		for (const [key, entry] of value.entries()) {
			table.set(toRuntimeValue(runtime, key), toRuntimeValue(runtime, entry));
		}
		return table;
	}
	return getOrCreateNativeObject(runtime, value as object);
}

export function toNativeValue(runtime: Runtime, value: Value, context: LuaMarshalContext, visited: WeakMap<Table, unknown>): unknown {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return value;
	}
	if (isStringValue(value)) {
		return stringValueToString(value);
	}
	if (value instanceof Table) {
		return tableToNative(runtime, value, context, visited);
	}
	if (isNativeObject(value)) {
		return value.raw;
	}
	if (isNativeFunction(value)) {
		return (...args: unknown[]) => {
			const callArgs: Value[] = [];
			for (let index = 0; index < args.length; index += 1) {
				callArgs.push(toRuntimeValue(runtime, args[index]));
			}
			const results: Value[] = [];
			value.invoke(callArgs, results);
			if (results.length === 0) {
				return undefined;
			}
			return toNativeValue(runtime, results[0], context, new WeakMap());
		};
	}
	const handler = runtime.closureHandlerCache.getOrCreate(value as Closure, {
		moduleId: context.moduleId,
		path: context.path,
	});
	return handler;
}

export function wrapNativeResult(runtime: Runtime, result: unknown, out: Value[]): void {
	if (Array.isArray(result)) {
		for (let index = 0; index < result.length; index += 1) {
			out.push(toRuntimeValue(runtime, result[index]));
		}
		return;
	}
	if (result === undefined) {
		return;
	}
	out.push(toRuntimeValue(runtime, result));
}

export function getOrCreateNativeObject(runtime: Runtime, value: object): NativeObject {
	const cached = runtime.nativeObjectCache.get(value);
	if (cached) {
		return cached;
	}
	const isArray = Array.isArray(value);
	const arrayValue = isArray ? (value as unknown[]) : null;
	const wrapper = createNativeObject(value, {
		get: (key) => {
			if (isArray && typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				const index = key - 1;
				if (index >= arrayValue.length) {
					return null;
				}
				const rawValue = arrayValue[index];
				return rawValue === undefined ? null : toRuntimeValue(runtime, rawValue);
			}
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to index native object with unsupported key.');
			}
			if (isBlockedGameTimingProperty(value, prop)) {
				return null;
			}
			const rawValue = (value as Record<string, unknown>)[prop];
			if (rawValue === undefined) {
				return null;
			}
			if (typeof rawValue === 'function') {
				return getOrCreateNativeMethod(runtime, value, prop);
			}
			return toRuntimeValue(runtime, rawValue);
		},
		set: (key, entryValue) => {
			if (isArray && typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				const index = key - 1;
				const ctx = buildMarshalContext(runtime);
				arrayValue[index] = toNativeValue(runtime, entryValue, ctx, new WeakMap());
				return;
			}
			const prop = resolveNativeKey(key);
			if (!prop) {
				throw new Error('Attempted to assign native object with unsupported key.');
			}
			if (isBlockedGameTimingProperty(value, prop)) {
				throw new Error(`Attempted to assign unsupported native object key '${prop}'.`);
			}
			if (entryValue === null) {
				delete (value as Record<string, unknown>)[prop];
				return;
			}
			const ctx = buildMarshalContext(runtime);
			(value as Record<string, unknown>)[prop] = toNativeValue(runtime, entryValue, ctx, new WeakMap());
		},
		len: isArray ? () => arrayValue.length : undefined,
		nextEntry: buildNativeNextEntry(runtime, value),
	});
	runtime.nativeObjectCache.set(value, wrapper);
	return wrapper;
}

export function getOrCreateNativeFunction(runtime: Runtime, fn: Function): NativeFunction {
	const cached = runtime.nativeFunctionCache.get(fn);
	if (cached) {
		return cached;
	}
	const name = resolveNativeTypeName(fn);
	const wrapper = createNativeFunction(name, (args, out) => {
		const ctx = buildMarshalContext(runtime);
		const visited = new WeakMap<Table, unknown>();
		const jsArgs: unknown[] = [];
		for (let index = 0; index < args.length; index += 1) {
			jsArgs.push(toNativeValue(runtime, args[index], ctx, visited));
		}
		const result = fn.apply(undefined, jsArgs);
		wrapNativeResult(runtime, result, out);
	});
	runtime.nativeFunctionCache.set(fn, wrapper);
	return wrapper;
}

export function getOrCreateNativeMethod(runtime: Runtime, target: object, key: string): NativeFunction {
	let bucket = runtime.nativeMemberCache.get(target);
	if (!bucket) {
		bucket = new Map<string, NativeFunction>();
		runtime.nativeMemberCache.set(target, bucket);
	}
	const cached = bucket.get(key);
	if (cached) {
		return cached;
	}
	const name = `${resolveNativeTypeName(target)}.${key}`;
	const wrapper = createNativeFunction(name, (args, out) => {
		const ctx = buildMarshalContext(runtime);
		const visited = new WeakMap<Table, unknown>();
		const member = (target as Record<string, unknown>)[key];
		if (!isLuaHandlerFunction(member)) {
			const jsArgs: unknown[] = [];
			let startIndex = 0;
			if (args.length > 0) {
				const first = toNativeValue(runtime, args[0], ctx, visited);
				if (first !== target) {
					jsArgs.push(first);
				}
				startIndex = 1;
			}
			for (let index = startIndex; index < args.length; index += 1) {
				jsArgs.push(toNativeValue(runtime, args[index], ctx, visited));
			}
			if (typeof member !== 'function') {
				throw new Error(`Property '${key}' is not callable.`);
			}
			const result = (member as (...inner: unknown[]) => unknown).apply(target, jsArgs);
			wrapNativeResult(runtime, result, out);
			return;
		}
		const jsArgs: unknown[] = [];
		for (let index = 0; index < args.length; index += 1) {
			jsArgs.push(toNativeValue(runtime, args[index], ctx, visited));
		}
		if (typeof member !== 'function') {
			throw new Error(`Property '${key}' is not callable.`);
		}
		const result = (member as (...inner: unknown[]) => unknown).apply(undefined, jsArgs);
		wrapNativeResult(runtime, result, out);
	});
	bucket.set(key, wrapper);
	return wrapper;
}
