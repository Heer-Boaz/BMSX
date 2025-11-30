import type { StorageService, InputEvt } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { CONSOLE_API_METHOD_METADATA } from './api_metadata';
import { BmsxConsoleStorage } from './storage';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram, BmsxConsoleLuaPrimaryAsset, ConsoleResourceDescriptor, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaResourceCreationRequest, ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry, ConsoleLuaBuiltinDescriptor, ConsoleLuaMemberCompletionRequest, ConsoleLuaMemberCompletion, BmsxConsoleLuaPrimaryAssetWithSource, LifeCycleHandlerName } from './types';
import type { RomResourcePath, Viewport } from '../rompack/rompack';
import {
	createLuaInterpreter,
	LuaInterpreter,
	createLuaNativeFunction,
	type LuaCallFrame,
	type LuaDebuggerPauseSignal,
	type ExecutionSignal,
	isLuaDebuggerPauseSignal,
} from '../lua/runtime';
import { LuaDebuggerController, type LuaDebuggerResumeCommand } from '../lua/debugger';
import { LuaEnvironment } from '../lua/environment';
import type { LuaFunctionValue, LuaValue, LuaTable, LuaNativeValue } from '../lua/value';
import { createLuaTable, isLuaNativeValue, isLuaTable, setLuaTableCaseInsensitiveKeys } from '../lua/value';
import { LuaRuntimeError, LuaError, LuaSyntaxError } from '../lua/errors';
import { $ } from '../core/game';
import { Service } from '../core/service';
import { taskGate } from '../core/taskgate';
import { OverlayPipelineController } from '../core/pipelines/overlay_controller';
import { ConsoleRenderFacade } from './console_render_facade';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import { LuaHandlerCache, isLuaHandlerFn } from '../lua/handler_cache';
import type { LuaSourceRange, LuaDefinitionInfo, LuaDefinitionKind } from '../lua/ast';
import { createConsoleCartEditor, type ConsoleCartEditor, } from './ide/console_cart_editor';
import type { RuntimeErrorDetails } from './ide/types';
import { type FaultSnapshot } from './ide/render/render_error_overlay';
import type { StackTraceFrame } from '../lua/runtime';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import { DEFAULT_LUA_BUILTIN_FUNCTIONS } from './lua_builtins';
import type { ConsoleFontVariant } from './font';
import { buildLuaSemanticModel, type LuaSemanticModel } from './ide/semantic_model';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceStateFilePath, buildWorkspaceStorageKey, WORKSPACE_FILE_ENDPOINT } from './workspace';
import { collectWorkspaceOverrides, type WorkspaceOverrideRecord } from './workspace';
import { deep_clone } from '../utils/deep_clone';
import { WorldObject } from '../core/object/worldobject';
import { Input } from '../input/input';
import type { InputMap, KeyboardInputMapping, GamepadInputMapping, PointerInputMapping, KeyboardBinding, GamepadBinding, PointerBinding } from '../input/inputtypes';
import { ConsoleMode } from './console_mode';
import { EDITOR_TOGGLE_KEY, CONSOLE_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, GAME_PAUSE_KEY } from './ide/constants';
import {
	emitDebuggerLifecycleEvent,
	type DebuggerResumeMode,
	type DebuggerPauseDisplayPayload
} from './ide/ide_debugger';
import { arrayify } from '../utils/arrayify';
import { fallbackclamp } from '../utils/clamp';
import { ConsoleCommandDispatcher } from './console_commands';
import { CanonicalizationType } from '../rompack/rompack';
import { ActionEffectRegistry } from '../action_effects/effect_registry';
import { KeyModifier } from '../input/playerinput';

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

const CONSOLE_BUTTON_ACTIONS: ReadonlyArray<string> = [
	'console_left',
	'console_right',
	'console_up',
	'console_down',
	'console_b',
	'console_a',
	'console_x',
	'console_y',
	'console_start',
	'console_select',
	'console_rt',
	'console_lt',
	'console_rb',
	'console_lb',
];

const CONSOLE_PREVIEW_MAX_ENTRIES = 12;
const CONSOLE_PREVIEW_MAX_DEPTH = 2;

// Flip back to 'msx' to restore the legacy editor font.
const EDITOR_FONT_VARIANT: ConsoleFontVariant = 'tiny';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	playerIndex: number;
	storage?: StorageService;
	luaSourceFailurePolicy?: Partial<LuaPersistenceFailurePolicy>;
	canonicalization?: CanonicalizationType;
};

export type LuaSnapshotObjects = Record<number, unknown>;
export type LuaSnapshotGraph = { root: unknown; objects: LuaSnapshotObjects };
export type LuaEntrySnapshot = Record<string, unknown> | LuaSnapshotGraph;
type LuaSnapshotContext = { ids: WeakMap<LuaTable, number>; objects: LuaSnapshotObjects; nextId: number };

export type BmsxConsoleState = {
	luaRuntimeFailed: boolean;
	luaChunkName: string | null;
	storage?: { namespace: string; entries: Array<{ index: number; value: number }> };
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
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

type LuaRequireModuleRecord = {
	packageKey: string;
	canonicalKey: string;
	asset_id: string;
	chunkName: string;
	path: string | null;
};

type ConsoleFrameState = {
	deltaSeconds: number;
	deltaForUpdate: number;
	editorActive: boolean;
	consoleActive: boolean;
	haltGame: boolean;
	debugPaused: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	frameBegan: boolean;
	consoleEvaluated: boolean;
	editorEvaluated: boolean;
};

type LuaMarshalContext = {
	moduleId: string;
	path: string[];
};

type LuaFunctionRedirectRecord = {
	key: string;
	moduleId: string;
	path: ReadonlyArray<string>;
	current: LuaFunctionValue;
	redirect: LuaFunctionValue;
};

class LuaFunctionRedirectCache {
	private readonly byKey = new Map<string, LuaFunctionRedirectRecord>();
	private readonly byModule = new Map<string, Set<string>>();

	public getOrCreate(moduleId: string, path: ReadonlyArray<string>, fn: LuaFunctionValue): LuaFunctionValue {
		const normalizedModule = moduleId.trim();
		const key = this.buildKey(normalizedModule, path);
		let record = this.byKey.get(key);
		if (!record) {
			record = this.createRecord(normalizedModule, key, path, fn);
			this.byKey.set(key, record);
			this.index(normalizedModule, key);
			return record.redirect;
		}
		record.current = fn;
		return record.redirect;
	}

	public clear(): void {
		this.byKey.clear();
		this.byModule.clear();
	}

	private createRecord(moduleId: string, key: string, path: ReadonlyArray<string>, fn: LuaFunctionValue): LuaFunctionRedirectRecord {
		const record: LuaFunctionRedirectRecord = {
			key,
			moduleId,
			path: path.slice(),
			current: fn,
			redirect: null as unknown as LuaFunctionValue,
		};
		const redirect = createLuaNativeFunction(`redirect:${path[path.length - 1] ?? 'fn'}`, (args) => {
			return record.current.call(args);
		});
		record.redirect = redirect;
		return record;
	}

	private index(moduleId: string, key: string): void {
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Set<string>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.add(key);
	}

	private buildKey(moduleId: string, path: ReadonlyArray<string>): string {
		return `${moduleId}::${path.join('.')}`;
	}
}

export var api: BmsxConsoleApi; // Initialized in BmsxConsoleRuntime constructor

export class BmsxConsoleRuntime extends Service {
	private static _instance: BmsxConsoleRuntime | null = null;
	private static preservingWorldResetDepth = 0;
	private static readonly MAX_FRAME_DELTA_MS = 250;
	private static readonly HOVER_VALUE_MAX_LINE_LENGTH = 160;
	private static readonly HOVER_VALUE_MAX_SERIALIZED_LINES = 200;
	private static readonly LUA_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>([
		'print',
		'type',
		'tostring',
		'tonumber',
		'setmetatable',
		'getmetatable',
		'require',
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
		'package',
		'api',
	]);

	public static async createInstance(options: BmsxConsoleRuntimeOptions): Promise<void> {
		const existing = BmsxConsoleRuntime._instance;
		if (existing) {
			const sameCart = existing.cart.meta.persistentId === options.cart.meta.persistentId;
			const preserving = BmsxConsoleRuntime.preservingWorldResetDepth > 0;
			if (sameCart && preserving) {
				return;
			}
			existing.dispose();
		}
		BmsxConsoleRuntime._instance = new BmsxConsoleRuntime(options);
		await BmsxConsoleRuntime._instance.startup();
	}

	public static get instance(): BmsxConsoleRuntime {
		return BmsxConsoleRuntime._instance!;
	}

	public static beginPreservedWorldReset(): void {
		BmsxConsoleRuntime.preservingWorldResetDepth = BmsxConsoleRuntime.preservingWorldResetDepth + 1;
	}

	public static endPreservedWorldReset(): void {
		if (BmsxConsoleRuntime.preservingWorldResetDepth === 0) {
			throw new Error('[BmsxConsoleRuntime] endPreservedWorldReset called without matching begin.');
		}
		BmsxConsoleRuntime.preservingWorldResetDepth = BmsxConsoleRuntime.preservingWorldResetDepth - 1;
	}

	public static destroy(): void {
		const instance = BmsxConsoleRuntime._instance;
		if (!instance) {
			return;
		}
		if (BmsxConsoleRuntime.preservingWorldResetDepth > 0) {
			instance.pendingLuaWarnings = [];
			return;
		}
		instance.dispose();
		BmsxConsoleRuntime._instance = null;
	}

	private cart: BmsxConsoleCartridge;
	private readonly storage: BmsxConsoleStorage;
	private readonly storageService: StorageService;
	private readonly apiFunctionNames = new Set<string>();
	private readonly luaBuiltinMetadata = new Map<string, ConsoleLuaBuiltinDescriptor>();
	private _activeIdeFontVariant: ConsoleFontVariant = EDITOR_FONT_VARIANT;
	private luaProgram!: BmsxConsoleLuaProgram;
	private playerIndex: number;
	private editor!: ConsoleCartEditor;
	private readonly overlayRenderBackend = new ConsoleRenderFacade();
	public readonly consoleMode!: ConsoleMode;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderBackend.setRenderingViewportType(value);
		this.editor?.updateViewport(this.overlayRenderBackend.viewportSize);
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderBackend.viewportSize;
	}

	private overlayRenderedThisFrame = false;
	private readonly consoleCommands: ConsoleCommandDispatcher;
	private readonly consoleHotkeyLatch = new Map<string, number | null>();
	private shortcutDisposers: Array<() => void> = [];
	private globalInputUnsubscribe: (() => void) | null = null;
	private readonly validationStrategy: BmsxLuaValidationStrategy = BmsxLuaValidationStrategy.TrustRealRun;
	private luaInterpreter!: LuaInterpreter;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaBootFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private luaVmInitialized = false;
	private luaRuntimeFailed = false;
	public get hasLuaRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	private readonly luaDebuggerController: LuaDebuggerController = new LuaDebuggerController();
	private luaDebuggerSuspension: LuaDebuggerPauseSignal | null = null;
	private debuggerHaltsGame = false;
	private debuggerAutoActivateOnNextPause = false;
	private lastFrameTimestampMs = 0;
	private overlayState = { console: false, editor: false };
	private includeJsStackTraces = false;
	private currentFrameState: ConsoleFrameState | null = null;
	private readonly luaFailurePolicy: LuaPersistenceFailurePolicy;
	private pendingLuaWarnings: string[] = [];
	private nativeMemberCompletionCache: WeakMap<object, { dot?: ConsoleLuaMemberCompletion[]; colon?: ConsoleLuaMemberCompletion[] }> = new WeakMap();
	private readonly luaChunkResourceMap: Map<string, { asset_id: string | null; path?: string | null }> = new Map();
	private readonly resourcePathCache: Map<string, string | null> = new Map();
	private readonly luaModuleAliases: Map<string, LuaRequireModuleRecord> = new Map();
	private readonly luaModuleLoadingKeys: Set<string> = new Set();
	private luaModuleIndexBuilt = false;
	private readonly chunkSemanticCache: Map<string, { source: string; model: LuaSemanticModel | null; definitions: ReadonlyArray<LuaDefinitionInfo> }> = new Map();
	private readonly luaChunkEnvironmentsByAssetId: Map<string, LuaEnvironment> = new Map();
	private readonly luaChunkEnvironmentsByChunkName: Map<string, LuaEnvironment> = new Map();
	private readonly chunkFunctionDefinitionKeys: Map<string, Set<string>> = new Map();
	private readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	private readonly luaGenericAssetsExecuted: Set<string> = new Set();
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	private readonly luaVmGate = taskGate.group('console:lua_vm');
	private readonly _workspaceScratchPaths: Set<string> = new Set();
	private handledLuaErrors = new WeakSet<object>();
	public faultSnapshot: FaultSnapshot | null = null;
	private faultOverlayNeedsFlush = false;
	public get doesFaultOverlayNeedFlush(): boolean {
		return this.faultOverlayNeedsFlush;
	}
	public flushedFaultOverlay(): void {
		this.faultOverlayNeedsFlush = false;
	}
	private readonly rompackOriginalLua: Map<string, string> = new Map();
	public readonly workspaceLuaOverrides: Map<string, WorkspaceOverrideRecord> = new Map();
	private hasBooted = false;
	private workspaceOverrideToken = 0;
	private readonly canonicalization: CanonicalizationType;

	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}

	public get workspaceScratchPaths(): ReadonlySet<string> {
		return this._workspaceScratchPaths;
	}

	private static readonly CONSOLE_SINGLE_ARG_KEYWORDS = new Set([
		'if',
		'then',
		'elseif',
		'else',
		'end',
		'for',
		'while',
		'repeat',
		'until',
		'function',
		'local',
		'return',
		'break',
		'do',
	]);

	private constructor(options: BmsxConsoleRuntimeOptions) {
		super({ id: 'bmsx_console_runtime' });
		BmsxConsoleRuntime._instance = this;
		this.cart = options.cart;
		this.playerIndex = options.playerIndex;
		this.storageService = options.storage ?? $.platform.storage;
		this.storage = new BmsxConsoleStorage(this.storageService, options.cart.meta.persistentId);
		const rompack = $.rompack;
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this.canonicalization = resolvedCanonicalization;
		setLuaTableCaseInsensitiveKeys(this.canonicalization !== 'none');
		setEditorCaseInsensitivity(this.canonicalization !== 'none');
		this.consoleMode = new ConsoleMode({
			playerIndex: options.playerIndex,
			fontVariant: this._activeIdeFontVariant,
			canonicalization: this.canonicalization,
			listLuaSymbols: (asset_id, chunkName) => this.listLuaSymbols(asset_id, chunkName),
			listGlobalLuaSymbols: () => this.listAllLuaSymbols(),
			listLuaModuleSymbols: (moduleName) => this.listLuaModuleSymbols(moduleName),
			listBuiltinLuaFunctions: () => this.listLuaBuiltinFunctions(),
			listLuaObjectMembers: (request) => this.listLuaObjectMembers(request),
		});
		this.consoleCommands = new ConsoleCommandDispatcher(this);
		this.consoleMode.setPromptPrefix(this.consoleCommands.getPrompt());
		this.enableEvents();
		const policyOverride = options.luaSourceFailurePolicy ?? {};
		this.luaFailurePolicy = { ...DEFAULT_LUA_FAILURE_POLICY, ...policyOverride };

		api = new BmsxConsoleApi({
			playerindex: this.playerIndex,
			storage: this.storage,
		});
		api.set_render_backend(this.overlayRenderBackend);
		this.overlayResolutionMode = 'viewport';
		this.luaProgram = this.cart.luaProgram;
		for (const [asset_id, source] of Object.entries(rompack.lua)) {
			this.rompackOriginalLua.set(asset_id, source);
		}
		this.seedDefaultLuaBuiltins();
		this.initializeEditor();
		this.subscribeGlobalDebuggerHotkeys();
		this.resetFrameTiming();
	}

	public async startup(): Promise<void> {
		await this.prefetchLuaSourceFromFilesystem();
		await this.boot();
	}

	private extractErrorMessage(error: unknown): string {
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

	private extractErrorLocation(error: unknown): { line: number | null; column: number | null; chunkName: string | null } {
		if (error instanceof LuaError) {
			const rawChunk = typeof error.chunkName === 'string' && error.chunkName.length > 0 ? error.chunkName : null;
			const chunkName = rawChunk && rawChunk.startsWith('@') ? rawChunk.slice(1) : rawChunk;
			return {
				line: Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null,
				column: Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null,
				chunkName: chunkName,
			};
		}
		return { line: null, column: null, chunkName: null };
	}

	private isLuaError(error: unknown): error is LuaError | LuaRuntimeError | LuaSyntaxError {
		return error instanceof LuaError || error instanceof LuaRuntimeError || error instanceof LuaSyntaxError;
	}

	private normalizeError(error: unknown): Error {
		return error instanceof Error ? error : new Error(String(error));
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.setHostAdapter({
			toLua: (value) => this.jsToLua(value),
			toJs: (luaValue) => {
				const moduleId = this.moduleIdFor(null, this.luaChunkName ?? null);
				return this.luaValueToJs(luaValue, { moduleId, path: [] });
			},
			serializeNative: (native) => this.snapshotEncodeNative(native),
			deserializeNative: (token) => this.snapshotDecodeNative(token),
		});
		interpreter.setRequireHandler((ctx, module) => this.requireLuaModule(ctx, module));
		interpreter.attachDebugger(this.luaDebuggerController);
	}

	private onLuaDebuggerPause(signal: LuaDebuggerPauseSignal): void {
		if (this.luaDebuggerSuspension === signal) {
			return;
		}
		const autoActivateOnPause = this.debuggerAutoActivateOnNextPause;
		this.debuggerAutoActivateOnNextPause = false;
		const controller = this.luaDebuggerController;
		const sessionMetrics = controller.handlePause(signal);
		this.luaDebuggerSuspension = signal;
		this.debuggerHaltsGame = true;
		this.setDebuggerPaused(true);
		const editorActive = this.editor?.isActive === true;
		const shouldActivateEditor = signal.reason === 'exception'
			? editorActive || autoActivateOnPause
			: signal.reason === 'breakpoint' || autoActivateOnPause;
		if (shouldActivateEditor) {
			try {
				this.activateEditor();
			}
			catch (activationError) {
				console.warn('[BmsxConsoleRuntime] Failed to activate console editor during debugger pause.', activationError);
			}
		}
		if (signal.reason === 'exception') {
			this.recordDebuggerExceptionFault(signal);
			if (editorActive || shouldActivateEditor) {
				this.editor.renderFaultOverlay();
			}
		} else if (this.luaRuntimeFailed && (editorActive || shouldActivateEditor)) {
			this.editor.renderFaultOverlay();
		}
		const state = this.currentFrameState;
		if (state) {
			state.haltGame = true;
			state.deltaForUpdate = 0;
		}
		const hint = this.lookupChunkResourceInfoNullable(signal.location.chunk);
		const payload: DebuggerPauseDisplayPayload = {
			chunk: signal.location.chunk,
			line: signal.location.line,
			column: signal.location.column,
			reason: signal.reason,
			hint,
		};
		emitDebuggerLifecycleEvent({
			type: 'paused',
			suspension: signal,
			payload,
			callStack: signal.callStack,
			metrics: sessionMetrics,
		});
	}
	private pauseDebuggerForException(
		details: { chunkName: string | null; line: number | null; column: number | null },
		callStackOverride?: ReadonlyArray<LuaCallFrame>,
	): void {
		const controller = this.luaDebuggerController;
		const interpreter = this.luaInterpreter;
		const callStack =
			callStackOverride !== undefined
				? Array.from(callStackOverride)
				: interpreter
					? Array.from(interpreter.lastFaultCallStack)
					: [];
		const chunk =
			(details.chunkName && details.chunkName.length > 0
				? details.chunkName
				: this.luaChunkName) ?? '<chunk>';
		const line = details.line ?? 0;
		const column = details.column ?? 0;
		const normalSignal: ExecutionSignal = { kind: 'normal' };
		const suspension: LuaDebuggerPauseSignal = {
			kind: 'pause',
			reason: 'exception',
			location: { chunk, line, column },
			callStack,
			resume: () => normalSignal,
		};
		this.onLuaDebuggerPause(suspension as LuaDebuggerPauseSignal);
		controller.clearStepping();
	}

	private setDebuggerPaused(paused: boolean): void {
		const state = this.currentFrameState;
		if (state) {
			state.debugPaused = paused;
		}
	}

	private clearActiveDebuggerPause(): void {
		const hadSuspension = this.luaDebuggerSuspension !== null;
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false);
		if (hadSuspension) {
			emitDebuggerLifecycleEvent({ type: 'continued', mode: 'continue' });
		}
	}

	private resumeLuaDebugger(command: LuaDebuggerResumeCommand, options?: { stepDepthOverride?: number }): void {
		const suspension = this.luaDebuggerSuspension;
		const controller = this.luaDebuggerController;
		const interpreter = this.luaInterpreter;
		const strategy = controller.prepareResume(command, suspension, options);
		if (interpreter) {
			interpreter.setExceptionResumeStrategy(strategy);
		}
		const shouldClearRuntimeErrorOverlay =
			!!suspension &&
			suspension.reason === 'exception' &&
			(command === 'continue' || command === 'ignore_exception' || command === 'step_out_exception');
		this.luaRuntimeFailed = false;
		if (shouldClearRuntimeErrorOverlay) {
			this.clearFaultSnapshot();
			if (this.editor) {
				this.editor.clearRuntimeErrorOverlay();
			}
			publishOverlayFrame(null);
		}
		const resumeMode = this.toDebuggerResumeMode(command);
		emitDebuggerLifecycleEvent({ type: 'continued', mode: resumeMode });
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false);
		const state = this.currentFrameState;
		if (state) {
			this.updateFrameHaltingState(state);
		}
		try {
			const result = suspension.resume();
			if (result.kind === 'pause') {
				this.onLuaDebuggerPause(result);
				return;
			}
			controller.handleSilentResumeResult(command, suspension);
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return;
			}
			this.handleLuaError(error);
		}
	}

	private toDebuggerResumeMode(command: LuaDebuggerResumeCommand): DebuggerResumeMode {
		if (command === 'step_into') {
			return 'step_into';
		}
		if (command === 'step_over') {
			return 'step_over';
		}
		if (command === 'step_out' || command === 'step_out_exception') {
			return 'step_out';
		}
		return 'continue';
	}

	public resumeDebugger(command: LuaDebuggerResumeCommand): void {
		const suspension = this.luaDebuggerSuspension;
		let options: { stepDepthOverride?: number } | undefined;
		if (command === 'step_out' || command === 'step_out_exception') {
			const targetDepth = Math.max(0, suspension.callStack.length - 1);
			options = { stepDepthOverride: targetDepth };
		}
		this.resumeLuaDebugger(command, options);
	}

	public setLuaBreakpoints(breakpoints: ReadonlyMap<string, ReadonlySet<number>>): void {
		const controller = this.luaDebuggerController;
		controller.setBreakpoints(breakpoints);
	}

	private pollConsoleHotkeys(): void {
		if (this.shouldAcceptConsoleHotkey('console-font-variant', 'KeyT', KeyModifier.ctrl | KeyModifier.shift)) {
			$.consume_button(this.playerIndex, 'KeyT', 'keyboard');
			const next = this._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
			this.activeIdeFontVariant = next; // Toggle font variant and apply to both console and editor
			return;
		}
		if (this.consoleMode.isActive) {
			if (this.shouldAcceptConsoleHotkey('console-resolution', 'KeyV', KeyModifier.ctrl | KeyModifier.alt)) {
				$.consume_button(this.playerIndex, 'KeyV', 'keyboard');
				this.toggleOverlayResolutionMode();
			}
		}
		this.handleGlobalDebuggerHotkeys();
	}

	public get activeIdeFontVariant(): ConsoleFontVariant {
		return this._activeIdeFontVariant;
	}

	public set activeIdeFontVariant(variant: ConsoleFontVariant) {
		this._activeIdeFontVariant = variant;
		this.consoleMode.setFontVariant(variant);
		this.editor?.setFontVariant(variant);
	}

	private subscribeGlobalDebuggerHotkeys(): void {
		this.unsubscribeGlobalDebuggerHotkeys();
		const hub = $.platform.input;
		this.globalInputUnsubscribe = hub.subscribe((event) => this.onGlobalInputEvent(event));
	}

	private unsubscribeGlobalDebuggerHotkeys(): void {
		if (!this.globalInputUnsubscribe) {
			return;
		}
		const unsubscribe = this.globalInputUnsubscribe;
		this.globalInputUnsubscribe = null;
		unsubscribe();
	}

	private onGlobalInputEvent(event: InputEvt): void {
		if (event.type !== 'button' || event.code !== 'F8' || event.down !== true) {
			return;
		}
		const playerInput = $.input.getPlayerInput(this.playerIndex);

		const modifiers = playerInput.getModifiersState();
		if (modifiers.ctrl) {
			return;
		}
		const pressId = typeof event.pressId === 'number' ? event.pressId : null;
		const existing = this.consoleHotkeyLatch.get('debugger-f8-step') ?? null;
		if (pressId !== null) {
			if (existing === pressId) {
				return;
			}
			this.consoleHotkeyLatch.set('debugger-f8-step', pressId);
		} else if (existing === null) {
			return;
		} else {
			this.consoleHotkeyLatch.set('debugger-f8-step', null);
		}
		if (this.editor?.isActive !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		this.beginGlobalDebuggerStepping();
	}

	private handleGlobalDebuggerHotkeys(): boolean {
		if (this.shouldAcceptConsoleHotkey('debugger-f8-step', 'F8', KeyModifier.ctrl)) {
			$.consume_button(this.playerIndex, 'F8', 'keyboard');
			console.log(`[LuaDebugger] Global F8 hotkey detected (suspended=${this.luaDebuggerSuspension ? 'yes' : 'no'}).`);
			this.beginGlobalDebuggerStepping();
			return true;
		}
		return false;
	}

	private beginGlobalDebuggerStepping(): void {
		if (this.luaDebuggerSuspension) {
			console.log('[LuaDebugger] Global F8 step-over requested while suspended.');
			if (this.editor?.isActive !== true) {
				this.debuggerAutoActivateOnNextPause = true;
			}
			this.resumeDebugger('step_over');
			return;
		}
		const controller = this.luaDebuggerController;
		if (this.editor?.isActive !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		if (controller.hasActiveSteppingRequest()) {
			console.log('[LuaDebugger] Global F8 step already pending; waiting for next pause.');
			return;
		}
		console.log('[LuaDebugger] Global F8 step armed for next statement.');
		controller.requestStepInto();
	}

	private shouldAcceptConsoleHotkey(code: string, key: string, modifiers: KeyModifier): boolean {
		const state = $.get_key_state(this.playerIndex, key, modifiers);
		if (state.pressed !== true) {
			this.consoleHotkeyLatch.delete(code);
			return false;
		}
		if (typeof state.pressId === 'number') {
			const existing = this.consoleHotkeyLatch.get(code);
			if (existing === state.pressId) {
				return false;
			}
			this.consoleHotkeyLatch.set(code, state.pressId);
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		this.consoleHotkeyLatch.set(code, null);
		return true;
	}

	private toggleConsoleMode(): void {
		if (this.consoleMode.isActive) {
			this.deactivateConsoleMode(true);
			return;
		}
		this.activateConsoleMode();
	}

	private toggleEditor(): void {
		if (this.editor?.isActive === true) {
			this.editor.deactivate();
			return;
		}
		this.activateEditor();
	}

	public activateEditor(): void {
		if (!this.editor) {
			return;
		}
		if (this.consoleMode.isActive) {
			this.deactivateConsoleMode(false);
		}
		if (!this.editor?.isActive === true) {
			this.editor.activate();
		}

		this.updateOverlayState(this.consoleMode.isActive, this.editor?.isActive === true, true);
	}

	private registerConsoleShortcuts(): void {
		this.disposeShortcutHandlers();
		const registry = Input.instance.getGlobalShortcutRegistry();
		const disposers: Array<() => void> = [];
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, EDITOR_TOGGLE_KEY, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, CONSOLE_TOGGLE_KEY, () => this.toggleConsoleMode()));
		disposers.push(registry.registerGamepadChord(this.playerIndex, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, GAME_PAUSE_KEY, () => $.toggleDebuggerControls()));
		this.shortcutDisposers = disposers;
	}

	private disposeShortcutHandlers(): void {
		if (this.shortcutDisposers.length === 0) {
			return;
		}
		for (let i = 0; i < this.shortcutDisposers.length; i++) {
			this.shortcutDisposers[i]();
		}
		this.shortcutDisposers = [];
	}

	private activateConsoleMode(): void {
		if (this.consoleMode.isActive) {
			return;
		}
		if (this.editor?.isActive === true) {
			this.editor.deactivate();
		}
		this.consoleMode.activate();
	}

	private deactivateConsoleMode(_resumeGame: boolean): void {
		if (!this.consoleMode.isActive) {
			return;
		}
		this.consoleMode.deactivate();
	}

	public toggleOverlayResolutionMode(): 'offscreen' | 'viewport' {
		const next = this._overlayResolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
		this.overlayResolutionMode = next;
		return next;
	}

	private renderConsoleOverlay(): void {
		if (!this.consoleMode.isActive) {
			return;
		}
		this.overlayRenderBackend.beginFrame();
		this.consoleMode.draw(this.overlayRenderBackend, this.overlayRenderBackend.viewportSize);
		this.overlayRenderBackend.endFrame();
		this.overlayRenderedThisFrame = true;
	}

	private async advanceConsoleMode(deltaSeconds: number): Promise<void> {
		if (!this.consoleMode.isActive) {
			return;
		}
		this.consoleMode.update(deltaSeconds);
		const command = this.consoleMode.handleInput(deltaSeconds);
		if (command === null) {
			return;
		}
		await this.handleConsoleCommand(command);
	}

	private async handleConsoleCommand(rawCommand: string): Promise<void> {
		const input = rawCommand ?? '';
		this.consoleMode.setPromptPrefix(this.consoleCommands.getPrompt());
		this.consoleMode.appendPromptEcho(input);
		const trimmed = input.trim();
		if (trimmed.length > 0) {
			this.consoleMode.recordHistory(trimmed);
		}
		if (trimmed.length === 0) {
			return;
		}
		try {
			if (await this.consoleCommands.handle(trimmed)) {
				return;
			}
		} catch (error) {
			this.consoleMode.appendStderr(this.extractErrorMessage(error));
			return;
		}
		this.executeConsoleCommand(trimmed);
	}

	public set consoleJsStackEnabled(enabled: boolean) {
		this.includeJsStackTraces = enabled;
	}

	public get consoleJsStackEnabled(): boolean {
		return this.includeJsStackTraces;
	}

	private drawEditorFrame(editor: ConsoleCartEditor): void {
		this.overlayRenderBackend.beginFrame();
		try {
			editor.draw();
		} finally {
			this.overlayRenderBackend.endFrame();
		}
	}

	public continueFromConsole(): void {
		if (this.luaDebuggerSuspension) {
			this.resumeDebugger('continue');
		}
		this.deactivateConsoleMode(true);
	}

	private executeConsoleCommand(command: string): void {
		const source = this.prepareConsoleChunk(command);
		if (source.length === 0) {
			return;
		}
		const interpreter = this.luaInterpreter;

		// Temporarily redirect print output to console mode
		const previousOutputHandler = interpreter.outputHandler;
		interpreter.outputHandler = (text: string) => {
			this.consoleMode.appendStdout(text);
		};

		try {
			let results: LuaValue[] = [];
			try {
				results = interpreter.execute(source, 'console');
			}
			catch (error) {
				throw error;
			}
			if (results.length > 0) {
				const summary = results.map(value => this.consoleValueToString(value)).join('\t');
				this.consoleMode.appendStdout(summary);
			}
		}
		catch (error) {
			this.consoleMode.appendStderr(this.extractErrorMessage(error));
		}
		finally {
			// Restore previous output handler
			if (previousOutputHandler !== undefined) {
				interpreter.outputHandler = previousOutputHandler;
			} else {
				interpreter.outputHandler = null;
			}
		}
	}

	private prepareConsoleChunk(command: string): string {
		const trimmed = command.trim();
		if (trimmed.length === 0) {
			return '';
		}
		if (trimmed.startsWith('?')) {
			const expression = trimmed.slice(1).trim();
			return expression.length === 0 ? '' : `return ${expression}`;
		}
		if (trimmed.startsWith('=')) {
			const expression = trimmed.slice(1).trim();
			return expression.length === 0 ? '' : `return ${expression}`;
		}
		const rewritten = this.rewriteSingleArgumentCall(trimmed);
		if (rewritten) {
			return rewritten;
		}
		return trimmed;
	}

	private rewriteSingleArgumentCall(source: string): string | null {
		const match = source.match(/^([A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*)\s+(.+)$/);
		if (!match) {
			return null;
		}
		const callee = match[1];
		if (BmsxConsoleRuntime.CONSOLE_SINGLE_ARG_KEYWORDS.has(callee)) {
			return null;
		}
		const argument = match[2].trim();
		if (argument.length === 0 || argument.startsWith('=')) {
			return null;
		}
		if (argument.startsWith('--')) {
			return null;
		}
		return `${callee}(${argument})`;
	}

	public getSystemStatusLines(): string[] {
		const overlay = this.overlayViewportSize;
		const workspaceSaved = this.getWorkspaceSavedAssetIds().size;
		const workspaceDirty = this.workspaceLuaOverrides.size;
		const workspaceScratch = this.workspaceScratchPaths.size;
		const chunkLabel = this.luaChunkName ?? '<none>';
		const vmState = this.luaVmInitialized ? 'initialized' : 'not initialized';
		const suspension = this.luaDebuggerSuspension;
		const suspensionLocation = suspension
			? this.formatRuntimeErrorLocation(suspension.location.chunk, suspension.location.line, suspension.location.column)
			: null;
		const debuggerLabel = suspension ? `${suspension.reason} @ ${suspensionLocation ?? suspension.location.chunk}` : 'idle';
		const faultLabel = this.luaRuntimeFailed ? 'FAULTED' : 'OK';
		const root = this.resolveCartProjectRootPath();
		const lines: string[] = [];
		lines.push(`Cart: ${this.cart.meta.title} (${this.cart.meta.persistentId})`);
		lines.push(`Lua VM: ${vmState} | Entry: ${chunkLabel}`);
		lines.push(`Status: ${faultLabel} | Debugger: ${debuggerLabel}`);
		lines.push(`Canonicalization: ${this.canonicalization}`);
		lines.push(`Overlay: ${this.overlayResolutionMode} ${Math.round(overlay.width)}x${Math.round(overlay.height)}`);
		if (root) {
			lines.push(`Workspace root: ${root}`);
		}
		lines.push(`Workspace: dirty=${workspaceDirty} saved=${workspaceSaved} scratch=${workspaceScratch}`);
		const snapshot = this.faultSnapshot;
		if (snapshot) {
			const location = this.formatRuntimeErrorLocation(snapshot.chunkName, snapshot.line, snapshot.column);
			const when = new Date(snapshot.timestampMs).toISOString();
			const label = location ? `${location} - ${snapshot.message}` : snapshot.message;
			lines.push(`Last fault: ${label} @ ${when}`);
		} else {
			lines.push('Last fault: none recorded');
		}
		lines.push(`JS stack traces: ${this.consoleJsStackEnabled ? 'ON' : 'OFF'}`);
		return lines;
	}

	public getFaultStatusLines(): { lines: string[]; active: boolean } {
		const lines: string[] = [];
		const suspension = this.luaDebuggerSuspension;
		const faultInfo = this.faultSnapshot;
		const faultFlag = this.luaRuntimeFailed || (suspension !== null && suspension.reason === 'exception');
		lines.push(`Faulted: ${faultFlag ? 'YES' : 'NO'}`);
		if (suspension) {
			const suspensionLocation = this.formatRuntimeErrorLocation(
				suspension.location.chunk,
				suspension.location.line,
				suspension.location.column,
			);
			lines.push(`Debugger: ${suspension.reason} @ ${suspensionLocation ?? suspension.location.chunk}`);
		} else {
			lines.push('Debugger: idle');
		}
		if (faultInfo) {
			const location = this.formatRuntimeErrorLocation(faultInfo.chunkName, faultInfo.line, faultInfo.column);
			if (location) {
				lines.push(`Location: ${location}`);
			}
			lines.push(`Message: ${faultInfo.message}`);
			const stackLines = this.buildStackLines(faultInfo.details);
			const maxStackLines = 6;
			for (let index = 0; index < stackLines.length && index < maxStackLines; index += 1) {
				lines.push(stackLines[index]);
			}
			if (stackLines.length > maxStackLines) {
				lines.push(`... ${stackLines.length - maxStackLines} more frame(s)`);
			}
			lines.push(`Recorded: ${new Date(faultInfo.timestampMs).toISOString()}`);
			return { lines, active: faultFlag };
		}
		lines.push('No fault information recorded.');
		return { lines, active: faultFlag };
	}

	public clearFaultState(): { cleared: boolean; resumedDebugger: boolean } {
		const suspension = this.luaDebuggerSuspension;
		if (suspension && suspension.reason === 'exception') {
			this.resumeDebugger('ignore_exception');
			return { cleared: true, resumedDebugger: true };
		}
		if (this.luaRuntimeFailed || this.faultSnapshot) {
			this.luaRuntimeFailed = false;
			this.clearFaultSnapshot();
			this.luaInterpreter.clearLastFaultEnvironment();
			this.luaInterpreter.clearLastFaultCallStack();
			if (this.editor) {
				this.editor.clearRuntimeErrorOverlay();
			}
			publishOverlayFrame(null);
			return { cleared: true, resumedDebugger: false };
		}
		return { cleared: false, resumedDebugger: false };
	}

	private consoleValueToString(value: LuaValue, depth = 0, visited: Set<unknown> = new Set()): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? String(value) : 'nan';
		}
		if (typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return this.describeLuaTable(value, depth, visited);
		}
		if (isLuaNativeValue(value)) {
			return this.describeLuaNativeValue(value, depth, visited);
		}
		if (this.isLuaFunctionValue(value)) {
			return this.describeLuaFunctionValue(value);
		}
		return 'function';
	}

	private describeLuaFunctionValue(value: LuaFunctionValue): string {
		const name = value.name && value.name.length > 0 ? value.name : '<anonymous>';
		return `function ${name}`;
	}

	private describeLuaTable(table: LuaTable, depth: number, visited: Set<unknown>): string {
		if (visited.has(table) || depth >= CONSOLE_PREVIEW_MAX_DEPTH) {
			return '{…}';
		}
		visited.add(table);
		const entries = table.entriesArray();
		if (entries.length === 0) {
			return '{}';
		}
		const numeric = new Map<number, LuaValue>();
		const stringEntries: Array<{ key: string; value: LuaValue }> = [];
		const otherEntries: Array<{ key: string; value: LuaValue }> = [];
		for (let i = 0; i < entries.length; i += 1) {
			const [key, entryValue] = entries[i];
			if (typeof key === 'number' && Number.isInteger(key)) {
				numeric.set(key, entryValue);
				continue;
			}
			if (typeof key === 'string') {
				if (key === '__index' || key === '__metatable') {
					continue;
				}
				stringEntries.push({ key, value: entryValue });
				continue;
			}
			otherEntries.push({ key: this.consoleValueToString(key as LuaValue, depth + 1, visited), value: entryValue });
		}
		const sequentialValues: LuaValue[] = [];
		let seqIndex = 1;
		while (numeric.has(seqIndex)) {
			sequentialValues.push(numeric.get(seqIndex)!);
			seqIndex += 1;
		}
		const isPureSequence = sequentialValues.length === numeric.size && stringEntries.length === 0 && otherEntries.length === 0;
		if (isPureSequence) {
			return `[${this.formatValueList(sequentialValues, depth, visited)}${numeric.size > CONSOLE_PREVIEW_MAX_ENTRIES ? ', …' : ''}]`;
		}
		const parts: string[] = [];
		const limit = CONSOLE_PREVIEW_MAX_ENTRIES;
		let consumed = 0;
		const appendEntry = (label: string, entryValue: LuaValue): void => {
			if (consumed >= limit) {
				return;
			}
			parts.push(`${label} = ${this.consoleValueToString(entryValue, depth + 1, visited)}`);
			consumed += 1;
		};
		stringEntries.sort((a, b) => a.key.localeCompare(b.key));
		for (let i = 0; i < stringEntries.length && consumed < limit; i += 1) {
			const entry = stringEntries[i];
			appendEntry(entry.key, entry.value);
		}
		const numericKeys = Array.from(numeric.keys()).filter(key => key < 1 || key >= seqIndex);
		numericKeys.sort((a, b) => a - b);
		for (let i = 0; i < numericKeys.length && consumed < limit; i += 1) {
			const key = numericKeys[i];
			const val = numeric.get(key);
			if (val !== undefined) {
				appendEntry(`[${key}]`, val);
			}
		}
		for (let i = 0; i < otherEntries.length && consumed < limit; i += 1) {
			const entry = otherEntries[i];
			appendEntry(`[${entry.key}]`, entry.value);
		}
		if (sequentialValues.length > 0 && consumed < limit) {
			parts.push(`array = [${this.formatValueList(sequentialValues, depth, visited)}${sequentialValues.length > limit ? ', …' : ''}]`);
		}
		if (parts.length === 0) {
			return '{…}';
		}
		if (consumed >= limit || parts.length < stringEntries.length + numericKeys.length + otherEntries.length) {
			parts.push('…');
		}
		return `{ ${parts.join(', ')} }`;
	}

	private describeLuaNativeValue(value: LuaNativeValue, depth: number, visited: Set<unknown>): string {
		const native = value.native;
		const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : this.resolveNativeTypeName(native);
		if (visited.has(native) || depth >= CONSOLE_PREVIEW_MAX_DEPTH) {
			return `[${typeName ?? 'native'} …]`;
		}
		visited.add(native);
		if (Array.isArray(native)) {
			const preview = this.formatArrayPreview(native, depth + 1, visited);
			return `${typeName ?? 'array'} [${preview}]`;
		}
		if (typeof native === 'function') {
			const label = native.name && native.name.length > 0 ? native.name : '<anonymous>';
			return `[native function ${label}]`;
		}
		if (native && typeof native === 'object') {
			const entries = Object.getOwnPropertyNames(native).sort();
			const limit = Math.min(entries.length, CONSOLE_PREVIEW_MAX_ENTRIES);
			const parts: string[] = [];
			for (let i = 0; i < limit; i += 1) {
				const key = entries[i];
				let summary = '<unavailable>';
				try {
					const descriptor = (native as Record<string, unknown>)[key];
					summary = this.formatJsValue(descriptor, depth, visited);
				} catch (error) {
					summary = this.extractErrorMessage(error);
				}
				parts.push(`${key}: ${summary}`);
			}
			if (entries.length > limit) {
				parts.push('…');
			}
			return `${typeName ?? 'native'} { ${parts.join(', ')} }`;
		}
		return `${typeName ?? 'native'} ${String(native)}`;
	}

	private formatArrayPreview(values: unknown[], depth: number, visited: Set<unknown>): string {
		const preview: string[] = [];
		const limit = Math.min(values.length, CONSOLE_PREVIEW_MAX_ENTRIES);
		for (let i = 0; i < limit; i += 1) {
			preview.push(this.formatJsValue(values[i], depth, visited));
		}
		if (values.length > limit) {
			preview.push('…');
		}
		return preview.join(', ');
	}

	private formatValueList(values: LuaValue[], depth: number, visited: Set<unknown>): string {
		const parts: string[] = [];
		const limit = Math.min(values.length, CONSOLE_PREVIEW_MAX_ENTRIES);
		for (let i = 0; i < limit; i += 1) {
			parts.push(this.consoleValueToString(values[i], depth + 1, visited));
		}
		return parts.join(', ');
	}

	private formatJsValue(value: unknown, depth: number, visited: Set<unknown>): string {
		if (value === null) {
			return 'null';
		}
		if (Array.isArray(value)) {
			return `[${this.formatArrayPreview(value, depth + 1, visited)}]`;
		}
		const type = typeof value;
		if (type === 'string') {
			return `"${value}"`;
		}
		if (type === 'number' || type === 'boolean') {
			return String(value);
		}
		if (type === 'function') {
			const fn = value as Function;
			const label = fn.name && fn.name.length > 0 ? fn.name : '<anonymous>';
			return `[function ${label}]`;
		}
		if (isLuaTable(value)) {
			return this.describeLuaTable(value, depth + 1, visited);
		}
		if (isLuaNativeValue(value)) {
			return this.describeLuaNativeValue(value, depth + 1, visited);
		}
		if (value && typeof value === 'object') {
			if (visited.has(value)) {
				return '{…}';
			}
			visited.add(value);
			const entries = Object.keys(value as Record<string, unknown>).sort();
			const limit = Math.min(entries.length, CONSOLE_PREVIEW_MAX_ENTRIES);
			const parts: string[] = [];
			for (let i = 0; i < limit; i += 1) {
				const key = entries[i];
				let summary = '<unavailable>';
				try {
					summary = this.formatJsValue((value as Record<string, unknown>)[key], depth + 1, visited);
				} catch (error) {
					summary = this.extractErrorMessage(error);
				}
				parts.push(`${key}: ${summary}`);
			}
			if (entries.length > limit) {
				parts.push('…');
			}
			return `{ ${parts.join(', ')} }`;
		}
		return String(value);
	}

	private recordLuaWarning(message: string): void {
		this.pendingLuaWarnings.push(message);
		console.warn(message);
		this.flushLuaWarnings();
	}

	private flushLuaWarnings(): void {
		if (this.pendingLuaWarnings.length === 0) {
			return;
		}
		const messages = this.pendingLuaWarnings;
		this.pendingLuaWarnings = [];
		for (const warning of messages) {
			this.editor!.showWarningBanner(warning, 6.0);
		}
	}

	private resolveAssetIdFromPath(path: string | null | undefined): string | null {
		if (!path) {
			return null;
		}
		const normalized = path.replace(/\\/g, '/').toLowerCase();
		for (const [asset_id, sourcePath] of Object.entries($.rompack.luaSourcePaths)) {
			const candidate = sourcePath.replace(/\\/g, '/').toLowerCase();
			if (candidate === normalized) {
				return asset_id;
			}
		}
		return null;
	}

	private getResourceDescriptors(): ConsoleResourceDescriptor[] {
		return $.rompack.resourcePaths
			.map(entry => ({ path: entry.path, type: entry.type, asset_id: entry.asset_id }))
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
			const reason = this.extractErrorMessage(options.error);
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

	private updateOverlayState(includeConsole: boolean, includeEditor: boolean, force = false): void {
		if (!force && this.overlayState.console === includeConsole && this.overlayState.editor === includeEditor) {
			return;
		}
		this.overlayState = { console: includeConsole, editor: includeEditor };
		const anyOverlay = includeConsole || includeEditor;
		if (!anyOverlay) {
			publishOverlayFrame(null);
			OverlayPipelineController.setRequest('console', null);
			return;
		}
		api.set_render_backend(this.overlayRenderBackend);
		OverlayPipelineController.setRequest('console', {
			includeConsole,
			includeEditor,
			includePresentation: true,
		});
	}

	public async boot(): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'boot' });
		try {
			this.luaDebuggerSuspension = null;
			this.debuggerHaltsGame = false;
			this.setDebuggerPaused(false);
			this.luaRuntimeFailed = false;
			this.luaVmInitialized = false;
			this.clearFaultSnapshot();
			this.luaChunkResourceMap.clear();
			this.resourcePathCache.clear();
			this.invalidateLuaModuleIndex();
			this.luaChunkEnvironmentsByAssetId.clear();
			this.luaChunkEnvironmentsByChunkName.clear();
			this.luaGenericAssetsExecuted.clear();
			await this.refreshWorkspaceSources(false);
			if (this.editor) {
				this.editor.clearRuntimeErrorOverlay();
			}
			if (this.hasBooted) {
				await this.resetWorldState();
			}
			api.cartdata(this.cart.meta.persistentId);
			if (this.luaProgram) {
				this.bootLuaProgram({ runInit: true, runBoot: true });
			} else {
				this.resetLuaInteroperabilityState();
				this.cart.init(api);
				this.cart.boot(api);
			}
			this.resetFrameTiming();
			this.hasBooted = true;
			void this.applyServerWorkspaceDirtyLuaOverrides(true);
		}
		catch (error) {
			throw '[BmsxConsoleRuntime]: Failed to boot runtime: ' + error;
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	private async resetWorldState(): Promise<void> {
		this.abandonFrameState();
		ActionEffectRegistry.instance.clear();
		await $.reset_to_fresh_world({ preserveConsoleRuntime: true });
	}

	// Frame state is owned by the runtime: it is created per-frame, kept intact for debugger inspection on faults,
	// and only cleared via finalize/abandon during explicit reboot/reset flows.
	// Frame state is owned by the runtime and is always finalized/abandoned by the runtime; faults capture a snapshot for inspection.
	private beginFrameState(): ConsoleFrameState {
		if (this.currentFrameState) {
			throw new Error('[BmsxConsoleRuntime] Attempted to begin a new frame while another frame is active.');
		}
		const deltaSeconds = this.computeFrameDeltaSeconds();
		this.overlayRenderedThisFrame = false;
		const debugPaused = $.paused === true;
		const haltGame = debugPaused || this.debuggerHaltsGame;
		const state: ConsoleFrameState = {
			deltaSeconds,
			deltaForUpdate: haltGame ? 0 : deltaSeconds,
			editorActive: false,
			consoleActive: false,
			haltGame,
			debugPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			frameBegan: false,
			consoleEvaluated: false,
			editorEvaluated: false,
		};
		this.currentFrameState = state;
		return state;
	}

	private updateFrameHaltingState(state: ConsoleFrameState): void {
		const debugPaused = $.paused === true;
		state.debugPaused = debugPaused;
		const consoleActive = state.consoleEvaluated ? state.consoleActive : this.overlayState.console;
		const editorActive = state.editorEvaluated ? state.editorActive : this.overlayState.editor;
		const haltGame = debugPaused || this.debuggerHaltsGame || consoleActive || editorActive;
		state.haltGame = haltGame;
		state.deltaForUpdate = haltGame ? 0 : state.deltaSeconds;
		this.updateOverlayState(consoleActive, editorActive, false);
		Input.instance.setDebugHotkeysPaused(consoleActive || editorActive);
	}

	public runFrame(): void {
		if (!this.tickEnabled) {
			return;
		}
		let state: ConsoleFrameState | null = null;
		let fault: unknown = null;
		try {
			state = this.beginFrameState();
			this.runConsolePhase(state).then(() => {
				this.runEditorPhase(state);
				this.runUpdatePhaseInternal(state);
				this.runDrawPhaseInternal(state);
			});
		} catch (error) {
			fault = error;
			this.handleLuaError(error);
		} finally {
			if (fault !== null || this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	private async runConsolePhase(state: ConsoleFrameState): Promise<void> {
		this.pollConsoleHotkeys();
		await this.advanceConsoleMode(state.deltaSeconds);
		state.consoleEvaluated = true;
		state.consoleActive = this.consoleMode.isActive;
		this.updateFrameHaltingState(state);
	}

	private runEditorPhase(state: ConsoleFrameState): void {
		const editor = this.editor;
		if (editor && !state.consoleActive) {
			editor.update(state.deltaSeconds);
		}
		const editorActive = editor?.isActive === true && !state.consoleActive;
		state.editorEvaluated = true;
		state.editorActive = editorActive;
		this.updateFrameHaltingState(state);
	}

	private runUpdatePhaseInternal(state: ConsoleFrameState): void {
		this.handleGlobalDebuggerHotkeys();
		if (state.updateExecuted) {
			return;
		}
		if (state.editorActive) {
			state.updateExecuted = true;
			return;
		}
		if (!this.luaVmGate.ready) {
			state.updateExecuted = true;
			return;
		}
		if (state.luaFaulted || this.luaRuntimeFailed) {
			state.luaFaulted = true;
			state.updateExecuted = true;
			return;
		}
		if (state.haltGame) {
			state.updateExecuted = true;
			return;
		}
		try {
			if (this.luaProgram) {
				if (this.luaUpdateFunction !== null) {
					this.invokeLuaFunction(this.luaUpdateFunction, [state.deltaSeconds]);
				}
			} else {
				this.cart.update(api, state.deltaSeconds);
			}
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				state.luaFaulted = true;
				this.handleLuaError(error);
			}
		} finally {
			state.updateExecuted = true;
		}
	}

	private runDrawPhaseInternal(state: ConsoleFrameState): void {
		try {
			const editor = this.editor;
			const editorActive = state.editorActive;
			state.frameBegan = true;
			if (editorActive && editor) {
				this.drawEditorFrame(editor);
				this.finalizeFrame(true);
				return;
			}
			const luaFaulted = state.luaFaulted || this.luaRuntimeFailed;
			if (luaFaulted) {
				if (editorActive && editor) {
					this.drawEditorFrame(editor);
					this.finalizeFrame(true);
					return;
				}
				this.finalizeFrame(editorActive);
				return;
			}
			if (!this.luaVmGate.ready) {
				this.finalizeFrame(editorActive);
				return;
			}
			if (this.luaProgram) {
				try {
					if (this.luaDrawFunction !== null) {
						this.invokeLuaFunction(this.luaDrawFunction, []);
					}
				} catch (error) {
					if (isLuaDebuggerPauseSignal(error)) {
						this.onLuaDebuggerPause(error);
					} else {
						this.handleLuaError(error);
					}
					if (editorActive && editor) {
						this.drawEditorFrame(editor);
						this.finalizeFrame(true);
						return;
					}
					this.finalizeFrame(editorActive);
					return;
				}
			} else {
				this.cart.draw(api);
			}
			this.finalizeFrame(editorActive);
		} finally {
			this.currentFrameState = null;
		}
	}

	private finalizeFrame(editorActive: boolean): void {
		this.overlayRenderedThisFrame = editorActive;
		if (this.consoleMode.isActive) {
			this.renderConsoleOverlay();
		}
		if (!this.overlayRenderedThisFrame) {
			publishOverlayFrame(null);
		}
	}

	private computeFrameDeltaSeconds(): number {
		const now = $.platform.clock.now();
		let deltaMs = now - this.lastFrameTimestampMs;
		if (!Number.isFinite(deltaMs) || deltaMs < 0) {
			deltaMs = 0;
		}
		else if (deltaMs > BmsxConsoleRuntime.MAX_FRAME_DELTA_MS) {
			deltaMs = BmsxConsoleRuntime.MAX_FRAME_DELTA_MS;
		}
		this.lastFrameTimestampMs = now;
		return deltaMs / 1000;
	}

	public abandonFrameState(): void {
		const state = this.currentFrameState;
		if (!state) {
			return;
		}
		if (state.frameBegan) {
			publishOverlayFrame(null);
		}
		this.currentFrameState = null;
	}

	private resetFrameTiming(): void {
		this.lastFrameTimestampMs = $.platform.clock.now();
	}

	public override dispose(): void {
		this.disposeShortcutHandlers();
		this.consoleMode.deactivate();
		this.unsubscribeGlobalDebuggerHotkeys();
		this.updateOverlayState(false, false, true);
		this.luaVmInitialized = false;
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
		this.luaInterpreter = null;
		super.dispose();
		if (BmsxConsoleRuntime._instance === this) {
			BmsxConsoleRuntime._instance = null;
		}
	}

	private initializeEditor(): void {
		if (!this.luaProgram) {
			if (this.editor) {
				this.editor.shutdown();
			}
			this.editor = null;
			this.disposeShortcutHandlers();
			return;
		}
		const viewportSize = this.overlayViewportSize;
		const viewport = { width: viewportSize.width, height: viewportSize.height };
		// Check the primary asset ID for the currently loaded program
		// Note that this can be null if the program was not loaded from source or has not been saved yet (then the type is BmsxConsoleLuaInlineProgram)!
		const entryAssetId = this.resolveEntryAsset(this.luaProgram).asset_id;
		this.editor = createConsoleCartEditor({
			playerIndex: this.playerIndex,
			metadata: this.cart.meta,
			viewport,
			canonicalization: this.canonicalization,
			loadSource: () => this.luaProgram ? this.getProgramEntrySource(this.luaProgram) : '',
			saveSource: (source: string) => this.saveLuaProgram(source),
			listResources: () => this.getResourceDescriptors(),
			loadLuaResource: (asset_id: string) => $.rompack.lua[asset_id],
			saveLuaResource: (asset_id: string, source: string) => this.saveLuaResourceSource(asset_id, source),
			createLuaResource: (request) => this.createLuaResource(request),
			inspectLuaExpression: (request: ConsoleLuaHoverRequest) => this.inspectLuaExpression(request),
			listLuaObjectMembers: (request) => this.listLuaObjectMembers(request),
			listLuaModuleSymbols: (moduleName) => this.listLuaModuleSymbols(moduleName),
			entryAssetId: entryAssetId,
			listLuaSymbols: (asset_id: string | null, chunkName: string | null) => this.listLuaSymbols(asset_id, chunkName),
			listGlobalLuaSymbols: () => this.listAllLuaSymbols(),
			listBuiltinLuaFunctions: () => this.listLuaBuiltinFunctions(),
			fontVariant: this._activeIdeFontVariant,
			workspaceRootPath: this.resolveCartProjectRootPath(),
			themeVariant: this.cart.meta.ideTheme,
		});
		this.flushLuaWarnings();
		this.registerConsoleShortcuts();
	}

	public get state(): BmsxConsoleState | undefined {
		const storage = this.storage.dump();
		const vmState = this.captureVmState();
		const state: BmsxConsoleState = {
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaChunkName: this.luaChunkName,
			storage,
		};
		if (vmState) {
			if (vmState.globals) {
				state.luaGlobals = vmState.globals;
			}
			if (vmState.locals) {
				state.luaLocals = vmState.locals;
			}
			if (vmState.randomSeed !== undefined) {
				state.luaRandomSeed = vmState.randomSeed;
			}
		}
		return state;
	}

	public set state(state: BmsxConsoleState) {
		if (!state) this.resetRuntimeToFreshState();
		this.restoreFromStateSnapshot(state);
	}

	private async resetRuntimeToFreshState() {
		const asset = this.resolveEntryAsset(this.luaProgram);
		this.workspaceLuaOverrides.delete(asset.asset_id);
		this.luaChunkName = this.resolveProgramEntryChunkName(this.luaProgram);
		this.luaVmInitialized = false;
		await this.boot();
	}

	private restoreFromStateSnapshot(snapshot: BmsxConsoleState): void {
		this.clearActiveDebuggerPause();
		// The editor deliberately clears luaRuntimeFailed before calling setState when the
		// user hits "Resume". That signal tells us to keep the script environment but otherwise
		// treat the operation as a soft reboot: user code should rerun init/update hooks while
		// engine state (world objects, physics, etc.) stays untouched unless the cart's own
		// logic rebuilds it. The fallback snapshot populated above is only meant to reapply
		// plain Lua globals/locals so the user's script logic can pick up right where it left
		// off. It is not a save-state, and it intentionally skips anything that needs engine
		// cooperation to restore.
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;

		api.cartdata(this.cart.meta.persistentId);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}

		this.luaRuntimeFailed = false;
		const shouldRunInit = this.shouldRunInitForSnapshot(snapshot);
		this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: shouldRunInit, hotReload: false });

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor?.isActive === true, true);
		this.redrawAfterStateRestore();
	}

	public resumeFromSnapshot(state: unknown): void {
		this.clearActiveDebuggerPause();
		if (!state) {
			this.luaRuntimeFailed = false;
			throw new Error('[BmsxConsoleRuntime] Cannot resume from invalid state snapshot.');
		}
		const originalSnapshot = state as BmsxConsoleState;
		const snapshot: BmsxConsoleState = { ...originalSnapshot, luaRuntimeFailed: false };
		// Clear any previous error overlays and interpreter fault markers so a fresh
		// resume starts clean and can report new errors normally.
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		this.luaInterpreter.clearLastFaultEnvironment();
		this.luaInterpreter.clearLastFaultCallStack();

		// Also clear dedupe set so subsequent errors surface again after resume.
		this.handledLuaErrors = new WeakSet<object>();
		// Clear flag and any queued overlay frame before we resume swapping handlers.
		this.luaRuntimeFailed = false;
		publishOverlayFrame(null);
		void this.refreshWorkspaceSources(false);
		this.processPendingLuaAssets('resume');
		this.resumeLuaProgramState(snapshot, { runInit: true });
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor?.isActive === true, true);
		this.redrawAfterStateRestore();
		this.clearFaultSnapshot();
		this.luaVmInitialized = this.luaInterpreter !== null;
	}

	private hotReloadProgramEntry(params: BmsxConsoleLuaPrimaryAssetWithSource): void {
		const program = this.luaProgram;
		const canonicalChunk = this.canonicalizeProgramEntryChunkName(program, params.chunkName);
		const previousChunkState = this.captureChunkState(canonicalChunk);
		const previousChunkTables = this.captureChunkTables(canonicalChunk);
		const previousGlobals = this.captureGlobalStateForReload();
		const interpreter = this.luaInterpreter;
		const entryAsset = this.resolveEntryAsset(program, canonicalChunk);
		let entryAssetId: string | null = params.asset_id || entryAsset.asset_id;
		const normalizedChunk = this.normalizeChunkName(canonicalChunk);
		const hotModuleId = this.moduleIdFor(entryAssetId, canonicalChunk);
		interpreter.clearLastFaultEnvironment();
		const results = interpreter.execute(params.source, canonicalChunk);
		this.wrapLuaExecutionResults(hotModuleId, results);
		this.cacheChunkEnvironment(canonicalChunk, entryAssetId, hotModuleId);
		this.restoreChunkState(interpreter.chunkEnvironment, previousChunkState);
		this.restoreChunkTables(interpreter.chunkEnvironment, previousChunkTables);
		this.restoreGlobalStateForReload(previousGlobals);
		this.rebindChunkEnvironmentHandlers(hotModuleId);
		this.bindLifecycleHandlers();
		this.luaRuntimeFailed = false;
		this.luaChunkName = canonicalChunk;
		this.luaVmInitialized = true;
		const hotSource = params.source;
		this.refreshLuaHandlersForChunk(normalizedChunk, hotSource);
		this.refreshLuaModulesOnResume(normalizedChunk);
		this.clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private bindLifecycleHandlers(): void {
		const env = this.luaInterpreter.globalEnvironment;
		this.luaBootFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'boot' as LifeCycleHandlerName));
		this.luaInitFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'init' as LifeCycleHandlerName));
		this.luaUpdateFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'update' as LifeCycleHandlerName));
		this.luaDrawFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, 'draw' as LifeCycleHandlerName));
	}

	private runLuaLifecycleHandler(kind: 'init' | 'boot'): boolean {
		const fn = kind === 'init' ? this.luaInitFunction : this.luaBootFunction;
		if (fn === null) {
			return true;
		}
		try {
			this.invokeLuaFunction(fn, []);
			return true;
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
			return false;
		}
	}

	private reloadLuaProgramState(source: string, chunkName: string, asset_id?: string): void {
		const program = this.luaProgram!;
		const canonicalChunk = this.canonicalizeProgramEntryChunkName(program, chunkName);
		const programAssetId = asset_id ?? this.resolveEntryAsset(program, canonicalChunk).asset_id;
		this.applyProgramEntrySourceToCartridge(source, canonicalChunk, programAssetId);
		this.luaChunkName = canonicalChunk;
		if (!this.luaInterpreter) {
			this.bootLuaProgram({ runInit: false, runBoot: false });
		}
		else {
			this.hotReloadProgramEntry({ asset_id: programAssetId, source, chunkName: canonicalChunk });
		}
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor?.isActive === true, true);
		this.redrawAfterStateRestore();
		this.luaVmInitialized = this.luaInterpreter !== null;
	}

	private shouldRunInitForSnapshot(snapshot: BmsxConsoleState): boolean {
		return snapshot.luaRuntimeFailed !== true;
	}

	private resumeLuaProgramState(snapshot: BmsxConsoleState, options: { runInit: boolean }): void {
		const program = this.luaProgram;
		if (!program) {
			throw new Error('[BmsxConsoleRuntime] No Lua program available for resume.');
		}
		if (!this.luaInterpreter) {
			this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: options.runInit, hotReload: false });
			return;
		}

		this.processPendingLuaAssets('resume');

		const targetChunkName = this.canonicalizeProgramEntryChunkName(program, snapshot.luaChunkName ?? null);
		const normalizedTarget = this.normalizeChunkName(targetChunkName);
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const shouldRunInit = options.runInit && !savedRuntimeFailed;
		let source: string;
		try {
			source = this.getProgramEntrySource(program);
		}
		catch (error) {
			throw this.normalizeError(error);
		}
		this.applyProgramEntrySourceToCartridge(source, targetChunkName);
		this.luaChunkName = targetChunkName;
		try {
			this.hotReloadProgramEntry({ source, chunkName: targetChunkName });
		}
		catch (error) {
			this.handleLuaError(error);
		}
		this.refreshLuaModulesOnResume(normalizedTarget);
		this.clearNativeMemberCompletionCache();
		if (shouldRunInit) {
			this.runLuaLifecycleHandler('init');
		}
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: BmsxConsoleState, options: { runInit: boolean; hotReload: boolean }): void {
		const program = this.luaProgram;
		const targetChunkName = this.canonicalizeProgramEntryChunkName(program, snapshot.luaChunkName ?? null);
		let source: string;
		try {
			source = this.getProgramEntrySource(program);
		}
		catch (error) {
			throw this.normalizeError(error);
		}

		this.applyProgramEntrySourceToCartridge(source, targetChunkName);
		this.luaChunkName = targetChunkName;

		this.initializeLuaInterpreterFromSnapshot({
			source,
			chunkName: targetChunkName,
			snapshot,
			runInit: options.runInit,
			hotReload: options.hotReload,
		});
		this.clearNativeMemberCompletionCache();
	}

	private refreshLuaModulesOnResume(resumeModuleId: string | null): void {
		const modules = new Set<string>();
		const normalizedResume = resumeModuleId ? this.normalizeChunkName(resumeModuleId) : null;

		const pushModule = (moduleId: string | null | undefined): void => {
			if (!moduleId) {
				return;
			}
			const normalized = this.normalizeChunkName(moduleId);
			if (normalizedResume && normalized === normalizedResume) {
				return;
			}
			modules.add(normalized);
		};

		for (const chunkName of this.luaChunkResourceMap.keys()) {
			pushModule(chunkName);
		}

		if (modules.size === 0) {
			return;
		}
		for (const moduleId of modules) {
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private rebindChunkEnvironmentHandlers(moduleId: string): void {
		const env = this.luaInterpreter?.chunkEnvironment;
		if (!env) {
			throw new Error('[BmsxConsoleRuntime] No Lua environment available for rebind.');
		}
		const visited = new WeakSet<LuaTable>();
		for (const [key, value] of env.entries()) {
			const path = [key];
			if (value !== null && value !== undefined) {
				this.rebindHandlersFromLuaValue(moduleId, value, path, visited);
			}
		}
	}

	private rebindHandlersFromLuaValue(
		moduleId: string,
		value: LuaValue,
		path: ReadonlyArray<string>,
		visited: WeakSet<LuaTable>,
	): void {
		if (this.isLuaFunctionValue(value)) {
			this.luaHandlerCache.rebind(moduleId, path, value);
			return;
		}
		if (!isLuaTable(value)) {
			return;
		}
		const table = value as LuaTable;
		if (visited.has(table)) {
			return;
		}
		visited.add(table);
		for (const [rawKey, entry] of table.entriesArray()) {
			const segment = typeof rawKey === 'string' ? rawKey : String(rawKey);
			const nextPath = path.length === 0 ? [segment] : [...path, segment];
			this.rebindHandlersFromLuaValue(moduleId, entry, nextPath, visited);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; chunkName: string; snapshot: BmsxConsoleState; runInit: boolean; hotReload: boolean }): void {
		if (params.hotReload) {
			this.hotReloadProgramEntry({ source: params.source, chunkName: params.chunkName });
			return;
		}

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter(this.canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaInitFunction = null;
		this.luaBootFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaRuntimeFailed = false;

		const program = this.luaProgram;
		let programasset_id: string | null = null;
		if (program) {
			const asset = this.resolveEntryAsset(program, params.chunkName);
			this.registerProgramChunk(asset, params.chunkName);
			programasset_id = asset.asset_id;
		}

		this.registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);

		const moduleId = this.moduleIdFor(programasset_id, params.chunkName);
		const results = interpreter.execute(params.source, params.chunkName);
		this.wrapLuaExecutionResults(moduleId, results);
		if (program) {
			this.cacheChunkEnvironment(params.chunkName, programasset_id, moduleId);
		}
		this.luaVmInitialized = true;

		this.bindLifecycleHandlers();

		const snapshot = params.snapshot;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		if (params.runInit && !savedRuntimeFailed) {
			this.runLuaLifecycleHandler('init');
		}
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private redrawAfterStateRestore(): void {
		if (this.luaProgram) {
			if (this.luaRuntimeFailed) {
				return;
			}
			if (this.luaDrawFunction !== null) {
				try {
					this.invokeLuaFunction(this.luaDrawFunction, []);
				}
				catch (error) {
					if (isLuaDebuggerPauseSignal(error)) {
						this.onLuaDebuggerPause(error);
					} else {
						this.handleLuaError(error);
					}
				}
			}
			return;
		}
		this.cart.draw(api);
	}

	private clearEditorErrorOverlaysIfNoFault(): void {
		if (this.luaRuntimeFailed) return;
		this.editor.clearRuntimeErrorOverlay();
		publishOverlayFrame(null);
	}

	private recordFaultSnapshot(payload: {
		message: string;
		chunkName: string | null;
		line: number | null;
		column: number | null;
		details: RuntimeErrorDetails | null;
		fromDebugger: boolean;
	}): FaultSnapshot {
		const snapshot: FaultSnapshot = {
			message: payload.message,
			chunkName: payload.chunkName,
			line: payload.line,
			column: payload.column,
			details: payload.details,
			timestampMs: $.platform.clock.now(),
			fromDebugger: payload.fromDebugger,
		};
		this.faultSnapshot = snapshot;
		this.faultOverlayNeedsFlush = true;
		return snapshot;
	}

	private clearFaultSnapshot(): void {
		this.faultSnapshot = null;
		this.faultOverlayNeedsFlush = false;
	}

	private recordDebuggerExceptionFault(signal: LuaDebuggerPauseSignal): void {
		const interpreter = this.luaInterpreter;
		const exception = interpreter?.consumeLastDebuggerException?.() ?? null;
		if (this.faultSnapshot && this.luaRuntimeFailed) {
			this.faultOverlayNeedsFlush = true;
			return;
		}
		const signalLine = fallbackclamp(signal.location.line, 1, Number.MAX_SAFE_INTEGER, null);
		const signalColumn = fallbackclamp(signal.location.column, 1, Number.MAX_SAFE_INTEGER, null);
		if (!exception) {
			this.luaRuntimeFailed = true;
			this.recordFaultSnapshot({
				message: 'Runtime error',
				chunkName: signal.location.chunk,
				line: signalLine,
				column: signalColumn,
				details: this.buildRuntimeErrorDetailsForEditor(null, 'Runtime error'),
				fromDebugger: true,
			});
			return;
		}
		const message = this.extractErrorMessage(exception);
		let chunkName: string | null = exception.chunkName ?? null;
		if (!chunkName || chunkName.length === 0) {
			chunkName = signal.location.chunk;
		}
		const normalizedLine = fallbackclamp(exception.line, 1, Number.MAX_SAFE_INTEGER, null);
		const normalizedColumn = fallbackclamp(exception.column, 1, Number.MAX_SAFE_INTEGER, null);
		this.luaRuntimeFailed = true;
		this.recordFaultSnapshot({
			message,
			chunkName,
			line: normalizedLine ?? signalLine,
			column: normalizedColumn ?? signalColumn,
			details: this.buildRuntimeErrorDetailsForEditor(exception, message),
			fromDebugger: true,
		});
	}

	private formatRuntimeErrorLocation(chunkName: string | null, line: number | null, column: number | null): string | null {
		let label = chunkName && chunkName.length > 0 ? chunkName : null;
		if (line !== null) {
			const suffix = column !== null ? `${line}:${column}` : `${line}`;
			label = label ? `${label}:${suffix}` : suffix;
		}
		return label;
	}

	private formatRuntimeStackFrameForConsole(frame: StackTraceFrame): string {
		const origin = frame.origin === 'lua' ? 'Lua' : 'JS';
		let name = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '';
		if (name.length === 0 && frame.raw && frame.raw.length > 0) {
			name = frame.raw;
		}
		if (name.length === 0 && frame.source && frame.source.length > 0) {
			name = frame.source;
		}
		if (name.length === 0) {
			name = '(anonymous)';
		}
		let location = '';
		if (frame.source && frame.source.length > 0) {
			location = frame.source;
		}
		if (frame.line !== null) {
			location = location.length > 0 ? `${location}:${frame.line}` : `${frame.line}`;
			if (frame.column !== null) {
				location += `:${frame.column}`;
			}
		}
		return location.length > 0 ? `[${origin}] ${name} (${location})` : `[${origin}] ${name}`;
	}

	private buildStackLines(details: RuntimeErrorDetails | null): string[] {
		if (!details) {
			return [];
		}
		const frames: StackTraceFrame[] = [];
		for (let index = 0; index < details.luaStack.length; index += 1) {
			frames.push(details.luaStack[index]);
		}
		if (this.includeJsStackTraces) {
			for (let index = 0; index < details.jsStack.length; index += 1) {
				frames.push(details.jsStack[index]);
			}
		}
		if (frames.length === 0) {
			return [];
		}
		const lines: string[] = ['Stack trace:'];
		for (let index = 0; index < frames.length; index += 1) {
			const frame = frames[index];
			lines.push(`  ${this.formatRuntimeStackFrameForConsole(frame)}`);
		}
		return lines;
	}

	private presentRuntimeErrorInConsole(
		chunkName: string | null,
		line: number | null,
		column: number | null,
		message: string,
		details: RuntimeErrorDetails | null,
	): void {
		const location = this.formatRuntimeErrorLocation(chunkName, line, column);
		const headline = location ? `Runtime error at ${location}: ${message}` : `Runtime error: ${message}`;
		this.consoleMode.appendStderr(headline);
		const stackLines = this.buildStackLines(details);
		for (let index = 0; index < stackLines.length; index += 1) {
			this.consoleMode.appendStderr(stackLines[index]);
		}
	}

	private async saveLuaResourceSource(asset_id: string, source: string): Promise<void> {
		const cartPath = $.rompack.luaSourcePaths[asset_id];
		const filesystemPath = this.resolveFilesystemPathForCartPath(cartPath!);
		await this.persistLuaSourceToFilesystem(filesystemPath, source);
		const rompack = $.rompack;
		rompack.lua[asset_id] = source;
		const normalizedPath = cartPath.replace(/\\/g, '/');
		const chunkName = `@${normalizedPath}`;
		this.registerLuaChunkResource(chunkName, { asset_id, path: normalizedPath });
		this.luaGenericAssetsExecuted.delete(asset_id);
		this.updateWorkspaceOverrideMap(asset_id, source, normalizedPath);
	}

	private async createLuaResource(request: ConsoleLuaResourceCreationRequest): Promise<ConsoleResourceDescriptor> {
		if (!request || typeof request.path !== 'string') {
			throw new Error('[BmsxConsoleRuntime] Path must be provided to create a Lua resource.');
		}
		const rompack = $.rompack;
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
		let asset_id = '';
		if (typeof request.asset_id === 'string' && request.asset_id.trim().length > 0) {
			asset_id = request.asset_id.trim();
		} else {
			asset_id = baseName;
		}
		if (asset_id.length === 0) {
			throw new Error('[BmsxConsoleRuntime] Unable to infer Lua asset id for new resource.');
		}
		if (asset_id in rompack.lua) {
			throw new Error(`[BmsxConsoleRuntime] Lua asset '${asset_id}' already exists.`);
		}
		if (!Array.isArray(rompack.resourcePaths)) {
			rompack.resourcePaths = [];
		}
		for (let i = 0; i < rompack.resourcePaths.length; i += 1) {
			const entry = rompack.resourcePaths[i];
			const entryPath = entry.path ? entry.path.replace(/\\/g, '/') : '';
			if (entry.asset_id === asset_id) {
				throw new Error(`[BmsxConsoleRuntime] Resource for asset '${asset_id}' already exists.`);
			}
			if (entryPath === normalizedPath) {
				throw new Error(`[BmsxConsoleRuntime] Resource at path '${normalizedPath}' already exists.`);
			}
		}
		rompack.lua[asset_id] = contents;
		rompack.luaSourcePaths[asset_id] = normalizedPath;

		const filesystemPath = this.resolveFilesystemPathForCartPath(normalizedPath);
		await this.persistLuaSourceToFilesystem(filesystemPath, contents);
		const resourceEntry: RomResourcePath = { path: normalizedPath, type: 'lua', asset_id };
		rompack.resourcePaths.push(resourceEntry);
		rompack.resourcePaths.sort((left, right) => left.path.localeCompare(right.path));
		this.resourcePathCache.set(asset_id, normalizedPath);
		this.registerLuaChunkResource(normalizedPath, { asset_id: asset_id, path: normalizedPath });
		this.luaGenericAssetsExecuted.delete(asset_id);
		this.updateWorkspaceOverrideMap(asset_id, contents, normalizedPath);
		const descriptor: ConsoleResourceDescriptor = { path: normalizedPath, type: 'lua', asset_id };
		return descriptor;
	}

	private captureVmState(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number } | null {
		const interpreter = this.luaInterpreter;
		if (!this.luaVmInitialized || !interpreter?.chunkEnvironment) return null;
		const globals = this.captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
		const locals = this.captureLuaEntryCollection(interpreter.enumerateChunkEntries());
		const randomSeed = interpreter.getRandomSeed();
		return {
			globals: globals,
			locals: locals,
			randomSeed: randomSeed,
		};
	}

	private captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot | null {
		// The console editor uses this fallback snapshot when a cart does not expose
		// __bmsx_snapshot_save/__bmsx_snapshot_load. It exists purely to let the editor
		// "resume" after a runtime failure without rebooting the whole cart. Unlike a
		// deterministic save-state we only grab plain Lua data that can be faithfully
		// re-injected; anything that represents a live engine object gets silently skipped.
		// (That includes tables that still reference __js_handle__ values returned by API
		// calls or registry lookups.) We deliberately do not warn about those omissions,
		// because they are expected for this best-effort workflow: the goal of resume is to
		// recover user script state, not to clone world entities or engine internals.
		if (!entries || entries.length === 0) {
			return null;
		}
		const ctx = this.createLuaSnapshotContext();
		const snapshotRoot: Record<string, unknown> = {};
		let count = 0;
		for (const [name, value] of entries) {
			if (this.shouldSkipLuaSnapshotEntry(name, value)) {
				continue;
			}
			try {
				const serialized = this.serializeLuaValueForSnapshot(value, ctx);
				snapshotRoot[name] = serialized;
				count += 1;
			}
			catch (error) {
				console.warn(`[BmsxConsoleRuntime] Skipped Lua snapshot entry '${name}':`, error);
			}
		}
		return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
	}

	private captureChunkState(chunkName: string): LuaEntrySnapshot | null {
		const env = this.resolveChunkEnvironment(chunkName);
		return this.captureLuaEntryCollection(env.entries());
	}

	private captureChunkTables(chunkName: string): Map<string, LuaTable> {
		const env = this.resolveChunkEnvironment(chunkName);
		const tables = new Map<string, LuaTable>();
		for (const [name, value] of env.entries()) {
			if (typeof name === 'string' && isLuaTable(value)) {
				tables.set(name, value);
			}
		}
		return tables;
	}

	private restoreChunkState(env: LuaEnvironment | null, snapshot: LuaEntrySnapshot | null): void {
		if (!env || !snapshot) {
			return;
		}
		const entries = this.materializeLuaEntrySnapshot(snapshot);
		for (const [name, value] of entries) {
			if (!name) {
				continue;
			}
			const existing = env.get(name);
			if (this.isLuaFunctionValue(existing)) {
				continue;
			}
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.applyLuaTableSnapshot(existing, value);
				continue;
			}
			env.set(name, value);
		}
	}

	private restoreChunkTables(env: LuaEnvironment | null, previousTables: Map<string, LuaTable>): void {
		if (!env || previousTables.size === 0) {
			return;
		}
		const visited = new WeakSet<LuaTable>();
		for (const [name, freshValue] of env.entries()) {
			if (typeof name !== 'string' || !isLuaTable(freshValue)) {
				continue;
			}
			const previous = previousTables.get(name);
			if (!previous) {
				continue;
			}
			this.mergeLuaTablePreservingState(previous, freshValue, visited);
			env.set(name, previous);
		}
	}

	private captureGlobalStateForReload(): LuaEntrySnapshot | null {
		return this.captureLuaEntryCollection(this.luaInterpreter.enumerateGlobalEntries());
	}

	private restoreGlobalStateForReload(globals: LuaEntrySnapshot | null): void {
		if (!globals) {
			return;
		}
		const entries = this.materializeLuaEntrySnapshot(globals);
		for (const [name, value] of entries) {
			if (!name || this.apiFunctionNames.has(name) || BmsxConsoleRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			const existing = this.luaInterpreter.getGlobal(name);
			if (this.isLuaFunctionValue(existing)) {
				continue;
			}
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.applyLuaTableSnapshot(existing, value);
				continue;
			}
			this.luaInterpreter.setGlobal(name, value);
		}
	}

	private shouldSkipLuaSnapshotEntry(name: string, value: LuaValue): boolean {
		if (!name || this.apiFunctionNames.has(name)) {
			return true;
		}
		if (BmsxConsoleRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			return true;
		}
		if (isLuaNativeValue(value)) {
			return true;
		}
		if (this.isLuaFunctionValue(value)) {
			return true;
		}
		return false;
	}

	private isLuaFunctionValue(value: unknown): value is LuaFunctionValue {
		if (!value || typeof value !== 'object') {
			return false;
		}
		return typeof (value as { call?: unknown }).call === 'function';
	}

	private resolveChunkEnvironment(chunkName: string): LuaEnvironment {
		const normalized = this.normalizeChunkName(chunkName);
		let env = this.luaChunkEnvironmentsByChunkName.get(normalized);
		if (!env) {
			const info = this.lookupChunkResourceInfo(normalized);
			if (info?.asset_id) {
				env = this.luaChunkEnvironmentsByAssetId.get(info.asset_id) ?? null;
				if (!env && info.path) {
					const canonicalChunk = this.resolveLuaModuleChunkName(info.asset_id, info.path);
					env = this.luaChunkEnvironmentsByChunkName.get(this.normalizeChunkName(canonicalChunk)) ?? null;
				}
			}
		}
		if (!env) {
			throw new Error(`[BmsxConsoleRuntime] Missing chunk environment for '${chunkName}'.`);
		}
		return env;
	}

	// private copyLuaTableInPlace(target: LuaTable, source: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
	// 	if (visited.has(target)) {
	// 		return;
	// 	}
	// 	visited.add(target);
	// 	target.setMetatable(source.getMetatable());
	// 	for (const [key] of target.entriesArray()) {
	// 		if (!source.has(key)) {
	// 			target.set(key, null);
	// 		}
	// 	}
	// 	for (const [key, value] of source.entriesArray()) {
	// 		const current = target.get(key);
	// 		if (isLuaTable(current) && isLuaTable(value)) {
	// 			this.copyLuaTableInPlace(current, value, visited);
	// 			continue;
	// 		}
	// 		target.set(key, value);
	// 	}
	// }

	private applyLuaTableSnapshot(target: LuaTable, snapshot: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
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

	private mergeLuaTablePreservingState(target: LuaTable, fresh: LuaTable, visited: WeakSet<LuaTable> = new WeakSet()): void {
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
			if (this.isLuaFunctionValue(freshValue)) {
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
			if (current === null || this.isLuaFunctionValue(current)) {
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
			if (this.isLuaFunctionValue(value) && !seenKeys.has(key)) {
				target.set(key, null);
			}
		}
	}

	private createLuaSnapshotContext(): LuaSnapshotContext {
		return { ids: new WeakMap<LuaTable, number>(), objects: {}, nextId: 1 };
	}

	private serializeLuaValueForSnapshot(value: LuaValue, ctx: LuaSnapshotContext): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaNativeValue(value)) {
			const encoded = this.snapshotEncodeNative(value.native);
			return encoded !== undefined ? encoded : null;
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

	private shouldSkipLuaSnapshotMetamethodKey(key: string): boolean {
		return key.toLowerCase() === '__index';
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
			if (this.isLuaFunctionValue(entryValue)) {
				continue;
			}
			if (typeof key === 'string' && this.shouldSkipLuaSnapshotMetamethodKey(key)) {
				continue;
			}
			let serializedEntry: unknown;
			try {
				if (isLuaNativeValue(entryValue)) {
					const encoded = this.snapshotEncodeNative(entryValue.native);
					if (encoded === undefined) {
						continue;
					}
					serializedEntry = encoded;
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

	private serializeLuaSnapshotKey(key: LuaValue, ctx: LuaSnapshotContext): unknown {
		if (key === null || typeof key === 'boolean' || typeof key === 'number' || typeof key === 'string') {
			return key;
		}
		if (isLuaNativeValue(key)) {
			return this.snapshotEncodeNative(key.native);
		}
		if (this.isLuaFunctionValue(key)) {
			return undefined;
		}
		if (isLuaTable(key)) {
			return this.serializeLuaTableForSnapshot(key, ctx);
		}
		return this.serializeLuaValueForSnapshot(key, ctx);
	}

	private deserializeLuaSnapshotKey(raw: unknown, resolver?: (value: unknown) => LuaValue): LuaValue {
		if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
			return raw as LuaValue;
		}
		if (typeof raw === 'object' && raw !== null) {
			const decoded = this.snapshotDecodeNative(raw);
			if (decoded) {
				return this.wrapNativeValue(decoded);
			}
		}
		if (resolver) {
			return resolver(raw);
		}
		return this.jsToLua(raw);
	}

	private isLuaSnapshotGraph(value: unknown): value is LuaSnapshotGraph {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const record = value as Record<string, unknown>;
		return Object.prototype.hasOwnProperty.call(record, 'root') && Object.prototype.hasOwnProperty.call(record, 'objects');
	}

	private materializeLuaEntrySnapshot(snapshot: LuaEntrySnapshot): Array<[string, LuaValue]> {
		if (this.isLuaSnapshotGraph(snapshot)) {
			return this.deserializeLuaSnapshotGraph(snapshot);
		}
		const entries: Array<[string, LuaValue]> = [];
		for (const [name, value] of Object.entries(snapshot)) {
			entries.push([name, this.jsToLua(value)]);
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
		const parseRefId = (value: unknown): number => {
			const id = Number((value as { r: unknown }).r);
			if (!Number.isFinite(id)) {
				throw new Error(`[BmsxConsoleRuntime] Invalid Lua snapshot reference id '${String((value as { r: unknown }).r)}'.`);
			}
			return id;
		};
		const resolveSnapshotValue = (raw: unknown): LuaValue => {
			if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
				return raw as LuaValue;
			}
			if (raw && typeof raw === 'object') {
				if ('r' in (raw as Record<string, unknown>)) {
					return ensureTable(parseRefId(raw));
				}
				const decoded = this.snapshotDecodeNative(raw as Record<string, unknown>);
				if (decoded) {
					return this.wrapNativeValue(decoded);
				}
			}
			if (Array.isArray(raw)) {
				const table = createLuaTable();
				for (let index = 0; index < raw.length; index += 1) {
					table.set(index + 1, resolveSnapshotValue(raw[index]));
				}
				return table;
			}
			if (raw && typeof raw === 'object') {
				const record = raw as Record<string, unknown>;
				if (record.__bmsx_table__ === 'map' && Array.isArray((record as { entries?: unknown }).entries)) {
					const table = createLuaTable();
					this.applyLuaSnapshotPayload(table, record, resolveSnapshotValue);
					return table;
				}
				return this.jsToLua(raw);
			}
			return null;
		};

		for (const idText of Object.keys(graph.objects)) {
			const id = Number.parseInt(idText, 10);
			if (!Number.isFinite(id)) {
				throw new Error(`[BmsxConsoleRuntime] Invalid Lua snapshot object id '${idText}'.`);
			}
			ensureTable(id);
		}
		for (const [idText, payload] of Object.entries(graph.objects)) {
			const id = Number.parseInt(idText, 10);
			if (!Number.isFinite(id)) {
				throw new Error(`[BmsxConsoleRuntime] Invalid Lua snapshot object id '${idText}'.`);
			}
			this.applyLuaSnapshotPayload(ensureTable(id), payload, resolveSnapshotValue);
		}

		const rootRef = graph.root as unknown;
		const resolvedRoot = rootRef && typeof rootRef === 'object' && 'r' in (rootRef as Record<string, unknown>)
			? ensureTable(parseRefId(rootRef))
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

	private restoreVmState(snapshot: BmsxConsoleState): void {
		const interpreter = this.luaInterpreter;
		if (snapshot.luaRandomSeed !== undefined) {
			interpreter.setRandomSeed(snapshot.luaRandomSeed);
		}
		if (snapshot.luaGlobals) {
			this.restoreLuaGlobals(snapshot.luaGlobals);
		}
		if (snapshot.luaLocals) {
			this.restoreLuaLocals(snapshot.luaLocals);
		}
	}

	private restoreLuaGlobals(globals: LuaEntrySnapshot): void {
		const interpreter = this.luaInterpreter;
		const entries = this.materializeLuaEntrySnapshot(globals);
		for (const [name, value] of entries) {
			if (!name || this.apiFunctionNames.has(name) || BmsxConsoleRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			const existing = interpreter.getGlobal(name);
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.applyLuaTableSnapshot(existing, value);
				continue;
			}
			try {
				interpreter.setGlobal(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxConsoleRuntime] Failed to restore Lua global '${name}':`, error);
				}
			}
		}
	}

	private restoreLuaLocals(locals: LuaEntrySnapshot): void {
		const interpreter = this.luaInterpreter;
		const entries = this.materializeLuaEntrySnapshot(locals);
		for (const [name, value] of entries) {
			if (!name || !interpreter.hasChunkBinding(name)) {
				continue;
			}
			const env = interpreter.chunkEnvironment;
			if (env) {
				const current = env.get(name);
				if (isLuaTable(current) && isLuaTable(value)) {
					this.applyLuaTableSnapshot(current, value);
					continue;
				}
			}
			try {
				interpreter.assignChunkValue(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxConsoleRuntime] Failed to restore Lua local '${name}':`, error);
				}
			}
		}
	}

	private resetLuaInteroperabilityState(): void {
		this.luaGenericAssetsExecuted.clear();
		this.handledLuaErrors = new WeakSet<object>();
		this.luaFunctionRedirectCache.clear();
		setLuaTableCaseInsensitiveKeys(this.canonicalization !== 'none');
	}

	private bootLuaProgram(options: { runInit: boolean; runBoot: boolean }): void {
		const program = this.luaProgram;
		const source = this.getProgramEntrySource(program);
		const chunkName = this.resolveProgramEntryChunkName(program);

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter(this.canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaInitFunction = null;
		this.luaBootFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaChunkName = chunkName;
		this.luaRuntimeFailed = false;

		try {
			const asset = this.resolveEntryAsset(program, chunkName);
			this.registerProgramChunk(asset, chunkName);
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			const programasset_id = asset.asset_id;
			const moduleId = this.moduleIdFor(programasset_id, chunkName);
			const results = interpreter.execute(source, chunkName);
			this.wrapLuaExecutionResults(moduleId, results);
			this.cacheChunkEnvironment(chunkName, programasset_id, moduleId);
			this.luaVmInitialized = true;
		}
		catch (error) {
			console.info(`[BmsxConsoleRuntime] Lua boot '${chunkName}' failed.`);
			this.handleLuaError(error);
			return;
		}

		this.bindLifecycleHandlers();

		if (options.runInit) {
			const ok = this.runLuaLifecycleHandler('init');
			if (!ok) {
				return;
			}
		}
		if (options.runBoot) {
			this.runLuaLifecycleHandler('boot');
		}
	}

	private processPendingLuaAssets(context: 'resume' | 'boot' | 'workspace:reset'): void {
		switch (context) {
			case 'resume':
			case 'boot':
				const editorOverrides = this.overlayEditorBuffersToRompack();
				if (editorOverrides.size > 0) {
					this.applyWorkspaceLuaOverrides(editorOverrides, false);
					this.reloadChangedLuaAssets(new Set(editorOverrides.keys()));
				}
				break;
			case 'workspace:reset':
				this.clearWorkspaceLuaOverrides();
				break;
		}
	}

	public async saveLuaProgram(source: string): Promise<void> {
		const program = this.luaProgram;
		const cartSavePath = this.resolveLuaEntrySourcePath(program);
		if (!cartSavePath) {
			throw new Error('[BmsxConsoleRuntime] Lua source path unavailable for active Lua asset.');
		}
		const savePath = this.resolveFilesystemPathForCartPath(cartSavePath);
		const previousChunkName = this.resolveProgramEntryChunkName(program);
		const previousSource = this.getProgramEntrySource(program);
		const targetChunkName = previousChunkName;
		const shouldValidate = this.validationStrategy === BmsxLuaValidationStrategy.FullExecution;
		if (!shouldValidate && $.debug === true) {
			console.info(`[BmsxConsoleRuntime] Skipping pre-boot validation for '${targetChunkName}'. Trusting the real run.`);
		}
		if (shouldValidate) {
			this.validateLuaSource(source, targetChunkName);
		}
		try {
			this.applyProgramEntrySourceToCartridge(source, targetChunkName);
		}
		catch (error) {
			try {
				this.applyProgramEntrySourceToCartridge(previousSource, previousChunkName);
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
			const rompack = $.rompack;
			const programasset_id = this.resolveEntryAsset(program, targetChunkName).asset_id;
			rompack.lua[programasset_id] = source;
			this.updateWorkspaceOverrideMap(programasset_id, source, cartSavePath);
			try {
				const asset = this.resolveEntryAsset(program, targetChunkName);
				this.reloadLuaProgramState(source, targetChunkName, asset.asset_id);
			}
			catch (error) {
				this.handleLuaError(error);
			}
		} catch (error) {
			try {
				this.applyProgramEntrySourceToCartridge(previousSource, previousChunkName);
			} catch (restoreError) {
				this.handleLuaPersistenceFailure('restore', '[BmsxConsoleRuntime] Failed to restore Lua source after persistence failure', { error: restoreError });
				return;
			}
			this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to persist Lua source to '${cartSavePath}'`, { error });
			if (this.luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
	}

	public async reloadLuaProgram(source: string): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'reload_program' });
		if (!this.luaProgram) {
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
		const previousChunkName = this.resolveProgramEntryChunkName(program);
		const previousSource = this.getProgramEntrySource(program);
		try {
			await this.saveLuaProgram(source);
		}
		catch (error) {
			try {
				const asset = this.resolveEntryAsset(program, previousChunkName);
				this.reloadLuaProgramState(previousSource, previousChunkName, asset.asset_id);
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
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	public async reloadProgramAndResetWorld(source: string): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'reload_and_reset' });
		try {
			const program = this.luaProgram;
			const chunkName = this.luaChunkName ?? this.resolveProgramEntryChunkName(program);
			await this.resetWorldState();
			try {
				const asset = this.resolveEntryAsset(program, chunkName);
				this.reloadLuaProgramState(source, chunkName, asset.asset_id);
			} catch (error) {
				this.handleLuaError(error);
			}
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	private validateLuaSource(source: string, chunkName: string): void {
		const previousChunk = this.luaChunkName;
		this.luaChunkName = chunkName;
		const currentProgram = this.luaProgram;
		if (currentProgram) {
			const asset = this.resolveEntryAsset(currentProgram, chunkName);
			this.registerProgramChunk(asset, chunkName);
		}
		try {
			const interpreter = createLuaInterpreter(this.canonicalization);
			this.configureInterpreter(interpreter);
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			const chunk = interpreter.parseChunk(source, chunkName);
			interpreter.validateChunkIdentifiers(chunk);
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

	private applyInputMappingFromLua(mapping: Record<string, unknown>, playerIndex: number): void {
		const keyboardLayer = this.convertLuaInputLayer(mapping['keyboard'], 'keyboard') as KeyboardInputMapping | undefined;
		const gamepadLayer = this.convertLuaInputLayer(mapping['gamepad'], 'gamepad') as GamepadInputMapping | undefined;
		const pointerLayer = this.convertLuaInputLayer(mapping['pointer'], 'pointer') as PointerInputMapping | undefined;

		const existing = Input.instance.getPlayerInput(playerIndex).inputMap;
		const next: InputMap = {
			keyboard: keyboardLayer ?? existing?.keyboard ?? {},
			gamepad: gamepadLayer ?? existing?.gamepad ?? {},
			pointer: pointerLayer ?? existing?.pointer ?? Input.clonePointerMapping(),
		};
		$.set_inputmap(playerIndex, next);
	}

	private convertLuaInputLayer(value: unknown, kind: 'keyboard' | 'gamepad' | 'pointer'): KeyboardInputMapping | GamepadInputMapping | PointerInputMapping | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value !== 'object') {
			throw this.createApiRuntimeError(`set_input_map: ${kind} mapping must be a table.`);
		}
		const result: Record<string, Array<KeyboardBinding | GamepadBinding | PointerBinding>> = {};
		for (const [action, rawBindings] of Object.entries(value as Record<string, unknown>)) {
			if (!action || typeof action !== 'string') {
				continue;
			}
			const entries = this.normalizeBindingList(kind, action, rawBindings);
			if (entries.length === 0) {
				continue;
			}
			result[action] = entries as Array<KeyboardBinding | GamepadBinding | PointerBinding>;
		}
		return result as KeyboardInputMapping | GamepadInputMapping | PointerInputMapping;
	}

	private normalizeBindingList(kind: 'keyboard' | 'gamepad' | 'pointer', action: string, rawBindings: unknown): Array<KeyboardBinding | GamepadBinding | PointerBinding> {
		const items = arrayify(rawBindings);
		const normalized: Array<KeyboardBinding | GamepadBinding | PointerBinding> = [];
		for (const item of items) {
			if (item === undefined || item === null) {
				throw this.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' cannot be nil.`);
			}
			if (typeof item === 'string') {
				if (item.length === 0) {
					throw this.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' cannot be an empty string.`);
				}
				normalized.push(item);
				continue;
			}
			if (typeof item === 'object') {
				const record = item as Record<string, unknown>;
				const idValue = record.id;
				if (typeof idValue !== 'string' || idValue.length === 0) {
					throw this.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' must provide a non-empty string id.`);
				}
				const binding: { id: string; scale?: number; invert?: boolean } = { id: idValue };
				if ('scale' in record && record.scale !== undefined && record.scale !== null) {
					const scale = Number(record.scale);
					if (!Number.isFinite(scale)) {
						throw this.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' has an invalid scale value.`);
					}
					binding.scale = scale;
				}
				if ('invert' in record && record.invert !== undefined && record.invert !== null) {
					binding.invert = Boolean(record.invert);
				}
				normalized.push(binding as KeyboardBinding | GamepadBinding | PointerBinding);
				continue;
			}
			throw this.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' must be a string or a table with an 'id' field.`);
		}
		return normalized;
	}

	public handleLuaError(error: unknown): void {
		// Pause signal has its own handler
		if (isLuaDebuggerPauseSignal(error)) {
			console.info('[BmsxConsoleRuntime] Lua debugger pause signal received: ', error);
			this.onLuaDebuggerPause(error);
			return;
		}

		// Avoid handling the same Error object repeatedly
		if (error instanceof Error && this.handledLuaErrors.has(error as object)) {
			return;
		}

		// Extract message and location info
		const message = this.extractErrorMessage(error);
		const { line, column, chunkName } = this.extractErrorLocation(error);
		const editorWasActive = this.editor?.isActive === true;

		this.luaRuntimeFailed = true;
		const interpreter = this.luaInterpreter;
		const callStackSnapshot = interpreter ? Array.from(interpreter.lastFaultCallStack) : [];
		const runtimeDetails = this.buildRuntimeErrorDetailsForEditor(error, message);
		const snapshot = this.recordFaultSnapshot({
			message,
			chunkName,
			line,
			column,
			details: runtimeDetails,
			fromDebugger: false,
		});
		this.pauseDebuggerForException({ chunkName: snapshot.chunkName, line: snapshot.line, column: snapshot.column }, callStackSnapshot);
		const editorIsActive = this.editor?.isActive === true;
		if (editorIsActive || editorWasActive) {
			this.editor.renderFaultOverlay();
		} else {
			this.activateConsoleMode();
			this.presentRuntimeErrorInConsole(snapshot.chunkName, snapshot.line, snapshot.column, snapshot.message, snapshot.details);
			this.updateOverlayState(true, false, true);
		}
		const logMessage = snapshot.chunkName && snapshot.chunkName.length > 0 ? `${snapshot.chunkName}: ${snapshot.message}` : snapshot.message;
		console.error('[BmsxConsoleRuntime] Lua runtime error:', logMessage, error);
		try {
			this.consoleMode.appendStderr(logMessage);
		} catch (appendError) {
			console.warn('[BmsxConsoleRuntime] Failed to append console runtime error output.', appendError);
		}
		// Remember we've handled this Error-like object so we don't duplicate reporting.
		if (typeof error === 'object' && error !== null) {
			this.handledLuaErrors.add(error);
		}
	}

	private buildRuntimeErrorDetailsForEditor(error: unknown, message: string): RuntimeErrorDetails | null {
		const interpreter = this.luaInterpreter;
		let luaFrames: StackTraceFrame[] = [];
		if (interpreter) {
			const callFrames = interpreter.lastFaultCallStack;
			// Convert recorded call sites
			luaFrames = this.convertLuaCallFrames(callFrames);
			// If the thrown error includes precise location, prepend it as the current frame
			if (error instanceof LuaError) {
				const src = typeof error.chunkName === 'string' && error.chunkName.length > 0 ? error.chunkName : null;
				const line = Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null;
				const col = Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null;
				// Only inject if not already represented as the innermost frame
				const innermost = callFrames.length > 0 ? callFrames[callFrames.length - 1] : null;
				const alreadyCaptured = !!innermost && innermost.source === (src ?? '') && innermost.line === (line ?? 0) && innermost.column === (col ?? 0);
				if (!alreadyCaptured) {
					let fnName: string | null = null;
					if (innermost) {
						fnName = innermost.functionName && innermost.functionName.length > 0 ? innermost.functionName : null;
					}
					let raw = '';
					if (fnName && fnName.length > 0) raw = fnName;
					if (src && src.length > 0) raw = raw.length > 0 ? `${raw} @ ${src}` : src;
					const top: StackTraceFrame = { origin: 'lua', functionName: fnName, source: src, line, column: col, raw: raw.length > 0 ? raw : '[lua]' };
					if (src && src.length > 0) {
						const hint = this.lookupChunkResourceInfoNullable(src);
						if (hint) {
							top.chunkasset_id = hint.asset_id ?? null;
							if (hint.path && hint.path.length > 0) top.chunkPath = hint.path;
						}
					}
					luaFrames.unshift(top);
				}
			}
			interpreter.clearLastFaultCallStack();
		}
		let stackText: string | null = null;
		if (this.includeJsStackTraces && error instanceof Error && typeof error.stack === 'string') {
			stackText = error.stack;
		}
		const jsFrames = this.includeJsStackTraces ? this.parseJsStackFrames(stackText) : [];
		if (luaFrames.length === 0 && jsFrames.length === 0) {
			return null;
		}
		return {
			message,
			luaStack: luaFrames,
			jsStack: jsFrames,
		};
	}

	private convertLuaCallFrames(callFrames: ReadonlyArray<LuaCallFrame>): StackTraceFrame[] {
		const frames: StackTraceFrame[] = [];
		for (let index = callFrames.length - 1; index >= 0; index -= 1) {
			const frame = callFrames[index];
			const source = frame.source && frame.source.length > 0 ? frame.source : null;
			const effectiveLine = frame.line > 0 ? frame.line : null;
			const effectiveColumn = frame.column > 0 ? frame.column : null;
			let rawLabel = '';
			if (frame.functionName && frame.functionName.length > 0) {
				rawLabel = frame.functionName;
			}
			if (source && source.length > 0) {
				rawLabel = rawLabel.length > 0 ? `${rawLabel} @ ${source}` : source;
			}
			const runtimeFrame: StackTraceFrame = {
				origin: 'lua',
				functionName: frame.functionName && frame.functionName.length > 0 ? frame.functionName : null,
				source,
				line: effectiveLine,
				column: effectiveColumn,
				raw: rawLabel.length > 0 ? rawLabel : '[lua]',
			};
			if (source && source.length > 0) {
				const hint = this.lookupChunkResourceInfoNullable(source);
				if (hint) {
					runtimeFrame.chunkasset_id = hint.asset_id ?? null;
					if (hint.path && hint.path.length > 0) {
						runtimeFrame.chunkPath = hint.path;
					}
				}
			}
			frames.push(runtimeFrame);
		}
		return frames;
	}

	private parseJsStackFrames(stack: string | null): StackTraceFrame[] {
		if (!stack || stack.length === 0) {
			return [];
		}
		const sanitized = stack.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const lines = sanitized.split('\n');
		const frames: StackTraceFrame[] = [];
		for (let index = 1; index < lines.length; index += 1) {
			const trimmed = lines[index].trim();
			if (trimmed.length === 0) {
				continue;
			}
			if (!trimmed.startsWith('at ')) {
				continue;
			}
			const parsed = this.parseJsStackLine(trimmed);
			if (parsed) {
				frames.push(parsed);
			}
		}
		return frames;
	}

	private parseJsStackLine(line: string): StackTraceFrame | null {
		let content = line;
		if (content.startsWith('at ')) {
			content = content.slice(3).trim();
		}
		let functionName: string | null = null;
		let location = content;
		const openIndex = content.indexOf('(');
		const closeIndex = content.lastIndexOf(')');
		if (openIndex >= 0 && closeIndex > openIndex) {
			const prefix = content.slice(0, openIndex).trim();
			functionName = prefix.length > 0 ? prefix : null;
			location = content.slice(openIndex + 1, closeIndex).trim();
		}
		let source: string | null = null;
		let lineNumber: number | null = null;
		let columnNumber: number | null = null;
		const locationText = location;
		if (locationText.length > 0) {
			const lastColon = locationText.lastIndexOf(':');
			if (lastColon > 0) {
				const columnText = locationText.slice(lastColon + 1);
				const columnValue = Number.parseInt(columnText, 10);
				if (Number.isFinite(columnValue) && columnValue > 0) {
					columnNumber = columnValue;
					const withoutColumn = locationText.slice(0, lastColon);
					const lineColon = withoutColumn.lastIndexOf(':');
					if (lineColon > 0) {
						const lineText = withoutColumn.slice(lineColon + 1);
						const lineValue = Number.parseInt(lineText, 10);
						if (Number.isFinite(lineValue) && lineValue > 0) {
							lineNumber = lineValue;
							source = withoutColumn.slice(0, lineColon);
						} else {
							source = withoutColumn;
						}
					} else {
						source = withoutColumn;
					}
				} else {
					source = locationText;
				}
			} else {
				source = locationText;
			}
		}
		if (source) {
			source = source.trim();
			if (source.length === 0) {
				source = null;
			}
		}
		return {
			origin: 'js',
			functionName,
			source,
			line: lineNumber,
			column: columnNumber,
			raw: line,
		};
	}

	private createApiRuntimeError(message: string): LuaRuntimeError {
		this.luaInterpreter.markFaultEnvironment();
		const range = this.luaInterpreter.getCurrentCallRange();
		const chunkName = range ? range.chunkName : (this.luaChunkName ?? 'lua');
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		return new LuaRuntimeError(message, chunkName, line, column);
	}

	private registerApiBuiltins(interpreter: LuaInterpreter): void {
		this.apiFunctionNames.clear();

		const env = interpreter.globalEnvironment;
		const resolveButtonAction = (value: LuaValue, fnName: string): string => {
			if (typeof value !== 'number' || Number.isNaN(value)) {
				throw this.createApiRuntimeError(`${fnName}(button [, player]) expects a numeric button index.`);
			}
			const index = Math.trunc(value);
			if (index < 0 || index >= CONSOLE_BUTTON_ACTIONS.length) {
				throw this.createApiRuntimeError(`${fnName}(button [, player]) button index must be between 0 and ${CONSOLE_BUTTON_ACTIONS.length - 1}.`);
			}
			return CONSOLE_BUTTON_ACTIONS[index];
		};

		const resolvePlayerIndex = (value: LuaValue | undefined, fnName: string): number => {
			if (value === undefined || value === null) {
				throw this.createApiRuntimeError(`${fnName}(button [, player]) expects the optional player index to be numeric.`);
			}
			if (typeof value !== 'number' || Number.isNaN(value)) {
				throw this.createApiRuntimeError(`${fnName}(button [, player]) expects the optional player index to be numeric.`);
			}
			const normalized = Math.trunc(value);
			if (normalized < 0) {
				throw this.createApiRuntimeError(`${fnName}(button [, player]) player index cannot be negative.`);
			}
			return normalized + 1;
		};

		const registerButtonFunction = (fnName: 'btn' | 'btnp' | 'btnr', modifier: string) => {
			const native = createLuaNativeFunction(fnName, (args) => {
				if (args.length === 0) {
					throw this.createApiRuntimeError(`${fnName}(button [, player]) requires at least one argument.`);
				}
				const action = resolveButtonAction(args[0], fnName);
				const playerIndex = resolvePlayerIndex(args.length >= 2 ? args[1] : undefined, fnName);
				let hasBinding = false;
				try {
					const playerInput = Input.instance.getPlayerInput(playerIndex);
					const inputMap = playerInput.inputMap;
					if (inputMap) {
						const keyboardBindings = inputMap.keyboard?.[action];
						const gamepadBindings = inputMap.gamepad?.[action];
						const pointerBindings = inputMap.pointer?.[action];
						hasBinding = Boolean(
							(keyboardBindings && keyboardBindings.length > 0) ||
							(gamepadBindings && gamepadBindings.length > 0) ||
							(pointerBindings && pointerBindings.length > 0)
						);
					}
				} catch {
					hasBinding = false;
					throw this.createApiRuntimeError(`${fnName}(button [, player]) expects a valid input mapping to be defined.`);
				}
				if (!hasBinding) {
					return [false];
				}
				const actionDefinition = `${action}${modifier}`;
				try {
					const triggered = api.check_action_state(playerIndex, actionDefinition);
					return [triggered];
				} catch (error) {
					if (error instanceof Error && /unknown actions/i.test(error.message)) {
						throw this.createApiRuntimeError(`${fnName}(button [, player]) unknown action '${actionDefinition}'`);
					}
					throw error;
				}
			});
			this.registerLuaGlobal(env, fnName, native);
			this.registerLuaBuiltin({
				name: fnName,
				params: ['button', 'player?'],
				signature: `${fnName}(button [, player])`,
				parameterDescriptions: [
					'Button index (0=left,1=right,2=up,3=down,4=O,5=X).',
					'Optional player index (0-based).',
				],
			});
		};

		registerButtonFunction('btn', '[p]');
		registerButtonFunction('btnp', '[gp]');
		registerButtonFunction('btnr', '[jr]');

		const setInputMapNative = createLuaNativeFunction('set_input_map', (args) => {
			if (args.length === 0 || !isLuaTable(args[0])) {
				throw this.createApiRuntimeError('set_input_map(mapping [, player]) requires a table as the first argument.');
			}
			const mappingTable = args[0] as LuaTable;
			const targetPlayer = args.length >= 2
				? resolvePlayerIndex(args[1], 'set_input_map')
				: this.playerIndex;
			const moduleId = this.moduleIdFor(null, this.luaChunkName ?? null);
			const marshalCtx = this.ensureMarshalContext({ moduleId, path: [] });
			const mappingValue = this.luaValueToJs(mappingTable, marshalCtx);
			if (!mappingValue || typeof mappingValue !== 'object') {
				throw this.createApiRuntimeError('set_input_map(mapping [, player]) requires mapping to be a table.');
			}
			this.applyInputMappingFromLua(mappingValue as Record<string, unknown>, targetPlayer);
			return [];
		});
		this.registerLuaGlobal(env, 'set_input_map', setInputMapNative);
		this.registerLuaBuiltin({
			name: 'set_input_map',
			params: ['mapping', 'player?'],
			signature: 'set_input_map(mapping [, player])',
			description: 'Replaces the input bindings for the console player. The optional player argument is zero-based.',
		});

		const members = this.collectApiMembers();
		for (const { name, kind, descriptor } of members) {
			if (!descriptor) {
				continue;
			}
			if (kind === 'method') {
				switch (name) {
					case 'btn':
					case 'btnp':
					case 'btnr':
					case 'set_input_map':
						// Already registered above
						continue;
				}
				const callable = descriptor.value;
				if (typeof callable !== 'function') {
					throw this.createApiRuntimeError(`API method '${name}' is not callable.`);
				}
				const params = this.extractFunctionParameters(callable as (...args: unknown[]) => unknown);
				const apiMetadata = CONSOLE_API_METHOD_METADATA[name];
				const optionalSet: Set<string> = new Set();
				if (apiMetadata?.optionalParameters) {
					for (let index = 0; index < apiMetadata.optionalParameters.length; index += 1) {
						optionalSet.add(apiMetadata.optionalParameters[index]);
					}
				}
				const parameterDescriptionMap: Map<string, string | null> = new Map();
				if (apiMetadata?.parameters) {
					for (let index = 0; index < apiMetadata.parameters.length; index += 1) {
						const metadataParam = apiMetadata.parameters[index];
						if (!metadataParam || typeof metadataParam.name !== 'string') {
							throw this.createApiRuntimeError(`API method '${name}' has invalid parameter metadata.`);
						}
						if (metadataParam.optional) {
							optionalSet.add(metadataParam.name);
						}
						if (metadataParam.description !== undefined) {
							parameterDescriptionMap.set(metadataParam.name, metadataParam.description ?? null);
						}
					}
				}
				const optionalArray = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
				const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param) ?? null);
				const displayParams = params.map(param => (optionalSet.has(param) ? `${param}?` : param));
				const signature = displayParams.length > 0 ? `${name}(${displayParams.join(', ')})` : `${name}()`;
				const native = createLuaNativeFunction(`api.${name}`, (args) => {
					const moduleId = this.moduleIdFor(null, this.luaChunkName ?? null);
					const baseCtx = this.ensureMarshalContext({ moduleId, path: [] });
					const jsArgs = Array.from(args, (arg, index) => this.luaValueToJs(arg, this.extendMarshalContext(baseCtx, `arg${index}`)));
					try {
						const target = api as unknown as Record<string, unknown>;
						const method = target[name];
						if (typeof method !== 'function') {
							throw new Error(`Method '${name}' is not callable.`);
						}
						const result = (method as (...inner: unknown[]) => unknown).apply(api, jsArgs);
						return this.wrapResultValue(result);
					} catch (error) {
						if (this.isLuaError(error)) {
							throw error;
						}
						const message = this.extractErrorMessage(error);
						throw this.createApiRuntimeError(`[api.${name}] ${message}`);
					}
				});
				this.registerLuaGlobal(env, name, native);
				this.registerLuaBuiltin({
					name,
					params,
					signature,
					optionalParams: optionalArray,
					parameterDescriptions,
					description: apiMetadata?.description ?? null,
				});
				continue;
			}

			if (descriptor.get) {
				const getter = descriptor.get;
				const native = createLuaNativeFunction(`api.${name}`, () => {
					try {
						const value = getter.call(api);
						return this.wrapResultValue(value);
					} catch (error) {
						if (this.isLuaError(error)) {
							throw error;
						}
						const message = this.extractErrorMessage(error);
						throw this.createApiRuntimeError(`[api.${name}] ${message}`);
					}
				});
				this.registerLuaGlobal(env, name, native);
			}
		}

		this.exposeEngineObjects(env);
	}

	private registerLuaBuiltin(metadata: ConsoleLuaBuiltinDescriptor): void {
		const normalizedName = this.canonicalizeIdentifier(metadata.name.trim());
		if (normalizedName.length === 0) {
			throw new Error(`Invalid Lua builtin name for '${normalizedName}'.`);
		}
		const params: string[] = [];
		const optionalSet: Set<string> = new Set();
		const normalizedDescriptions: (string | null)[] = [];
		const sourceParams = Array.isArray(metadata.params) ? metadata.params : [];
		const sourceDescriptions = Array.isArray(metadata.parameterDescriptions) ? metadata.parameterDescriptions : [];
		for (let index = 0; index < sourceParams.length; index += 1) {
			const raw = sourceParams[index];
			const description = index < sourceDescriptions.length ? sourceDescriptions[index] ?? null : null;
			if (typeof raw !== 'string') {
				throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
			}
			const trimmed = raw.trim();
			if (trimmed.length === 0) {
				throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
			}
			if (trimmed === '...' || trimmed.endsWith('...')) {
				params.push(trimmed);
				normalizedDescriptions.push(description);
				continue;
			}
			if (trimmed.endsWith('?')) {
				const base = trimmed.slice(0, -1);
				if (base.length > 0) {
					params.push(base);
					normalizedDescriptions.push(description);
					optionalSet.add(base);
				}
				continue;
			}
			params.push(trimmed);
			normalizedDescriptions.push(description);
		}
		if (Array.isArray(metadata.optionalParams)) {
			for (let index = 0; index < metadata.optionalParams.length; index += 1) {
				const name = metadata.optionalParams[index];
				if (typeof name !== 'string' || name.length === 0) {
					throw new Error(`Invalid Lua optional parameter at index ${index} for '${normalizedName}'.`);
				}
				optionalSet.add(name);
			}
		}
		const signature = typeof metadata.signature === 'string' ? metadata.signature : normalizedName;
		const optionalParams = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
		const descriptor: ConsoleLuaBuiltinDescriptor = {
			name: normalizedName,
			params,
			signature,
			optionalParams,
			parameterDescriptions: normalizedDescriptions,
			description: metadata.description ?? null,
		};
		this.luaBuiltinMetadata.set(normalizedName, descriptor);
	}

	private registerLuaGlobal(env: LuaEnvironment, name: string, value: LuaValue): void {
		const key = this.canonicalizeIdentifier(name);
		env.set(key, value);
		this.apiFunctionNames.add(key);
	}

	private getLuaGlobalValue(env: LuaEnvironment, name: string | null | undefined): LuaValue | null {
		if (!name) {
			return null;
		}
		return env.get(this.canonicalizeIdentifier(name));
	}

	private canonicalizeIdentifier(name: string): string {
		if (this.canonicalization) {
			if (this.canonicalization === 'upper') {
				return name.toUpperCase();
			}
			if (this.canonicalization === 'lower') {
				return name.toLowerCase();
			}
		}
		return name;
	}
	private extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
		const source = Function.prototype.toString.call(fn);
		const openIndex = source.indexOf('(');
		if (openIndex === -1) {
			return [];
		}
		let index = openIndex + 1;
		let depth = 1;
		let closeIndex = source.length;
		while (index < source.length) {
			const ch = source.charAt(index);
			if (ch === '(') {
				depth += 1;
			} else if (ch === ')') {
				depth -= 1;
				if (depth === 0) {
					closeIndex = index;
					break;
				}
			}
			index += 1;
		}
		if (depth !== 0 || closeIndex <= openIndex) {
			return [];
		}
		const slice = source.slice(openIndex + 1, closeIndex);
		const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
		const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
		const rawTokens = withoutLineComments.split(',');
		const names: string[] = [];
		for (let i = 0; i < rawTokens.length; i += 1) {
			const token = rawTokens[i].trim();
			if (token.length === 0) {
				continue;
			}
			names.push(this.sanitizeParameterName(token, i));
		}
		return names;
	}

	private sanitizeParameterName(token: string, index: number): string {
		let candidate = token.trim();
		if (candidate.length === 0) {
			return `arg${index + 1}`;
		}
		if (candidate.startsWith('...')) {
			return '...';
		}
		const equalsIndex = candidate.indexOf('=');
		if (equalsIndex >= 0) {
			candidate = candidate.slice(0, equalsIndex).trim();
		}
		const colonIndex = candidate.indexOf(':');
		if (colonIndex >= 0) {
			candidate = candidate.slice(0, colonIndex).trim();
		}
		const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
		if (bracketIndex !== -1) {
			return `arg${index + 1}`;
		}
		const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
		if (sanitized.length === 0) {
			return `arg${index + 1}`;
		}
		return sanitized;
	}

	private seedDefaultLuaBuiltins(): void {
		this.luaBuiltinMetadata.clear();
		const defaults = DEFAULT_LUA_BUILTIN_FUNCTIONS;
		for (let i = 0; i < defaults.length; i += 1) {
			this.registerLuaBuiltin(defaults[i]);
		}
	}

	public getWorkspaceSavedAssetIds(): ReadonlySet<string> {
		const saved = new Set<string>();
		for (const [asset_id, original] of this.rompackOriginalLua.entries()) {
			if (this.workspaceLuaOverrides.has(asset_id)) {
				continue;
			}
			const current = $.rompack.lua[asset_id];
			if (current === undefined) {
				continue;
			}
			const normalizedOriginal = original.replace(/\r\n/g, '\n');
			const normalizedCurrent = current.replace(/\r\n/g, '\n');
			if (normalizedCurrent !== normalizedOriginal) {
				saved.add(asset_id);
			}
		}
		return saved;
	}

	public callLuaFunction(fn: LuaFunctionValue, args: unknown[]): unknown[] {
		const luaArgs: LuaValue[] = [];
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(this.jsToLua(args[index]));
		}
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		const moduleId = this.moduleIdFor(null, this.luaChunkName ?? null);
		const baseCtx = this.ensureMarshalContext({ moduleId, path: [] });
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaValueToJs(results[i], this.extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private invokeLuaHandler(fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs: unknown[] = [];
		if (thisArg !== undefined) {
			callArgs.push(thisArg);
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		const results = this.callLuaFunction(fn, callArgs);
		return results.length > 0 ? results[0] : undefined;
	}

	private handleLuaHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void {
		const normalized = this.normalizeError(error);
		if (meta && meta.hid && !normalized.message.startsWith(`[${meta.hid}]`)) {
			normalized.message = `[${meta.hid}] ${normalized.message}`;
		}
		this.handleLuaError(normalized);
	}

	private ensureMarshalContext(context?: LuaMarshalContext): LuaMarshalContext {
		if (context) {
			return context;
		}
		const moduleId = this.luaChunkName ?? 'lua::runtime';
		return {
			moduleId,
			path: [],
		};
	}

	private extendMarshalContext(ctx: LuaMarshalContext, segment: string): LuaMarshalContext {
		if (!segment) {
			return ctx;
		}
		return {
			moduleId: ctx.moduleId,
			path: ctx.path.concat(segment),
		};
	}

	private describeMarshalSegment(key: LuaValue): string | null {
		if (typeof key === 'string') {
			return key;
		}
		if (typeof key === 'number') {
			return String(key);
		}
		return null;
	}


	private moduleIdFor(
		asset_id?: string | null,
		chunkName?: string | null,
	): string {
		return this.resolveLuaModulePackageKey(asset_id ?? null, chunkName ?? null);
	}

	private collectApiMembers(): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor | undefined }> {
		const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor | undefined }>();
		let prototype: object | null = Object.getPrototypeOf(api);
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

	private exposeEngineObjects(env: LuaEnvironment): void {
		const rompackView = this.buildLuaRompackView();
		const entries: Array<[string, unknown]> = [
			['world', $.world],
			['game', $],
			['$', $],
			['registry', $.registry],
			['events', $.event_emitter],
			['rompack', rompackView],
		];
		for (const [name, object] of entries) {
			if (object === undefined || object === null) {
				continue;
			}
			const luaValue = this.jsToLua(object);
			this.registerLuaGlobal(env, name, luaValue);
		}
	}

	private buildLuaRompackView() {
		const rompack = $.rompack;
		return {
			img: this.serializeRomAssetMap(rompack.img),
			audio: this.serializeRomAssetMap(rompack.audio),
			model: this.serializeRomAssetMap(rompack.model),
			data: this.cloneRompackDataMap(rompack.data),
			audioevents: rompack.audioevents ? deep_clone(rompack.audioevents) : {},
			lua: rompack.lua ? { ...rompack.lua } : {},
			luaSourcePaths: rompack.luaSourcePaths ? { ...rompack.luaSourcePaths } : {},
			resourcePaths: Array.isArray(rompack.resourcePaths)
				? rompack.resourcePaths.map(entry => ({ path: entry.path, type: entry.type, asset_id: entry.asset_id }))
				: [],
			code: rompack.code,
			canonicalization: rompack.canonicalization,
		};
	}

	private serializeRomAssetMap(source: Record<string, any> | undefined): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		if (!source) {
			return result;
		}
		for (const [id, asset] of Object.entries(source)) {
			if (!asset) {
				continue;
			}
			result[id] = this.extractRomAssetFields(asset);
		}
		return result;
	}

	private extractRomAssetFields(source: Record<string, any>): Record<string, unknown> {
		const entry: Record<string, unknown> = {};
		for (const key of Object.getOwnPropertyNames(source)) {
			switch (key) { // TODO: Still relevant?
				case 'buffer':
				case 'texture_buffer':
				case '_imgbin':
				case '_imgbinYFlipped':
				case 'imgbin':
				case 'imgbinYFlipped':
					continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(source, key);
			if (descriptor && typeof descriptor.get === 'function') {
				continue;
			}
			const value = source[key];
			if (value === undefined) {
				continue;
			}
			if (value === null || typeof value !== 'object') {
				entry[key] = value;
				continue;
			}
			entry[key] = deep_clone(value as Record<string, unknown>);
		}
		return entry;
	}

	private cloneRompackDataMap(source: Record<string, unknown> | undefined): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		if (!source) {
			return result;
		}
		for (const [id, value] of Object.entries(source)) {
			if (value === undefined) {
				continue;
			}
			if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
				result[id] = value;
				continue;
			}
			if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
				result[id] = { byteLength: value.byteLength };
				continue;
			}
			if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value as ArrayBufferView)) {
				const view = value as ArrayBufferView;
				result[id] = { byteLength: view.byteLength, constructor: view.constructor.name };
				continue;
			}
			result[id] = deep_clone(value as Record<string, unknown>);
		}
		return result;
	}

	private isPlainObject(value: unknown): value is Record<string, unknown> {
		if (value === null || typeof value !== 'object') {
			return false;
		}
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	private resolveNativeTypeName(value: object | Function): string {
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
		if (value === null) {
			return true;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return true;
		}
		if (isLuaTable(value)) {
			return true;
		}
		if (isLuaNativeValue(value)) {
			return true;
		}
		if (value && typeof value === 'object' && 'call' in (value as Record<string, unknown>)) {
			const candidate = value as { call?: unknown };
			return typeof candidate.call === 'function';
		}
		return false;
	}

	public luaValueToJs(value: LuaValue, context?: LuaMarshalContext): unknown {
		const marshalCtx = this.ensureMarshalContext(context);
		return this.luaValueToJsWithVisited(value, marshalCtx, new WeakMap<LuaTable, unknown>());
	}

	private luaValueToJsWithVisited(value: LuaValue, context: LuaMarshalContext, visited: WeakMap<LuaTable, unknown>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (this.isLuaFunctionValue(value)) {
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
				const converted = this.luaValueToJsWithVisited(entry.value, segment ? this.extendMarshalContext(context, segment) : context, visited);
				result[entry.key - 1] = converted;
			}
			return result;
		}
		const objectResult: Record<string, unknown> = {};
		visited.set(table, objectResult);
		for (let index = 0; index < numericEntries.length; index += 1) {
			const entry = numericEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(entry.value, segment ? this.extendMarshalContext(context, segment) : context, visited);
		}
		for (let index = 0; index < otherEntries.length; index += 1) {
			const entry = otherEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			objectResult[String(entry.key)] = this.luaValueToJsWithVisited(entry.value, segment ? this.extendMarshalContext(context, segment) : context, visited);
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
			if (this.isPlainObject(value)) {
				const record = value as Record<string, unknown>;
				if ('__native__' in record) {
					const decoded = this.snapshotDecodeNative(record);
					if (decoded) {
						return this.wrapNativeValue(decoded);
					}
					return null;
				}
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
		return this.luaInterpreter.getOrCreateNativeValue(value, this.resolveNativeTypeName(value));
	}

	private snapshotEncodeNative(native: object | Function): unknown {
		if (native instanceof WorldObject) {
			return { __native__: 'world_object', id: native.id ?? null };
		}
		const owner = (native as { owner: WorldObject }).owner;
		if (owner instanceof WorldObject) {
			const componentId = (native as { id?: string | null }).id ?? null;
			const className = (native as { constructor: { name?: string } }).constructor?.name ?? null;
			return {
				__native__: 'component',
				ownerId: owner.id ?? null,
				id: componentId,
				className,
			};
		}
		if (typeof native === 'function') {
			return { __native__: 'function' };
		}
		return undefined;
	}

	private snapshotDecodeNative(token: unknown): object | Function | null {
		if (!token || typeof token !== 'object') {
			console.warn('[BmsxConsoleRuntime] Ignoring invalid native snapshot token:', token);
			return null;
		}
		const record = token as { __native__?: string;[key: string]: unknown };
		switch (record.__native__) {
			case 'world_object': {
				return this.lookupWorldObjectById(record.id);
			}
			case 'component': {
				const owner = this.lookupWorldObjectById(record.ownerId);
				if (!owner) {
					console.warn(`[BmsxConsoleRuntime] Failed to resolve owner for component: ${record.ownerId}`);
					return null;
				}
				if (record.id !== undefined && record.id !== null) {
					const resolved = owner.get_component_by_id(record.id as string);
					if (resolved) {
						return resolved as object;
					}
				}
				if (record.className) {
					const resolved = owner.get_component_by_id(record.className as string);
					if (resolved) {
						return resolved as object;
					}
				}
				return null;
			}
			default:
				return null;
		}
	}

	private lookupWorldObjectById(id: unknown): WorldObject | null {
		if (id === undefined || id === null) {
			return null;
		}
		const registry = $.registry;
		const resolvedFromRegistry = registry.get(id as string);
		if (resolvedFromRegistry instanceof WorldObject) {
			return resolvedFromRegistry;
		}
		if (resolvedFromRegistry && typeof resolvedFromRegistry === 'object' && 'id' in (resolvedFromRegistry as Record<string, unknown>)) {
			return resolvedFromRegistry as WorldObject;
		}
		const world = $.world;
		const resolvedFromWorld = world.getWorldObject(id as string);
		if (resolvedFromWorld instanceof WorldObject) {
			return resolvedFromWorld;
		}
		if (resolvedFromWorld && typeof resolvedFromWorld === 'object' && 'id' in (resolvedFromWorld as Record<string, unknown>)) {
			return resolvedFromWorld as WorldObject;
		}
		return null;
	}

	private resolveEntryAsset(program: BmsxConsoleLuaProgram, chunkName?: string | null): BmsxConsoleLuaPrimaryAsset {
		if (program.assets.length === 0) {
			return { asset_id: '' };
		}
		if (chunkName) {
			const normalized = this.normalizeChunkName(chunkName);
			for (let i = 0; i < program.assets.length; i += 1) {
				const asset = program.assets[i];
				if (this.normalizeChunkName(asset.chunkName ?? asset.asset_id) === normalized) {
					return asset;
				}
			}
		}
		const entryId = program.entryAssetId ?? program.assets[0].asset_id;
		const entry = program.assets.find(a => a.asset_id === entryId) ?? program.assets[0];
		return entry;
	}

	private getProgramEntrySource(program: BmsxConsoleLuaProgram): string {
		const asset = this.resolveEntryAsset(program);
		return $.rompack.lua[asset.asset_id];
	}

	private resolveLuaEntrySourcePath(program: BmsxConsoleLuaProgram): string | null {
		const asset = this.resolveEntryAsset(program);
		return $.rompack.luaSourcePaths[asset.asset_id] ?? null;
	}

	private async persistLuaSourceToFilesystem(path: string, source: string): Promise<void> {
		if (typeof fetch !== 'function') {
			throw new Error('[BmsxConsoleRuntime] Fetch API unavailable; cannot persist Lua source.');
		}
		let response: HttpResponse;
		try {
			response = await fetch(WORKSPACE_FILE_ENDPOINT, {
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
				const message = this.extractErrorMessage(textError);
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
					const parseMessage = this.extractErrorMessage(parseError);
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
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
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
				const message = this.extractErrorMessage(textError);
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
					const parseMessage = this.extractErrorMessage(parseError);
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
			const message = this.extractErrorMessage(parseError);
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
		const program = this.luaProgram!;
		const path = this.resolveLuaEntrySourcePath(program)!;
		const fetched = await this.fetchLuaSourceFromFilesystem(path);
		if (fetched === null) {
			return;
		}
		const currentSource = this.getProgramEntrySource(program);
		if (currentSource === fetched) {
			return;
		}
		const chunkName = this.resolveProgramEntryChunkName(program);
		try {
			const asset = this.resolveEntryAsset(program, chunkName);
			this.reloadLuaProgramState(fetched, chunkName, asset.asset_id);
		}
		catch (error) {
			try {
				const asset = this.resolveEntryAsset(program, chunkName);
				this.reloadLuaProgramState(currentSource, chunkName, asset.asset_id);
			}
			catch (restoreError) {
				this.handleLuaPersistenceFailure('restore', `[BmsxConsoleRuntime] Failed to restore Lua source after prefetched apply error`, { error: restoreError });
				return;
			}
			this.handleLuaPersistenceFailure('apply', `[BmsxConsoleRuntime] Failed to apply prefetched Lua source '${path}'`, { error });
			if (this.luaFailurePolicy.apply === 'warning') {
				return;
			}
			throw this.normalizeError(error);
		}
	}

	private applyProgramEntrySourceToCartridge(source: string, chunkName: string, asset_id?: string): void {
		const program = this.luaProgram!;
		const asset = asset_id ? this.resolveEntryAsset(program, chunkName) : this.resolveEntryAsset(program, chunkName);
		const mutable = program as typeof program & { assets: typeof program.assets };
		const assets = [...mutable.assets];
		assets[0] = { asset_id: asset.asset_id, chunkName };
		mutable.assets = assets;
		$.rompack.lua[asset.asset_id] = source;
		this.registerProgramChunk({ asset_id: asset.asset_id, chunkName }, chunkName);
		this.updateWorkspaceOverrideMap(asset.asset_id, source, this.resolveLuaEntrySourcePath(program));
	}

	private canonicalizeProgramEntryChunkName(program: BmsxConsoleLuaProgram, chunkName: string | null | undefined): string {
		let candidate: string;
		if (typeof chunkName === 'string') {
			candidate = chunkName;
		}
		else {
			const asset = this.resolveEntryAsset(program, chunkName);
			candidate = asset.asset_id;
		}

		const normalizedCandidate = this.normalizeChunkName(candidate);
		const asset = this.resolveEntryAsset(program, chunkName);
		const normalizedAsset = this.normalizeChunkName(asset.asset_id);
		const resolvedPath = this.resolveResourcePath(asset.asset_id);
		if (resolvedPath) {
			const normalizedPath = this.normalizeChunkName(resolvedPath);
			if (normalizedCandidate === normalizedAsset || normalizedCandidate === normalizedPath) {
				return `@${resolvedPath}`;
			}
		}
		else if (normalizedCandidate === normalizedAsset) {
			return `@lua/${asset.asset_id}`;
		}
		return candidate;
	}

	private resolveProgramEntryChunkName(program: BmsxConsoleLuaProgram): string {
		const asset = this.resolveEntryAsset(program);
		return this.canonicalizeProgramEntryChunkName(program, asset.chunkName);
	}

	private registerProgramChunk(asset: { asset_id: string; chunkName?: string }, chunkName: string): void {
		let asset_id: string | null = asset.asset_id ?? null;
		let resolvedPath: string | null = this.resolveResourcePath(asset.asset_id);
		const info: { asset_id: string | null; path?: string | null } = { asset_id };
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

	private normalizeModulePath(path: string): string {
		let normalized = path.trim();
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		normalized = normalized.replace(/\\/g, '/');
		while (normalized.startsWith('./')) {
			normalized = normalized.slice(2);
		}
		return normalized.replace(/\/{2,}/g, '/');
	}

	private stripLuaExtension(candidate: string): string {
		if (candidate.toLowerCase().endsWith('.lua')) {
			return candidate.slice(0, -4);
		}
		return candidate;
	}

	private baseModuleName(path: string): string {
		const normalized = this.normalizeModulePath(path);
		const index = normalized.lastIndexOf('/');
		const name = index >= 0 ? normalized.slice(index + 1) : normalized;
		return this.stripLuaExtension(name);
	}

	private normalizeModuleKey(name: string): string {
		let normalized = name.trim();
		if (normalized.length === 0) {
			return '';
		}
		normalized = normalized.replace(/\\/g, '/');
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		while (normalized.startsWith('./')) {
			normalized = normalized.slice(2);
		}
		normalized = normalized.replace(/\.lua$/i, '');
		normalized = normalized.replace(/\./g, '/');
		normalized = normalized.replace(/\/{2,}/g, '/');
		return normalized.toLowerCase();
	}

	private resolveLuaModulePackageKey(asset_id: string | null, chunkName: string | null): string {
		if (chunkName && chunkName.length > 0) {
			const normalized = this.normalizeModulePath(chunkName.startsWith('@') ? chunkName.slice(1) : chunkName);
			return `@${this.stripLuaExtension(normalized)}`;
		}
		if (asset_id) {
			const resolved = this.resolveResourcePath(asset_id);
			if (resolved && resolved.length > 0) {
				return `@${this.stripLuaExtension(this.normalizeModulePath(resolved))}`;
			}
			return `@lua/${this.stripLuaExtension(asset_id)}`;
		}
		return '@lua';
	}

	private refreshPackageLoadedEntry(packageKey: string, results: ReadonlyArray<LuaValue>): void {
		const packageLoaded = this.luaInterpreter.getPackageLoadedTable();
		const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
		packageLoaded?.set(packageKey, moduleValue);
	}

	private rebindModuleExportHandlers(moduleId: string, moduleValue: LuaValue): void {
		const visited = new WeakSet<LuaTable>();
		this.rebindHandlersFromLuaValue(moduleId, moduleValue, [], visited);
	}

	private reloadChangedLuaAssets(changedAssets: Set<string>): void {
		if (changedAssets.size === 0) {
			return;
		}
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			console.warn('[BmsxConsoleRuntime] Cannot reload changed Lua assets; no interpreter available.');
			return;
		}
		for (const asset_id of changedAssets) {
			const sourcePath = $.rompack.luaSourcePaths[asset_id] ?? null;
			const chunkName = this.resolveLuaModuleChunkName(asset_id, sourcePath);
			const info: { asset_id: string | null; path?: string | null } = { asset_id };
			if (sourcePath) {
				info.path = sourcePath;
			}
			const source = $.rompack.lua[asset_id];
			if (asset_id === this.resolveEntryAsset(this.luaProgram).asset_id) {
				this.hotReloadProgramEntry({ source, chunkName, asset_id });
				continue;
			}
			this.reloadGenericLuaChunk(chunkName, info, source);
		}
	}

	private resolveLuaModuleChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@lua/${asset_id}`;
	}

	private registerLuaChunkResource(chunkName: string, info: { asset_id: string | null; path?: string | null }): void {
		if (!chunkName) return;
		const key = this.normalizeChunkName(chunkName);
		this.luaChunkResourceMap.set(key, info);
	}

	private invalidateLuaModuleIndex(): void {
		this.luaModuleIndexBuilt = false;
		this.luaModuleAliases.clear();
		this.chunkSemanticCache.clear();
	}

	private cacheChunkEnvironment(chunkName: string, asset_id: string | null, moduleId?: string): void {
		const environment = this.luaInterpreter?.chunkEnvironment;
		if (!environment) {
			return;
		}
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const definitions = this.luaInterpreter.getChunkDefinitions(chunkName);
		const effectiveModuleId = moduleId ?? this.moduleIdFor(asset_id, chunkName);
		this.pruneRemovedChunkFunctionExports(normalizedChunk, environment, definitions, this.luaInterpreter.globalEnvironment);
		this.installFunctionRedirectsForChunk(effectiveModuleId, environment, definitions);
		this.wrapDynamicChunkFunctions(effectiveModuleId, environment, normalizedChunk);
		this.luaChunkEnvironmentsByChunkName.set(normalizedChunk, environment);
		if (asset_id) {
			this.luaChunkEnvironmentsByAssetId.set(asset_id, environment);
		}
	}

	private collectChunkFunctionDefinitionKeys(definitions: ReadonlyArray<LuaDefinitionInfo> | null): Set<string> {
		const keys = new Set<string>();
		if (!definitions) {
			return keys;
		}
		for (let index = 0; index < definitions.length; index += 1) {
			const entry = definitions[index];
			if (entry.kind !== 'function') {
				continue;
			}
			if (!entry.namePath || entry.namePath.length === 0) {
				continue;
			}
			const key = entry.namePath.join('.');
			if (key.length > 0) {
				keys.add(key);
			}
		}
		return keys;
	}

	private pruneRemovedChunkFunctionExports(
		normalizedChunk: string,
		environment: LuaEnvironment,
		definitions: ReadonlyArray<LuaDefinitionInfo> | null,
		globalEnv: LuaEnvironment,
	): void {
		if (!environment) {
			return;
		}
		const previousKeys = this.chunkFunctionDefinitionKeys.get(normalizedChunk) ?? null;
		const currentKeys = this.collectChunkFunctionDefinitionKeys(definitions);
		if (previousKeys && previousKeys.size > 0) {
			for (const key of previousKeys) {
				if (!currentKeys.has(key)) {
					const path = key.split('.');
					this.clearExportInEnvironment(environment, path);
					this.clearExportInEnvironment(globalEnv, path);
				}
			}
		}
		this.chunkFunctionDefinitionKeys.set(normalizedChunk, currentKeys);
	}

	private installFunctionRedirectsForChunk(
		moduleId: string,
		environment: LuaEnvironment,
		definitions: ReadonlyArray<LuaDefinitionInfo> | null,
	): void {
		const definitionKeys = this.collectChunkFunctionDefinitionKeys(definitions);
		if (definitionKeys.size === 0) {
			return;
		}
		for (const key of definitionKeys) {
			const segments = key.split('.');
			this.wrapFunctionByPath(moduleId, environment, segments);
		}
	}

	private isFunctionFromChunk(fn: LuaFunctionValue, chunkName: string): boolean {
		const candidate = fn as { getSourceRange?: () => LuaSourceRange | null };
		if (typeof candidate.getSourceRange !== 'function') {
			return false;
		}
		try {
			const range = candidate.getSourceRange();
			if (!range || typeof range.chunkName !== 'string') {
				return false;
			}
			return this.normalizeChunkName(range.chunkName) === this.normalizeChunkName(chunkName);
		}
		catch {
			return false;
		}
	}

	private wrapDynamicChunkFunctions(
		moduleId: string,
		environment: LuaEnvironment,
		chunkName: string,
	): void {
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const filter = (fn: LuaFunctionValue) => this.isFunctionFromChunk(fn, normalizedChunk);
		const visited = new WeakSet<LuaTable>();
		const entries = environment.entries();
		for (let index = 0; index < entries.length; index += 1) {
			const [name, value] = entries[index];
			const wrapped = this.wrapFunctionsInValue(moduleId, value, [name], visited, { filter });
			if (wrapped !== value) {
				environment.set(name, wrapped);
			}
		}
	}

	private wrapFunctionByPath(
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
			owner.set(leafKey, wrapped);
		} else {
			owner.set(leafKey, wrapped);
		}
	}

	private wrapFunctionsInValue(
		moduleId: string,
		value: LuaValue,
		path: ReadonlyArray<string>,
		visited: WeakSet<LuaTable>,
		options?: { filter?: (fn: LuaFunctionValue) => boolean },
	): LuaValue {
		if (this.isLuaFunctionValue(value)) {
			if (options?.filter && !options.filter(value)) {
				return value;
			}
			return this.luaFunctionRedirectCache.getOrCreate(moduleId, path, value);
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

	private wrapLuaExecutionResults(moduleId: string, results: LuaValue[]): void {
		if (results.length === 0) {
			return;
		}
		const visited = new WeakSet<LuaTable>();
		for (let index = 0; index < results.length; index += 1) {
			const wrapped = this.wrapFunctionsInValue(moduleId, results[index], ['return', String(index)], visited);
			results[index] = wrapped;
		}
	}

	private clearExportInEnvironment(env: LuaEnvironment, pathParts: ReadonlyArray<string>): void {
		if (!env || !pathParts || pathParts.length === 0) {
			return;
		}
		if (pathParts.length === 1) {
			env.set(pathParts[0], null);
			return;
		}
		const first = env.get(pathParts[0]);
		if (first === null || !isLuaTable(first)) {
			return;
		}
		let current: LuaTable = first;
		for (let index = 1; index < pathParts.length - 1; index += 1) {
			const nextValue = current.get(pathParts[index]);
			if (nextValue === null || !isLuaTable(nextValue)) {
				return;
			}
			current = nextValue;
		}
		current.set(pathParts[pathParts.length - 1], null);
	}

	private registerLuaModuleAliases(record: LuaRequireModuleRecord, asset_id: string, sourcePath: string | null, chunkName: string, canonicalPath: string): void {
		const register = (candidate: string | null) => {
			if (!candidate) {
				return;
			}
			const key = this.normalizeModuleKey(candidate);
			if (!key) {
				return;
			}
			if (!this.luaModuleAliases.has(key)) {
				this.luaModuleAliases.set(key, record);
			}
		};
		const canonical = this.normalizeModulePath(canonicalPath);
		register(canonical);
		register(`${canonical}.lua`);
		if (sourcePath) {
			const normalizedSource = this.normalizeModulePath(sourcePath);
			register(normalizedSource);
			register(`${normalizedSource}.lua`);
			register(normalizedSource.replace(/\//g, '.'));
			register(`${normalizedSource.replace(/\//g, '.')}.lua`);
		}
		register(asset_id);
		register(`${asset_id}.lua`);
		register(asset_id.replace(/[\\/]/g, '.'));
		register(`${asset_id.replace(/[\\/]/g, '.')}.lua`);
		register(chunkName);
		const canonicalDots = canonical.replace(/\//g, '.');
		register(canonicalDots);
		register(`${canonicalDots}.lua`);
		const baseName = this.baseModuleName(canonical);
		register(baseName);
		register(`${baseName}.lua`);
		const baseDots = baseName.replace(/\//g, '.');
		register(baseDots);
		register(`${baseDots}.lua`);
	}

	private ensureLuaModuleIndex(): void {
		if (this.luaModuleIndexBuilt) {
			return;
		}
		this.luaModuleAliases.clear();
		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		for (const asset_id of Object.keys(luaSources)) {
			const sourcePath = sourcePaths[asset_id] ?? null;
			const chunkName = this.resolveLuaModuleChunkName(asset_id, sourcePath);
			const canonicalPath = this.stripLuaExtension(this.normalizeModulePath(sourcePath ?? asset_id ?? chunkName));
			const canonicalKey = this.normalizeModuleKey(canonicalPath);
			if (!canonicalKey) {
				continue;
			}
			const packageKey = this.resolveLuaModulePackageKey(asset_id, chunkName);
			const record: LuaRequireModuleRecord = {
				packageKey,
				canonicalKey,
				asset_id,
				chunkName,
				path: sourcePath ? this.normalizeModulePath(sourcePath) : null,
			};
			this.registerLuaModuleAliases(record, asset_id, sourcePath, chunkName, canonicalPath);
		}
		this.luaModuleIndexBuilt = true;
	}

	private requireLuaModule(interpreter: LuaInterpreter, moduleName: string): LuaValue {
		this.ensureLuaModuleIndex();
		const aliasKey = this.normalizeModuleKey(moduleName);
		if (!aliasKey) {
			throw this.createApiRuntimeError(`require(moduleName) received an invalid module name '${moduleName}'.`);
		}
		const record = this.luaModuleAliases.get(aliasKey);
		if (!record) {
			throw this.createApiRuntimeError(`Module '${moduleName}' not found.`);
		}
		const packageLoaded = interpreter.getPackageLoadedTable();
		const cached = packageLoaded.get(record.packageKey);
		if (cached !== null) {
			return cached;
		}
		if (this.luaModuleLoadingKeys.has(record.packageKey)) {
			const pending = packageLoaded.get(record.packageKey);
			return pending === null ? true : pending;
		}
		const rompack = $.rompack;
		const source = rompack.lua[record.asset_id];
		const resourceInfo: { asset_id: string | null; path?: string | null } = { asset_id: record.asset_id };
		if (record.path) {
			resourceInfo.path = record.path;
		}
		this.registerLuaChunkResource(record.chunkName, resourceInfo);
		this.luaModuleLoadingKeys.add(record.packageKey);
		packageLoaded.set(record.packageKey, true);
		const previousChunkName = this.luaChunkName;
		this.luaChunkName = record.chunkName;
		try {
			const moduleId = this.moduleIdFor(record.asset_id, record.chunkName);
			const results = interpreter.execute(source, record.chunkName);
			this.wrapLuaExecutionResults(moduleId, results);
			this.cacheChunkEnvironment(record.chunkName, record.asset_id, moduleId);
			const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
			packageLoaded.set(record.packageKey, moduleValue);
			this.rebindChunkEnvironmentHandlers(moduleId);
			this.rebindModuleExportHandlers(moduleId, moduleValue);
			return moduleValue;
		}
		catch (error) {
			packageLoaded.delete(record.packageKey);
			if (this.isLuaError(error)) {
				throw error;
			}
			const message = this.extractErrorMessage(error);
			throw this.createApiRuntimeError(message);
		}
		finally {
			this.luaModuleLoadingKeys.delete(record.packageKey);
			this.luaChunkName = previousChunkName;
		}
	}

	private lookupChunkResourceInfo(chunkName: string): { asset_id: string | null; path?: string | null } | null {
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
		if (existing.asset_id) {
			const resolved = this.resolveResourcePath(existing.asset_id);
			if (resolved && resolved.length > 0) {
				const updated = { ...existing, path: resolved };
				this.luaChunkResourceMap.set(key, updated);
				return updated;
			}
		}
		return existing;
	}

	public lookupChunkResourceInfoNullable(chunkName: string | null): { asset_id: string | null; path?: string | null } | null {
		if (!chunkName) return null;
		return this.lookupChunkResourceInfo(chunkName);
	}

	private resolveResourcePath(asset_id: string): string | null {
		if (!asset_id) {
			return null;
		}
		if (this.resourcePathCache.has(asset_id)) {
			const cached = this.resourcePathCache.get(asset_id);
			if (cached === null || cached === undefined) {
				return null;
			}
			return cached;
		}
		const rompack = $.rompack;
		const luaSources = rompack.luaSourcePaths;
		const luaSource = luaSources[asset_id];
		if (typeof luaSource === 'string' && luaSource.length > 0) {
			const normalizedLuaPath = luaSource.replace(/\\/g, '/');
			this.resourcePathCache.set(asset_id, normalizedLuaPath);
			return normalizedLuaPath;
		}
		const entry = rompack.resourcePaths.find(candidate => candidate.asset_id === asset_id);
		if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
			this.resourcePathCache.set(asset_id, null);
			return null;
		}
		const normalizedPath = entry.path.replace(/\\/g, '/');
		this.resourcePathCache.set(asset_id, normalizedPath);
		return normalizedPath;
	}

	private normalizeWorkspacePath(path: string): string {
		let normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
		if (normalized.length > 1 && normalized.endsWith('/')) {
			normalized = normalized.replace(/\/+$/, '');
		}
		return normalized;
	}

	private isWorkspacePathWithinRoot(path: string, root: string): boolean {
		if (path === root) {
			return true;
		}
		return path.startsWith(`${root}/`);
	}

	private resolveCartProjectRootPath(): string | null {
		const root = $.rompack.projectRootPath;
		return root ? this.normalizeWorkspacePath(root) : null;
	}

	private resolveFilesystemPathForCartPath(cartPath: string): string {
		const normalizedCart = this.normalizeWorkspacePath(cartPath);
		const root = this.resolveCartProjectRootPath();
		if (!root || root.length === 0) {
			return normalizedCart;
		}
		if (normalizedCart.length === 0) {
			return root;
		}
		if (this.isWorkspacePathWithinRoot(normalizedCart, root)) {
			return normalizedCart;
		}
		return this.normalizeWorkspacePath(`${root}/${normalizedCart}`);
	}

	private applyLocalWorkspaceDirtyLuaOverrides(hotReload: boolean): void {
		const root = this.resolveCartProjectRootPath();
		const overrides = collectWorkspaceOverrides({ rompack: $.rompack, projectRootPath: root, storage: this.storageService });
		this.applyWorkspaceLuaOverrides(overrides, hotReload);
	}

	private overlayEditorBuffersToRompack(): Map<string, WorkspaceOverrideRecord> {
		const rompack = $.rompack;
		const overrides = new Map<string, WorkspaceOverrideRecord>();
		if (!this.editor) {
			return overrides;
		}
		const sourcePaths = rompack.luaSourcePaths;
		let touched = false;
		for (const asset_id of Object.keys(rompack.lua)) {
			const sourcePath = sourcePaths[asset_id] ?? null;
			const chunkName = this.resolveLuaModuleChunkName(asset_id, sourcePath);
			const latest = this.editor.getSourceForChunk(asset_id, chunkName);
			if (rompack.lua[asset_id] !== latest) {
				rompack.lua[asset_id] = latest;
				touched = true;
			}
			const cartPath = sourcePath ? this.normalizeWorkspacePath(sourcePath) : asset_id;
			const original = this.rompackOriginalLua.get(asset_id) ?? '';
			const normalizedLatest = latest.replace(/\r\n/g, '\n');
			const normalizedOriginal = original.replace(/\r\n/g, '\n');
			if (normalizedLatest !== normalizedOriginal) {
				overrides.set(asset_id, { source: latest, path: null, cartPath });
				this.workspaceLuaOverrides.set(asset_id, { source: latest, path: null, cartPath });
				continue;
			}
			this.workspaceLuaOverrides.delete(asset_id);
		}
		if (touched) {
			this.luaGenericAssetsExecuted.clear();
		}
		return overrides;
	}

	private applyWorkspaceLuaOverrides(overrides: Map<string, WorkspaceOverrideRecord>, hotReload: boolean): Set<string> {
		// IMPORTANT: Workspace dirty sources (unsaved edits) must always be honored.
		// The editor can hot-reload or resume using in-memory dirty buffers that were never persisted
		// to disk/server. That is intentional: losing unsaved changes on resume would be incorrect.
		// Therefore we do NOT revert to ROM when the backend lacks a dirty file; we only overlay ROM
		// with whatever dirty sources we currently have (from memory or backend) and keep them active
		// until the user explicitly resets or nukes the workspace.
		const rompack = $.rompack;
		let updated = false;
		const changedAssets = new Set<string>();
		for (const [asset_id, record] of overrides) {
			const { source, path, cartPath } = record;
			if (!source || source.length === 0) continue; // Ignore empty sources. This can happen if the backend file is empty or missing.
			this.workspaceLuaOverrides.set(asset_id, { source, path, cartPath });
			if (rompack.lua[asset_id] !== source) {
				rompack.lua[asset_id] = source;
				updated = true;
				changedAssets.add(asset_id);
			}
		}
		this.luaGenericAssetsExecuted.clear();
		if (!updated || !hotReload) {
			return changedAssets;
		}
		this.reloadChangedLuaAssets(changedAssets);
		return changedAssets;
	}

	private updateWorkspaceOverrideMap(asset_id: string, source: string, cartPath?: string | null, dirtyPath?: string | null): void {
		const original = this.rompackOriginalLua.get(asset_id);
		const normalizedSource = source.replace(/\r\n/g, '\n');
		if (original !== undefined && original !== null) {
			const normalizedOriginal = original.replace(/\r\n/g, '\n');
			if (normalizedSource === normalizedOriginal) {
				this.workspaceLuaOverrides.delete(asset_id);
				return;
			}
		}
		const effectiveCartPath = cartPath ?? $.rompack.luaSourcePaths[asset_id] ?? asset_id;
		const normalizedCartPath = this.normalizeWorkspacePath(effectiveCartPath);
		this.workspaceLuaOverrides.set(asset_id, { source, path: dirtyPath ?? null, cartPath: normalizedCartPath });
	}

	private persistWorkspaceOverridesToLocalStorage(root: string, overrides: Map<string, WorkspaceOverrideRecord>): void {
		for (const record of overrides.values()) {
			if (!record.path) {
				continue;
			}
			const storageKey = buildWorkspaceStorageKey(root, record.path);
			const payload = {
				contents: record.source,
				updatedAt: record.updatedAt ?? Date.now(),
			};
			this.storageService.setItem(storageKey, JSON.stringify(payload));
		}
	}

	private async applyServerWorkspaceDirtyLuaOverrides(hotReload: boolean): Promise<void> {
		const token = this.workspaceOverrideToken;
		const root = this.resolveCartProjectRootPath();
		if (!root) {
			return;
		}
		const localOverrides = collectWorkspaceOverrides({
			rompack: $.rompack,
			projectRootPath: root,
			storage: this.storageService,
		});
		const serverOverrides = await this.fetchWorkspaceDirtyLuaOverrides(root);
		const overrides = await this.mergeWorkspaceOverrides(root, localOverrides, serverOverrides);
		if (token !== this.workspaceOverrideToken) {
			return;
		}
		this.applyWorkspaceLuaOverrides(overrides, hotReload);
	}

	public refreshWorkspaceOverrides(hotReload: boolean, options?: { includeServer?: boolean; includeEditorBuffers?: boolean }): void {
		const includeServer = options ? options.includeServer !== false : true;
		const includeEditorBuffers = options ? options.includeEditorBuffers !== false : true;
		if (includeServer) {
			this.workspaceOverrideToken = this.workspaceOverrideToken + 1;
		}
		this.workspaceLuaOverrides.clear();
		this.applyLocalWorkspaceDirtyLuaOverrides(hotReload);
		if (includeServer) {
			void this.applyServerWorkspaceDirtyLuaOverrides(hotReload).catch((error) => {
				console.warn('[BmsxConsoleRuntime] Failed to refresh server workspace overrides; keeping local overrides active.', error);
			});
		}
		if (!includeEditorBuffers) {
			return;
		}
		const editorOverrides = this.overlayEditorBuffersToRompack();
		if (editorOverrides.size > 0) {
			this.applyWorkspaceLuaOverrides(editorOverrides, hotReload);
		}
	}

	private async applySavedWorkspaceLuaSources(): Promise<Set<string>> {
		const rompack = $.rompack;
		const changed = new Set<string>();
		for (const [asset_id, cartPath] of Object.entries(rompack.luaSourcePaths)) {
			if (typeof cartPath !== 'string' || cartPath.length === 0) {
				continue;
			}
			const normalizedPath = this.normalizeWorkspacePath(cartPath);
			const savedRecord = await this.fetchWorkspaceFile(normalizedPath);
			if (savedRecord === null) {
				continue;
			}
			const saved = savedRecord.contents;
			const current = rompack.lua[asset_id];
			if (current !== saved) {
				rompack.lua[asset_id] = saved;
				changed.add(asset_id);
			}
			this.rompackOriginalLua.set(asset_id, saved);
		}
		return changed;
	}

	public async refreshWorkspaceSources(hotReload: boolean): Promise<void> {
		this.workspaceOverrideToken = this.workspaceOverrideToken + 1;
		this.workspaceLuaOverrides.clear();
		this._workspaceScratchPaths.clear();
		const changedAssets = new Set<string>();
		const savedChanged = await this.applySavedWorkspaceLuaSources();
		for (const asset_id of savedChanged) {
			changedAssets.add(asset_id);
		}
		const root = this.resolveCartProjectRootPath();
		const scratchPaths = await this.collectScratchWorkspaceDirtyPaths(root);
		for (const path of scratchPaths) {
			this._workspaceScratchPaths.add(path);
		}
		const localOverrides = collectWorkspaceOverrides({
			rompack: $.rompack,
			projectRootPath: root,
			storage: this.storageService,
		});
		const serverOverrides = await this.fetchWorkspaceOverridesPriority() ?? new Map<string, WorkspaceOverrideRecord>();
		const merged = await this.mergeWorkspaceOverrides(root, localOverrides, serverOverrides);
		const dirtyChanged = this.applyWorkspaceLuaOverrides(merged, false);
		for (const asset_id of dirtyChanged) {
			changedAssets.add(asset_id);
		}
		const editorOverrides = this.overlayEditorBuffersToRompack();
		const editorChanged = this.applyWorkspaceLuaOverrides(editorOverrides, false);
		for (const asset_id of editorChanged) {
			changedAssets.add(asset_id);
		}
		if (hotReload && changedAssets.size > 0) {
			this.reloadChangedLuaAssets(changedAssets);
		}
	}

	private async mergeWorkspaceOverrides(
		root: string | null,
		localOverrides: Map<string, WorkspaceOverrideRecord>,
		serverOverrides: Map<string, WorkspaceOverrideRecord>,
	): Promise<Map<string, WorkspaceOverrideRecord>> {
		const merged = new Map<string, WorkspaceOverrideRecord>();
		const assetIds = new Set<string>([
			...localOverrides.keys(),
			...serverOverrides.keys(),
		]);
		for (const asset_id of assetIds) {
			const local = localOverrides.get(asset_id);
			const remote = serverOverrides.get(asset_id);
			const localTime = local?.updatedAt ?? 0;
			const remoteTime = remote?.updatedAt ?? 0;
			if (local && (!remote || localTime >= remoteTime)) {
				merged.set(asset_id, local);
				if (root) {
					this.persistWorkspaceOverridesToLocalStorage(root, new Map([[asset_id, local]]));
				}
				continue;
			}
			if (remote) {
				merged.set(asset_id, remote);
				if (root) {
					this.persistWorkspaceOverridesToLocalStorage(root, new Map([[asset_id, remote]]));
				}
			}
		}
		return merged;
	}

	private async fetchWorkspaceOverridesPriority(): Promise<Map<string, WorkspaceOverrideRecord> | null> {
		const root = this.resolveCartProjectRootPath();
		if (!root) {
			return null;
		}
		try {
			const serverOverrides = await this.fetchWorkspaceDirtyLuaOverrides(root);
			return serverOverrides;
		} catch (error) {
			console.warn('[BmsxConsoleRuntime] Failed to load server workspace overrides; falling back to local overrides.', error);
			return null;
		}
	}

	private buildDirtyPathForCartPath(cartPath: string, root: string): string {
		const normalizedCart = this.normalizeWorkspacePath(cartPath);
		return buildWorkspaceDirtyEntryPath(root, normalizedCart);
	}

	private async fetchWorkspaceDirtyLuaOverrides(root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
		const rompack = $.rompack;
		const tasks: Array<Promise<{ asset_id: string; contents: string; path: string | null; cartPath: string; updatedAt?: number } | null>> = [];
		// Fetching dirty files from backend is best-effort. Missing files do NOT mean we should
		// discard in-memory dirty edits; they simply yield no extra overrides.
		for (const [asset_id, cartPath] of Object.entries(rompack.luaSourcePaths)) {
			if (typeof cartPath !== 'string' || cartPath.length === 0) {
				console.warn('[BmsxConsoleRuntime] Invalid cartPath for asset_id:', asset_id);
				continue;
			}
			const dirtyPath = this.buildDirtyPathForCartPath(cartPath, root);
			tasks.push(this.fetchWorkspaceFile(dirtyPath).then((result) => {
				if (result === null) {
					return null;
				}
				const normalizedCartPath = this.normalizeWorkspacePath(cartPath);
				return { asset_id, contents: result.contents, path: dirtyPath, cartPath: normalizedCartPath, updatedAt: result.updatedAt };
			}));
		}
		if (tasks.length === 0) {
			return new Map<string, WorkspaceOverrideRecord>();
		}
		const results = await Promise.all(tasks);
		const overrides = new Map<string, WorkspaceOverrideRecord>();
		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			if (!result) {
				continue;
			}
			overrides.set(result.asset_id, { source: result.contents, path: result.path, cartPath: result.cartPath, updatedAt: result.updatedAt });
		}
		return overrides;
	}

	private async collectScratchWorkspaceDirtyPaths(root: string | null): Promise<Set<string>> {
		const paths = new Set<string>();
		if (!root) {
			return paths;
		}
		const statePath = buildWorkspaceStateFilePath(root);
		const payload = await this.fetchWorkspaceFile(statePath);
		if (!payload) {
			return paths;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload.contents);
		} catch {
			return paths;
		}
		if (!parsed || typeof parsed !== 'object') {
			return paths;
		}
		const record = parsed as { dirtyFiles?: Array<{ dirtyPath?: string; descriptor?: unknown }> };
		if (!Array.isArray(record.dirtyFiles)) {
			return paths;
		}
		for (let i = 0; i < record.dirtyFiles.length; i += 1) {
			const entry = record.dirtyFiles[i];
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			if (entry.descriptor !== null && entry.descriptor !== undefined) {
				continue;
			}
			if (typeof entry.dirtyPath === 'string' && entry.dirtyPath.length > 0) {
				const normalized = this.normalizeWorkspacePath(entry.dirtyPath);
				if (normalized.length > 0) {
					paths.add(normalized);
				}
			}
		}
		return paths;
	}

	private async fetchWorkspaceFile(path: string): Promise<{ contents: string; updatedAt?: number } | null> {
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
		let response: HttpResponse;
		try {
			response = await fetch(url, { method: 'GET', cache: 'no-store' });
		} catch {
			console.info(`[BmsxConsoleRuntime] Failed to fetch workspace file '${path}'. No server response.`);
			return null;
		}
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			console.info(`[BmsxConsoleRuntime] Workspace file request failed for '${path}' (HTTP ${response.status}).`);
			return null;
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			console.warn(`[BmsxConsoleRuntime] Failed to parse workspace file response JSON for '${path}'.`);
			return null;
		}
		if (!payload || typeof payload !== 'object') {
			console.warn(`[BmsxConsoleRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
			return null;
		}
		const record = payload as { contents?: string; updatedAt?: number };
		if (typeof record.contents !== 'string') {
			console.warn(`[BmsxConsoleRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
			return null;
		}
		return { contents: record.contents, updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined };
	}

	private async deleteWorkspaceFile(path: string): Promise<void> {
		if (typeof fetch !== 'function') {
			console.warn('[BmsxConsoleRuntime] Fetch API is not available.');
			return;
		}
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
		try {
			await fetch(url, { method: 'DELETE' });
		} catch {
			console.info('[BmsxConsoleRuntime] Failed to delete workspace file:', url);
			return;
		}
	}

	public async clearWorkspaceLuaOverrides(): Promise<void> {
		this.workspaceOverrideToken = this.workspaceOverrideToken + 1;
		if (this.editor) {
			this.editor.clearWorkspaceDirtyBuffers();
		}
		const rompack = $.rompack;
		for (const [asset_id, source] of this.rompackOriginalLua) {
			rompack.lua[asset_id] = source;
		}
		this.workspaceLuaOverrides.clear();
		this.luaGenericAssetsExecuted.clear();
		const root = this.resolveCartProjectRootPath();
		if (root) {
			for (const cartPath of Object.values(rompack.luaSourcePaths)) {
				if (typeof cartPath !== 'string' || cartPath.length === 0) {
					continue;
				}
				const dirtyPath = this.buildDirtyPathForCartPath(cartPath, root);
				const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
				this.storageService.removeItem(storageKey);
				void this.deleteWorkspaceFile(dirtyPath);
			}
			const statePath = buildWorkspaceStateFilePath(root);
			const stateKey = buildWorkspaceStorageKey(root, statePath);
			this.storageService.removeItem(stateKey);
			void this.deleteWorkspaceFile(statePath);
		}
		await this.refreshWorkspaceSources(false);
		if (this.luaInterpreter && this.luaProgram) {
			const asset = this.resolveEntryAsset(this.luaProgram);
			const chunkName = this.resolveProgramEntryChunkName(this.luaProgram);
			const finalSource = rompack.lua[asset.asset_id];
			this.reloadLuaProgramState(finalSource, chunkName);
			this.processPendingLuaAssets('workspace:reset');
		}
	}

	public async nukeWorkspace(): Promise<void> {
		await this.clearWorkspaceLuaOverrides();
		this.workspaceLuaOverrides.clear();
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
		const asset_id = request.asset_id && request.asset_id.length > 0 ? request.asset_id : null;
		const usageRow = Number.isFinite(request.row) ? Math.max(1, Math.floor(request.row)) : null;
		const usageColumn = Number.isFinite(request.column) ? Math.max(1, Math.floor(request.column)) : null;
		const resolved = this.resolveLuaChainValue(chain, asset_id);
		const staticDefinition = this.findStaticDefinitionLocation(asset_id, chain, usageRow, usageColumn, request.chunkName);
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
			definition = this.resolveLuaDefinitionMetadata(resolved.value, asset_id, resolved.definitionRange);
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

	private listLuaObjectMembers(request: ConsoleLuaMemberCompletionRequest): ConsoleLuaMemberCompletion[] {
		const trimmed = request.expression.trim();
		if (trimmed.length === 0) {
			return [];
		}
		const chain = this.parseLuaIdentifierChain(trimmed);
		if (!chain) {
			return [];
		}
		const resolved = this.resolveLuaChainValue(chain, request.asset_id);
		if (!resolved || resolved.kind !== 'value') {
			return [];
		}
		const value = resolved.value;
		if (value === null) {
			return [];
		}
		if (isLuaNativeValue(value)) {
			return this.getNativeMemberCompletionEntries(value, request.operator);
		}
		if (isLuaTable(value)) {
			return this.buildTableMemberCompletionEntries(value, request.operator);
		}
		return [];
	}

	private resolveLuaDefinitionMetadata(value: LuaValue, fallbackasset_id: string | null, definitionRange: LuaSourceRange | null): ConsoleLuaDefinitionLocation | null {
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
		return this.buildDefinitionLocationFromRange(range, fallbackasset_id);
	}

	private buildDefinitionLocationFromRange(range: LuaSourceRange, fallbackasset_id: string | null): ConsoleLuaDefinitionLocation {
		const normalizedChunk = this.normalizeChunkName(range.chunkName);
		const chunkResource = this.lookupChunkResourceInfoNullable(range.chunkName);
		const asset_id = chunkResource?.asset_id ?? fallbackasset_id ?? null;
		const location: ConsoleLuaDefinitionLocation = {
			chunkName: normalizedChunk,
			asset_id,
			range: {
				startLine: range.start.line,
				startColumn: range.start.column,
				endLine: range.end.line,
				endColumn: range.end.column,
			},
		};
		if (chunkResource?.path) {
			location.path = chunkResource.path;
		} else if (asset_id) {
			const resolvedPath = this.resolveResourcePath(asset_id);
			if (resolvedPath) {
				location.path = resolvedPath;
			}
		}
		return location;
	}

	public listLuaSymbols(asset_id: string | null, chunkName: string | null): ConsoleLuaSymbolEntry[] {
		const bundle = this.getStaticDefinitions(asset_id, chunkName);
		if (!bundle || bundle.definitions.length === 0) {
			return [];
		}
		const { definitions } = bundle;
		const definitionPriority = (kind: LuaDefinitionKind): number => {
			switch (kind) {
				case 'table_field':
					return 5;
				case 'function':
					return 4;
				case 'parameter':
					return 3;
				case 'variable':
					return 2;
				case 'assignment':
				default:
					return 1;
			}
		};
		const entries = new Map<string, { info: LuaDefinitionInfo; location: ConsoleLuaDefinitionLocation; priority: number }>();
		for (const info of definitions) {
			const location = this.buildDefinitionLocationFromRange(info.definition, asset_id);
			const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
			const keyPath = path.length > 0 ? path : info.name;
			const key = `${location.chunkName ?? ''}::${keyPath}@${location.range.startLine}:${location.range.startColumn}`;
			const priority = definitionPriority(info.kind);
			const existing = entries.get(key);
			if (!existing || priority > existing.priority || (priority === existing.priority && info.definition.start.line < existing.info.definition.start.line)) {
				entries.set(key, { info, location, priority });
			}
		}
		const symbols: ConsoleLuaSymbolEntry[] = [];
		for (const { info, location } of entries.values()) {
			const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
			symbols.push({
				name: info.name,
				path,
				kind: info.kind,
				location,
			});
		}
		symbols.sort((a, b) => {
			const aLine = a.location.range.startLine;
			const bLine = b.location.range.startLine;
			if (aLine !== bLine) {
				return aLine - bLine;
			}
			return a.path.localeCompare(b.path);
		});
		return symbols;
	}

	public listLuaModuleSymbols(moduleName: string): ConsoleLuaSymbolEntry[] {
		this.ensureLuaModuleIndex();
		const record = this.luaModuleAliases.get(this.normalizeModuleKey(moduleName));
		if (!record) {
			return [];
		}
		return this.listLuaSymbols(record.asset_id, record.chunkName);
	}

	public listLuaBuiltinFunctions(): ConsoleLuaBuiltinDescriptor[] {
		const result: ConsoleLuaBuiltinDescriptor[] = [];
		for (const metadata of this.luaBuiltinMetadata.values()) {
			const optionalParams = metadata.optionalParams ?? [];
			const optionalSet = optionalParams.length > 0 ? new Set(optionalParams) : null;
			const params = metadata.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param));
			const parameterDescriptions = metadata.parameterDescriptions ? metadata.parameterDescriptions.slice() : undefined;
			result.push({
				name: metadata.name,
				params,
				signature: metadata.signature,
				optionalParams,
				parameterDescriptions,
				description: metadata.description ?? null,
			});
		}
		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}

	public listAllLuaSymbols(): ConsoleLuaSymbolEntry[] {
		const entries = new Map<string, { info: LuaDefinitionInfo; location: ConsoleLuaDefinitionLocation; priority: number }>();

		const appendDefinitions = (info: { asset_id: string | null; path?: string | null }, definitions: ReadonlyArray<LuaDefinitionInfo> | null) => {
			if (!definitions) {
				return;
			}
			for (const definition of definitions) {
				const location = this.buildDefinitionLocationFromRange(definition.definition, info.asset_id);
				if (info.path && !location.path) {
					location.path = info.path;
				}
				const symbolPath = definition.namePath.length > 0 ? definition.namePath.join('.') : definition.name;
				const key = `${location.chunkName}::${symbolPath}@${definition.definition.start.line}:${definition.definition.start.column}`;
				const priority = (() => {
					switch (definition.kind) {
						case 'table_field':
							return 5;
						case 'function':
							return 4;
						case 'variable':
							return 3;
						case 'parameter':
							return 2;
						case 'assignment':
						default:
							return 1;
					}
				})();
				const existing = entries.get(key);
				if (!existing || priority > existing.priority) {
					entries.set(key, { info: definition, location, priority });
				}
			}
		};

		const enqueuedChunks = new Set<string>();
		const candidates: Array<{ chunkName: string; info: { asset_id: string | null; path?: string | null } }> = [];
		const enqueueCandidate = (chunkName: string | null | undefined, info: { asset_id: string | null; path?: string | null }): void => {
			if (!chunkName) {
				return;
			}
			const normalizedChunk = this.normalizeChunkName(chunkName);
			const key = `${info.asset_id ?? ''}|${normalizedChunk}`;
			if (enqueuedChunks.has(key)) {
				return;
			}
			enqueuedChunks.add(key);
			const candidateInfo: { asset_id: string | null; path?: string | null } = { asset_id: info.asset_id ?? null };
			if (info.path !== undefined) {
				candidateInfo.path = info.path;
			}
			candidates.push({ chunkName: normalizedChunk, info: candidateInfo });
		};

		const descriptors = this.getResourceDescriptors().filter(descriptor => {
			if (descriptor.type === 'lua') {
				return true;
			}
			const lowerPath = descriptor.path.toLowerCase();
			return lowerPath.endsWith('.lua');
		});
		const programasset_id = (() => {
			const program = this.luaProgram;
			if (!program) return null;
			return this.resolveEntryAsset(program).asset_id;
		})();

		for (const descriptor of descriptors) {
			let asset_id = descriptor.asset_id ?? null;
			if (!asset_id) {
				asset_id = this.resolveAssetIdFromPath(descriptor.path);
			}
			if (asset_id && programasset_id && asset_id === programasset_id) {
				continue;
			}
			const chunkName = descriptor.path ?? descriptor.asset_id ?? 'lua_resource';
			const info = { asset_id, path: descriptor.path ?? null };
			enqueueCandidate(chunkName, info);
		}

		for (const [chunkName, info] of this.luaChunkResourceMap) {
			const candidateInfo: { asset_id: string | null; path?: string | null } = {
				asset_id: info.asset_id ?? null,
			};
			if (info.path !== undefined) {
				candidateInfo.path = info.path;
			}
			enqueueCandidate(chunkName, candidateInfo);
		}

		const program = this.luaProgram;
		if (program) {
			const programChunk = this.normalizeChunkName(this.resolveProgramEntryChunkName(program));
			const primary = this.resolveEntryAsset(program);
			const programInfo: { asset_id: string | null; path?: string | null } = { asset_id: primary.asset_id, path: this.resolveResourcePath(primary.asset_id) ?? undefined };
			enqueueCandidate(programChunk, programInfo);
		}

		for (const candidate of candidates) {
			const model = this.buildSemanticModelForChunk(candidate.chunkName, candidate.info);
			appendDefinitions(candidate.info, model ? model.definitions : null);
		}

		const symbols: ConsoleLuaSymbolEntry[] = [];
		for (const { info, location } of entries.values()) {
			const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
			symbols.push({
				name: info.name,
				path,
				kind: info.kind,
				location,
			});
		}
		symbols.sort((a, b) => {
			const pathA = a.location.path ?? a.location.chunkName ?? '';
			const pathB = b.location.path ?? b.location.chunkName ?? '';
			if (pathA !== pathB) {
				return pathA.localeCompare(pathB);
			}
			const lineA = a.location.range.startLine;
			const lineB = b.location.range.startLine;
			if (lineA !== lineB) {
				return lineA - lineB;
			}
			return a.path.localeCompare(b.path);
		});
		return symbols;
	}

	private findStaticDefinitionLocation(asset_id: string | null, chain: ReadonlyArray<string>, usageRow: number | null, usageColumn: number | null, preferredChunk: string | null): ConsoleLuaDefinitionLocation | null {
		if (chain.length === 0) {
			return null;
		}
		const bundle = this.getStaticDefinitions(asset_id, preferredChunk);
		if (!bundle || bundle.definitions.length === 0) {
			return null;
		}
		const { definitions, chunks, models } = bundle;
		if (usageRow !== null && usageColumn !== null) {
			for (let index = 0; index < chunks.length; index += 1) {
				const chunk = chunks[index];
				let model = models.get(chunk.chunkName) ?? null;
				if (!model) {
					const source = this.resolveSourceForChunk(chunk.chunkName, chunk.info);
					if (!source) {
						continue;
					}
					model = buildLuaSemanticModel(source, chunk.chunkName);
					models.set(chunk.chunkName, model);
				}
				const semanticDefinition = model.lookupIdentifier(usageRow, usageColumn, chain);
				if (semanticDefinition) {
					const targetAsset = chunk.info.asset_id ?? asset_id;
					return this.buildDefinitionLocationFromRange(semanticDefinition.definition, targetAsset);
				}
			}
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
		const definitionPriority = (info: LuaDefinitionInfo): number => {
			switch (info.kind) {
				case 'parameter':
					return 5;
				case 'table_field':
					return 4;
				case 'function':
					return 3;
				case 'variable':
					return 2;
				case 'assignment':
				default:
					return 1;
			}
		};
		const selectPreferred = (candidate: LuaDefinitionInfo, current: LuaDefinitionInfo | null): LuaDefinitionInfo | null => {
			const candidatePriority = definitionPriority(candidate);
			const currentPriority = current ? definitionPriority(current) : -1;
			if (usageRow !== null) {
				if (!this.positionWithinRange(usageRow, usageColumn, candidate.scope)) {
					return current;
				}
				if (usageRow < candidate.definition.start.line) {
					return current;
				}
				if (
					!current
					|| candidatePriority > currentPriority
					|| (candidatePriority === currentPriority
						&& (
							candidate.definition.start.line > current.definition.start.line
							|| (candidate.definition.start.line === current.definition.start.line
								&& candidate.definition.start.column >= current.definition.start.column)
						))
				) {
					return candidate;
				}
				return current;
			}
			if (
				!current
				|| candidatePriority > currentPriority
				|| (candidatePriority === currentPriority
					&& (
						candidate.definition.start.line < current.definition.start.line
						|| (candidate.definition.start.line === current.definition.start.line
							&& candidate.definition.start.column < current.definition.start.column)
					))
			)
				return candidate;
			return current;
		};
		let bestExact: LuaDefinitionInfo | null = null;
		let bestPartial: LuaDefinitionInfo | null = null;
		for (let i = 0; i < definitions.length; i += 1) {
			const definition = definitions[i];
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
		return this.buildDefinitionLocationFromRange(chosen.definition, asset_id);
	}

	private getStaticDefinitions(asset_id: string | null, preferredChunk: string | null): { definitions: ReadonlyArray<LuaDefinitionInfo>; chunks: Array<{ chunkName: string; info: { asset_id: string | null; path?: string | null } }>; models: Map<string, LuaSemanticModel> } | null {
		const interpreter = this.luaInterpreter;
		const normalizedPreferred = preferredChunk ? this.normalizeChunkName(preferredChunk) : null;
		const normalizedPreferredPath = preferredChunk ? preferredChunk.replace(/\\/g, '/') : null;
		const matchingChunks: Array<{ chunkName: string; info: { asset_id: string | null; path?: string | null } }> = [];
		for (const [chunkName, info] of this.luaChunkResourceMap) {
			const matchesAsset = asset_id !== null && info.asset_id === asset_id;
			const matchesPath = normalizedPreferredPath !== null && info.path === normalizedPreferredPath;
			const matchesChunk = normalizedPreferred !== null && this.normalizeChunkName(chunkName) === normalizedPreferred;
			if (!matchesAsset && !matchesPath && !matchesChunk) {
				continue;
			}
			matchingChunks.push({ chunkName, info });
		}
		if (matchingChunks.length === 0) {
			return null;
		}
		const byKey = new Map<string, LuaDefinitionInfo>();
		const models: Map<string, LuaSemanticModel> = new Map();
		const recordDefinition = (definition: LuaDefinitionInfo) => {
			const key = `${definition.namePath.join('.')}@${definition.definition.start.line}:${definition.definition.start.column}`;
			if (!byKey.has(key)) {
				byKey.set(key, definition);
			}
		};
		for (let index = 0; index < matchingChunks.length; index += 1) {
			const candidate = matchingChunks[index];
			const chunkDefinitions = interpreter.getChunkDefinitions(candidate.chunkName);
			if (chunkDefinitions && chunkDefinitions.length > 0) {
				for (let defIndex = 0; defIndex < chunkDefinitions.length; defIndex += 1) {
					recordDefinition(chunkDefinitions[defIndex]);
				}
			}
			const model = this.buildSemanticModelForChunk(candidate.chunkName, candidate.info);
			const normalizedChunk = this.normalizeChunkName(candidate.chunkName);
			const cacheEntry = this.chunkSemanticCache.get(normalizedChunk);
			const cachedDefinitions = cacheEntry ? cacheEntry.definitions : (model ? model.definitions : []);
			if (model) {
				models.set(candidate.chunkName, model);
			}
			for (let defIndex = 0; defIndex < cachedDefinitions.length; defIndex += 1) {
				recordDefinition(cachedDefinitions[defIndex]);
			}
		}
		if (byKey.size === 0) {
			return null;
		}
		return { definitions: Array.from(byKey.values()), chunks: matchingChunks, models };
	}

	private buildSemanticModelForChunk(chunkName: string, info: { asset_id: string | null; path?: string | null }): LuaSemanticModel | null {
		const source = this.resolveSourceForChunk(chunkName, info);
		if (!source) {
			return null;
		}
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const cached = this.chunkSemanticCache.get(normalizedChunk);
		const previousModel = cached ? cached.model : null;
		const previousDefinitions = cached ? cached.definitions : [];
		if (cached && cached.source === source) {
			return cached.model;
		}
		try {
			const model = buildLuaSemanticModel(source, chunkName);
			this.chunkSemanticCache.set(normalizedChunk, { source, model, definitions: model.definitions });
			return model;
		} catch (error) {
			if (error instanceof LuaSyntaxError) {
				const sanitizedSource = (() => {
					if (!Number.isFinite(error.line)) {
						return null;
					}
					const lines = source.split('\n');
					const lineIndex = error.line - 1;
					if (lineIndex < 0 || lineIndex >= lines.length) {
						return null;
					}
					const originalLine = lines[lineIndex];
					const trimmed = originalLine.trimStart();
					if (trimmed.startsWith('--__BMSX_SYNTAX_ERROR__')) {
						return null;
					}
					const prefixLength = originalLine.length - trimmed.length;
					const prefix = originalLine.slice(0, prefixLength);
					lines[lineIndex] = `${prefix}--__BMSX_SYNTAX_ERROR__ ${trimmed}`;
					return lines.join('\n');
				})();
				if (sanitizedSource && sanitizedSource !== source) {
					try {
						const model = buildLuaSemanticModel(sanitizedSource, chunkName);
						this.chunkSemanticCache.set(normalizedChunk, { source, model, definitions: model.definitions });
						return model;
					} catch {
						// continue with fallback logic below
					}
				}
				if (previousModel) {
					this.chunkSemanticCache.set(normalizedChunk, { source, model: previousModel, definitions: previousDefinitions });
					return previousModel;
				}
				this.chunkSemanticCache.set(normalizedChunk, { source, model: null, definitions: [] });
				return null;
			}
			const message = this.extractErrorMessage(error);
			this.chunkSemanticCache.set(normalizedChunk, { source, model: null, definitions: [] });
			console.warn(`[BmsxConsoleRuntime] Failed to parse '${chunkName}': ${message}`);
			return null;
		}
	}

	private resolveSourceForChunk(chunkName: string, info: { asset_id: string | null; path?: string | null }): string | null {
		if (this.editor) {
			try {
				return this.editor.getSourceForChunk(info.asset_id, chunkName);
			} catch {
				// Fall back to rompack/program sources.
				console.warn(`[BmsxConsoleRuntime] Editor failed to provide source for chunk '${chunkName}'. Falling back to rompack/program sources.`);
			}
		}
		if (info.asset_id) {
			const rompackSource = this.resolveRompackLuaSource(info.asset_id);
			if (rompackSource) {
				return rompackSource;
			}
		}
		return this.resolveProgramSourceForChunk(chunkName);
	}

	private resolveRompackLuaSource(asset_id: string): string | null {
		const rompack = $.rompack;
		const source = rompack.lua[asset_id];
		return source ?? null;
	}

	private resolveProgramSourceForChunk(chunkName: string): string | null {
		if (!this.luaProgram) {
			return null;
		}
		const programChunk = this.normalizeChunkName(this.resolveProgramEntryChunkName(this.luaProgram));
		const normalizedChunk = this.normalizeChunkName(chunkName);
		if (programChunk !== normalizedChunk) {
			return null;
		}
		return this.getProgramEntrySource(this.luaProgram);
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

	private resolveLuaChainValue(parts: string[], asset_id: string | null): ({ kind: 'value'; value: LuaValue; scope: ConsoleLuaHoverScope; definitionRange: LuaSourceRange | null } | { kind: 'not_defined'; scope: ConsoleLuaHoverScope }) | null {
		if (!parts || parts.length === 0) {
			return null;
		}
		const interpreter = this.luaInterpreter;
		const root = parts[0];
		let value: LuaValue | null = null;
		let scope: ConsoleLuaHoverScope = 'global';
		let found = false;
		let definitionEnv: LuaEnvironment | null = null;
		let definitionRange: LuaSourceRange | null = null;
		const globalEnv = interpreter.globalEnvironment;

		const frameEnv = interpreter.lastFaultEnvironment;
		if (frameEnv) {
			const resolved = this.resolveIdentifierThroughChain(frameEnv, root, interpreter);
			if (resolved) {
				value = resolved.value;
				scope = resolved.scope;
				found = true;
				definitionEnv = resolved.environment;
			}
		}
		if (!found && asset_id) {
			const env = this.luaChunkEnvironmentsByAssetId.get(asset_id) ?? null;
			if (env && env.hasLocal(root)) {
				value = env.get(root);
				scope = env === globalEnv ? 'global' : 'chunk';
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
					scope = envByChunk === globalEnv ? 'global' : 'chunk';
					found = true;
					definitionEnv = envByChunk;
				}
			}
		}
		if (!found) {
			if (globalEnv.hasLocal(root)) {
				value = globalEnv.get(root);
				scope = 'global';
				found = true;
				definitionEnv = globalEnv;
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
			if (!(isLuaTable(current))) {
				return { kind: 'not_defined', scope };
			}
			const nextValue = current.get(part);
			if (nextValue === null) {
				return { kind: 'not_defined', scope };
			}
			current = nextValue;
			definitionRange = null;
		}
		return { kind: 'value', value: current, scope, definitionRange };
	}

	private resolveIdentifierThroughChain(environment: LuaEnvironment, name: string, interpreter: LuaInterpreter): { environment: LuaEnvironment; value: LuaValue | null; scope: ConsoleLuaHoverScope } | null {
		let current: LuaEnvironment | null = environment;
		const globalEnv = interpreter.globalEnvironment;
		while (current) {
			if (current.hasLocal(name)) {
				const value = current.get(name);
				const scope: ConsoleLuaHoverScope = current === globalEnv ? 'global' : 'chunk';
				return { environment: current, value, scope };
			}
			current = current.getParent();
		}
		return null;
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
		if (isLuaNativeValue(value)) {
			const native = value.native;
			const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : this.resolveNativeTypeName(native);
			if (typeof native === 'function') {
				const params = this.extractFunctionParameters(native as (...args: unknown[]) => unknown);
				const paramSegment = params.length > 0 ? params.join(', ') : '';
				const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
				const label = typeName && typeName.length > 0 ? `<native function ${typeName}${signature}>` : `<native function${signature}>`;
				return { lines: [label], valueType: typeName ?? 'native', isFunction: true };
			}
			let summary = `<${typeName ?? 'native'}>`;
			const identifier = (native as { id?: unknown }).id;
			if (identifier !== undefined && identifier !== null) {
				summary = `${summary} id=${String(identifier)}`;
			}
			return { lines: [summary], valueType: typeName ?? 'native', isFunction: false };
		}
		if (isLuaTable(value)) {
			try {
				const ctx = this.createLuaSnapshotContext();
				const serialized = { root: this.serializeLuaValueForSnapshot(value, ctx), objects: ctx.objects };
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

	private getNativeMemberCompletionEntries(value: LuaNativeValue, operator: '.' | ':'): ConsoleLuaMemberCompletion[] {
		const native = value.native;
		const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : this.resolveNativeTypeName(native);
		const registry = new Map<string, ConsoleLuaMemberCompletion>();
		const includeProperties = operator === '.';
		const metatable = value.getMetatable();
		if (metatable) {
			const indexValue = metatable.get('__index');
			if (isLuaTable(indexValue)) {
				const luaEntries = this.buildTableMemberCompletionEntries(indexValue, operator);
				for (let index = 0; index < luaEntries.length; index += 1) {
					this.registerNativeCompletion(registry, luaEntries[index]);
				}
			}
		}
		if (typeof native === 'object' && native !== null) {
			this.populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
		} else if (typeof native === 'function' && operator === '.') {
			this.populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
		}
		const prototypeEntries = this.getCachedPrototypeNativeEntries(native, operator, typeName);
		for (let index = 0; index < prototypeEntries.length; index += 1) {
			this.registerNativeCompletion(registry, prototypeEntries[index]);
		}
		const result: ConsoleLuaMemberCompletion[] = [];
		for (const entry of registry.values()) {
			result.push({
				name: entry.name,
				kind: entry.kind,
				detail: entry.detail,
				parameters: entry.parameters.slice(),
			});
		}
		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}

	private getCachedPrototypeNativeEntries(native: object | Function, operator: '.' | ':', typeName: string | null): ConsoleLuaMemberCompletion[] {
		const cacheKey = this.resolveNativeCompletionCacheKey(native);
		const cacheField = operator === ':' ? 'colon' : 'dot';
		let cache = this.nativeMemberCompletionCache.get(cacheKey);
		const cached = cache && cache[cacheField];
		if (cached) {
			return this.cloneMemberCompletions(cached);
		}
		const built = this.buildNativePrototypeMemberEntries(native, operator, typeName);
		if (!cache) {
			cache = {};
			this.nativeMemberCompletionCache.set(cacheKey, cache);
		}
		cache[cacheField] = built;
		return this.cloneMemberCompletions(built);
	}

	private buildNativePrototypeMemberEntries(native: object | Function, operator: '.' | ':', typeName: string | null): ConsoleLuaMemberCompletion[] {
		const registry = new Map<string, ConsoleLuaMemberCompletion>();
		const includeProperties = operator === '.';
		const visited = new Set<object>();
		const traverse = (target: object | null): void => {
			let current = target;
			while (current && !visited.has(current)) {
				if (current === Object.prototype || current === Function.prototype) {
					return;
				}
				visited.add(current);
				this.populateNativeMembersFromTarget(current, operator, typeName, registry, includeProperties);
				current = Object.getPrototypeOf(current);
			}
		};
		if (typeof native === 'function') {
			const prototype = native.prototype && typeof native.prototype === 'object' ? native.prototype : null;
			traverse(prototype);
			if (operator === '.') {
				const functionPrototype = Object.getPrototypeOf(native);
				traverse(functionPrototype);
			}
		} else {
			traverse(Object.getPrototypeOf(native));
		}
		const entries: ConsoleLuaMemberCompletion[] = [];
		for (const entry of registry.values()) {
			entries.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		return entries;
	}

	private buildTableMemberCompletionEntries(table: LuaTable, operator: '.' | ':'): ConsoleLuaMemberCompletion[] {
		const registry = new Map<string, ConsoleLuaMemberCompletion>();
		const includeProperties = operator === '.';

		const appendFromTable = (target: LuaTable) => {
			const entries = target.entriesArray();
			for (let index = 0; index < entries.length; index += 1) {
				const [key, entryValue] = entries[index];
				if (typeof key !== 'string' || key.length === 0) {
					continue;
				}
				if (key === '__index' || key === '__metatable') {
					continue;
				}
				const isFunction = this.isLuaFunctionValue(entryValue);
				if (operator === ':' && !isFunction) {
					continue;
				}
				const kind: 'method' | 'property' = isFunction ? 'method' : 'property';
				if (!includeProperties && kind === 'property') {
					continue;
				}
				if (registry.has(key)) {
					continue;
				}
				const detail = isFunction ? `function ${key}` : `table field '${key}'`;
				registry.set(key, { name: key, kind, detail, parameters: [] });
			}
		};

		const visited = new Set<LuaTable>();
		let current: LuaTable | null = table;
		while (current && !visited.has(current)) {
			visited.add(current);
			appendFromTable(current);
			let nextTable: LuaTable | null = null;

			const metatable = current.getMetatable();
			if (metatable) {
				const metatableIndex = metatable.get('__index');
				if (isLuaTable(metatableIndex)) {
					nextTable = metatableIndex;
				}
			}

			if (!nextTable) {
				const ownIndex = current.get('__index');
				if (isLuaTable(ownIndex)) {
					nextTable = ownIndex;
				}
			}

			if (!nextTable) {
				break;
			}

			current = nextTable;
		}

		const results: ConsoleLuaMemberCompletion[] = [];
		for (const entry of registry.values()) {
			results.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
		}
		results.sort((a, b) => a.name.localeCompare(b.name));
		return results;
	}

	private resolveNativeCompletionCacheKey(native: object | Function): object {
		if (typeof native === 'function') {
			return native;
		}
		const prototype = Object.getPrototypeOf(native);
		if (prototype && typeof prototype === 'object') {
			return prototype;
		}
		return native;
	}

	private populateNativeMembersFromTarget(target: object, operator: '.' | ':', typeName: string | null, registry: Map<string, ConsoleLuaMemberCompletion>, includeProperties: boolean): void {
		const propertyNames = Object.getOwnPropertyNames(target);
		const isFunctionTarget = typeof target === 'function';
		const skipFunctionPrototypeMembers = target === Function.prototype;
		for (let index = 0; index < propertyNames.length; index += 1) {
			const name = propertyNames[index];
			if (!name || name === 'constructor' || name === '__proto__' || name === 'prototype' || name === 'caller' || name === 'callee') {
				continue;
			}
			if (skipFunctionPrototypeMembers && (name === 'call' || name === 'apply' || name === 'bind')) {
				continue;
			}
			if (isFunctionTarget && (name === 'length' || name === 'name' || name === 'arguments')) {
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(target, name);
			if (!descriptor) {
				continue;
			}
			if (typeof descriptor.value === 'function') {
				const rawParams = this.extractFunctionParameters(descriptor.value as (...args: unknown[]) => unknown);
				const params = operator === ':' ? this.adjustMethodParametersForColon(rawParams) : rawParams.slice();
				const detail = this.formatNativeMethodDetail(typeName, name, params, operator);
				this.registerNativeCompletion(registry, { name, kind: 'method', detail, parameters: params });
				continue;
			}
			const hasGetter = typeof descriptor.get === 'function';
			const hasSetter = typeof descriptor.set === 'function';
			if (includeProperties && (hasGetter || 'value' in descriptor)) {
				const detail = this.formatNativePropertyDetail(typeName, name, hasGetter, hasSetter);
				this.registerNativeCompletion(registry, { name, kind: 'property', detail, parameters: [] });
			}
		}
	}

	private registerNativeCompletion(registry: Map<string, ConsoleLuaMemberCompletion>, entry: ConsoleLuaMemberCompletion): void {
		if (registry.has(entry.name)) {
			return;
		}
		registry.set(entry.name, {
			name: entry.name,
			kind: entry.kind,
			detail: entry.detail,
			parameters: entry.parameters.slice(),
		});
	}

	private adjustMethodParametersForColon(params: string[]): string[] {
		if (!params || params.length === 0) {
			return [];
		}
		const first = params[0] ?? '';
		const normalized = first.trim().toLowerCase();
		if (normalized === 'self' || normalized === 'this') {
			return params.slice(1);
		}
		return params.slice();
	}

	private formatNativeMethodDetail(typeName: string | null, name: string, parameters: readonly string[], operator: '.' | ':'): string {
		const paramSegment = parameters.length > 0 ? parameters.join(', ') : '';
		const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
		const separator = operator === ':' ? ':' : '.';
		if (typeName && typeName.length > 0) {
			return `${typeName}${separator}${name}${signature}`;
		}
		return `${name}${signature}`;
	}

	private formatNativePropertyDetail(typeName: string | null, name: string, hasGetter: boolean, hasSetter: boolean): string {
		const base = typeName && typeName.length > 0 ? `${typeName}.${name}` : name;
		if (hasGetter && hasSetter) {
			return `${base} (property)`;
		}
		if (hasGetter) {
			return `${base} (read-only)`;
		}
		if (hasSetter) {
			return `${base} (write-only)`;
		}
		return `${base}`;
	}

	private cloneMemberCompletions(entries: ConsoleLuaMemberCompletion[]): ConsoleLuaMemberCompletion[] {
		const cloned: ConsoleLuaMemberCompletion[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			cloned.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
		}
		return cloned;
	}

	private clearNativeMemberCompletionCache(): void {
		this.nativeMemberCompletionCache = new WeakMap<object, { dot?: ConsoleLuaMemberCompletion[]; colon?: ConsoleLuaMemberCompletion[] }>();
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
		// Also support '$' (36) and '_' (95) as valid start characters.
		if (code === 36) { // Note that '$' is not standard in Lua, but used by my game engine to denote the singleton Game instance
			return true;
		}
		if (code === 95) {
			return true;
		}

		return false;
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
		return this.luaBuiltinMetadata.has(name);
	}

	private refreshLuaHandlersForChunk(chunkName: string, sourceOverride?: string | null): void {
		const normalized = this.normalizeChunkName(chunkName);
		const resourceInfo = this.lookupChunkResourceInfo(normalized) ?? { asset_id: null };
		const asset_id = resourceInfo.asset_id ?? null;
		this.luaGenericAssetsExecuted.delete(asset_id ?? normalized);
		this.registerLuaChunkResource(chunkName, resourceInfo);
		this.reloadGenericLuaChunk(chunkName, resourceInfo, sourceOverride);
		this.clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private reloadGenericLuaChunk(chunkName: string, info: { asset_id: string | null; path?: string | null }, sourceOverride: string | null): void {
		const interpreter = this.luaInterpreter;
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const previousChunkState = this.captureChunkState(normalizedChunk);
		const previousChunkTables = this.captureChunkTables(normalizedChunk);
		const previousGlobals = this.captureGlobalStateForReload();
		const source = sourceOverride ?? this.resolveSourceForChunk(chunkName, info);
		if (!source) {
			return;
		}
		const moduleId = this.moduleIdFor(info.asset_id, chunkName);
		const results = interpreter.execute(source, chunkName);
		this.wrapLuaExecutionResults(moduleId, results);
		this.cacheChunkEnvironment(chunkName, info.asset_id, moduleId);
		this.restoreChunkState(interpreter.chunkEnvironment, previousChunkState);
		this.restoreChunkTables(interpreter.chunkEnvironment, previousChunkTables);
		this.restoreGlobalStateForReload(previousGlobals);
		const packageKey = this.resolveLuaModulePackageKey(info.asset_id ?? normalizedChunk, chunkName);
		this.refreshPackageLoadedEntry(packageKey, results);
		const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
		this.rebindChunkEnvironmentHandlers(moduleId);
		this.rebindModuleExportHandlers(moduleId, moduleValue);
		this.luaGenericAssetsExecuted.add(info.asset_id ?? normalizedChunk);
	}
}
