import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram } from './types';
import { createLuaInterpreter, LuaInterpreter, createLuaNativeFunction } from '../lua/runtime';
import type { LuaFunctionValue, LuaValue } from '../lua/value';
import { LuaTable } from '../lua/value';
import { LuaRuntimeError } from '../lua/errors';

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

	public getApi(): BmsxConsoleApi {
		return this.api;
	}

	private hasLuaProgram(): boolean {
		return this.luaProgram !== null;
	}

	private bootLuaProgram(): void {
		const program = this.luaProgram;
		if (!program) return;

		this.luaInterpreter = createLuaInterpreter();
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;

		this.registerApiBuiltins(this.luaInterpreter);
		this.luaInterpreter.execute(program.source, program.chunkName);

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
						throw new LuaRuntimeError(`[api.${name}] ${message}`, this.luaProgram?.chunkName ?? 'lua', 0, 0);
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
						throw new LuaRuntimeError(`[api.${name}] ${message}`, this.luaProgram?.chunkName ?? 'lua', 0, 0);
					}
				});
				env.set(name, native);
				apiTable.set(name, native);
			}
		}
		env.set('api', apiTable);
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
		if (Array.isArray(value) && value.every((entry) => this.isLuaValue(entry))) {
			return value as LuaValue[];
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
			let isArray = true;
			const arrayValues: unknown[] = [];
			const objectValues: Record<string, unknown> = {};
			for (const [key, entryValue] of entries) {
				const converted = this.luaValueToJs(entryValue);
				if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					arrayValues[key - 1] = converted;
				}
				else if (typeof key === 'string') {
					objectValues[key] = converted;
					isArray = false;
				}
				else {
					objectValues[String(key)] = converted;
					isArray = false;
				}
			}
			if (isArray && Object.keys(objectValues).length === 0) {
				return arrayValues;
			}
			for (let index = 0; index < arrayValues.length; index += 1) {
				if (arrayValues[index] !== undefined) {
					objectValues[String(index + 1)] = arrayValues[index];
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
}
