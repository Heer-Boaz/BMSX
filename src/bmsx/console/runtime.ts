import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { ConsoleCartEditor } from './editor';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager, type Physics2DSerializedState } from '../physics/physics2d';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram } from './types';
import { createLuaInterpreter, LuaInterpreter, createLuaNativeFunction } from '../lua/runtime.ts';
import { LuaEnvironment } from '../lua/environment.ts';
import type { LuaFunctionValue, LuaValue } from '../lua/value.ts';
import { LuaTable } from '../lua/value.ts';
import { LuaRuntimeError, LuaError } from '../lua/errors.ts';
import { $ } from '../core/game';
import { Service } from '../core/service';
import { EventEmitter, type EventPayload } from '../core/eventemitter';
import type { Identifiable } from '../rompack/rompack';
import { consoleEditorSpec } from '../core/pipelines/console_editor';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	playerIndex: number;
	storage?: StorageService;
};

export type BmsxConsoleState = {
	frameCounter: number;
	luaRuntimeFailed: boolean;
	luaProgramSourceOverride: string | null;
	luaChunkName: string | null;
	luaSnapshot?: unknown;
	cartState?: unknown;
	storage?: { namespace: string; entries: Array<{ index: number; value: number }> };
	physics?: Physics2DSerializedState;
};

export class BmsxConsoleRuntime extends Service {
	private static _instance: BmsxConsoleRuntime | null = null;
	private static readonly MAX_WRAP_DEPTH = 4;
	private static readonly MAX_FRAME_DELTA_MS = 250;
	private static readonly LUA_HANDLE_FIELD = '__js_handle__';
	private static readonly LUA_TYPE_FIELD = '__js_type__';

	public static ensure(options: BmsxConsoleRuntimeOptions): BmsxConsoleRuntime {
		if (!BmsxConsoleRuntime._instance) {
			BmsxConsoleRuntime._instance = new BmsxConsoleRuntime(options);
			return BmsxConsoleRuntime._instance;
		}
		BmsxConsoleRuntime._instance.assertCompatibleOptions(options);
		return BmsxConsoleRuntime._instance;
	}

	public static get instance(): BmsxConsoleRuntime | null {
		return BmsxConsoleRuntime._instance;
	}

	public static destroy(): void {
		if (!BmsxConsoleRuntime._instance) return;
		BmsxConsoleRuntime._instance.dispose();
		BmsxConsoleRuntime._instance = null;
	}

	private cart: BmsxConsoleCartridge;
	private readonly api: BmsxConsoleApi;
	private input: BmsxConsoleInput;
	private readonly storage: BmsxConsoleStorage;
	private readonly storageService: StorageService;
	private readonly colliders: ConsoleColliderManager;
	private readonly physics: Physics2DManager;
	private readonly apiFunctionNames = new Set<string>();
	private luaProgram: BmsxConsoleLuaProgram | null;
	private playerIndex: number;
	private editor: ConsoleCartEditor | null = null;
	private luaProgramSourceOverride: string | null = null;
	private luaInterpreter: LuaInterpreter | null = null;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private frameCounter = 0;
	private readonly luaHandleToObject = new Map<number, unknown>();
	private readonly luaObjectToHandle = new WeakMap<object, number>();
	private nextLuaHandleId = 1;
	private wrapDepth = 0;
	private luaSnapshotSave: LuaFunctionValue | null = null;
	private luaSnapshotLoad: LuaFunctionValue | null = null;
	private luaRuntimeFailed = false;
	private lastFrameTimestampMs = 0;
	private readonly presentationFrameHandler: (event_name: string, emitter: Identifiable, payload?: EventPayload) => void;
	private frameListenerAttached = false;
	private editorPipelineActive = false;

	private constructor(options: BmsxConsoleRuntimeOptions) {
		super({ id: 'bmsx_console_runtime' });
		this.enableEvents();
		this.presentationFrameHandler = this.handlePresentationFrame.bind(this);
		this.cart = options.cart;
		this.playerIndex = options.playerIndex;
		this.input = new BmsxConsoleInput(options.playerIndex);
		this.storageService = options.storage ?? $.platform.storage;
		this.storage = new BmsxConsoleStorage(this.storageService, options.cart.meta.persistentId);
		this.colliders = new ConsoleColliderManager();
		this.physics = new Physics2DManager();
		this.api = new BmsxConsoleApi({
			input: this.input,
			storage: this.storage,
			colliders: this.colliders,
			physics: this.physics,
		});
		this.luaProgram = this.cart.luaProgram ?? null;
		this.initializeEditor();
		this.attachFrameListener();
		this.boot();
	}

	private assertCompatibleOptions(options: BmsxConsoleRuntimeOptions): void {
		if (options.cart !== this.cart) {
			throw new Error('[BmsxConsoleRuntime] Runtime already initialised with a cart. Destroy the existing instance before swapping carts.');
		}
		if (options.playerIndex !== this.playerIndex) {
			throw new Error('[BmsxConsoleRuntime] Runtime already initialised with a different player index.');
		}
		if (options.storage && options.storage !== this.storageService) {
			throw new Error('[BmsxConsoleRuntime] Runtime already initialised with a different storage service.');
		}
	}

	private attachFrameListener(): void {
		if (this.frameListenerAttached) return;
		EventEmitter.instance.on('frameend', this.presentationFrameHandler, this, { lane: 'presentation', persistent: true });
		this.frameListenerAttached = true;
	}

	private detachFrameListener(): void {
		if (!this.frameListenerAttached) return;
		EventEmitter.instance.off('frameend', this.presentationFrameHandler);
		this.frameListenerAttached = false;
	}

	private handlePresentationFrame(_event: string, _emitter: Identifiable, _payload?: EventPayload): void {
		if (!this.tickEnabled) return;
		const now = $.platform.clock.now();
		let deltaMs = now - this.lastFrameTimestampMs;
		if (!Number.isFinite(deltaMs) || deltaMs < 0) {
			deltaMs = 0;
		}
		else if (deltaMs > BmsxConsoleRuntime.MAX_FRAME_DELTA_MS) {
			deltaMs = BmsxConsoleRuntime.MAX_FRAME_DELTA_MS;
		}
		this.lastFrameTimestampMs = now;
		this.frame(deltaMs);
		if ($.paused && this.shouldRequestPausedFrame()) {
			$.requestPausedFrame();
		}
	}

	private shouldRequestPausedFrame(): boolean {
		if (!this.editor) {
			return false;
		}
		return this.editor.isActive();
	}

	private setEditorPipelineActive(active: boolean, force = false): void {
		if (!force && active === this.editorPipelineActive) {
			return;
		}
		this.editorPipelineActive = active;
		if (active) {
			$.setPipelineOverride(consoleEditorSpec());
			return;
		}
		$.setPipelineOverride(null);
	}

	public boot(): void {
		this.frameCounter = 0;
		this.luaRuntimeFailed = false;
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		this.physics.clear();
		this.api.cartdata(this.cart.meta.persistentId);
		this.api.colliderClear();
		if (this.hasLuaProgram()) {
			this.bootLuaProgram();
		}
		else {
			this.cart.init(this.api);
		}
		this.lastFrameTimestampMs = $.platform.clock.now();
		this.frame(0);
		if ($.paused && this.shouldRequestPausedFrame()) {
			$.requestPausedFrame();
		}
	}

	public frame(deltaMilliseconds: number): void {
		if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds < 0) {
			throw new Error('[BmsxConsoleRuntime] Delta time must be a finite non-negative number.');
		}
		const deltaSeconds = deltaMilliseconds / 1000;
		this.input.beginFrame(this.frameCounter, deltaSeconds);
		const editor = this.editor;
		if (editor) {
			editor.update(deltaSeconds);
		}
		const editorActive = editor?.isActive() === true;
		this.setEditorPipelineActive(editorActive);
		const paused = $.paused === true;
		if (paused) {
			this.api.beginPausedFrame(this.frameCounter);
			if (editorActive && editor) {
				editor.draw(this.api);
			}
			return;
		}
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		if (editorActive && editor) {
			editor.draw(this.api);
			this.frameCounter += 1;
			return;
		}
		if (this.hasLuaProgram()) {
			if (this.luaRuntimeFailed) {
				if (editorActive && editor) {
					editor.draw(this.api);
				}
				this.frameCounter += 1;
				return;
			}
			try {
				if (this.luaUpdateFunction !== null) {
					this.invokeLuaFunction(this.luaUpdateFunction, [deltaSeconds]);
				}
				if (this.luaDrawFunction !== null) {
					this.invokeLuaFunction(this.luaDrawFunction, []);
				}
			}
			catch (error) {
				this.handleLuaError(error);
				const activeEditor = this.editor;
				if (activeEditor && activeEditor.isActive()) {
					activeEditor.draw(this.api);
				}
				this.frameCounter += 1;
				return;
			}
		}
		else {
			this.cart.update(this.api, deltaSeconds);
			this.cart.draw(this.api);
		}
		this.physics.step(deltaSeconds);
		this.frameCounter += 1;
	}

	public override dispose(): void {
		this.setEditorPipelineActive(false, true);
		this.detachFrameListener();
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
		this.colliders.clear();
		this.luaInterpreter = null;
		super.dispose();
		if (BmsxConsoleRuntime._instance === this) {
			BmsxConsoleRuntime._instance = null;
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
			saveSource: (source: string) => { this.saveLuaProgram(source); },
		});
	}

	public override getState(): BmsxConsoleState | undefined {
		const storageState = this.storage.dump();
		const physicsState = this.physics.snapshot();
		const luaSnapshot = this.captureLuaSnapshot();
		const cartState = (!this.hasLuaProgram() && typeof this.cart.captureState === 'function')
			? this.cart.captureState(this.api)
			: undefined;
		return {
			frameCounter: this.frameCounter,
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaProgramSourceOverride: this.luaProgramSourceOverride,
			luaChunkName: this.luaChunkName,
			luaSnapshot,
			cartState,
			storage: storageState,
			physics: physicsState,
		};
	}

	public override setState(state: unknown): void {
		if (!state || typeof state !== 'object') {
			this.boot();
			return;
		}
		const snapshot = state as BmsxConsoleState;
		if (snapshot.storage) {
			this.storage.restore(snapshot.storage);
		}
		if (snapshot.luaProgramSourceOverride !== undefined) {
			this.luaProgramSourceOverride = snapshot.luaProgramSourceOverride;
		}
		if (snapshot.luaChunkName !== undefined) {
			this.luaChunkName = snapshot.luaChunkName;
		}
		this.boot();
		this.frameCounter = snapshot.frameCounter ?? 0;
		this.luaRuntimeFailed = snapshot.luaRuntimeFailed ?? false;
		if (snapshot.physics) {
			this.physics.restore(snapshot.physics);
		}
		if (this.hasLuaProgram() && snapshot.luaSnapshot !== undefined) {
			this.applyLuaSnapshot(snapshot.luaSnapshot);
		}
		if (!this.hasLuaProgram() && snapshot.cartState !== undefined && typeof this.cart.restoreState === 'function') {
			this.cart.restoreState(this.api, snapshot.cartState);
		}
		this.setEditorPipelineActive(this.editor?.isActive() === true, true);
		this.redrawAfterStateRestore();
	}

	private redrawAfterStateRestore(): void {
		if (this.hasLuaProgram()) {
			if (this.luaRuntimeFailed) {
				return;
			}
			this.api.beginFrame(this.frameCounter, 0);
			if (this.luaDrawFunction !== null) {
				try {
					this.invokeLuaFunction(this.luaDrawFunction, []);
				}
				catch (error) {
					this.handleLuaError(error);
				}
			}
			return;
		}
		this.api.beginFrame(this.frameCounter, 0);
		this.cart.draw(this.api);
	}

	private getEditorSource(): string {
		const program = this.luaProgram;
		if (!program) {
			return '';
		}
		return this.getLuaProgramSource(program);
	}

	private captureLuaSnapshot(): unknown {
		if (!this.luaSnapshotSave || this.luaRuntimeFailed) {
			return undefined;
		}
		try {
			const results = this.invokeLuaFunction(this.luaSnapshotSave, []);
			if (!results || results.length === 0) return undefined;
			return this.luaValueToJs(results[0]);
		}
		catch (error) {
			console.error('[BmsxConsoleRuntime] Failed to capture Lua snapshot:', error);
			return undefined;
		}
	}

	private applyLuaSnapshot(snapshot: unknown): void {
		if (!this.luaSnapshotLoad || snapshot === undefined) {
			return;
		}
		try {
			this.invokeLuaFunction(this.luaSnapshotLoad, [snapshot]);
		}
		catch (error) {
			console.error('[BmsxConsoleRuntime] Failed to restore Lua snapshot:', error);
		}
	}

	private bootLuaProgram(): void {
		const program = this.luaProgram;
		if (!program) return;

		const source = this.getLuaProgramSource(program);
		const chunkName = this.resolveLuaProgramChunkName(program);

		this.luaSnapshotSave = null;
		this.luaSnapshotLoad = null;
		this.luaInterpreter = createLuaInterpreter();
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaChunkName = chunkName;
		this.luaRuntimeFailed = false;

		const interpreter = this.luaInterpreter;
		try {
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			interpreter.execute(source, chunkName);
		}
		catch (error) {
			this.handleLuaError(error);
			return;
		}

		const env = interpreter.getGlobalEnvironment();
		this.luaInitFunction = this.resolveLuaFunction(env.get(program.entry?.init ?? 'init'));
		this.luaUpdateFunction = this.resolveLuaFunction(env.get(program.entry?.update ?? 'update'));
		this.luaDrawFunction = this.resolveLuaFunction(env.get(program.entry?.draw ?? 'draw'));
		this.luaSnapshotSave = this.resolveLuaFunction(env.get('__bmsx_snapshot_save'));
		this.luaSnapshotLoad = this.resolveLuaFunction(env.get('__bmsx_snapshot_load'));

		if (this.luaInitFunction !== null) {
			try {
				this.invokeLuaFunction(this.luaInitFunction, []);
			}
			catch (error) {
				this.handleLuaError(error);
			}
		}
	}

	public saveLuaProgram(source: string): void {
		if (!this.hasLuaProgram()) {
			throw new Error('[BmsxConsoleRuntime] Cannot save Lua program when no Lua program is active.');
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
		const previousOverride = this.luaProgramSourceOverride;
		const previousChunkName = this.resolveLuaProgramChunkName(program);
		const previousSource = this.getLuaProgramSource(program);
		const targetChunkName = previousChunkName;
		this.validateLuaSource(source, targetChunkName);
		try {
			this.luaProgramSourceOverride = source;
			this.applyProgramSourceToCartridge(source, targetChunkName);
		}
		catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.applyProgramSourceToCartridge(previousSource, previousChunkName);
			}
			catch {
				// Restoration best-effort; ignore secondary failure.
			}
			throw error;
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
		const previousOverride = this.luaProgramSourceOverride;
		const previousChunkName = this.resolveLuaProgramChunkName(program);
		const previousSource = this.getLuaProgramSource(program);
		try {
			this.saveLuaProgram(source);
			this.boot();
		}
		catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.applyProgramSourceToCartridge(previousSource, previousChunkName);
				this.boot();
			}
			catch {
				// Ignore restoration errors; original error takes precedence.
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
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			throw new Error('[BmsxConsoleRuntime] Lua interpreter is not available.');
		}
		const luaArgs = args.map((value) => this.jsToLua(value, interpreter));
		return fn.call(luaArgs);
	}

	private handleLuaError(error: unknown): void {
		this.luaRuntimeFailed = true;
		let message: string;
		if (error instanceof Error) {
			message = error.message;
		}
		else {
			message = String(error);
		}
		let line = 1;
		let column = 1;
		if (error instanceof LuaError) {
			if (Number.isFinite(error.line) && error.line > 0) {
				line = error.line;
			}
			if (Number.isFinite(error.column) && error.column > 0) {
				column = error.column;
			}
			if (error.chunkName && error.chunkName.length > 0) {
				message = `${error.chunkName}: ${message}`;
			}
		}
		if (!this.editor && this.hasLuaProgram()) {
			this.initializeEditor();
		}
		if (this.editor) {
			this.editor.showRuntimeError(line, column, message);
		}
		console.error('[BmsxConsoleRuntime] Lua runtime error:', error);
	}

	private createApiRuntimeError(interpreter: LuaInterpreter, message: string): LuaRuntimeError {
		const range = interpreter.getCurrentCallRange();
		const chunkName = range ? range.chunkName : (this.luaChunkName ?? 'lua');
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		return new LuaRuntimeError(message, chunkName, line, column);
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
						return this.wrapResultValue(result, interpreter);
					}
					catch (error) {
						if (error instanceof LuaRuntimeError) {
							throw error;
						}
						const message = error instanceof Error ? error.message : String(error);
						throw this.createApiRuntimeError(interpreter, `[api.${name}] ${message}`);
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
						return this.wrapResultValue(value, interpreter);
					}
					catch (error) {
						if (error instanceof LuaRuntimeError) {
							throw error;
						}
						const message = error instanceof Error ? error.message : String(error);
						throw this.createApiRuntimeError(interpreter, `[api.${name}] ${message}`);
					}
				});
				env.set(name, native);
				apiTable.set(name, native);
				this.apiFunctionNames.add(name);
			}
		}
		env.set('api', apiTable);

		this.exposeEngineObjects(env, interpreter);

		this.registerLuaTableLibrary(env, interpreter);
	}

	private registerLuaTableLibrary(env: LuaEnvironment, interpreter: LuaInterpreter): void {
		const tableLibrary = new LuaTable();

		tableLibrary.set('insert', createLuaNativeFunction('table.insert', interpreter, (_lua, args) => {
			if (args.length < 2) {
				throw this.createApiRuntimeError(interpreter, '[table.insert] requires at least 2 arguments.');
			}
			const target = args[0];
			if (!(target instanceof LuaTable)) {
				throw this.createApiRuntimeError(interpreter, '[table.insert] target must be a table.');
			}
			let position: number | null = null;
			let value: LuaValue;
			if (args.length === 2) {
				value = args[1];
			}
			else {
				const positionValue = args[1];
				if (typeof positionValue !== 'number' || !Number.isInteger(positionValue)) {
					throw this.createApiRuntimeError(interpreter, '[table.insert] position must be an integer.');
				}
				position = positionValue;
				value = args[2];
			}
			this.luaTableInsert(target, value, position);
			return [];
		}));

		tableLibrary.set('remove', createLuaNativeFunction('table.remove', interpreter, (_lua, args) => {
			if (args.length === 0) {
				throw this.createApiRuntimeError(interpreter, '[table.remove] requires a table argument.');
			}
			const target = args[0];
			if (!(target instanceof LuaTable)) {
				throw this.createApiRuntimeError(interpreter, '[table.remove] target must be a table.');
			}
			let position: number | null = null;
			if (args.length >= 2) {
				const positionValue = args[1];
				if (typeof positionValue !== 'number' || !Number.isInteger(positionValue)) {
					throw this.createApiRuntimeError(interpreter, '[table.remove] position must be an integer.');
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

	private exposeEngineObjects(env: LuaEnvironment, interpreter: LuaInterpreter): void {
		const entries: Array<[string, unknown]> = [
			['world', $.world],
			['game', $],
			['registry', $.registry],
			['events', $.event_emitter],
		];
		for (const [name, object] of entries) {
			if (object === undefined || object === null) {
				continue;
			}
			const luaValue = this.jsToLua(object, interpreter);
			env.set(name, luaValue);
			this.apiFunctionNames.add(name);
		}
	}

	private ensureInterpreter(interpreter: LuaInterpreter | null): LuaInterpreter {
		if (interpreter) {
			return interpreter;
		}
		if (this.luaInterpreter) {
			return this.luaInterpreter;
		}
		throw new Error('[BmsxConsoleRuntime] Lua interpreter is not available.');
	}

	private isPlainObject(value: unknown): value is Record<string, unknown> {
		if (value === null || typeof value !== 'object') {
			return false;
		}
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	private getOrCreateHandle(value: object): number {
		const existing = this.luaObjectToHandle.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const handle = this.nextLuaHandleId++;
		this.luaObjectToHandle.set(value, handle);
		this.luaHandleToObject.set(handle, value);
		return handle;
	}

	private wrapEngineObject(value: object, interpreter: LuaInterpreter): LuaTable {
		const handle = this.getOrCreateHandle(value);
		const table = new LuaTable();
		table.set(BmsxConsoleRuntime.LUA_HANDLE_FIELD, handle);
		const typeName = value.constructor?.name ?? 'Object';
		table.set(BmsxConsoleRuntime.LUA_TYPE_FIELD, typeName);

		this.populateObjectProperties(table, value, interpreter);
		this.populateObjectMethods(table, value, handle, interpreter, typeName);

		return table;
	}

	private populateObjectProperties(table: LuaTable, value: object, interpreter: LuaInterpreter): void {
		if (this.wrapDepth > BmsxConsoleRuntime.MAX_WRAP_DEPTH) {
			return;
		}
		this.wrapDepth += 1;
		for (const key of Object.keys(value as Record<string, unknown>)) {
			if (key === BmsxConsoleRuntime.LUA_HANDLE_FIELD || key === BmsxConsoleRuntime.LUA_TYPE_FIELD) {
				continue;
			}
			if (table.has(key)) {
				continue;
			}
			try {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor) {
					if (typeof descriptor.value === 'function') {
						continue;
					}
					if (typeof descriptor.get === 'function' && descriptor.value === undefined) {
						continue;
					}
				}
				const propertyValue = (value as Record<string, unknown>)[key];
				table.set(key, this.jsToLua(propertyValue, interpreter));
			}
			catch (error) {
				if ($ && $.debug) {
					console.warn(`[BmsxConsoleRuntime] Failed to expose property '${key}':`, error);
				}
			}
		}
		if (value instanceof LuaTable) {
			this.wrapDepth -= 1;
			return;
		}
		// Common identifiers
		if ('id' in (value as Record<string, unknown>) && !table.has('id')) {
			table.set('id', this.jsToLua((value as Record<string, unknown>).id, interpreter));
		}
		if ('name' in (value as Record<string, unknown>) && !table.has('name')) {
			table.set('name', this.jsToLua((value as Record<string, unknown>).name, interpreter));
		}
		this.wrapDepth -= 1;
	}

	private populateObjectMethods(table: LuaTable, value: object, handle: number, interpreter: LuaInterpreter, typeName: string): void {
		const seen = new Set<string>();
		for (const ownName of Object.getOwnPropertyNames(value)) {
			if (ownName === 'constructor') continue;
			if (seen.has(ownName)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(value, ownName);
			if (descriptor && typeof descriptor.value === 'function') {
				if (!table.has(ownName)) {
					const fn = this.createHandleMethod(handle, ownName, typeName, interpreter);
					table.set(ownName, fn);
				}
				seen.add(ownName);
			}
		}
		let prototype: unknown = Object.getPrototypeOf(value);
		while (prototype && prototype !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(prototype as object)) {
				if (name === 'constructor' || seen.has(name) || table.has(name)) {
					continue;
				}
				const descriptor = Object.getOwnPropertyDescriptor(prototype as object, name);
				if (descriptor && typeof descriptor.value === 'function') {
					const fn = this.createHandleMethod(handle, name, typeName, interpreter);
					table.set(name, fn);
					seen.add(name);
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
	}

	private createHandleMethod(handle: number, methodName: string, typeName: string, interpreter: LuaInterpreter): LuaFunctionValue {
		return createLuaNativeFunction(`${typeName}.${methodName}`, interpreter, (_lua, args) => {
			const instance = this.luaHandleToObject.get(handle);
			if (!instance) {
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${methodName}] Object handle is no longer valid.`);
			}
			const jsArgs: unknown[] = [];
			if (args.length > 0) {
				const maybeSelf = this.luaValueToJs(args[0]);
				let start = 0;
				if (maybeSelf === instance) {
					start = 1;
				}
				for (let index = start; index < args.length; index += 1) {
					jsArgs.push(this.luaValueToJs(args[index]));
				}
			}
			try {
				const method = (instance as Record<string, unknown>)[methodName];
				if (typeof method !== 'function') {
					throw new Error(`Property '${methodName}' is not callable.`);
				}
				const result = Reflect.apply(method as Function, instance, jsArgs);
				return this.wrapResultValue(result, interpreter);
			}
			catch (error) {
				if (error instanceof LuaRuntimeError) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${methodName}] ${message}`);
			}
		});
	}

	private wrapResultValue(value: unknown, interpreter: LuaInterpreter): ReadonlyArray<LuaValue> {
		if (Array.isArray(value)) {
			if (value.every((entry) => this.isLuaValue(entry))) {
				return value as LuaValue[];
			}
			return value.map((entry) => this.jsToLua(entry, interpreter));
		}
		if (value === undefined) {
			return [];
		}
		const luaValue = this.jsToLua(value, interpreter);
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
			const handleValue = value.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
			if (typeof handleValue === 'number') {
				const instance = this.luaHandleToObject.get(handleValue);
				if (instance !== undefined) {
					return instance;
				}
			}
			const entries = value.entriesArray();
			if (entries.length === 0) {
				return {};
			}
			const arrayValues: unknown[] = [];
			const objectValues: Record<string, unknown> = {};
			let sequentialCount = 0;
			let processedEntries = 0;
			for (const [key, entryValue] of entries) {
				if (key === BmsxConsoleRuntime.LUA_HANDLE_FIELD || key === BmsxConsoleRuntime.LUA_TYPE_FIELD) {
					continue;
				}
				processedEntries += 1;
				const converted = this.luaValueToJs(entryValue);
				if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					arrayValues[key - 1] = converted;
					sequentialCount += 1;
				} else {
					objectValues[String(key)] = converted;
				}
			}
			if (processedEntries === 0) {
				return {};
			}
			if (sequentialCount === processedEntries) {
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

	private jsToLua(value: unknown, interpreter: LuaInterpreter | null = this.luaInterpreter): LuaValue {
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
			const ensured = this.ensureInterpreter(interpreter);
			const table = new LuaTable();
			for (let index = 0; index < value.length; index += 1) {
				table.set(index + 1, this.jsToLua(value[index], ensured));
			}
			return table;
		}
		if (typeof value === 'object') {
			const ensured = this.ensureInterpreter(interpreter);
			if (this.isPlainObject(value)) {
				const table = new LuaTable();
				for (const key of Object.keys(value as Record<string, unknown>)) {
					const descriptor = Object.getOwnPropertyDescriptor(value, key);
					if (descriptor && typeof descriptor.get === 'function' && descriptor.value === undefined) {
						continue;
					}
					const entryValue = (value as Record<string, unknown>)[key];
					table.set(key, this.jsToLua(entryValue, ensured));
				}
				return table;
			}
			return this.wrapEngineObject(value as object, ensured);
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
