import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram } from './types';
import { createLuaInterpreter, LuaInterpreter, createLuaNativeFunction } from '../lua/runtime';
import { LuaEnvironment } from '../lua/environment';
import type { LuaFunctionValue, LuaValue } from '../lua/value';
import { LuaTable } from '../lua/value';
import { LuaRuntimeError } from '../lua/errors';
import { $ } from '../core/game';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	storage: StorageService;
	playerIndex: number;
	physics: Physics2DManager;
};

export class BmsxConsoleRuntime {
	private readonly cart: BmsxConsoleCartridge;
	private readonly api: BmsxConsoleApi;
	private readonly input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly colliders: ConsoleColliderManager;
	private readonly physics: Physics2DManager;
	private readonly luaProgram: BmsxConsoleLuaProgram | null;
	private luaInterpreter: LuaInterpreter | null = null;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private frameCounter = 0;

	constructor(options: BmsxConsoleRuntimeOptions) {
		this.cart = options.cart;
		this.input = new BmsxConsoleInput(options.playerIndex);
		this.storage = new BmsxConsoleStorage(options.storage, options.cart.meta.persistentId);
		this.colliders = new ConsoleColliderManager();
		this.physics = options.physics;
		this.physics.clear();
		this.api = new BmsxConsoleApi({
			input: this.input,
			storage: this.storage,
			colliders: this.colliders,
			physics: this.physics,
		});
		this.luaProgram = this.cart.luaProgram ?? null;
	}

	public boot(): void {
		this.physics.clear();
		this.api.cartdata(this.cart.meta.persistentId);
		this.api.colliderClear();
		if (this.hasLuaProgram()) {
			this.bootLuaProgram();
			return;
		}
		this.cart.init(this.api);
	}

	public frame(deltaMilliseconds: number): void {
		if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds < 0) {
			throw new Error('[BmsxConsoleRuntime] Delta time must be a finite non-negative number.');
		}
		const deltaSeconds = deltaMilliseconds / 1000;
		this.input.beginFrame(this.frameCounter);
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		if (this.hasLuaProgram()) {
			if (this.luaUpdateFunction !== null) {
				this.invokeLuaFunction(this.luaUpdateFunction, [deltaSeconds]);
			}
			if (this.luaDrawFunction !== null) {
				this.invokeLuaFunction(this.luaDrawFunction, []);
			}
		}
		else {
			this.cart.update(this.api, deltaSeconds);
			this.cart.draw(this.api);
		}
		this.physics.step(deltaSeconds);
		this.frameCounter += 1;
	}

	private hasLuaProgram(): boolean {
		return this.luaProgram !== null;
	}

	private bootLuaProgram(): void {
		const program = this.luaProgram;
		if (!program) return;

		const source = this.resolveLuaProgramSource(program);
		const chunkName = this.resolveLuaProgramChunkName(program);

		this.luaInterpreter = createLuaInterpreter();
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaChunkName = chunkName;

		this.registerApiBuiltins(this.luaInterpreter);
		this.luaInterpreter.execute(source, chunkName);

		const env = this.luaInterpreter.getGlobalEnvironment();
		this.luaInitFunction = this.resolveLuaFunction(env.get(program.entry?.init ?? 'init'));
		this.luaUpdateFunction = this.resolveLuaFunction(env.get(program.entry?.update ?? 'update'));
		this.luaDrawFunction = this.resolveLuaFunction(env.get(program.entry?.draw ?? 'draw'));

		if (this.luaInitFunction !== null) {
			this.invokeLuaFunction(this.luaInitFunction, []);
		}
	}

	private resolveLuaFunction(value: LuaValue | null): LuaFunctionValue | null {
		if (value === null) {
			return null;
		}
		if (typeof value === 'object' && value !== null && 'call' in value) {
			return value as LuaFunctionValue;
		}
		return null;
	}

	private invokeLuaFunction(fn: LuaFunctionValue, args: unknown[]): LuaValue[] {
		const luaArgs = args.map((value) => this.jsToLua(value));
		return fn.call(luaArgs);
	}

	private registerApiBuiltins(interpreter: LuaInterpreter): void {
		const env = interpreter.getGlobalEnvironment();
		const apiTable = new LuaTable();
		const members = this.collectApiMembers();
		for (const { name, kind, descriptor } of members) {
			if (descriptor === undefined) {
				continue;
			}
			if (kind === 'method') {
				const methodDescriptor = descriptor;
				if (typeof methodDescriptor.value !== 'function') {
					continue;
				}
				const native = createLuaNativeFunction(`api.${name}`, interpreter, (_lua, args) => {
					const jsArgs = Array.from(args, (arg) => this.luaValueToJs(arg));
					try {
						const target = this.api as unknown as Record<string, unknown>;
						const candidate = target[name];
						if (typeof candidate !== 'function') {
							throw new Error(`Method '${name}' is not callable.`);
						}
						const result = candidate.apply(this.api, jsArgs);
						return this.wrapResultValue(result);
					}
					catch (error) {
						if (error instanceof LuaRuntimeError) {
							throw error;
						}
						const message = error instanceof Error ? error.message : String(error);
						throw new LuaRuntimeError(`[api.${name}] ${message}`, this.luaChunkName ?? 'lua', 0, 0);
					}
				});
				env.set(name, native);
				apiTable.set(name, native);
				continue;
			}

			if (descriptor.get) {
				const getter = descriptor.get;
				const native = createLuaNativeFunction(`api.${name}`, interpreter, () => {
					try {
						const value = getter.call(this.api);
						return this.wrapResultValue(value);
					}
					catch (error) {
						if (error instanceof LuaRuntimeError) {
							throw error;
						}
						const message = error instanceof Error ? error.message : String(error);
						throw new LuaRuntimeError(`[api.${name}] ${message}`, this.luaChunkName ?? 'lua', 0, 0);
					}
				});
				env.set(name, native);
				apiTable.set(name, native);
			}
		}
		env.set('api', apiTable);

		this.registerLuaTableLibrary(env, interpreter);
	}

	private registerLuaTableLibrary(env: LuaEnvironment, interpreter: LuaInterpreter): void {
		const tableLibrary = new LuaTable();

		tableLibrary.set('insert', createLuaNativeFunction('table.insert', interpreter, (_lua, args) => {
			if (args.length < 2) {
				throw new LuaRuntimeError('[table.insert] requires at least 2 arguments.', this.luaChunkName ?? 'lua', 0, 0);
			}
			const target = args[0];
			if (!(target instanceof LuaTable)) {
				throw new LuaRuntimeError('[table.insert] target must be a table.', this.luaChunkName ?? 'lua', 0, 0);
			}
			let position: number | null = null;
			let value: LuaValue;
			if (args.length === 2) {
				value = args[1];
			}
			else {
				const positionValue = args[1];
				if (typeof positionValue !== 'number' || !Number.isInteger(positionValue)) {
					throw new LuaRuntimeError('[table.insert] position must be an integer.', this.luaChunkName ?? 'lua', 0, 0);
				}
				position = positionValue;
				value = args[2];
			}
			this.luaTableInsert(target, value, position);
			return [];
		}));

		tableLibrary.set('remove', createLuaNativeFunction('table.remove', interpreter, (_lua, args) => {
			if (args.length === 0) {
				throw new LuaRuntimeError('[table.remove] requires a table argument.', this.luaChunkName ?? 'lua', 0, 0);
			}
			const target = args[0];
			if (!(target instanceof LuaTable)) {
				throw new LuaRuntimeError('[table.remove] target must be a table.', this.luaChunkName ?? 'lua', 0, 0);
			}
			let position: number | null = null;
			if (args.length >= 2) {
				const positionValue = args[1];
				if (typeof positionValue !== 'number' || !Number.isInteger(positionValue)) {
					throw new LuaRuntimeError('[table.remove] position must be an integer.', this.luaChunkName ?? 'lua', 0, 0);
				}
				position = positionValue;
			}
			const removed = this.luaTableRemove(target, position);
			return removed === null ? [] : [removed];
		}));

		env.set('table', tableLibrary);
	}

	private collectApiMembers(): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor | undefined }> {
		const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor | undefined }>();
		let prototype: object | null = Object.getPrototypeOf(this.api);
		while (prototype && prototype !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(prototype)) {
				if (name === 'constructor') continue;
				const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
				if (!descriptor || map.has(name)) continue;
				if (typeof descriptor.value === 'function') {
					map.set(name, { kind: 'method', descriptor });
				}
				else if (descriptor.get) {
					map.set(name, { kind: 'getter', descriptor });
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
		return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
	}

	private wrapResultValue(value: unknown): ReadonlyArray<LuaValue> {
		if (Array.isArray(value)) {
			if (value.every((entry) => this.isLuaValue(entry))) {
				return value as LuaValue[];
			}
			return value.map((entry) => this.jsToLua(entry));
		}
		if (value === undefined) {
			return [];
		}
		const luaValue = this.jsToLua(value);
		return [luaValue];
	}

	private isLuaValue(value: unknown): value is LuaValue {
		if (value === null) return true;
		switch (typeof value) {
			case 'boolean':
			case 'number':
			case 'string':
				return true;
			case 'object':
				return value instanceof LuaTable;
			default:
				return typeof value === 'object' && value !== null && 'call' in (value as Record<string, unknown>);
		}
	}

	private luaValueToJs(value: LuaValue): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (value instanceof LuaTable) {
			const entries = value.entriesArray();
			if (entries.length === 0) {
				return {};
			}
			const arrayValues: unknown[] = [];
			const objectValues: Record<string, unknown> = {};
			let sequentialCount = 0;
			for (const [key, entryValue] of entries) {
				const converted = this.luaValueToJs(entryValue);
				if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					arrayValues[key - 1] = converted;
					sequentialCount += 1;
				} else {
					objectValues[String(key)] = converted;
				}
			}
			if (sequentialCount === entries.length) {
				return arrayValues;
			}
			for (const [index, entryValue] of arrayValues.entries()) {
				if (entryValue !== undefined) {
					objectValues[String(index + 1)] = entryValue;
				}
			}
			return objectValues;
		}
		return null;
	}

	private jsToLua(value: unknown): LuaValue {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (value instanceof LuaTable) {
			return value;
		}
		if (Array.isArray(value)) {
			const table = new LuaTable();
			for (let index = 0; index < value.length; index += 1) {
				table.set(index + 1, this.jsToLua(value[index]));
			}
			return table;
		}
		if (typeof value === 'object') {
			const table = new LuaTable();
			for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
				table.set(key, this.jsToLua(entryValue));
			}
			return table;
		}
		return null;
	}

	private resolveLuaProgramSource(program: BmsxConsoleLuaProgram): string {
		if ('source' in program && program.source) {
			return program.source;
		}
		if ('assetId' in program && program.assetId) {
			const rompack = $.rompack;
			if (!rompack) {
				throw new Error('[BmsxConsoleRuntime] Rompack not loaded. Cannot access Lua asset.');
			}
			const source = rompack.lua?.[program.assetId];
			if (typeof source !== 'string') {
				throw new Error(`[BmsxConsoleRuntime] Lua asset '${program.assetId}' not found in rompack.`);
			}
			return source;
		}
		throw new Error('[BmsxConsoleRuntime] Lua program requires either an inline source or an asset id.');
	}

	private resolveLuaProgramChunkName(program: BmsxConsoleLuaProgram): string {
		if (program.chunkName && program.chunkName.length > 0) {
			return program.chunkName;
		}
		if ('assetId' in program && program.assetId) {
			return program.assetId;
		}
		return 'bmsx-lua';
	}

	private luaTableInsert(table: LuaTable, value: LuaValue, position: number | null): void {
		const sequence = this.getLuaTableSequence(table);
		if (position === null) {
			sequence.push(value);
		}
		else {
			const index = Math.max(1, position);
			const zeroBased = Math.min(index, sequence.length + 1) - 1;
			sequence.splice(zeroBased, 0, value);
		}
		this.setLuaTableSequence(table, sequence);
	}

	private luaTableRemove(table: LuaTable, position: number | null): LuaValue | null {
		const sequence = this.getLuaTableSequence(table);
		if (sequence.length === 0) {
			return null;
		}
		let index: number;
		if (position === null) {
			index = sequence.length - 1;
		}
		else {
			if (position < 1 || position > sequence.length) {
				return null;
			}
			index = position - 1;
		}
		const [removed] = sequence.splice(index, 1);
		this.setLuaTableSequence(table, sequence);
		return removed ?? null;
	}

	private getLuaTableSequence(table: LuaTable): LuaValue[] {
		const length = table.numericLength();
		const values: LuaValue[] = [];
		for (let i = 1; i <= length; i += 1) {
			values.push(table.get(i));
		}
		return values;
	}

	private setLuaTableSequence(table: LuaTable, values: LuaValue[]): void {
		for (const [key] of table.entriesArray()) {
			if (typeof key === 'number') {
				table.delete(key);
			}
		}
		for (let index = 0; index < values.length; index += 1) {
			table.set(index + 1, values[index] ?? null);
		}
	}
}
