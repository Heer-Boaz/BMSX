export type LuaValue = LuaNil | boolean | number | string | LuaTable | LuaFunctionValue;

export type LuaNil = null;

export interface LuaFunctionValue {
	readonly name: string;
	call(args: ReadonlyArray<LuaValue>): LuaValue[];
}

type LuaTableMethods = {
	get(key: LuaValue): LuaValue | null;
	set(key: LuaValue, value: LuaValue): void;
	delete(key: LuaValue): void;
	has(key: LuaValue): boolean;
	entriesArray(): ReadonlyArray<[LuaValue, LuaValue]>;
	numericLength(): number;
	setMetatable(table: LuaTable | null): void;
	getMetatable(): LuaTable | null;
};

const LUA_TABLE_BRAND = Symbol('LuaTableBrand');

export type LuaTable = {
	[key: string]: LuaValue;
} & LuaTableMethods & { [LUA_TABLE_BRAND]?: true };

type TableState = {
	metatable: LuaTable | null;
	stringKeys: Map<string, { key: LuaValue; lower?: string }>;
	lowercaseIndex?: Map<string, string>;
	nonPrimitiveKeys?: Map<LuaValue, LuaValue>;
	numericKeys: Set<number>;
};

const tableState = new WeakMap<LuaTable, TableState>();
let caseInsensitiveKeys = true;

export function setLuaTableCaseInsensitiveKeys(enabled: boolean): void {
	caseInsensitiveKeys = enabled;
}

const luaTablePrototype = Object.create(null) as LuaTableMethods & { [LUA_TABLE_BRAND]?: true };

export function createLuaTable(): LuaTable {
	const table = Object.create(luaTablePrototype) as LuaTable;
	Object.defineProperty(table, LUA_TABLE_BRAND, {
		value: true,
		enumerable: false,
		configurable: false,
		writable: false,
	});
	tableState.set(table, {
		metatable: null,
		stringKeys: new Map(),
		lowercaseIndex: caseInsensitiveKeys ? new Map() : undefined,
		nonPrimitiveKeys: undefined,
		numericKeys: new Set(),
	});
	return table;
}

export function isLuaTable(value: unknown): value is LuaTable {
	return !!value && typeof value === 'object' && (value as LuaTable)[LUA_TABLE_BRAND] === true;
}

function getState(table: LuaTable): TableState {
	const state = tableState.get(table);
	if (!state) {
		throw new Error('Lua table state not found.');
	}
	return state;
}

function ensureLowercaseIndex(state: TableState): Map<string, string> {
	if (!state.lowercaseIndex) {
		const index = new Map<string, string>();
		for (const [property, info] of state.stringKeys.entries()) {
			if (typeof info.key === 'string') {
				const lower = info.key.toLowerCase();
				index.set(lower, property);
				if (info.lower === undefined) {
					info.lower = lower;
				}
			}
		}
		state.lowercaseIndex = index;
	}
	return state.lowercaseIndex;
}

function resolveStringPropertyForWrite(state: TableState, key: string): string {
	if (!caseInsensitiveKeys) {
		return key;
	}
	const lower = key.toLowerCase();
	const index = ensureLowercaseIndex(state);
	const existing = index.get(lower);
	if (existing !== undefined) {
		return existing;
	}
	index.set(lower, key);
	return key;
}

function resolveStringPropertyForRead(state: TableState, key: string): string {
	if (!caseInsensitiveKeys) {
		return key;
	}
	const lower = key.toLowerCase();
	const index = ensureLowercaseIndex(state);
	const existing = index.get(lower);
	return existing !== undefined ? existing : key;
}

function tableSet(this: LuaTable, key: LuaValue, value: LuaValue): void {
	if (value === null) {
		tableDelete.call(this, key);
		return;
}
	const state = getState(this);
	if (typeof key === 'number' && Number.isInteger(key)) {
		const property = String(key);
		this[property] = value;
		state.stringKeys.set(property, { key });
		state.numericKeys.add(key);
		return;
	}
	if (typeof key === 'string') {
		const property = resolveStringPropertyForWrite(state, key);
		this[property] = value;
		if (!state.stringKeys.has(property)) {
			const lower = caseInsensitiveKeys ? key.toLowerCase() : undefined;
			if (caseInsensitiveKeys) {
				const index = ensureLowercaseIndex(state);
				index.set(lower!, property);
			}
			state.stringKeys.set(property, { key, lower });
		}
		return;
	}
	let map = state.nonPrimitiveKeys;
	if (!map) {
		map = new Map<LuaValue, LuaValue>();
		state.nonPrimitiveKeys = map;
	}
	map.set(key, value);
}

function tableGet(this: LuaTable, key: LuaValue): LuaValue | null {
	const state = getState(this);
	if (typeof key === 'number' && Number.isInteger(key)) {
		const property = String(key);
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			const value = this[property];
			return value === undefined ? null : value;
		}
		return null;
	}
	if (typeof key === 'string') {
		const property = resolveStringPropertyForRead(state, key);
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			const value = this[property];
			return value === undefined ? null : value;
		}
		return null;
	}
	const map = state.nonPrimitiveKeys;
	if (!map) {
		return null;
	}
	const value = map.get(key);
	return value === undefined ? null : value;
}

function tableDelete(this: LuaTable, key: LuaValue): void {
	const state = getState(this);
	if (typeof key === 'number' && Number.isInteger(key)) {
		const property = String(key);
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			delete this[property];
		}
		state.stringKeys.delete(property);
		state.numericKeys.delete(key);
		return;
	}
	if (typeof key === 'string') {
		const property = resolveStringPropertyForRead(state, key);
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			delete this[property];
		}
		const entry = state.stringKeys.get(property);
		if (entry) {
			if (entry.lower && state.lowercaseIndex) {
				const current = state.lowercaseIndex.get(entry.lower);
				if (current === property) {
					state.lowercaseIndex.delete(entry.lower);
				}
			}
			state.stringKeys.delete(property);
		}
		return;
	}
	const map = state.nonPrimitiveKeys;
	if (!map) {
		return;
	}
	map.delete(key);
}

function tableHas(this: LuaTable, key: LuaValue): boolean {
	const state = getState(this);
	if (typeof key === 'number' && Number.isInteger(key)) {
		const property = String(key);
		return Object.prototype.hasOwnProperty.call(this, property);
	}
	if (typeof key === 'string') {
		const property = resolveStringPropertyForRead(state, key);
		return Object.prototype.hasOwnProperty.call(this, property);
	}
	const map = state.nonPrimitiveKeys;
	return map ? map.has(key) : false;
}

function tableEntriesArray(this: LuaTable): ReadonlyArray<[LuaValue, LuaValue]> {
	const state = getState(this);
	const entries: Array<[LuaValue, LuaValue]> = [];
	for (const [property, info] of state.stringKeys.entries()) {
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			entries.push([info.key, this[property]]);
		}
	}
	if (state.nonPrimitiveKeys) {
		for (const [key, value] of state.nonPrimitiveKeys.entries()) {
			entries.push([key, value]);
		}
	}
	return entries;
}

function tableNumericLength(this: LuaTable): number {
	const state = getState(this);
	let index = 1;
	while (state.numericKeys.has(index)) {
		index += 1;
	}
	return index - 1;
}

function tableSetMetatable(this: LuaTable, table: LuaTable | null): void {
	const state = getState(this);
	state.metatable = table;
}

function tableGetMetatable(this: LuaTable): LuaTable | null {
	return getState(this).metatable;
}

Object.defineProperties(luaTablePrototype, {
	get: { value: tableGet, enumerable: false, configurable: false },
	set: { value: tableSet, enumerable: false, configurable: false },
	delete: { value: tableDelete, enumerable: false, configurable: false },
	has: { value: tableHas, enumerable: false, configurable: false },
	entriesArray: { value: tableEntriesArray, enumerable: false, configurable: false },
	numericLength: { value: tableNumericLength, enumerable: false, configurable: false },
	setMetatable: { value: tableSetMetatable, enumerable: false, configurable: false },
	getMetatable: { value: tableGetMetatable, enumerable: false, configurable: false },
});
