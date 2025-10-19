import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { ConsoleCartEditor } from './editor';
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
	private readonly apiFunctionNames = new Set<string>();
	private luaProgram: BmsxConsoleLuaProgram | null;
	private readonly playerIndex: number;
	private editor: ConsoleCartEditor | null = null;
	private luaProgramSourceOverride: string | null = null;
	private luaInterpreter: LuaInterpreter | null = null;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private frameCounter = 0;

	constructor(options: BmsxConsoleRuntimeOptions) {
		this.cart = options.cart;
		this.playerIndex = options.playerIndex;
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
		this.initializeEditor();
	}

	public boot(): void {
		this.frameCounter = 0;
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
		const editor = this.editor;
		if (editor) {
			editor.update(deltaSeconds);
		}
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		if (editor && editor.isActive()) {
			editor.draw(this.api);
			this.frameCounter += 1;
			return;
		}
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

	public dispose(): void {
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
	}

	private hasLuaProgram(): boolean {
		return this.luaProgram !== null;
	}

	private initializeEditor(): void {
		if (!this.hasLuaProgram()) {
			if (this.editor) {
				this.editor.shutdown();
			}
			this.editor = null;
			return;
		}
		const viewport = { width: this.api.displayWidth, height: this.api.displayHeight };
		this.editor = new ConsoleCartEditor({
			playerIndex: this.playerIndex,
			metadata: this.cart.meta,
			viewport,
			loadSource: () => this.getEditorSource(),
			reloadSource: (source: string) => { this.reloadLuaProgram(source); },
		});
	}

	private getEditorSource(): string {
		const program = this.luaProgram;
		if (!program) {
			return '';
		}
		return this.getLuaProgramSource(program);
	}

	private bootLuaProgram(): void {
		const program = this.luaProgram;
		if (!program) return;

		const source = this.getLuaProgramSource(program);
		const chunkName = this.resolveLuaProgramChunkName(program);

		this.luaInterpreter = createLuaInterpreter();
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaChunkName = chunkName;

		this.registerApiBuiltins(this.luaInterpreter);
		this.luaInterpreter.setReservedIdentifiers(this.apiFunctionNames);
		this.luaInterpreter.execute(source, chunkName);

		const env = this.luaInterpreter.getGlobalEnvironment();
		this.luaInitFunction = this.resolveLuaFunction(env.get(program.entry?.init ?? 'init'));
		this.luaUpdateFunction = this.resolveLuaFunction(env.get(program.entry?.update ?? 'update'));
		this.luaDrawFunction = this.resolveLuaFunction(env.get(program.entry?.draw ?? 'draw'));

		if (this.luaInitFunction !== null) {
			this.invokeLuaFunction(this.luaInitFunction, []);
		}
	}

	public reloadLuaProgram(source: string): void {
		if (!this.hasLuaProgram()) {
			throw new Error('[BmsxConsoleRuntime] Cannot reload Lua program when no Lua program is active.');
		}
		if (typeof source !== 'string') {
			throw new Error('[BmsxConsoleRuntime] Lua source must be a string.');
		}
		if (source.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua source cannot be empty.');
		}
		const program = this.luaProgram;
		if (!program) {
			throw new Error('[BmsxConsoleRuntime] Lua program reference unavailable.');
		}
		const chunkName = this.resolveLuaProgramChunkName(program);
		this.validateLuaSource(source, chunkName);
		const previousOverride = this.luaProgramSourceOverride;
		this.luaProgramSourceOverride = source;
		try {
			this.boot();
			this.applyProgramSourceToCartridge(source, chunkName);
		}
		catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.boot();
			}
			catch (_restoreError) {
				// Preserve original error; restoration failure is secondary.
			}
			throw error;
		}
	}

	private validateLuaSource(source: string, chunkName: string): void {
		const previousChunk = this.luaChunkName;
		this.luaChunkName = chunkName;
		try {
			const interpreter = createLuaInterpreter();
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			interpreter.execute(source, chunkName);
		}
		finally {
			this.luaChunkName = previousChunk;
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
		this.apiFunctionNames.clear();

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
				this.apiFunctionNames.add(name);
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
				this.apiFunctionNames.add(name);
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
		this.apiFunctionNames.add('table');
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

	private getLuaProgramSource(program: BmsxConsoleLuaProgram): string {
		if (this.luaProgramSourceOverride !== null) {
			return this.luaProgramSourceOverride;
		}
		return this.resolveLuaProgramSource(program);
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

	private applyProgramSourceToCartridge(source: string, chunkName: string): void {
		const program = this.luaProgram;
		if (!program) return;
		if ('source' in program) {
			const mutable = program as { source: string; chunkName?: string };
			mutable.source = source;
			mutable.chunkName = chunkName;
			return;
		}
		const cartridge = this.cart as { luaProgram?: BmsxConsoleLuaProgram };
		const updated: BmsxConsoleLuaProgram = {
			source,
			chunkName,
			entry: program.entry,
		};
		cartridge.luaProgram = updated;
		this.luaProgram = updated;
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
