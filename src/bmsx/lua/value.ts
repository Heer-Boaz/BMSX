import { LuaError, LuaRuntimeError, LuaSyntaxError } from './errors';
import type { ExecutionSignal } from './runtime';

export type LuaValue = null | boolean | number | string | LuaTable | LuaFunctionValue | LuaNativeValue;

export interface LuaFunctionValue {
	readonly name: string;
	call(args: ReadonlyArray<LuaValue>): LuaCallResult;
}

export type LuaCallSignal = Extract<ExecutionSignal, { kind: 'pause'; }>;
export type LuaCallResult = ReadonlyArray<LuaValue> | LuaCallSignal;

export class LuaNativeValue {
	public metatable: LuaTable = null;

	constructor(public readonly native: object | Function, public readonly typeName?: string) {
		// if (native === null || (typeof native !== 'object' && typeof native !== 'function')) { // Useless defensive coding
		// 	throw new Error('LuaNativeValue requires an object or function.');
		// }
	}
}

export class LuaNativeMemberHandle implements LuaFunctionValue {
	public readonly name: string;
	public readonly target: object | Function;
	public readonly path: ReadonlyArray<string>;
	private readonly callImpl: (args: ReadonlyArray<LuaValue>) => LuaCallResult;

	constructor(params: { name?: string; target?: object | Function; path?: ReadonlyArray<string>; callImpl?: (args: ReadonlyArray<LuaValue>) => LuaCallResult }) {
		this.name = (params as { name?: string }).name ?? 'native_member_handle';
		this.target = (params as { target: object | Function }).target;
		this.path = Array.from((params as { path?: ReadonlyArray<string> }).path ?? []);
		this.callImpl = (params as { callImpl?: (args: ReadonlyArray<LuaValue>) => LuaCallResult }).callImpl ?? (() => { throw new Error('Native member handle not bound.'); });
	}

	public call(args: ReadonlyArray<LuaValue>): LuaCallResult {
		return this.callImpl(args);
	}
}

export function createLuaNativeMemberHandle(params: { name: string; target: object | Function; path: ReadonlyArray<string>; callImpl: (args: ReadonlyArray<LuaValue>) => LuaCallResult }): LuaNativeMemberHandle {
	return new LuaNativeMemberHandle(params);
}

export function isLuaNativeMemberHandle(value: unknown): value is LuaNativeMemberHandle {
	return value instanceof LuaNativeMemberHandle;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function resolveNativeTypeName(value: object | Function): string {
	if (typeof value === 'function') {
		const name = value.name;
		if (typeof name === 'string' && name.length > 0) {
			return name;
		}
		return 'Function';
	}
	const descriptor = (value as { constructor?: unknown }).constructor;
	if (typeof descriptor === 'function') {
		const constructorFunction = descriptor as { name?: unknown };
		if (constructorFunction && typeof constructorFunction.name === 'string' && constructorFunction.name.length > 0) {
			return constructorFunction.name;
		}
	}
	return 'Object';
}

type LuaTableMethods = {
	get(key: LuaValue): LuaValue;
	set(key: LuaValue, value: LuaValue): void;
	delete(key: LuaValue): void;
	has(key: LuaValue): boolean;
	entriesArray(): ReadonlyArray<[LuaValue, LuaValue]>;
	numericLength(): number;
	setMetatable(table: LuaTable): void;
	getMetatable(): LuaTable;
};

const LUA_TABLE_BRAND = Symbol('LuaTableBrand');

export type LuaTable = {
	[key: string]: LuaValue;
} & LuaTableMethods & { [LUA_TABLE_BRAND]?: true };

type TableState = {
	metatable: LuaTable;
	stringKeys: Map<string, { key: string }>;
	stringValues: Map<string, LuaValue>;
	nonPrimitiveKeys?: Map<LuaValue, LuaValue>;
	numericKeys: Set<number>;
};

const tableState = new WeakMap<LuaTable, TableState>();

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
		stringValues: new Map(),
		nonPrimitiveKeys: undefined,
		numericKeys: new Set(),
	});
	return table;
}

export function isLuaTable(value: unknown): value is LuaTable {
	return (value as LuaTable)?.[LUA_TABLE_BRAND] === true;
}

function getState(table: LuaTable): TableState {
	const state = tableState.get(table);
	if (!state) {
		throw new Error('Lua table state not found.');
	}
	return state;
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
		state.numericKeys.add(key);
		return;
	}
	if (typeof key === 'string') {
		state.stringValues.set(key, value);
		if (!state.stringKeys.has(key)) {
			state.stringKeys.set(key, { key });
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

function tableGet(this: LuaTable, key: LuaValue): LuaValue {
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
		const value = state.stringValues.get(key);
		return value === undefined ? null : value;
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
		state.numericKeys.delete(key);
		return;
	}
	if (typeof key === 'string') {
		state.stringValues.delete(key);
		state.stringKeys.delete(key);
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
		return state.stringValues.has(key);
	}
	const map = state.nonPrimitiveKeys;
	return map ? map.has(key) : false;
}

function tableEntriesArray(this: LuaTable): ReadonlyArray<[LuaValue, LuaValue]> {
	const state = getState(this);
	const entries: Array<[LuaValue, LuaValue]> = [];
	for (const index of state.numericKeys.values()) {
		const property = String(index);
		if (Object.prototype.hasOwnProperty.call(this, property)) {
			entries.push([index, this[property]]);
		}
	}
	for (const [stringKey, info] of state.stringKeys.entries()) {
		const value = state.stringValues.get(stringKey);
		if (value !== undefined) {
			entries.push([info.key, value]);
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

function tableSetMetatable(this: LuaTable, table: LuaTable): void {
	const state = getState(this);
	state.metatable = table;
}

function tableGetMetatable(this: LuaTable): LuaTable {
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

export type LuaDebuggerPauseSignal = Extract<ExecutionSignal, { kind: 'pause'; }>;

export function isLuaDebuggerPauseSignal(value: unknown): value is LuaDebuggerPauseSignal {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<LuaDebuggerPauseSignal>;
	return candidate.kind === 'pause' && typeof candidate.resume === 'function';
}

export function isLuaCallSignal(value: unknown): value is LuaCallSignal {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { kind?: unknown };
	return candidate.kind === 'pause';
}

export function isLuaFunctionValue(value: unknown): value is LuaFunctionValue {
	if (!value || typeof value !== 'object') {
		return false;
	}
	return typeof (value as { call?: unknown }).call === 'function';
}

export function convertToError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function extractErrorMessage(error: unknown): string {
	if (typeof error === 'string') {
		return error;
	}
	if (error instanceof LuaError || error instanceof LuaRuntimeError || error instanceof LuaSyntaxError) {
		return error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export type StackFrameLanguage = 'lua' | 'js';

export type StackTraceFrame = {
	origin: StackFrameLanguage;
	functionName: string;
	source: string;
	line: number;
	column: number;
	raw: string;
	pathPath?: string;
};
