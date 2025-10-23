import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { ConsoleCartEditor } from './editor';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram, ConsoleResourceDescriptor, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaResourceCreationRequest, ConsoleLuaDefinitionLocation } from './types';
import type { RomResourcePath } from '../rompack/rompack';
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
import { EditorConsoleRenderBackend } from './render_backend';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import { HandlerRegistry, setupFSMlibrary } from '../fsm/fsmlibrary';
import type { Stateful, StateMachineBlueprint } from '../fsm/fsmtypes';
import type { LuaSourceRange, LuaDefinitionInfo } from '../lua/ast.ts';

type LuaPersistenceFailureMode = 'error' | 'warning';
type LuaPersistenceFailureKind = 'fetch' | 'persist' | 'apply' | 'restore';

type LuaPersistenceFailurePolicy = {
	[K in LuaPersistenceFailureKind]: LuaPersistenceFailureMode;
};

const DEFAULT_LUA_FAILURE_POLICY: LuaPersistenceFailurePolicy = {
	fetch: 'warning',
	persist: 'error',
	apply: 'error',
	restore: 'error',
};

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	playerIndex: number;
	storage?: StorageService;
	luaSourceFailurePolicy?: Partial<LuaPersistenceFailurePolicy>;
};

export type BmsxConsoleState = {
	frameCounter: number;
	luaRuntimeFailed: boolean;
	luaProgramSourceOverride: string | null;
	luaChunkName: string | null;
	luaSnapshot?: unknown;
	cartState?: unknown;
	storage?: { namespace: string; entries: Array<{ index: number; value: number }> };
	luaGlobals?: Record<string, unknown>;
	luaLocals?: Record<string, unknown>;
	luaRandomSeed?: number;
};

enum BmsxLuaValidationStrategy {
	TrustRealRun = 'trust_real_run',
	FullExecution = 'full_execution',
}

type HttpResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
};

export class BmsxConsoleRuntime extends Service {
	private static _instance: BmsxConsoleRuntime | null = null;
	private static readonly MAX_FRAME_DELTA_MS = 250;
	private static readonly HOVER_VALUE_MAX_LINE_LENGTH = 160;
	private static readonly HOVER_VALUE_MAX_SERIALIZED_LINES = 200;
	private static readonly LUA_BUILTIN_FUNCTIONS = new Set<string>([
		'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs', 'load',
		'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawset', 'require',
		'select', 'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall'
	]);
	private static readonly LUA_HANDLE_FIELD = '__js_handle__';
	private static readonly LUA_TYPE_FIELD = '__js_type__';
	private static readonly LUA_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>([
		'print',
		'type',
		'tostring',
		'tonumber',
		'setmetatable',
		'getmetatable',
		'pairs',
		'ipairs',
		'serialize',
		'deserialize',
		'math',
		'string',
		'os',
		'table',
		'coroutine',
		'debug',
	]);

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
	private readonly editorRenderBackend = new EditorConsoleRenderBackend();
	private readonly validationStrategy: BmsxLuaValidationStrategy = BmsxLuaValidationStrategy.TrustRealRun;
	private luaProgramSourceOverride: string | null = null;
	private luaInterpreter: LuaInterpreter | null = null;
	private fsmLuaInterpreter: LuaInterpreter | null = null;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private frameCounter = 0;
	private luaHandleToObject = new Map<number, unknown>();
	private luaObjectToHandle = new WeakMap<object, number>();
	private luaObjectWrapperCache: WeakMap<object, LuaTable> = new WeakMap<object, LuaTable>();
	private handleMethodCache = new Map<number, Map<string, LuaFunctionValue>>();
	private nextLuaHandleId = 1;
	private luaSnapshotSave: LuaFunctionValue | null = null;
	private luaSnapshotLoad: LuaFunctionValue | null = null;
	private luaRuntimeFailed = false;
	private lastFrameTimestampMs = 0;
	private readonly presentationFrameHandler: (event_name: string, emitter: Identifiable, payload?: EventPayload) => void;
	private frameListenerAttached = false;
	private editorPipelineActive = false;
	private readonly luaFailurePolicy: LuaPersistenceFailurePolicy;
	private pendingLuaWarnings: string[] = [];
	private readonly luaChunkResourceMap: Map<string, { assetId: string | null; path?: string | null }> = new Map();
	private readonly resourcePathCache: Map<string, string | null> = new Map();
	private readonly luaChunkEnvironmentsByAssetId: Map<string, LuaEnvironment> = new Map();
	private readonly luaChunkEnvironmentsByChunkName: Map<string, LuaEnvironment> = new Map();
	private readonly luaFsmMachineIds: Set<string> = new Set<string>();
	private hasBooted = false;

	private constructor(options: BmsxConsoleRuntimeOptions) {
		super({ id: 'bmsx_console_runtime' });
		this.enableEvents();
		const policyOverride = options.luaSourceFailurePolicy ?? {};
		this.luaFailurePolicy = { ...DEFAULT_LUA_FAILURE_POLICY, ...policyOverride };
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
		void this.prefetchLuaSourceFromFilesystem();
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

	private endFrameAndFlush(editorActive: boolean): void {
		this.api.endFrame();
		this.flushEditorOverlayFrame(editorActive);
	}

	private flushEditorOverlayFrame(editorActive: boolean): void {
		if (!editorActive) {
			publishOverlayFrame(null);
		}
	}

	private recordLuaWarning(message: string): void {
		this.pendingLuaWarnings.push(message);
		console.warn(message);
		this.flushLuaWarnings();
	}

	private flushLuaWarnings(): void {
		if (!this.editor || this.pendingLuaWarnings.length === 0) {
			return;
		}
		const messages = this.pendingLuaWarnings;
		this.pendingLuaWarnings = [];
		for (const warning of messages) {
			this.editor.showWarningBanner(warning, 6.0);
		}
	}

	private getResourceDescriptors(): ConsoleResourceDescriptor[] {
		const rompack = $.rompack;
		if (!rompack || !Array.isArray(rompack.resourcePaths)) {
			return [];
		}
		return rompack.resourcePaths
			.map(entry => ({ path: entry.path, type: entry.type, assetId: entry.assetId }))
			.sort((left, right) => left.path.localeCompare(right.path));
	}

	private handleLuaPersistenceFailure(
		kind: LuaPersistenceFailureKind,
		context: string,
		options: { detail?: string; error?: unknown } = {}
	): void {
		const mode = this.luaFailurePolicy[kind];
		const parts: string[] = [context];
		if (options.detail && options.detail.length > 0) {
			parts.push(options.detail);
		}
		if (options.error !== undefined) {
			const reason = options.error instanceof Error ? options.error.message : String(options.error);
			if (reason.length > 0) {
				parts.push(reason);
			}
		}
		const message = parts.join(': ');
		if (mode === 'warning') {
			this.recordLuaWarning(message);
			return;
		}
		if (options.error instanceof Error) {
			const wrapped = new Error(message);
			// @ts-ignore - preserve original error via non-standard cause where available
			wrapped.cause = options.error;
			console.error(message, options.error);
			throw wrapped;
		}
		console.error(message);
		throw new Error(message);
	}

	private setEditorPipelineActive(active: boolean, force = false): void {
		if (!force && active === this.editorPipelineActive) {
			return;
		}
		this.editorPipelineActive = active;
		if (active) {
			this.api.setRenderBackend(this.editorRenderBackend);
			$.setPipelineOverride(consoleEditorSpec());
			return;
		}
		this.api.setRenderBackend(null);
		$.setPipelineOverride(null);
		publishOverlayFrame(null);
	}

	public boot(): void {
		this.frameCounter = 0;
		this.luaRuntimeFailed = false;
		this.luaChunkResourceMap.clear();
		this.resourcePathCache.clear();
		this.luaChunkEnvironmentsByAssetId.clear();
		this.luaChunkEnvironmentsByChunkName.clear();
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		if (this.hasBooted) {
			this.resetWorldState();
		}
		this.physics.clear();
		this.api.cartdata(this.cart.meta.persistentId);
		this.api.colliderClear();
		if (this.hasLuaProgram()) {
			this.bootLuaProgram(true);
		}
		else {
			this.resetLuaInteroperabilityState();
			this.fsmLuaInterpreter = null;
			const fsmInterpreter = this.ensureFsmLuaInterpreter();
			this.loadLuaStateMachineScripts(fsmInterpreter);
			this.cart.init(this.api);
		}
		this.lastFrameTimestampMs = $.platform.clock.now();
		this.frame(0);
		if ($.paused && this.shouldRequestPausedFrame()) {
			$.requestPausedFrame();
		}
		this.hasBooted = true;
	}

	private resetWorldState(): void {
		$.resetToFreshWorld({ preserveConsoleRuntime: true });
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
			this.endFrameAndFlush(editorActive);
			return;
		}
		this.api.beginFrame(this.frameCounter, deltaSeconds);
		if (editorActive && editor) {
			editor.draw(this.api);
			this.endFrameAndFlush(editorActive);
			this.frameCounter += 1;
			return;
		}
		if (this.hasLuaProgram()) {
			if (this.luaRuntimeFailed) {
				if (editorActive && editor) {
					editor.draw(this.api);
				}
				this.endFrameAndFlush(editorActive);
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
				this.endFrameAndFlush(editorActive);
				this.frameCounter += 1;
				return;
			}
		}
		else {
			this.cart.update(this.api, deltaSeconds);
			this.cart.draw(this.api);
		}
		this.endFrameAndFlush(editorActive);
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
		this.fsmLuaInterpreter = null;
		this.luaFsmMachineIds.clear();
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
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleRuntime] Game view unavailable during editor initialization.');
		}
		const offscreen = view.offscreenCanvasSize;
		if (!Number.isFinite(offscreen.x) || !Number.isFinite(offscreen.y) || offscreen.x <= 0 || offscreen.y <= 0) {
			throw new Error('[BmsxConsoleRuntime] Invalid offscreen dimensions during editor initialization.');
		}
		const viewport = { width: offscreen.x, height: offscreen.y };
		const primaryAssetId = (this.luaProgram && 'assetId' in this.luaProgram)
			? (typeof this.luaProgram.assetId === 'string' ? this.luaProgram.assetId : null)
			: null;
		this.editor = new ConsoleCartEditor({
			playerIndex: this.playerIndex,
			metadata: this.cart.meta,
			viewport,
			loadSource: () => this.getEditorSource(),
			saveSource: (source: string) => this.saveLuaProgram(source),
			listResources: () => this.getResourceDescriptors(),
			loadLuaResource: (assetId: string) => this.getLuaResourceSource(assetId),
			saveLuaResource: (assetId: string, source: string) => this.saveLuaResourceSource(assetId, source),
			createLuaResource: (request) => this.createLuaResource(request),
			inspectLuaExpression: (request: ConsoleLuaHoverRequest) => this.inspectLuaExpression(request),
			primaryAssetId,
		});
		this.flushLuaWarnings();
	}

	public ensureEditorActive(): void {
		if (!this.hasLuaProgram()) {
			throw new Error('[BmsxConsoleRuntime] Cannot activate console editor when no Lua program is active.');
		}
		const editor = this.editor;
		if (!editor) {
			throw new Error('[BmsxConsoleRuntime] Console editor unavailable.');
		}
		if (!editor.isActive()) {
			const activator = editor as unknown as { activate(): void };
			activator.activate();
		}
		this.setEditorPipelineActive(true, true);
	}

	public override getState(): BmsxConsoleState | undefined {
		const storageState = this.storage.dump();
		const luaSnapshot = this.captureLuaSnapshot();
		const cartState = (!this.hasLuaProgram() && typeof this.cart.captureState === 'function')
			? this.cart.captureState(this.api)
			: undefined;
		const fallbackLuaState = luaSnapshot === undefined ? this.captureFallbackLuaState() : null;
		const state: BmsxConsoleState = {
			frameCounter: this.frameCounter,
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaProgramSourceOverride: this.luaProgramSourceOverride,
			luaChunkName: this.luaChunkName,
			luaSnapshot,
			cartState,
			storage: storageState,
		};
		if (fallbackLuaState) {
			if (fallbackLuaState.globals) {
				state.luaGlobals = fallbackLuaState.globals;
			}
			if (fallbackLuaState.locals) {
				state.luaLocals = fallbackLuaState.locals;
			}
			if (fallbackLuaState.randomSeed !== undefined) {
				state.luaRandomSeed = fallbackLuaState.randomSeed;
			}
		}
		return state;
	}

	public override setState(state: unknown): void {
		if (!state || typeof state !== 'object') {
			this.resetRuntimeToFreshState();
			return;
		}
		this.restoreFromStateSnapshot(state as BmsxConsoleState);
	}

	private resetRuntimeToFreshState(): void {
		const program = this.luaProgram;
		if (program) {
			this.luaProgramSourceOverride = null;
			this.luaChunkName = this.resolveLuaProgramChunkName(program);
		} else {
			this.luaProgramSourceOverride = null;
			this.luaChunkName = null;
		}
		this.boot();
	}

	private restoreFromStateSnapshot(snapshot: BmsxConsoleState): void {
		const savedFrameCounter = snapshot.frameCounter ?? 0;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;

		this.api.cartdata(this.cart.meta.persistentId);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		this.api.colliderClear();
		this.frameCounter = savedFrameCounter;

		if (this.hasLuaProgram()) {
			const hasStructuredSnapshot = snapshot.luaSnapshot !== undefined && snapshot.luaSnapshot !== null;
			const hasFallbackState = snapshot.luaGlobals !== undefined || snapshot.luaLocals !== undefined || snapshot.luaRandomSeed !== undefined;
			const shouldRunInit = !savedRuntimeFailed && !hasStructuredSnapshot && !hasFallbackState;

			this.reinitializeLuaProgramForState(snapshot, shouldRunInit);
			if (!savedRuntimeFailed && hasStructuredSnapshot) {
				this.applyLuaSnapshot(snapshot.luaSnapshot);
			}
			else {
				this.restoreFallbackLuaState(snapshot);
			}
			this.frameCounter = savedFrameCounter;
		} else if (snapshot.cartState !== undefined && typeof this.cart.restoreState === 'function') {
			this.cart.restoreState(this.api, snapshot.cartState);
		}

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
		this.lastFrameTimestampMs = $.platform.clock.now();
		this.setEditorPipelineActive(this.editor?.isActive() === true, true);
		this.redrawAfterStateRestore();
	}

	private reinitializeLuaProgramForState(snapshot: BmsxConsoleState, runInit: boolean): void {
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		const targetChunkName = snapshot.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		const override = snapshot.luaProgramSourceOverride ?? null;
		const source = override !== null ? override : this.resolveLuaProgramSource(program);

		this.applyProgramSourceToCartridge(source, targetChunkName);
		this.luaProgramSourceOverride = override;
		this.luaChunkName = targetChunkName;

		this.luaSnapshotSave = null;
		this.luaSnapshotLoad = null;
		this.luaInterpreter = null;
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;

		this.bootLuaProgram(runInit);
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

	private getLuaResourceSource(assetId: string): string {
		const rompack = $.rompack;
		if (!rompack) {
			throw new Error('[BmsxConsoleRuntime] Rompack not loaded while retrieving Lua resource source.');
		}
		const source = rompack.lua?.[assetId];
		if (typeof source === 'string') {
			return source;
		}
		throw new Error(`[BmsxConsoleRuntime] Lua asset '${assetId}' not found.`);
	}

	private async saveLuaResourceSource(assetId: string, source: string): Promise<void> {
		if (typeof source !== 'string') {
			throw new Error('[BmsxConsoleRuntime] Lua resource source must be a string.');
		}
		if (source.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua resource source cannot be empty.');
		}
		const path = this.resolveLuaResourcePath(assetId);
		if (!path) {
			throw new Error(`[BmsxConsoleRuntime] Lua source path unavailable for asset '${assetId}'. Rebuild the rompack with filesystem metadata to enable saving.`);
		}
		await this.persistLuaSourceToFilesystem(path, source);
		const rompack = $.rompack;
		if (rompack) {
			if (!rompack.lua) {
				rompack.lua = {};
			}
			rompack.lua[assetId] = source;
		}
	}

	private async createLuaResource(request: ConsoleLuaResourceCreationRequest): Promise<ConsoleResourceDescriptor> {
		if (!request || typeof request.path !== 'string') {
			throw new Error('[BmsxConsoleRuntime] Path must be provided to create a Lua resource.');
		}
		const rompack = $.rompack;
		if (!rompack) {
			throw new Error('[BmsxConsoleRuntime] Rompack not loaded while creating Lua resource.');
		}
		const contents = typeof request.contents === 'string' ? request.contents : '';
		if (contents.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Initial Lua resource contents must be a non-empty string.');
		}
		let normalizedPath = request.path.trim();
		if (normalizedPath.length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua resource path cannot be empty.');
		}
		if (normalizedPath.indexOf('\n') !== -1 || normalizedPath.indexOf('\r') !== -1) {
			throw new Error('[BmsxConsoleRuntime] Lua resource path cannot contain newline characters.');
		}
		normalizedPath = normalizedPath.replace(/\\/g, '/');
		normalizedPath = normalizedPath.replace(/\/+/g, '/');
		if (normalizedPath.startsWith('./')) {
			normalizedPath = normalizedPath.slice(2);
		}
		while (normalizedPath.startsWith('/')) {
			normalizedPath = normalizedPath.slice(1);
		}
		if (normalizedPath.length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua resource path cannot be empty.');
		}
		const segments = normalizedPath.split('/');
		for (let i = 0; i < segments.length; i += 1) {
			if (segments[i] === '..') {
				throw new Error('[BmsxConsoleRuntime] Lua resource path cannot contain ".." segments.');
			}
		}
		if (normalizedPath.endsWith('/')) {
			throw new Error('[BmsxConsoleRuntime] Lua resource path must include a file name.');
		}
		if (!normalizedPath.endsWith('.lua')) {
			normalizedPath += '.lua';
		}
		const slashIndex = normalizedPath.lastIndexOf('/');
		const fileName = slashIndex === -1 ? normalizedPath : normalizedPath.slice(slashIndex + 1);
		if (fileName.length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua resource file name cannot be empty.');
		}
		const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
		let assetId = '';
		if (typeof request.assetId === 'string' && request.assetId.trim().length > 0) {
			assetId = request.assetId.trim();
		} else {
			assetId = baseName;
		}
		if (assetId.length === 0) {
			throw new Error('[BmsxConsoleRuntime] Unable to infer Lua asset id for new resource.');
		}
		if (rompack.lua && Object.prototype.hasOwnProperty.call(rompack.lua, assetId)) {
			throw new Error(`[BmsxConsoleRuntime] Lua asset '${assetId}' already exists.`);
		}
		if (Array.isArray(rompack.resourcePaths)) {
			for (let i = 0; i < rompack.resourcePaths.length; i += 1) {
				const entry = rompack.resourcePaths[i];
				const entryPath = entry.path ? entry.path.replace(/\\/g, '/') : '';
				if (entry.assetId === assetId) {
					throw new Error(`[BmsxConsoleRuntime] Resource for asset '${assetId}' already exists.`);
				}
				if (entryPath === normalizedPath) {
					throw new Error(`[BmsxConsoleRuntime] Resource at path '${normalizedPath}' already exists.`);
				}
			}
		}
		await this.persistLuaSourceToFilesystem(normalizedPath, contents);
		if (!rompack.lua) {
			rompack.lua = {};
		}
		rompack.lua[assetId] = contents;
		if (!rompack.luaSourcePaths) {
			rompack.luaSourcePaths = {};
		}
		rompack.luaSourcePaths[assetId] = normalizedPath;
		if (!Array.isArray(rompack.resourcePaths)) {
			rompack.resourcePaths = [];
		}
		const resourceType: RomResourcePath['type'] = this.resourcePathRepresentsFsm(normalizedPath, assetId) ? 'fsm' : 'lua';
		const resourceEntry: RomResourcePath = { path: normalizedPath, type: resourceType, assetId };
		rompack.resourcePaths.push(resourceEntry);
		rompack.resourcePaths.sort((left, right) => left.path.localeCompare(right.path));
		this.resourcePathCache.set(assetId, normalizedPath);
		this.registerLuaChunkResource(normalizedPath, { assetId, path: normalizedPath });
		const descriptor: ConsoleResourceDescriptor = { path: normalizedPath, type: resourceType, assetId };
		return descriptor;
	}

	private captureFallbackLuaState(): { globals?: Record<string, unknown>; locals?: Record<string, unknown>; randomSeed?: number } | null {
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			return null;
		}
		const globals = this.captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
		const locals = this.captureLuaEntryCollection(interpreter.enumerateChunkEntries());
		const randomSeed = interpreter.getRandomSeed();
		return {
			globals: globals ?? undefined,
			locals: locals ?? undefined,
			randomSeed: Number.isFinite(randomSeed) ? randomSeed : undefined,
		};
	}

	private captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): Record<string, unknown> | null {
		if (!entries || entries.length === 0) {
			return null;
		}
		const snapshot: Record<string, unknown> = {};
		let count = 0;
		for (const [name, value] of entries) {
			if (this.shouldSkipLuaSnapshotEntry(name, value)) {
				continue;
			}
			try {
				const serialized = this.serializeLuaValueForSnapshot(value, new Set<LuaTable>());
				snapshot[name] = serialized;
				count += 1;
			}
			catch (error) {
				if ($ && $.debug) {
					console.warn(`[BmsxConsoleRuntime] Skipped Lua snapshot entry '${name}':`, error);
				}
			}
		}
		return count > 0 ? snapshot : null;
	}

	private shouldSkipLuaSnapshotEntry(name: string, value: LuaValue): boolean {
		if (!name || this.apiFunctionNames.has(name)) {
			return true;
		}
		if (BmsxConsoleRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			return true;
		}
		if (this.isLuaFunctionValue(value)) {
			return true;
		}
		if (value instanceof LuaTable) {
			const handle = value.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
			if (typeof handle === 'number') {
				return true;
			}
		}
		return false;
	}

	private isLuaFunctionValue(value: unknown): value is LuaFunctionValue {
		if (!value || typeof value !== 'object') {
			return false;
		}
		return typeof (value as { call?: unknown }).call === 'function';
	}

	private serializeLuaValueForSnapshot(value: LuaValue, visited: Set<LuaTable>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (value instanceof LuaTable) {
			if (visited.has(value)) {
				throw new Error('Cyclic Lua table structures are not supported by the console snapshot.');
			}
			const handle = value.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
			if (typeof handle === 'number') {
				throw new Error('Cannot serialize engine object handles inside Lua tables.');
			}
			visited.add(value);
			try {
				const entries = value.entriesArray();
				if (entries.length === 0) {
					return {};
				}
				const numericEntries = new Map<number, unknown>();
				const objectEntries: Record<string, unknown> = {};
				let hasStringKey = false;
				let maxNumericIndex = 0;
				for (const [key, entryValue] of entries) {
					if (key === BmsxConsoleRuntime.LUA_HANDLE_FIELD || key === BmsxConsoleRuntime.LUA_TYPE_FIELD) {
						continue;
					}
					if (this.isLuaFunctionValue(entryValue)) {
						continue;
					}
					if (entryValue instanceof LuaTable) {
						const nestedHandle = entryValue.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
						if (typeof nestedHandle === 'number') {
							if ($ && $.debug) {
								console.warn('[BmsxConsoleRuntime] Skipping engine-backed Lua table entry during snapshot.');
							}
							continue;
						}
					}
					let serializedEntry: unknown;
					try {
						serializedEntry = this.serializeLuaValueForSnapshot(entryValue, visited);
					}
					catch (error) {
						if ($ && $.debug) {
							console.warn(`[BmsxConsoleRuntime] Skipping Lua table entry '${String(key)}' during snapshot:`, error);
						}
						continue;
					}
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
					throw new Error('Unsupported Lua table key type during snapshot serialization.');
				}
				const numericCount = numericEntries.size;
				const isSequential = numericCount > 0 && !hasStringKey && numericCount === maxNumericIndex;
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
			finally {
				visited.delete(value);
			}
		}
		throw new Error('Unsupported Lua value encountered during snapshot serialization.');
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

	private restoreFallbackLuaState(snapshot: BmsxConsoleState): void {
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			return;
		}
		if (snapshot.luaRandomSeed !== undefined && Number.isFinite(snapshot.luaRandomSeed)) {
			interpreter.setRandomSeed(snapshot.luaRandomSeed);
		}
		if (snapshot.luaGlobals) {
			this.restoreLuaGlobals(snapshot.luaGlobals);
		}
		if (snapshot.luaLocals) {
			this.restoreLuaLocals(snapshot.luaLocals);
		}
	}

	private restoreLuaGlobals(globals: Record<string, unknown>): void {
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			return;
		}
		for (const [name, value] of Object.entries(globals)) {
			if (!name || this.apiFunctionNames.has(name) || BmsxConsoleRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			try {
				const luaValue = this.jsToLua(value, interpreter);
				interpreter.setGlobal(name, luaValue);
			}
			catch (error) {
				if ($ && $.debug) {
					console.warn(`[BmsxConsoleRuntime] Failed to restore Lua global '${name}':`, error);
				}
			}
		}
	}

	private restoreLuaLocals(locals: Record<string, unknown>): void {
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			return;
		}
		for (const [name, value] of Object.entries(locals)) {
			if (!name || !interpreter.hasChunkBinding(name)) {
				continue;
			}
			try {
				const luaValue = this.jsToLua(value, interpreter);
				interpreter.assignChunkValue(name, luaValue);
			}
			catch (error) {
				if ($ && $.debug) {
					console.warn(`[BmsxConsoleRuntime] Failed to restore Lua local '${name}':`, error);
				}
			}
		}
	}

	private resetLuaInteroperabilityState(): void {
		this.luaHandleToObject.clear();
		this.handleMethodCache.clear();
		this.luaObjectToHandle = new WeakMap<object, number>();
		this.luaObjectWrapperCache = new WeakMap<object, LuaTable>();
		this.nextLuaHandleId = 1;
	}

	private bootLuaProgram(runInit: boolean): void {
		const program = this.luaProgram;
		if (!program) return;

		const source = this.getLuaProgramSource(program);
		const chunkName = this.resolveLuaProgramChunkName(program);

		const debugTiming = $ && $.debug === true;
		let bootStartMs = 0;
		if (debugTiming) {
			bootStartMs = $.platform.clock.now();
		}
		this.resetLuaInteroperabilityState();
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
			this.registerProgramChunk(program, chunkName);
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			this.loadLuaStateMachineScripts(interpreter);
			interpreter.execute(source, chunkName);
			let programAssetId: string | null = null;
			if ('assetId' in program && typeof program.assetId === 'string' && program.assetId.length > 0) {
				programAssetId = program.assetId;
			}
			this.cacheCurrentChunkEnvironment(chunkName, programAssetId);
		}
		catch (error) {
			if (debugTiming) {
				const elapsedMs = $.platform.clock.now() - bootStartMs;
				console.info(`[BmsxConsoleRuntime] Lua boot '${chunkName}' failed after ${elapsedMs.toFixed(2)}ms.`);
			}
			this.handleLuaError(error);
			return;
		}

		const env = interpreter.getGlobalEnvironment();
		this.luaInitFunction = this.resolveLuaFunction(env.get(program.entry?.init ?? 'init'));
		this.luaUpdateFunction = this.resolveLuaFunction(env.get(program.entry?.update ?? 'update'));
		this.luaDrawFunction = this.resolveLuaFunction(env.get(program.entry?.draw ?? 'draw'));
		this.luaSnapshotSave = this.resolveLuaFunction(env.get('__bmsx_snapshot_save'));
		this.luaSnapshotLoad = this.resolveLuaFunction(env.get('__bmsx_snapshot_load'));

		if (runInit && this.luaInitFunction !== null) {
			try {
				this.invokeLuaFunction(this.luaInitFunction, []);
			}
			catch (error) {
				if (debugTiming) {
					const elapsedMs = $.platform.clock.now() - bootStartMs;
					console.info(`[BmsxConsoleRuntime] Lua init for '${chunkName}' failed after ${elapsedMs.toFixed(2)}ms.`);
				}
				this.handleLuaError(error);
				return;
			}
		}
		if (debugTiming) {
			const elapsedMs = $.platform.clock.now() - bootStartMs;
			console.info(`[BmsxConsoleRuntime] Lua boot '${chunkName}' completed in ${elapsedMs.toFixed(2)}ms.`);
		}
	}

	public async saveLuaProgram(source: string): Promise<void> {
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
		const savePath = this.resolveLuaSourcePath(program);
		if (!savePath) {
			if ('assetId' in program && program.assetId) {
				throw new Error(`[BmsxConsoleRuntime] Lua source path unavailable for asset '${program.assetId}'. Rebuild the rompack with filesystem metadata to enable saving.`);
			}
			throw new Error('[BmsxConsoleRuntime] Lua program does not reference a filesystem source.');
		}
		const previousOverride = this.luaProgramSourceOverride;
		const previousChunkName = this.resolveLuaProgramChunkName(program);
		const previousSource = this.getLuaProgramSource(program);
		const targetChunkName = previousChunkName;
		const shouldValidate = this.shouldValidateLuaSource();
		if (!shouldValidate && $ && $.debug) {
			console.info(`[BmsxConsoleRuntime] Skipping pre-boot validation for '${targetChunkName}'. Trusting the real run.`);
		}
		if (shouldValidate) {
			this.validateLuaSource(source, targetChunkName);
		}
	try {
		this.luaProgramSourceOverride = source;
		this.applyProgramSourceToCartridge(source, targetChunkName);
	}
	catch (error) {
		this.luaProgramSourceOverride = previousOverride;
		try {
			this.applyProgramSourceToCartridge(previousSource, previousChunkName);
		}
		catch (restoreError) {
			this.handleLuaPersistenceFailure('restore', '[BmsxConsoleRuntime] Failed to restore Lua source after apply failure', { error: restoreError });
			return;
		}
		this.handleLuaPersistenceFailure('apply', '[BmsxConsoleRuntime] Failed to apply Lua source override', { error });
		if (this.luaFailurePolicy.apply === 'warning') {
			return;
		}
		return;
	}
	try {
		await this.persistLuaSourceToFilesystem(savePath, source);
	} catch (error) {
		this.luaProgramSourceOverride = previousOverride;
		try {
			this.applyProgramSourceToCartridge(previousSource, previousChunkName);
		} catch (restoreError) {
			this.handleLuaPersistenceFailure('restore', '[BmsxConsoleRuntime] Failed to restore Lua source after persistence failure', { error: restoreError });
			return;
		}
		this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to persist Lua source to '${savePath}'`, { error });
		if (this.luaFailurePolicy.persist === 'warning') {
			return;
		}
		return;
	}
}

	public async reloadLuaProgram(source: string): Promise<void> {
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
			await this.saveLuaProgram(source);
			this.boot();
		}
	catch (error) {
		this.luaProgramSourceOverride = previousOverride;
		try {
			this.applyProgramSourceToCartridge(previousSource, previousChunkName);
			this.boot();
		}
		catch (restoreError) {
			this.handleLuaPersistenceFailure('restore', '[BmsxConsoleRuntime] Failed to restore Lua source after reload failure', { error: restoreError });
			return;
		}
		this.handleLuaPersistenceFailure('persist', '[BmsxConsoleRuntime] Reload failed', { error });
		if (this.luaFailurePolicy.persist === 'warning') {
			return;
		}
	}
}

	private shouldValidateLuaSource(): boolean {
		return this.validationStrategy === BmsxLuaValidationStrategy.FullExecution;
	}

	private validateLuaSource(source: string, chunkName: string): void {
		const previousChunk = this.luaChunkName;
		this.luaChunkName = chunkName;
		const currentProgram = this.luaProgram;
		if (currentProgram) {
			this.registerProgramChunk(currentProgram, chunkName);
		}
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
		let chunkName: string | null = null;
		if (error instanceof LuaError) {
			if (Number.isFinite(error.line) && error.line > 0) {
				line = error.line;
			}
			if (Number.isFinite(error.column) && error.column > 0) {
				column = error.column;
			}
			if (typeof error.chunkName === 'string' && error.chunkName.length > 0) {
				chunkName = error.chunkName;
			}
		}
		if (!this.editor && this.hasLuaProgram()) {
			this.initializeEditor();
		}
		if (this.editor) {
			try {
				const hint = this.lookupChunkResourceInfoNullable(chunkName);
				if (hint) {
					this.editor.showRuntimeErrorInChunk(chunkName, line, column, message, hint);
				} else {
					this.editor.showRuntimeErrorInChunk(chunkName, line, column, message);
				}
			}
			catch (editorError) {
				const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
				try {
					this.editor.showRuntimeError(line, column, overlayMessage);
				}
				catch (secondaryError) {
					console.warn('[BmsxConsoleRuntime] Failed to display Lua error in console editor.', editorError, secondaryError);
				}
			}
		}
		const logMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		console.error('[BmsxConsoleRuntime] Lua runtime error:', logMessage, error);
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

	private ensureFsmLuaInterpreter(): LuaInterpreter {
		if (this.fsmLuaInterpreter) {
			return this.fsmLuaInterpreter;
		}
		const interpreter = createLuaInterpreter();
		this.registerApiBuiltins(interpreter);
		this.fsmLuaInterpreter = interpreter;
		return interpreter;
	}

	private loadLuaStateMachineScripts(interpreter: LuaInterpreter): void {
		const rompack = this.api.rompack();
		if (!rompack || !rompack.lua) {
			return;
		}
		this.luaFsmMachineIds.clear();
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths ? rompack.luaSourcePaths : {};
		const loadedMachines: string[] = [];
		for (const assetId of Object.keys(luaSources)) {
			if (!this.assetIdRepresentsFsm(assetId)) {
				continue;
			}
			const source = luaSources[assetId];
			if (typeof source !== 'string') {
				throw new Error(`[BmsxConsoleRuntime] FSM Lua asset '${assetId}' is not a string source.`);
			}
			const sourcePathRaw = sourcePaths[assetId];
			let pathHint: string | null = null;
			if (typeof sourcePathRaw === 'string' && sourcePathRaw.length > 0) {
				pathHint = sourcePathRaw;
			} else {
				const resolvedPath = this.resolveResourcePath(assetId);
				if (resolvedPath) {
					pathHint = resolvedPath;
				}
			}
			const chunkName = this.resolveLuaFsmChunkName(assetId, typeof sourcePathRaw === 'string' ? sourcePathRaw : null);
			const fsmInfo: { assetId: string | null; path?: string | null } = { assetId };
			if (pathHint) {
				fsmInfo.path = pathHint;
			}
			this.registerLuaChunkResource(chunkName, fsmInfo);
			let results: LuaValue[];
			try {
				results = interpreter.execute(source, chunkName);
				this.cacheCurrentChunkEnvironment(chunkName, assetId);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`[BmsxConsoleRuntime] Failed to execute FSM Lua script '${assetId}': ${message}`);
			}
			const value = results.length > 0 ? results[0] : null;
			if (value === null) {
				throw new Error(`[BmsxConsoleRuntime] FSM Lua script '${assetId}' returned nil.`);
			}
			const blueprintValue = this.luaValueToJs(value);
			if (!this.isPlainObject(blueprintValue)) {
				throw new Error(`[BmsxConsoleRuntime] FSM Lua script '${assetId}' must return a table.`);
			}
			const machineIdRaw = blueprintValue.id;
			if (typeof machineIdRaw !== 'string' || machineIdRaw.trim().length === 0) {
				throw new Error(`[BmsxConsoleRuntime] FSM Lua script '${assetId}' returned a blueprint without a valid 'id'.`);
			}
			const machineId = machineIdRaw.trim();
			const prepared = this.prepareLuaStateMachineBlueprint(machineId, blueprintValue, interpreter);
			this.api.registerPreparedFsm(machineId, prepared, { setup: false });
			this.luaFsmMachineIds.add(machineId);
			loadedMachines.push(machineId);
		}
		if (loadedMachines.length > 0) {
			setupFSMlibrary();
		}
	}

	private assetIdRepresentsFsm(assetId: string): boolean {
		if (!assetId) {
			return false;
		}
		return assetId.indexOf('.fsm') !== -1;
	}

	private resolveLuaFsmChunkName(assetId: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@fsm/${assetId}`;
	}

	private prepareLuaStateMachineBlueprint(machineId: string, blueprint: Record<string, unknown>, interpreter: LuaInterpreter): StateMachineBlueprint {
		const sanitized = this.cloneLuaBlueprintValue(machineId, [], blueprint, interpreter);
		return sanitized as StateMachineBlueprint;
	}

	private cloneLuaBlueprintValue(machineId: string, path: string[], value: unknown, interpreter: LuaInterpreter): unknown {
		if (this.isLuaFunctionValue(value)) {
			return this.registerLuaStateMachineHandler(machineId, path, value, interpreter);
		}
		if (Array.isArray(value)) {
			const out: unknown[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const nextPath = path.concat(String(index));
				out.push(this.cloneLuaBlueprintValue(machineId, nextPath, value[index], interpreter));
			}
			return out;
		}
		if (this.isPlainObject(value)) {
			const out: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(value)) {
				const nextPath = path.concat(key);
				out[key] = this.cloneLuaBlueprintValue(machineId, nextPath, entry, interpreter);
			}
			return out;
		}
		return value;
	}

	private registerLuaStateMachineHandler(machineId: string, path: string[], fn: LuaFunctionValue, interpreter: LuaInterpreter): string {
		const handlerId = this.makeLuaHandlerId(machineId, path);
		const runtime = this;
		const handler = function (this: Stateful, ...args: unknown[]) {
			return runtime.executeLuaStateMachineHandler(handlerId, fn, interpreter, this, args);
		};
		HandlerRegistry.instance.register(handlerId, handler);
		return handlerId;
	}

	private executeLuaStateMachineHandler(handlerId: string, fn: LuaFunctionValue, interpreter: LuaInterpreter, self: Stateful, args: unknown[]): unknown {
		const callArgs: unknown[] = [self];
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		let results: unknown[];
		try {
			results = this.callLuaFunctionWithInterpreter(fn, callArgs, interpreter);
		}
		catch (error) {
			const baseMessage = error instanceof Error ? error.message : String(error);
			const prefix = `[BmsxConsoleRuntime] Lua FSM handler '${handlerId}' failed: `;
			if (error instanceof LuaRuntimeError) {
				const wrapped = new LuaRuntimeError(prefix + baseMessage, error.chunkName, error.line, error.column);
				// @ts-ignore - retain original error details for debugging where supported
				wrapped.cause = error;
				throw wrapped;
			}
			if (error instanceof LuaError) {
				const wrapped = new LuaRuntimeError(prefix + baseMessage, error.chunkName, error.line, error.column);
				// @ts-ignore - retain original error details for debugging where supported
				wrapped.cause = error;
				throw wrapped;
			}
			throw new Error(prefix + baseMessage);
		}
		return results.length > 0 ? results[0] : undefined;
	}

	private callLuaFunctionWithInterpreter(fn: LuaFunctionValue, args: unknown[], interpreter: LuaInterpreter): unknown[] {
		const luaArgs: LuaValue[] = [];
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(this.jsToLua(args[index], interpreter));
		}
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaValueToJs(results[i]));
		}
		return output;
	}

	private makeLuaHandlerId(machineId: string, path: string[]): string {
		const segments: string[] = [];
		for (let index = 0; index < path.length; index += 1) {
			segments.push(this.sanitizeHandlerSegment(path[index]));
		}
		const suffix = segments.join('.');
		return `lua.handlers.${machineId}.${suffix}`;
	}

	private sanitizeHandlerSegment(segment: string): string {
		if (segment.length === 0) {
			return 'slot';
		}
		let text = segment;
		if (/^\d+$/.test(segment)) {
			text = `i${segment}`;
		}
		const cleaned = text.replace(/[^a-zA-Z0-9]+/g, '_');
		return cleaned.length > 0 ? cleaned : 'slot';
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

	private getCachedHandleMethod(handle: number, methodName: string): LuaFunctionValue | null {
		const cache = this.handleMethodCache.get(handle);
		if (!cache) {
			return null;
		}
		const entry = cache.get(methodName);
		if (entry === undefined) {
			return null;
		}
		return entry;
	}

	private storeHandleMethod(handle: number, methodName: string, fn: LuaFunctionValue): void {
		let cache = this.handleMethodCache.get(handle);
		if (!cache) {
			cache = new Map<string, LuaFunctionValue>();
			this.handleMethodCache.set(handle, cache);
		}
		cache.set(methodName, fn);
	}

	private evictCachedHandleMethod(handle: number, methodName: string): void {
		const cache = this.handleMethodCache.get(handle);
		if (!cache) {
			return;
		}
		cache.delete(methodName);
		if (cache.size === 0) {
			this.handleMethodCache.delete(handle);
		}
	}

	private resolveObjectTypeName(value: object): string {
		const descriptor = (value as { constructor?: unknown }).constructor;
		if (typeof descriptor === 'function') {
			const constructorFunction = descriptor as { name?: unknown };
			if (constructorFunction && typeof constructorFunction.name === 'string' && constructorFunction.name.length > 0) {
				return constructorFunction.name;
			}
		}
		return 'Object';
	}

	private expectHandleObject(handle: number, typeName: string, member: string, interpreter: LuaInterpreter): object {
		const instance = this.luaHandleToObject.get(handle);
		if (instance === undefined) {
			throw this.createApiRuntimeError(interpreter, `[${typeName}.${member}] Object handle is no longer valid.`);
		}
		if (typeof instance !== 'object' || instance === null) {
			throw this.createApiRuntimeError(interpreter, `[${typeName}.${member}] Object handle resolved to an invalid target.`);
		}
		return instance as object;
	}

	private attachHandleMetatable(table: LuaTable, handle: number, typeName: string, interpreter: LuaInterpreter): void {
		const indexFn = createLuaNativeFunction(`${typeName}.__index`, interpreter, (_lua, args) => {
			if (args.length < 2) {
				throw this.createApiRuntimeError(interpreter, `[${typeName}.__index] requires a table and key.`);
			}
			const keyValue = args[1];
			if (typeof keyValue !== 'string' && typeof keyValue !== 'number') {
				return [null];
			}
			const propertyName = typeof keyValue === 'number' ? String(keyValue) : keyValue;
			const cached = this.getCachedHandleMethod(handle, propertyName);
			if (cached !== null) {
				return [cached];
			}
			const instance = this.expectHandleObject(handle, typeName, propertyName, interpreter);
			const target = instance as Record<string, unknown>;
			if (!(propertyName in target)) {
				return [null];
			}
			let property: unknown;
			try {
				property = Reflect.get(target, propertyName);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${propertyName}] ${message}`);
			}
			if (typeof property === 'function') {
				const fn = this.createHandleMethod(handle, propertyName, typeName, interpreter);
				this.storeHandleMethod(handle, propertyName, fn);
				table.set(propertyName, fn);
				return [fn];
			}
			if (property === undefined) {
				return [null];
			}
			const luaValue = this.jsToLua(property, interpreter);
			return [luaValue];
		});

		const newIndexFn = createLuaNativeFunction(`${typeName}.__newindex`, interpreter, (_lua, args) => {
			if (args.length < 3) {
				throw this.createApiRuntimeError(interpreter, `[${typeName}.__newindex] requires table, key, and value.`);
			}
			const keyValue = args[1];
			if (typeof keyValue !== 'string' && typeof keyValue !== 'number') {
				const targetTable = args[0];
				if (targetTable instanceof LuaTable) {
					targetTable.set(keyValue, args[2]);
				}
				return [];
			}
			const propertyName = typeof keyValue === 'number' ? String(keyValue) : keyValue;
			const instance = this.expectHandleObject(handle, typeName, propertyName, interpreter);
			const jsValue = this.luaValueToJs(args[2]);
			try {
				Reflect.set(instance as Record<string, unknown>, propertyName, jsValue);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${propertyName}] ${message}`);
			}
			this.evictCachedHandleMethod(handle, propertyName);
			const targetTable = args[0];
			if (targetTable instanceof LuaTable) {
				targetTable.delete(propertyName);
			}
			return [];
		});

		const metatable = new LuaTable();
		metatable.set('__index', indexFn);
		metatable.set('__newindex', newIndexFn);
		table.setMetatable(metatable);
	}

	private wrapEngineObject(value: object, interpreter: LuaInterpreter): LuaTable {
		const cached = this.luaObjectWrapperCache.get(value);
		if (cached !== undefined) {
			return cached;
		}
		const handle = this.getOrCreateHandle(value);
		const table = new LuaTable();
		table.set(BmsxConsoleRuntime.LUA_HANDLE_FIELD, handle);
		const typeName = this.resolveObjectTypeName(value);
		table.set(BmsxConsoleRuntime.LUA_TYPE_FIELD, typeName);
		this.attachHandleMetatable(table, handle, typeName, interpreter);
		this.luaObjectWrapperCache.set(value, table);
		return table;
	}

	private createHandleMethod(handle: number, methodName: string, typeName: string, interpreter: LuaInterpreter): LuaFunctionValue {
		return createLuaNativeFunction(`${typeName}.${methodName}`, interpreter, (_lua, args) => {
			const instance = this.expectHandleObject(handle, typeName, methodName, interpreter);
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
		if (typeof value === 'object' && value !== null) {
			const candidate = value as { call?: unknown };
			if (typeof candidate.call === 'function') {
				return value;
			}
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

	private resolveLuaSourcePath(program: BmsxConsoleLuaProgram): string | null {
		if ('assetId' in program && typeof program.assetId === 'string' && program.assetId.length > 0) {
			const rompack = $.rompack;
			if (!rompack) {
				throw new Error('[BmsxConsoleRuntime] Rompack not loaded while resolving Lua source path.');
			}
			const mappings = rompack.luaSourcePaths;
			if (!mappings) {
				return null;
			}
			const mapped = mappings[program.assetId];
			if (typeof mapped === 'string' && mapped.length > 0) {
				return mapped;
			}
			return null;
		}
		return null;
	}

	private resolveLuaResourcePath(assetId: string): string | null {
		const rompack = $.rompack;
		if (!rompack) {
			throw new Error('[BmsxConsoleRuntime] Rompack not loaded while resolving Lua resource path.');
		}
		const mappings = rompack.luaSourcePaths;
		if (!mappings) {
			return null;
		}
		const mapped = mappings[assetId];
		if (typeof mapped === 'string' && mapped.length > 0) {
			return mapped;
		}
		return null;
	}

	private async persistLuaSourceToFilesystem(path: string, source: string): Promise<void> {
		if (typeof fetch !== 'function') {
			throw new Error('[BmsxConsoleRuntime] Fetch API unavailable; cannot persist Lua source.');
		}
		let response: HttpResponse;
		try {
			response = await fetch('/__bmsx__/lua', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path, contents: source }),
			});
		} catch (error) {
			this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to reach Lua save endpoint for '${path}'`, { error });
			if (this.luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
		if (!response.ok) {
			let detail = '';
			try {
				detail = await response.text();
			} catch (textError) {
				const message = textError instanceof Error ? textError.message : String(textError);
				this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}' (response body read failed)`, { detail: message });
				if (this.luaFailurePolicy.persist === 'warning') {
					return;
				}
				return;
			}
			let finalDetail = response.statusText;
			if (detail && detail.length > 0) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(detail);
				} catch (parseError) {
					const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
					this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}' (error payload parse failed)`, { detail: parseMessage });
					if (this.luaFailurePolicy.persist === 'warning') {
						return;
					}
					return;
				}
				if (parsed && typeof parsed === 'object' && 'error' in parsed) {
					const record = parsed as { error?: unknown };
					if (typeof record.error === 'string' && record.error.length > 0) {
						finalDetail = record.error;
					} else {
						finalDetail = detail;
					}
				} else {
					finalDetail = detail;
				}
			}
			this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}'`, { detail: finalDetail });
			if (this.luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
	}

	private async fetchLuaSourceFromFilesystem(path: string): Promise<string | null> {
		if (typeof fetch !== 'function') {
			return null;
		}
		let response: HttpResponse;
		const url = `/__bmsx__/lua?path=${encodeURIComponent(path)}`;
		try {
			response = await fetch(url, { method: 'GET', cache: 'no-store' });
		} catch (error) {
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from filesystem (${path})`, { error });
			if (this.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			let detail = '';
			try {
				detail = await response.text();
			} catch (textError) {
				const message = textError instanceof Error ? textError.message : String(textError);
				this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}' (response body read failed)`, { detail: message });
				if (this.luaFailurePolicy.fetch === 'warning') {
					return null;
				}
				return null;
			}
			let finalDetail = response.statusText;
			if (detail && detail.length > 0) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(detail);
				} catch (parseError) {
					const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
					this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}' (error payload parse failed)`, { detail: parseMessage });
					if (this.luaFailurePolicy.fetch === 'warning') {
						return null;
					}
					return null;
				}
				if (parsed && typeof parsed === 'object' && 'error' in parsed) {
					const record = parsed as { error?: unknown };
					if (typeof record.error === 'string' && record.error.length > 0) {
						finalDetail = record.error;
					} else {
						finalDetail = detail;
					}
				} else {
					finalDetail = detail;
				}
			}
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}'`, { detail: finalDetail });
			if (this.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch (parseError) {
			const message = parseError instanceof Error ? parseError.message : String(parseError);
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Invalid response while loading Lua source from '${path}'`, { detail: message });
			if (this.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		if (!payload || typeof payload !== 'object') {
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
			if (this.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		const record = payload as { contents?: unknown };
		if (typeof record.contents !== 'string') {
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
			if (this.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		return record.contents;
	}

	private async prefetchLuaSourceFromFilesystem(): Promise<void> {
		if (!this.hasLuaProgram()) {
			return;
		}
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		let path: string | null;
		try {
			path = this.resolveLuaSourcePath(program);
		} catch (error) {
			this.handleLuaPersistenceFailure('fetch', '[BmsxConsoleRuntime] Failed to resolve Lua source path during prefetch', { error });
			if (this.luaFailurePolicy.fetch === 'warning') {
				return;
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
		if (!path) {
			return;
		}
		let fetched: string | null;
		try {
			fetched = await this.fetchLuaSourceFromFilesystem(path);
		} catch (error) {
			this.handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Prefetch of Lua source '${path}' failed`, { error });
			if (this.luaFailurePolicy.fetch === 'warning') {
				return;
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
		if (fetched === null) {
			return;
		}
		const currentSource = this.getLuaProgramSource(program);
		if (currentSource === fetched) {
			return;
		}
		const chunkName = this.resolveLuaProgramChunkName(program);
		const previousOverride = this.luaProgramSourceOverride;
		try {
			this.luaProgramSourceOverride = fetched;
			this.applyProgramSourceToCartridge(fetched, chunkName);
			this.boot();
		} catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.applyProgramSourceToCartridge(currentSource, chunkName);
			} catch (restoreError) {
				this.handleLuaPersistenceFailure('restore', `[BmsxConsoleRuntime] Failed to restore Lua source after prefetched apply error`, { error: restoreError });
				return;
			}
			this.handleLuaPersistenceFailure('apply', `[BmsxConsoleRuntime] Failed to apply prefetched Lua source '${path}'`, { error });
			if (this.luaFailurePolicy.apply === 'warning') {
				return;
			}
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	private resolveLuaProgramSource(program: BmsxConsoleLuaProgram): string {
		if ('source' in program && program.source) {
			return program.source;
		}
		if ('assetId' in program && program.assetId) {
			if ('overrideSource' in program && typeof program.overrideSource === 'string' && program.overrideSource.length > 0) {
				return program.overrideSource;
			}
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
			this.registerProgramChunk(mutable, chunkName);
			return;
		}
		if ('assetId' in program && program.assetId) {
			const cartridge = this.cart as { luaProgram?: BmsxConsoleLuaProgram };
			const updated: BmsxConsoleLuaProgram = {
				assetId: program.assetId,
				overrideSource: source,
				chunkName,
				entry: program.entry,
			};
			cartridge.luaProgram = updated;
			this.luaProgram = updated;
			this.registerProgramChunk(updated, chunkName);
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
		this.registerProgramChunk(updated, chunkName);
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

	private registerProgramChunk(program: BmsxConsoleLuaProgram, chunkName: string): void {
		let assetId: string | null = null;
		let resolvedPath: string | null = null;
		if ('assetId' in program && program.assetId) {
			assetId = program.assetId;
			resolvedPath = this.resolveResourcePath(program.assetId);
		}
		const info: { assetId: string | null; path?: string | null } = { assetId };
		if (resolvedPath && resolvedPath.length > 0) {
			info.path = resolvedPath;
		}
		this.registerLuaChunkResource(chunkName, info);
	}

	private normalizeChunkName(name: string): string {
		let normalized = name.trim();
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		return normalized.replace(/\\/g, '/');
	}

	private registerLuaChunkResource(chunkName: string, info: { assetId: string | null; path?: string | null }): void {
		if (!chunkName) return;
		const key = this.normalizeChunkName(chunkName);
		this.luaChunkResourceMap.set(key, info);
	}

	private cacheCurrentChunkEnvironment(chunkName: string, assetId: string | null): void {
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			return;
		}
		const environment = interpreter.getChunkEnvironment();
		if (!environment) {
			return;
		}
		const normalizedChunk = this.normalizeChunkName(chunkName);
		this.luaChunkEnvironmentsByChunkName.set(normalizedChunk, environment);
		if (assetId && assetId.length > 0) {
			this.luaChunkEnvironmentsByAssetId.set(assetId, environment);
		}
	}

	private lookupChunkResourceInfo(chunkName: string): { assetId: string | null; path?: string | null } | null {
		const key = this.normalizeChunkName(chunkName);
		if (!this.luaChunkResourceMap.has(key)) {
			return null;
		}
		const existing = this.luaChunkResourceMap.get(key);
		if (!existing) {
			return null;
		}
		if (existing.path) {
			return existing;
		}
		if (existing.assetId) {
			const resolved = this.resolveResourcePath(existing.assetId);
			if (resolved && resolved.length > 0) {
				const updated = { ...existing, path: resolved };
				this.luaChunkResourceMap.set(key, updated);
				return updated;
			}
		}
		return existing;
	}

	private lookupChunkResourceInfoNullable(chunkName: string | null): { assetId: string | null; path?: string | null } | null {
		if (!chunkName) return null;
		return this.lookupChunkResourceInfo(chunkName);
	}

	private resolveResourcePath(assetId: string): string | null {
		if (!assetId) {
			return null;
		}
		if (this.resourcePathCache.has(assetId)) {
			const cached = this.resourcePathCache.get(assetId);
			if (cached === null || cached === undefined) {
				return null;
			}
			return cached;
		}
		const rompack = $.rompack;
		if (!rompack) {
			this.resourcePathCache.set(assetId, null);
			return null;
		}
		let luaSources: Record<string, string>;
		if (rompack.luaSourcePaths) {
			luaSources = rompack.luaSourcePaths;
		} else {
			luaSources = {};
		}
		const luaSource = luaSources[assetId];
		if (typeof luaSource === 'string' && luaSource.length > 0) {
			const normalizedLuaPath = luaSource.replace(/\\/g, '/');
			this.resourcePathCache.set(assetId, normalizedLuaPath);
			return normalizedLuaPath;
		}
		if (!Array.isArray(rompack.resourcePaths)) {
			this.resourcePathCache.set(assetId, null);
			return null;
		}
		const entry = rompack.resourcePaths.find(candidate => candidate.assetId === assetId);
		if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
			this.resourcePathCache.set(assetId, null);
			return null;
		}
	const normalizedPath = entry.path.replace(/\\/g, '/');
	this.resourcePathCache.set(assetId, normalizedPath);
		return normalizedPath;
	}

	private resourcePathRepresentsFsm(path: string, assetId: string): boolean {
		if (path.toLowerCase().indexOf('.fsm.') !== -1) {
			return true;
		}
		return assetId.toLowerCase().indexOf('.fsm') !== -1;
	}

	private inspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult | null {
		if (!request) {
			return null;
		}
		const expressionRaw = request.expression;
		if (typeof expressionRaw !== 'string') {
			return null;
		}
		const trimmed = expressionRaw.trim();
		if (trimmed.length === 0) {
			return null;
		}
		const chain = this.parseLuaIdentifierChain(trimmed);
		if (!chain) {
			return null;
		}
		const assetId = request.assetId && request.assetId.length > 0 ? request.assetId : null;
		const usageRow = Number.isFinite(request.row) ? Math.max(1, Math.floor(request.row)) : null;
		const usageColumn = Number.isFinite(request.column) ? Math.max(1, Math.floor(request.column)) : null;
		const resolved = this.resolveLuaChainValue(chain, assetId);
		const staticDefinition = this.findStaticDefinitionLocation(assetId, chain, usageRow, usageColumn, request.chunkName);
		if (!resolved) {
			if (!staticDefinition) {
				return null;
			}
			return {
				expression: trimmed,
				lines: ['static definition'],
				valueType: 'unknown',
				scope: 'chunk',
				state: 'not_defined',
				isFunction: false,
				isLocalFunction: false,
				isBuiltin: false,
				definition: staticDefinition,
			};
		}
		if (resolved.kind === 'not_defined') {
			return {
				expression: trimmed,
				lines: ['not defined'],
				valueType: 'undefined',
				scope: resolved.scope,
				state: 'not_defined',
				isFunction: false,
				isLocalFunction: false,
				isBuiltin: false,
				definition: staticDefinition,
			};
		}
		const formatted = this.describeLuaValueForInspector(resolved.value);
		const isFunction = formatted.isFunction;
		const isLocalFunction = isFunction && resolved.scope === 'chunk';
		const isBuiltin = isFunction && chain.length === 1 && this.isLuaBuiltinFunctionName(chain[0]);
		let definition: ConsoleLuaDefinitionLocation | null = null;
		if (!isBuiltin) {
			definition = this.resolveLuaDefinitionMetadata(resolved.value, assetId, resolved.definitionRange);
			if (!definition) {
				definition = staticDefinition;
			}
		}
		return {
			expression: trimmed,
			lines: formatted.lines,
			valueType: formatted.valueType,
			scope: resolved.scope,
			state: 'value',
			isFunction,
			isLocalFunction,
			isBuiltin,
			definition,
		};
	}

	private resolveLuaDefinitionMetadata(value: LuaValue, fallbackAssetId: string | null, definitionRange: LuaSourceRange | null): ConsoleLuaDefinitionLocation | null {
		let range: LuaSourceRange | null = definitionRange ?? null;
		if (!range && value && typeof value === 'object') {
			const candidate = value as { getSourceRange?: () => LuaSourceRange };
			if (typeof candidate.getSourceRange === 'function') {
				range = candidate.getSourceRange() ?? null;
			}
		}
		if (!range) {
			return null;
		}
		return this.buildDefinitionLocationFromRange(range, fallbackAssetId);
	}

	private buildDefinitionLocationFromRange(range: LuaSourceRange, fallbackAssetId: string | null): ConsoleLuaDefinitionLocation {
		const normalizedChunk = this.normalizeChunkName(range.chunkName);
		const chunkResource = this.lookupChunkResourceInfoNullable(range.chunkName);
		const assetId = chunkResource?.assetId ?? fallbackAssetId ?? null;
		const location: ConsoleLuaDefinitionLocation = {
			chunkName: normalizedChunk,
			assetId,
			range: {
				startLine: range.start.line,
				startColumn: range.start.column,
				endLine: range.end.line,
				endColumn: range.end.column,
			},
		};
		if (chunkResource?.path) {
			location.path = chunkResource.path;
		} else if (assetId) {
			const resolvedPath = this.resolveResourcePath(assetId);
			if (resolvedPath) {
				location.path = resolvedPath;
			}
		}
		return location;
	}

	private findStaticDefinitionLocation(assetId: string | null, chain: ReadonlyArray<string>, usageRow: number | null, usageColumn: number | null, preferredChunk: string | null): ConsoleLuaDefinitionLocation | null {
		if (chain.length === 0) {
			return null;
		}
		const definitions = this.getStaticDefinitions(assetId, preferredChunk);
		if (!definitions) {
			return null;
		}
		const identifier = chain[chain.length - 1];
		const pathsMatch = (candidate: ReadonlyArray<string>): boolean => {
			if (candidate.length !== chain.length) {
				return false;
			}
			for (let index = 0; index < candidate.length; index += 1) {
				if (candidate[index] !== chain[index]) {
					return false;
				}
			}
			return true;
		};
		const selectPreferred = (candidate: LuaDefinitionInfo, current: LuaDefinitionInfo | null): LuaDefinitionInfo | null => {
			if (usageRow !== null) {
				if (!this.positionWithinRange(usageRow, usageColumn, candidate.scope)) {
					return current;
				}
				if (usageRow < candidate.definition.start.line) {
					return current;
				}
				if (
					!current
					|| candidate.definition.start.line > current.definition.start.line
					|| (candidate.definition.start.line === current.definition.start.line
						&& candidate.definition.start.column >= current.definition.start.column)
				) {
					return candidate;
				}
				return current;
			}
			if (
				!current
				|| candidate.definition.start.line < current.definition.start.line
				|| (candidate.definition.start.line === current.definition.start.line
					&& candidate.definition.start.column < current.definition.start.column)
			) {
				return candidate;
			}
			return current;
		};
		let bestExact: LuaDefinitionInfo | null = null;
		let bestPartial: LuaDefinitionInfo | null = null;
		for (const definition of definitions) {
			if (pathsMatch(definition.namePath)) {
				bestExact = selectPreferred(definition, bestExact);
				continue;
			}
			if (definition.name !== identifier) {
				continue;
			}
			bestPartial = selectPreferred(definition, bestPartial);
		}
		const chosen = bestExact ?? bestPartial;
		if (!chosen) {
			return null;
		}
		return this.buildDefinitionLocationFromRange(chosen.definition, assetId);
	}

	private getStaticDefinitions(assetId: string | null, preferredChunk: string | null): ReadonlyArray<LuaDefinitionInfo> | null {
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			return null;
		}
		const matches: LuaDefinitionInfo[] = [];
		const normalizedPreferred = preferredChunk ? this.normalizeChunkName(preferredChunk) : null;
		const normalizedPreferredPath = preferredChunk ? preferredChunk.replace(/\\/g, '/') : null;
		for (const [chunkName, info] of this.luaChunkResourceMap) {
			const matchesAsset = assetId !== null && info.assetId === assetId;
			const matchesPath = normalizedPreferredPath !== null && info.path === normalizedPreferredPath;
			const matchesChunk = normalizedPreferred !== null && this.normalizeChunkName(chunkName) === normalizedPreferred;
			if (!matchesAsset && !matchesPath && !matchesChunk) {
				continue;
			}
			const chunkDefinitions = interpreter.getChunkDefinitions(chunkName);
			if (chunkDefinitions && chunkDefinitions.length > 0) {
				matches.push(...chunkDefinitions);
			}
		}
		return matches.length > 0 ? matches : null;
	}

	private positionWithinRange(row: number, column: number | null, range: LuaSourceRange): boolean {
		if (row < range.start.line || row > range.end.line) {
			return false;
		}
		if (row === range.start.line && column !== null && column < range.start.column) {
			return false;
		}
		if (row === range.end.line && column !== null && column > range.end.column) {
			return false;
		}
		return true;
	}

	private parseLuaIdentifierChain(expression: string): string[] | null {
		if (!expression) {
			return null;
		}
		const parts = expression.split('.');
		if (parts.length === 0) {
			return null;
		}
		for (let i = 0; i < parts.length; i += 1) {
			const part = parts[i];
			if (part.length === 0) {
				return null;
			}
			if (!this.isLuaIdentifierStartChar(part.charCodeAt(0))) {
				return null;
			}
			for (let j = 1; j < part.length; j += 1) {
				if (!this.isLuaIdentifierChar(part.charCodeAt(j))) {
					return null;
				}
			}
		}
		return parts;
	}

	private resolveLuaChainValue(parts: string[], assetId: string | null): ({ kind: 'value'; value: LuaValue; scope: ConsoleLuaHoverScope; definitionRange: LuaSourceRange | null } | { kind: 'not_defined'; scope: ConsoleLuaHoverScope }) | null {
		if (!parts || parts.length === 0) {
			return null;
		}
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			return null;
		}
		const root = parts[0];
		let value: LuaValue | null = null;
		let scope: ConsoleLuaHoverScope = 'global';
		let found = false;
		let definitionEnv: LuaEnvironment | null = null;
		let definitionRange: LuaSourceRange | null = null;
		if (assetId) {
			const env = this.luaChunkEnvironmentsByAssetId.get(assetId) ?? null;
			if (env && env.hasLocal(root)) {
				value = env.get(root);
				scope = 'chunk';
				found = true;
				definitionEnv = env;
			}
		}
		if (!found) {
			const chunkName = this.luaChunkName;
			if (chunkName) {
				const normalized = this.normalizeChunkName(chunkName);
				const envByChunk = this.luaChunkEnvironmentsByChunkName.get(normalized) ?? null;
				if (envByChunk && envByChunk.hasLocal(root)) {
					value = envByChunk.get(root);
					scope = 'chunk';
					found = true;
					definitionEnv = envByChunk;
				}
			}
		}
		if (!found) {
			const globals = interpreter.getGlobalEnvironment();
			if (globals.hasLocal(root)) {
				value = globals.get(root);
				scope = 'global';
				found = true;
				definitionEnv = globals;
			}
		}
		if (!found) {
			return null;
		}
		if (definitionEnv) {
			definitionRange = definitionEnv.getDefinition(root);
		}
		if (value === undefined) {
			return null;
		}
		let current: LuaValue = value;
		for (let index = 1; index < parts.length; index += 1) {
			const part = parts[index];
			if (!(current instanceof LuaTable)) {
				return { kind: 'not_defined', scope };
			}
			const nextValue = current.get(part);
			if (nextValue === null) {
				return { kind: 'not_defined', scope };
			}
			current = nextValue;
		}
		return { kind: 'value', value: current, scope, definitionRange };
	}

	private describeLuaValueForInspector(value: LuaValue): { lines: string[]; valueType: string; isFunction: boolean } {
		if (value === null) {
			return { lines: ['Nil'], valueType: 'nil', isFunction: false };
		}
		if (typeof value === 'boolean') {
			return { lines: [value ? 'true' : 'false'], valueType: 'boolean', isFunction: false };
		}
		if (typeof value === 'number') {
			const numeric = Number.isFinite(value) ? String(value) : 'nan';
			return { lines: [numeric], valueType: 'number', isFunction: false };
		}
		if (typeof value === 'string') {
			return { lines: [this.truncateInspectorLine(JSON.stringify(value))], valueType: 'string', isFunction: false };
		}
		if (this.isLuaFunctionValue(value)) {
			const fnName = value.name && value.name.length > 0 ? value.name : '<anonymous>';
			return { lines: [`<function ${fnName}>`], valueType: 'function', isFunction: true };
		}
		if (value instanceof LuaTable) {
			try {
				const serialized = this.serializeLuaValueForSnapshot(value, new Set<LuaTable>());
				const json = JSON.stringify(serialized, null, 2) ?? 'null';
				const rawLines = json.split('\n');
				const lines: string[] = [];
				for (let i = 0; i < rawLines.length && i < BmsxConsoleRuntime.HOVER_VALUE_MAX_SERIALIZED_LINES; i += 1) {
					lines.push(this.truncateInspectorLine(rawLines[i]));
				}
				if (rawLines.length > BmsxConsoleRuntime.HOVER_VALUE_MAX_SERIALIZED_LINES) {
					lines.push('...');
				}
				return { lines, valueType: 'table', isFunction: false };
			} catch (_error) {
				return { lines: ['<table>'], valueType: 'table', isFunction: false };
			}
		}
		return { lines: ['<unknown>'], valueType: 'unknown', isFunction: false };
	}

	private truncateInspectorLine(value: string): string {
		if (value.length <= BmsxConsoleRuntime.HOVER_VALUE_MAX_LINE_LENGTH) {
			return value;
		}
		return value.slice(0, BmsxConsoleRuntime.HOVER_VALUE_MAX_LINE_LENGTH - 3) + '...';
	}

	private isLuaIdentifierStartChar(code: number): boolean {
		if (code >= 65 && code <= 90) {
			return true;
		}
		if (code >= 97 && code <= 122) {
			return true;
		}
		return code === 95;
	}

	private isLuaIdentifierChar(code: number): boolean {
		if (this.isLuaIdentifierStartChar(code)) {
			return true;
		}
		return code >= 48 && code <= 57;
	}

	private isLuaBuiltinFunctionName(name: string): boolean {
		if (!name || name.length === 0) {
			return false;
		}
		return BmsxConsoleRuntime.LUA_BUILTIN_FUNCTIONS.has(name);
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
