import { LuaSourceRange } from '../../lua/syntax/ast';
import { LuaEnvironment } from '../../lua/environment';
import { LuaHandlerCache, isLuaHandlerFunction } from '../../lua/handler_cache';
import { LuaValue, LuaTable, isLuaTable, createLuaTable, LuaNativeValue, isLuaFunctionValue, isPlainObject, resolveNativeTypeName, isLuaNativeMemberHandle, LuaFunctionValue } from '../../lua/value';
import { Table, type Closure, type NativeFunction, type NativeObject, type Value, createNativeFunction, createNativeObject, isNativeFunction, isNativeObject } from '../cpu/cpu';
import { Runtime } from '../runtime/runtime';
import type { LuaMarshalContext } from '../runtime/contracts';
import { isStringValue, stringValueToString } from '../memory/string/pool';

// disable defensive_typeof_function_pattern -- JS bridge marshals arbitrary host values; callable probes are explicit interop boundaries.
export type LuaSnapshotObjects = Record<number, unknown>;
export type LuaSnapshotGraph = { root: unknown; objects: LuaSnapshotObjects };
export type LuaEntrySnapshot = Record<string, unknown> | LuaSnapshotGraph;

export interface LuaInteropAdapter {
	convertFromLua(value: LuaValue, context?: LuaMarshalContext): unknown;
	toLua(value: unknown): LuaValue;
}
type LuaSnapshotContext = { ids: WeakMap<LuaTable, number>; objects: LuaSnapshotObjects; nextId: number };
type TableMarshalVisited = { get(table: Table): unknown | undefined; set(table: Table, value: unknown): void };

function reserveTableHashSize(entryCount: number): number {
	if (entryCount <= 0) {
		return 0;
	}
	return Math.max(4, entryCount * 2);
}

export class LuaJsBridge implements LuaInteropAdapter {
	// Assign stable ids to Lua tables during a marshal pass so handler caches and snapshots don't collide on object identity
	// across conversions; paths in marshal contexts stay deterministic.
	private readonly tableIds = new WeakMap<LuaTable, number>();
	private nextTableId = 1;

	constructor(private readonly runtime: Runtime, private readonly luaHandlerCache: LuaHandlerCache) {
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
			context = buildMarshalContext(this.runtime);
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
				if (record.bmsxTable === 'map' && Array.isArray(record.entries)) {
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
		if (raw && typeof raw === 'object' && (raw as { __native_member_handle__?: boolean }).__native_member_handle__) {
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
			throw new Error(`Invalid Lua snapshot object id '${text}'.`);
		}
		return id;
	}

	public parseSnapshotReferenceId(raw: unknown): number {
		const id = Number(raw);
		if (!Number.isFinite(id)) {
			throw new Error(`Invalid Lua snapshot reference id '${String(raw)}'.`);
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
			if (record.bmsxTable === 'map' && Array.isArray((record as { entries?: unknown }).entries)) {
				const table = createLuaTable();
				this.applyLuaSnapshotPayload(table, record, value => this.deserializeLuaSnapshotValue(value, resolveRef));
				return table;
			}
			if (record.__native_member_handle__) {
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
			const table = tableMap.get(id);
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
			resolvedRoot.forEachEntry((key, value) => {
				const stringKey = typeof key === 'string' ? key : String(key);
				entries.push([stringKey, value]);
			});
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
		const record = payload as { bmsxTable?: unknown; entries?: Array<{ key: unknown; value: unknown }> } & Record<string, unknown>;
		if (record.bmsxTable === 'map' && Array.isArray(record.entries)) {
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
			if (prop === 'bmsxTable') {
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
		target.setMetatable(snapshot.metatable);
		snapshot.forEachEntry((key, value) => {
			if (isLuaTable(value)) {
				const current = target.get(key);
				if (isLuaTable(current)) {
					this.applyLuaTableSnapshot(current, value, visited);
					return;
				}
			}
			target.set(key, value);
		});
	}

	public mergeLuaTablePreservingState(target: LuaTable, fresh: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
		if (visited.has(target)) {
			return;
		}
		visited.add(target);
		target.setMetatable(fresh.metatable);
		const seenKeys = new Set<LuaValue>();
		fresh.forEachEntry((key, freshValue) => {
			seenKeys.add(key);
			const current = target.get(key);
			if (isLuaFunctionValue(freshValue)) {
				target.set(key, freshValue);
				return;
			}
			if (isLuaTable(freshValue)) {
				if (isLuaTable(current)) {
					this.mergeLuaTablePreservingState(current, freshValue, visited);
					return;
				}
				target.set(key, freshValue);
				return;
			}
			if (current === null || isLuaFunctionValue(current)) {
				target.set(key, freshValue);
				return;
			}
			if (isLuaTable(current)) {
				target.set(key, freshValue);
			}
		});
		const staleKeys: LuaValue[] = [];
		target.forEachEntry((key, value) => {
			if (isLuaFunctionValue(value) && !seenKeys.has(key)) {
				staleKeys.push(key);
			}
		});
		for (let index = 0; index < staleKeys.length; index += 1) {
			target.set(staleKeys[index], null);
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
		const numericEntries = new Map<number, unknown>();
		const objectEntries: Record<string, unknown> = {};
		const complexEntries: Array<{ key: unknown; value: unknown }> = [];
		let hasEntries = false;
		let hasStringKey = false;
		let maxNumericIndex = 0;
		let hasComplexKeys = false;
		table.forEachEntry((key, entryValue) => {
			hasEntries = true;
			if (isLuaFunctionValue(entryValue)) {
				return;
			}
			if (typeof key === 'string' && key.toLowerCase() === '__index') {
				return;
			}
			const serializedEntry = entryValue instanceof LuaNativeValue
				? entryValue.native
				: this.serializeLuaValueForSnapshot(entryValue, ctx);
			const serializedKey = this.serializeLuaSnapshotKey(key, ctx);
			if (serializedKey === undefined) {
				return;
			}
			complexEntries.push({ key: serializedKey, value: serializedEntry });
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				numericEntries.set(key, serializedEntry);
				if (key > maxNumericIndex) {
					maxNumericIndex = key;
				}
				return;
			}
			if (typeof key === 'string') {
				hasStringKey = true;
				objectEntries[key] = serializedEntry;
				return;
			}
			hasComplexKeys = true;
		});
		if (!hasEntries) {
			return {};
		}
		const numericCount = numericEntries.size;
		const isSequential = numericCount > 0 && !hasStringKey && numericCount === maxNumericIndex;
		const needsMap = hasComplexKeys || (numericCount > 0 && (!isSequential || hasStringKey));
		if (needsMap) {
			return {
				bmsxTable: 'map',
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
			const wrapped = this.wrapFunctionsInValue(moduleId, value, [name], visited, filter);
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
			const nextValue = owner.get(segments[index]);
			if (!isLuaTable(nextValue)) {
				return;
			}
			owner = nextValue;
		}
		const leafKey = segments[segments.length - 1];
		const currentValue = owner.get(leafKey);
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
		filter?: (fn: LuaFunctionValue) => boolean,
	): LuaValue {
		if (isLuaFunctionValue(value)) {
			if (filter && !filter(value)) {
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
		value.forEachEntry((rawKey, entry) => {
			const segment = typeof rawKey === 'string' ? rawKey : String(rawKey);
			const wrapped = this.wrapFunctionsInValue(moduleId, entry, [...path, segment], visited, filter);
			if (wrapped !== entry) {
				value.set(rawKey, wrapped);
			}
		});
		return value;
	}

	public isFunctionFromChunk(fn: LuaFunctionValue, path: string): boolean {
		const candidate = fn as { getSourceRange?: () => LuaSourceRange };
		if (typeof candidate.getSourceRange !== 'function') {
			return false;
		}
		return candidate.getSourceRange().path === path;
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
	return { moduleId: runtime.resolveCurrentModuleId(), path: [] };
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

function isArrayIndexProperty(key: string, length: number): boolean {
	const numeric = Number(key);
	return Number.isInteger(numeric) && String(numeric) === key && numeric >= 0 && numeric < length;
}

function collectNativeKeys(runtime: Runtime, raw: object): Value[] {
	const keys: Value[] = [];
	if (Array.isArray(raw)) {
		const arr = raw as unknown[];
		const arrRecord = arr as unknown as Record<string, unknown>;
		for (let index = 0; index < arr.length; index += 1) {
			const value = arr[index];
			if (value == null) {
				continue;
			}
			keys.push(index + 1);
		}
		for (const key in arrRecord) {
			if (!Object.prototype.hasOwnProperty.call(arrRecord, key)) {
				continue;
			}
			if (isArrayIndexProperty(key, arr.length)) {
				continue;
			}
			const value = arrRecord[key];
			if (value == null) {
				continue;
			}
			keys.push(parseNativeKeyFromString(runtime, key));
		}
		return keys;
	}
	const obj = raw as Record<string, unknown>;
	for (const key in obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, key)) {
			continue;
		}
		const value = obj[key];
		if (value == null) {
			continue;
		}
		keys.push(parseNativeKeyFromString(runtime, key));
	}
	return keys;
}

function findNativePropertyAfter(runtime: Runtime, raw: Record<string, unknown>, after: Value, skipArrayLength: number): [Value, unknown] | null {
	let returnNext = after === null;
	for (const prop in raw) {
		if (!Object.prototype.hasOwnProperty.call(raw, prop)) {
			continue;
		}
		if (skipArrayLength >= 0 && isArrayIndexProperty(prop, skipArrayLength)) {
			continue;
		}
		const value = raw[prop];
		if (value == null) {
			continue;
		}
		const key = parseNativeKeyFromString(runtime, prop);
		if (returnNext) {
			return [key, value];
		}
		if (nativeKeysEqual(key, after)) {
			returnNext = true;
		}
	}
	return null;
}

function findNativeRawEntryAfter(runtime: Runtime, raw: object, after: Value): [Value, unknown] | null {
	if (Array.isArray(raw)) {
		const arr = raw as unknown[];
		if (after !== null && (typeof after !== 'number' || !Number.isInteger(after) || after < 1)) {
			return findNativePropertyAfter(runtime, raw as unknown as Record<string, unknown>, after, arr.length);
		}
		let startIndex = 0;
		if (after !== null) {
			startIndex = after as number;
		}
		for (let index = startIndex; index < arr.length; index += 1) {
			const value = arr[index];
			if (value !== undefined && value !== null) {
				return [index + 1, value];
			}
		}
			return findNativePropertyAfter(runtime, raw as unknown as Record<string, unknown>, null, arr.length);
		}
		return findNativePropertyAfter(runtime, raw as Record<string, unknown>, after, -1);
}

function stringifyKey(key: Value): string {
	if (isStringValue(key)) {
		return stringValueToString(key);
	}
	return String(key);
}

function tableToNative(runtime: Runtime, table: Table, context: LuaMarshalContext, visited: TableMarshalVisited): unknown {
	const cached = visited.get(table);
	if (cached !== undefined) {
		return cached;
	}
	const tableId = getOrAssignTableId(runtime, table);
	const tableContext = extendMarshalContext(context, `table${tableId}`);
	let entryCount = 0;
	let numericCount = 0;
	let hasOtherEntries = false;
	let maxNumericIndex = 0;
	// start repeated-sequence-acceptable -- Runtime table marshaling keeps this scan direct and allocation-free.
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
			result[index - 1] = toNativeValue(runtime, table.get(index), nextContext, visited);
		}
		return result;
	}
	const objectResult: Record<string, unknown> = {};
	visited.set(table, objectResult);
	table.forEachEntry((key, entryValue) => {
		const segment = describeMarshalSegment(key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[stringifyKey(key)] = toNativeValue(runtime, entryValue, nextContext, visited);
	});
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

export function pushNativePairsIterator(runtime: Runtime, target: NativeObject, out: Value[]): void {
	const keys = collectNativeKeys(runtime, target.raw);
	let pointer = 0;
	const iterator = createNativeFunction('native.pairs.iterator', (args, iteratorOut) => {
		const nativeTarget = args[0];
		if (!isNativeObject(nativeTarget) || nativeTarget !== target) {
			iteratorOut.push(null);
			return;
		}
		const after = args.length > 1 ? args[1] : null;
		if (after !== null && pointer > 0 && !nativeKeysEqual(keys[pointer - 1], after)) {
			pointer = 0;
			while (pointer < keys.length && !nativeKeysEqual(keys[pointer], after)) {
				pointer += 1;
			}
			if (pointer < keys.length) {
				pointer += 1;
			}
		}
		if (pointer >= keys.length) {
			iteratorOut.push(null);
			return;
		}
		const key = keys[pointer];
		pointer += 1;
		iteratorOut.push(key, target.get(key));
	});
	out.push(iterator, target, null);
}

function buildNativeNextEntry(runtime: Runtime, raw: object): (after: Value) => [Value, Value] | null {
	return (after: Value): [Value, Value] | null => {
		const entry = findNativeRawEntryAfter(runtime, raw, after);
		if (entry === null) {
			return null;
		}
		const key = entry[0];
		const value = entry[1];
		return [key, toRuntimeValue(runtime, value)];
	};
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
		const record = value as Record<string, unknown>;
		let entryCount = 0;
		for (const prop in record) {
			if (!Object.prototype.hasOwnProperty.call(record, prop)) {
				continue;
			}
			const entry = record[prop];
			if (entry === undefined || entry === null) {
				continue;
			}
			entryCount += 1;
		}
		const table = new Table(0, reserveTableHashSize(entryCount));
		for (const prop in record) {
			if (!Object.prototype.hasOwnProperty.call(record, prop)) {
				continue;
			}
			const entry = record[prop];
			if (entry === undefined || entry === null) {
				continue;
			}
			table.set(runtime.internString(prop), toRuntimeValue(runtime, entry));
		}
		return table;
	}
	if (value instanceof Map) {
		const table = new Table(0, reserveTableHashSize(value.size));
		for (const [key, entry] of value.entries()) {
			table.set(toRuntimeValue(runtime, key), toRuntimeValue(runtime, entry));
		}
		return table;
	}
	return getOrCreateNativeObject(runtime, value as object);
}

export function toNativeValue(runtime: Runtime, value: Value, context: LuaMarshalContext, visited: TableMarshalVisited): unknown {
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
			const callArgs = runtime.luaScratch.acquireValue();
			const results = runtime.luaScratch.acquireValue();
			const resultVisited = runtime.luaScratch.acquireTableMarshal();
			try {
				for (let index = 0; index < args.length; index += 1) {
						callArgs.push(toRuntimeValue(runtime, args[index]));
				}
				value.invoke(callArgs, results);
				if (results.length === 0) {
					return undefined;
				}
					return toNativeValue(runtime, results[0], context, resultVisited);
			} finally {
				runtime.luaScratch.releaseTableMarshal(resultVisited);
				runtime.luaScratch.releaseValue(results);
				runtime.luaScratch.releaseValue(callArgs);
			}
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
		const visited = runtime.luaScratch.acquireTableMarshal();
		const jsArgs = runtime.luaScratch.acquireValue() as unknown[];
		try {
			for (let index = 0; index < args.length; index += 1) {
				jsArgs.push(toNativeValue(runtime, args[index], ctx, visited));
			}
			const result = fn.apply(undefined, jsArgs);
			wrapNativeResult(runtime, result, out);
		} finally {
			runtime.luaScratch.releaseValue(jsArgs as unknown as Value[]);
			runtime.luaScratch.releaseTableMarshal(visited);
		}
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
		const visited = runtime.luaScratch.acquireTableMarshal();
		const jsArgs = runtime.luaScratch.acquireValue() as unknown[];
		const member = (target as Record<string, unknown>)[key];
		try {
			if (!isLuaHandlerFunction(member)) {
				if (typeof member !== 'function') {
					throw new Error(`Property '${key}' is not callable.`);
				}
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
				const result = (member as (...inner: unknown[]) => unknown).apply(target, jsArgs);
				wrapNativeResult(runtime, result, out);
				return;
			}
			for (let index = 0; index < args.length; index += 1) {
				jsArgs.push(toNativeValue(runtime, args[index], ctx, visited));
			}
			if (typeof member !== 'function') {
				throw new Error(`Property '${key}' is not callable.`);
			}
			const result = (member as (...inner: unknown[]) => unknown).apply(undefined, jsArgs);
			wrapNativeResult(runtime, result, out);
		} finally {
			runtime.luaScratch.releaseValue(jsArgs as unknown as Value[]);
			runtime.luaScratch.releaseTableMarshal(visited);
		}
	});
	bucket.set(key, wrapper);
	return wrapper;
}
