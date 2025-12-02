import { $ } from '../core/game';
import { LuaHandlerCache, isLuaHandlerFn } from '../lua/handler_cache';
import { LuaValue, LuaTable, isLuaNativeValue, isLuaTable, createLuaTable, LuaNativeValue, isLuaFunctionValue, isPlainObject, resolveNativeTypeName } from '../lua/value';
import { BmsxConsoleRuntime } from './runtime';
import { LuaMarshalContext } from './types';

export type LuaSnapshotObjects = Record<number, unknown>;
export type LuaSnapshotGraph = { root: unknown; objects: LuaSnapshotObjects };
export type LuaEntrySnapshot = Record<string, unknown> | LuaSnapshotGraph;
type LuaSnapshotContext = { ids: WeakMap<LuaTable, number>; objects: LuaSnapshotObjects; nextId: number };

export class LuaJsBridge {
	private readonly luaHandlerCache: LuaHandlerCache;
	private readonly consoleRuntime: BmsxConsoleRuntime;

	constructor(consoleRuntime: BmsxConsoleRuntime, luaHandlerCache: LuaHandlerCache) {
		this.consoleRuntime = consoleRuntime;
		this.luaHandlerCache = luaHandlerCache;
	}

	private describeMarshalSegment(key: LuaValue): string {
		if (typeof key === 'string') {
			return key;
		}
		if (typeof key === 'number') {
			return String(key);
		}
		return null;
	}

	public luaValueToJs(value: LuaValue, context?: LuaMarshalContext): unknown {
		const marshalCtx = this.consoleRuntime.ensureMarshalContext(context);
		return this.luaValueToJsWithVisited(value, marshalCtx, new WeakMap<LuaTable, unknown>());
	}

	private luaValueToJsWithVisited(value: LuaValue, context: LuaMarshalContext, visited: WeakMap<LuaTable, unknown>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaFunctionValue(value)) {
			return this.luaHandlerCache.getOrCreate(value, {
				moduleId: context.moduleId,
				path: context.path.slice(),
			});
		}
		if (isLuaNativeValue(value)) {
			return value.native;
		}
		if (isLuaTable(value)) {
			return this.convertLuaTableToJs(value, context, visited);
		}
		return null;
	}

	private convertLuaTableToJs(table: LuaTable, context: LuaMarshalContext, visited: WeakMap<LuaTable, unknown>): unknown {
		const cached = visited.get(table);
		if (cached !== undefined) {
			return cached;
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
		const isSequential = numericEntries.length === entries.length && numericEntries.length === maxNumericIndex;
		if (isSequential) {
			const result: unknown[] = new Array(maxNumericIndex);
			visited.set(table, result);
			for (let index = 0; index < numericEntries.length; index += 1) {
				const entry = numericEntries[index];
				const segment = this.describeMarshalSegment(entry.key);
				const converted = this.luaValueToJsWithVisited(entry.value, segment ? this.consoleRuntime.extendMarshalContext(context, segment) : context, visited);
				result[entry.key - 1] = converted;
			}
			return result;
		}
		const objectResult: Record<string, unknown> = {};
		visited.set(table, objectResult);
		for (let index = 0; index < numericEntries.length; index += 1) {
			const entry = numericEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(entry.value, segment ? this.consoleRuntime.extendMarshalContext(context, segment) : context, visited);
		}
		for (let index = 0; index < otherEntries.length; index += 1) {
			const entry = otherEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(entry.value, segment ? this.consoleRuntime.extendMarshalContext(context, segment) : context, visited);
		}
		return objectResult;
	}

	public jsToLua(value: unknown): LuaValue {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return value;
		}
		if (isLuaNativeValue(value)) {
			return value;
		}
		if (Array.isArray(value)) {
			const table = createLuaTable();
			for (let index = 0; index < value.length; index += 1) {
				table.set(index + 1, this.jsToLua(value[index]));
			}
			return table;
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
						const valueValue = this.jsToLua(entry.value);
						table.set(keyValue, valueValue);
					}
					return table;
				}
				const table = createLuaTable();
				for (const [prop, entry] of Object.entries(record)) {
					table.set(prop, this.jsToLua(entry));
				}
				return table;
			}
			if (value instanceof Map) {
				const table = createLuaTable();
				for (const [key, entry] of value.entries()) {
					table.set(this.jsToLua(key), this.jsToLua(entry));
				}
				return table;
			}
			if (value instanceof Set) {
				const table = createLuaTable();
				let index = 1;
				for (const entry of value.values()) {
					table.set(index, this.jsToLua(entry));
					index += 1;
				}
				return table;
			}
			return this.wrapNativeValue(value);
		}
		if (typeof value === 'function') {
			if (isLuaHandlerFn(value)) {
				const binding = this.luaHandlerCache.unwrap(value);
				if (binding) {
					return binding.fn;
				}
			}
			return this.wrapNativeValue(value);
		}
		return null;
	}

	private wrapNativeValue(value: object | Function): LuaNativeValue {
		return this.consoleRuntime.interpreter.getOrCreateNativeValue(value, resolveNativeTypeName(value));
	}

	public snapshotEncodeNative(native: object | Function): unknown {
		return native;
	}

	public snapshotDecodeNative(token: unknown): object | Function {
		return token as object | Function;
	}

	private serializeLuaSnapshotKey(key: LuaValue, ctx: LuaSnapshotContext): unknown {
		if (key === null || typeof key === 'boolean' || typeof key === 'number' || typeof key === 'string') {
			return key;
		}
		if (isLuaNativeValue(key)) {
			return this.snapshotEncodeNative(key.native);
		}
		if (isLuaFunctionValue(key)) {
			return undefined;
		}
		if (isLuaTable(key)) {
			return this.serializeLuaTableForSnapshot(key, ctx);
		}
		return this.serializeLuaValueForSnapshot(key, ctx);
	}

	private deserializeLuaSnapshotKey(raw: unknown, resolver?: (value: unknown) => LuaValue): LuaValue {
		if (resolver) {
			return resolver(raw);
		}
		return this.deserializeLuaSnapshotValue(raw);
	}

	private parseSnapshotObjectId(text: string): number {
		const id = Number.parseInt(text, 10);
		if (!Number.isFinite(id)) {
			throw new Error(`[BmsxConsoleRuntime] Invalid Lua snapshot object id '${text}'.`);
		}
		return id;
	}

	private parseSnapshotReferenceId(raw: unknown): number {
		const id = Number(raw);
		if (!Number.isFinite(id)) {
			throw new Error(`[BmsxConsoleRuntime] Invalid Lua snapshot reference id '${String(raw)}'.`);
		}
		return id;
	}

	private deserializeLuaSnapshotValue(raw: unknown, resolveRef?: (id: number) => LuaTable): LuaValue {
		if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
			return raw as LuaValue;
		}
		if (isLuaTable(raw) || isLuaNativeValue(raw)) {
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
			return this.wrapNativeValue(this.snapshotDecodeNative(raw as object));
		}
		if (typeof raw === 'function') {
			return this.wrapNativeValue(this.snapshotDecodeNative(raw));
		}
		return null;
	}

	private isLuaSnapshotGraph(value: unknown): value is LuaSnapshotGraph {
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

	private deserializeLuaSnapshotGraph(graph: LuaSnapshotGraph): Array<[string, LuaValue]> {
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
			for (const [name, value] of Object.entries(resolvedRoot as Record<string, unknown>)) {
				entries.push([name, resolveSnapshotValue(value)]);
			}
			return entries;
		}
		return [];
	}

	private applyLuaSnapshotPayload(target: LuaTable, payload: unknown, resolve: (value: unknown) => LuaValue): void {
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
		if (isLuaNativeValue(value)) {
			return this.snapshotEncodeNative(value.native);
		}
		if (isLuaTable(value)) {
			return this.serializeLuaTableForSnapshot(value, ctx);
		}
		throw new Error('Unsupported Lua value encountered during snapshot serialization.');
	}

	private serializeLuaTableForSnapshot(table: LuaTable, ctx: LuaSnapshotContext): { r: number } {
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

	private buildLuaTableSnapshotPayload(table: LuaTable, ctx: LuaSnapshotContext): unknown {
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
				if (isLuaNativeValue(entryValue)) {
					serializedEntry = this.snapshotEncodeNative(entryValue.native);
				} else {
					serializedEntry = this.serializeLuaValueForSnapshot(entryValue, ctx);
				}
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxConsoleRuntime] Skipping Lua table entry '${String(key)}' during snapshot:`, error);
				}
				continue;
			}
			let serializedKey: unknown;
			try {
				serializedKey = this.serializeLuaSnapshotKey(key, ctx);
			} catch (error) {
				if ($.debug) {
					console.warn(`[BmsxConsoleRuntime] Skipping Lua table key '${String(key)}' during snapshot:`, error);
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
}
