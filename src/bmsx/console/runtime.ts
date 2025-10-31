import type { StorageService } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { BmsxConsoleInput } from './input';
import { BmsxConsoleStorage } from './storage';
import { ConsoleColliderManager } from './collision';
import { Physics2DManager } from '../physics/physics2d';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram, ConsoleResourceDescriptor, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaResourceCreationRequest, ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry, ConsoleLuaBuiltinDescriptor } from './types';
import type { RomResourcePath } from '../rompack/rompack';
import { createLuaInterpreter, LuaInterpreter, createLuaNativeFunction, type LuaCallFrame } from '../lua/runtime.ts';
import { LuaEnvironment } from '../lua/environment.ts';
import type { LuaFunctionValue, LuaValue, LuaTable } from '../lua/value.ts';
import { createLuaTable, isLuaTable, setLuaTableCaseInsensitiveKeys } from '../lua/value.ts';
import { LuaRuntimeError, LuaError } from '../lua/errors.ts';
import { $ } from '../core/game';
import { Service } from '../core/service';
import { EventEmitter, type EventPayload } from '../core/eventemitter';
import type { Identifier, Identifiable } from '../rompack/rompack';
import { consoleEditorSpec } from '../core/pipelines/console_editor';
import { EditorConsoleRenderBackend } from './render_backend';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import { HandlerRegistry, LuaHotReloader, registerLuaHandler, subscribeLua, type GenericHandler, type LuaHotReloadCompilationResult, type LuaHandlerMeta } from '../core/handlerregistry';
import { ActiveStateMachines, migrateMachineDiff, StateDefinitions, applyPreparedStateMachine } from '../fsm/fsmlibrary';
import { instantiateBehaviorTree, unregisterBehaviorTreeBuilder, applyPreparedBehaviorTree, getBehaviorTreeDiagnostics } from '../ai/behaviourtree';
import type { BehaviorTreeDefinition, BehaviorTreeDiagnostic } from '../ai/behaviourtree';
import type { Stateful, StateMachineBlueprint } from '../fsm/fsmtypes';
import type { StateDefinition } from '../fsm/statedefinition';
import type { StateMachineController } from '../fsm/fsmcontroller';
import type { LuaSourceRange, LuaDefinitionInfo, LuaDefinitionKind } from '../lua/ast.ts';
import { ConsoleCartEditor } from './ide/console_cart_editor';
import { ConsoleLuaEditor } from './ide/console_lua_editor';
import type { RuntimeErrorDetails, RuntimeErrorStackFrame } from './ide/types';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import type { ConsoleFontVariant } from './font';
import { buildLuaSemanticModel, type LuaSemanticModel } from './ide/semantic_model';
import { LuaComponent } from '../component/lua_component';
import type { LuaComponentHandlerIdMap } from '../component/lua_component';
import { defineAbility, abilityActions } from '../gas/ability_registry';
import type { GameplayAbilityDefinition } from '../gas/gameplay_ability';
import { deepClone } from '../utils/utils';

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

// Flip back to 'msx' to restore the legacy editor font.
const EDITOR_FONT_VARIANT: ConsoleFontVariant = 'tiny';

export type BmsxConsoleRuntimeOptions = {
	cart: BmsxConsoleCartridge;
	playerIndex: number;
	storage?: StorageService;
	luaSourceFailurePolicy?: Partial<LuaPersistenceFailurePolicy>;
	caseInsensitiveLua?: boolean;
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

type LuaServiceHooks = {
	boot?: LuaFunctionValue;
	activate?: LuaFunctionValue;
	deactivate?: LuaFunctionValue;
	dispose?: LuaFunctionValue;
	tick?: LuaFunctionValue;
	getState?: LuaFunctionValue;
	setState?: LuaFunctionValue;
};

type LuaServiceBinding = {
	service: Service;
	table: LuaTable;
	interpreter: LuaInterpreter;
	hooks: LuaServiceHooks;
	events: Map<string, LuaFunctionValue>;
	autoActivate: boolean;
};

type LuaComponentDefinitionRecord = {
	id: string;
	handlerIds: LuaComponentHandlerIdMap;
	initialState?: Record<string, unknown>;
	tagsPre?: ReadonlyArray<string>;
	tagsPost?: ReadonlyArray<string>;
	unique?: boolean;
};

type LuaAbilityRegistrationDescriptor = {
	id: string;
	unique?: 'ignore' | 'restart' | 'stack';
	requiredTags?: ReadonlyArray<string>;
	blockedTags?: ReadonlyArray<string>;
	grantTags?: ReadonlyArray<string>;
	removeOnActivate?: ReadonlyArray<string>;
	removeOnEnd?: ReadonlyArray<string>;
	cooldownMs?: number;
	cost?: ReadonlyArray<{ attr: string; amount: number }>;
	activation?: LuaFunctionValue;
	completion?: LuaFunctionValue;
	cancel?: LuaFunctionValue;
};

class LuaScriptService extends Service {
	constructor(id: Identifier) {
		super({ id, deferBind: true });
	}
}

export class BmsxConsoleRuntime extends Service {
	private static _instance: BmsxConsoleRuntime | null = null;
	private static preservingWorldResetDepth = 0;
	private static readonly MAX_FRAME_DELTA_MS = 250;
	private static readonly HOVER_VALUE_MAX_LINE_LENGTH = 160;
	private static readonly HOVER_VALUE_MAX_SERIALIZED_LINES = 200;
	private static readonly DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<ConsoleLuaBuiltinDescriptor> = [
		{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
		{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
		{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
		{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
		{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
		{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
		{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
		{ name: 'print', params: ['...'], signature: 'print(...)' },
		{ name: 'rawequal', params: ['v1', 'v2'], signature: 'rawequal(v1, v2)' },
		{ name: 'rawget', params: ['table', 'index'], signature: 'rawget(table, index)' },
		{ name: 'rawset', params: ['table', 'index', 'value'], signature: 'rawset(table, index, value)' },
		{ name: 'select', params: ['index', '...'], signature: 'select(index, ...)' },
		{ name: 'setmetatable', params: ['table', 'metatable'], signature: 'setmetatable(table, metatable)' },
		{ name: 'tonumber', params: ['value', 'base?'], signature: 'tonumber(value [, base])' },
		{ name: 'tostring', params: ['value'], signature: 'tostring(value)' },
		{ name: 'type', params: ['value'], signature: 'type(value)' },
		{ name: 'xpcall', params: ['func', 'msgh', 'arg...'], signature: 'xpcall(f, msgh, ...)' },
		{ name: 'table.concat', params: ['list', 'separator?', 'start?', 'end?'], signature: 'table.concat(list [, sep [, i [, j]]])' },
		{ name: 'table.insert', params: ['list', 'pos?', 'value'], signature: 'table.insert(list [, pos], value)' },
		{ name: 'table.pack', params: ['...'], signature: 'table.pack(...)' },
		{ name: 'table.remove', params: ['list', 'pos?'], signature: 'table.remove(list [, pos])' },
		{ name: 'table.sort', params: ['list', 'comp?'], signature: 'table.sort(list [, comp])' },
		{ name: 'table.unpack', params: ['list', 'i?', 'j?'], signature: 'table.unpack(list [, i [, j]])' },
	];
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
		'api',
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
			instance.prepareForPreservedWorldReset();
			return;
		}
		instance.dispose();
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
	private readonly luaBuiltinMetadata = new Map<string, ConsoleLuaBuiltinDescriptor>();
	private readonly caseInsensitiveLua: boolean;
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
	private luaHandleToObject = new Map<number, WeakRef<object>>();
	private luaObjectToHandle = new WeakMap<object, number>();
	private luaObjectWrapperCache: WeakMap<object, LuaTable> = new WeakMap<object, LuaTable>();
	private handleMethodCache = new Map<number, Map<string, LuaFunctionValue>>();
	private nextLuaHandleId = 1;
	private freeHandles: number[] = [];
	private readonly freeHandleSet: Set<number> = new Set<number>();
	private readonly handleFinalizer: FinalizationRegistry<number> | null = typeof FinalizationRegistry !== 'undefined'
		? new FinalizationRegistry<number>((handle) => { this.releaseHandle(handle); })
		: null;
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
	private readonly luaBehaviorTreeIds: Set<string> = new Set<string>();
	private readonly luaStateMachineHandlerIds: Map<string, Set<string>> = new Map();
	private readonly luaBehaviorTreeHandlerIds: Map<string, Set<string>> = new Map();
	private readonly luaComponentDefinitions: Map<string, LuaComponentDefinitionRecord> = new Map();
	private readonly luaComponentHandlerIds: Map<string, Set<string>> = new Map();
	private readonly luaAbilityDefinitions: Map<string, GameplayAbilityDefinition> = new Map();
	private readonly luaAbilityHandlerIds: Map<string, Set<string>> = new Map();
	private readonly luaAbilityActionIds: Map<string, string[]> = new Map();
	private readonly luaAbilityActionByHandler = new Map<string, string>();
	private readonly luaHandlerBindings = new Map<string, { fn: LuaFunctionValue; interpreter: LuaInterpreter }>();
	private readonly luaServiceEventListeners = new Map<string, { slot: string; unsubscribe: () => void }>();
	private readonly luaModuleOwners = new Map<string, { fsm?: string; behavior_tree?: string }>();
	private handledLuaErrors = new WeakSet<object>();
	private readonly luaHotReloader = new LuaHotReloader(
		{
			compileAndLoad: (moduleId: string, source: string) => this.compileLuaModuleForHotReload(moduleId, source),
		},
		HandlerRegistry.instance,
	);
	private currentLuaAssetContext: { category: 'fsm' | 'behavior_tree' | 'service'; assetId: string } | null = null;
	private readonly behaviorTreeDiagnostics: Map<string, BehaviorTreeDiagnostic[]> = new Map();
	private readonly luaServices: Map<string, LuaServiceBinding> = new Map();
	private hasBooted = false;

	private constructor(options: BmsxConsoleRuntimeOptions) {
		super({ id: 'bmsx_console_runtime' });
		const rompack = $.rompack;
		this.caseInsensitiveLua = options.caseInsensitiveLua ?? (rompack?.caseInsensitiveLua ?? true);
		setLuaTableCaseInsensitiveKeys(this.caseInsensitiveLua);
		setEditorCaseInsensitivity(this.caseInsensitiveLua);
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
		this.seedDefaultLuaBuiltins();
		this.initializeEditor();
		this.attachFrameListener();
		this.boot('constructor');
		void this.prefetchLuaSourceFromFilesystem();
	}

	private requireLuaInterpreter(): LuaInterpreter {
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			throw new Error('[BmsxConsoleRuntime] Lua interpreter unavailable.');
		}
		return interpreter;
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
		const rompack = $.rompack;
		const nextCaseInsensitive = options.caseInsensitiveLua ?? (rompack?.caseInsensitiveLua ?? true);
		if (nextCaseInsensitive !== this.caseInsensitiveLua) {
			throw new Error('[BmsxConsoleRuntime] Runtime already initialised with a different Lua case-sensitivity setting.');
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
		this.api.end_frame();
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

	private findAssetIdForPath(path: string | null | undefined): string | null {
		if (!path) {
			return null;
		}
		const rompack = $.rompack;
		if (!rompack || !rompack.luaSourcePaths) {
			return null;
		}
		const normalized = path.replace(/\\/g, '/').toLowerCase();
		for (const [assetId, sourcePath] of Object.entries(rompack.luaSourcePaths)) {
			if (typeof sourcePath !== 'string') {
				continue;
			}
			const candidate = sourcePath.replace(/\\/g, '/').toLowerCase();
			if (candidate === normalized) {
				return assetId;
			}
		}
		return null;
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
			this.api.set_render_backend(this.editorRenderBackend);
			$.setPipelineOverride(consoleEditorSpec());
			return;
		}
		this.api.set_render_backend(null);
		$.setPipelineOverride(null);
		publishOverlayFrame(null);
	}

	public setEditorOverlayResolution(mode: 'offscreen' | 'viewport'): void {
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleRuntime] Game view unavailable while setting editor overlay resolution.');
		}
		if (mode === 'viewport') {
			this.editorRenderBackend.setFrameOverride({ width: view.viewportSize.x, height: view.viewportSize.y });
			return;
		}
		this.editorRenderBackend.setFrameOverride(null);
	}

	public boot(reason?: string): void {
		const bootReason = reason ?? 'unspecified';
		try { console.info(`[BmsxConsoleRuntime] Boot: ${bootReason}`); } catch { /* ignore */ }
		// Guard against unintended reboots while in a failed Lua runtime state.
		// Explicit callers should provide a reason. Unspecified reboots are ignored
		// when the Lua VM has failed, to preserve editor resume semantics.
		if (this.luaRuntimeFailed && bootReason === 'unspecified') {
			try { console.warn('[BmsxConsoleRuntime] Ignoring boot without reason during Lua failure state.'); } catch { /* ignore */ }
			return;
		}
		this.frameCounter = 0;
		this.luaRuntimeFailed = false;
		this.luaChunkResourceMap.clear();
		this.resourcePathCache.clear();
		this.luaChunkEnvironmentsByAssetId.clear();
		this.luaChunkEnvironmentsByChunkName.clear();
		if (this.editor) {
			// Clear overlays across all code tabs to ensure no stale error UI persists
			// when the editor had focused a specific chunk for the fault.
			(this.editor as any).clearAllRuntimeErrorOverlays?.() ?? this.editor.clearRuntimeErrorOverlay();
		}
		if (this.hasBooted) {
			this.resetWorldState();
		}
		this.physics.clear();
		this.api.cartdata(this.cart.meta.persistentId);
		this.api.collider_clear();
		if (this.hasLuaProgram()) {
			this.bootLuaProgram(true);
		}
		else {
			this.resetLuaInteroperabilityState();
			this.fsmLuaInterpreter = null;
			const fsmInterpreter = this.ensureFsmLuaInterpreter();
			this.loadLuaStateMachineScripts(fsmInterpreter);
			this.loadLuaBehaviorTreeScripts(fsmInterpreter);
			this.loadLuaServiceScripts(fsmInterpreter);
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
			this.api.begin_paused_frame(this.frameCounter);
			if (editorActive && editor) {
				editor.draw(this.api);
			}
			this.endFrameAndFlush(editorActive);
			return;
		}
		this.api.begin_frame(this.frameCounter, deltaSeconds);
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
				this.tickLuaServices(deltaSeconds);
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
			this.tickLuaServices(deltaSeconds);
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
		this.disposeLuaServices();
		this.luaInterpreter = null;
		this.fsmLuaInterpreter = null;
		this.luaFsmMachineIds.clear();
		super.dispose();
		if (BmsxConsoleRuntime._instance === this) {
			BmsxConsoleRuntime._instance = null;
		}
	}

	private prepareForPreservedWorldReset(): void {
		this.pendingLuaWarnings = [];
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
		this.editor = new ConsoleLuaEditor({
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
			listLuaSymbols: (assetId: string | null, chunkName: string | null) => this.listLuaSymbols(assetId, chunkName),
			listGlobalLuaSymbols: () => this.listAllLuaSymbols(),
			listBuiltinLuaFunctions: () => this.listLuaBuiltinFunctions(),
			fontVariant: EDITOR_FONT_VARIANT,
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
		this.boot('setState:resetFresh');
	}

	private restoreFromStateSnapshot(snapshot: BmsxConsoleState): void {
		// The editor deliberately clears luaRuntimeFailed before calling setState when the
		// user hits "Resume". That signal tells us to keep the script environment but otherwise
		// treat the operation as a soft reboot: user code should rerun init/update hooks while
		// engine state (world objects, physics, etc.) stays untouched unless the cart's own
		// logic rebuilds it. The fallback snapshot populated above is only meant to reapply
		// plain Lua globals/locals so the user's script logic can pick up right where it left
		// off. It is not a save-state, and it intentionally skips anything that needs engine
		// cooperation to restore.
		const savedFrameCounter = snapshot.frameCounter ?? 0;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;

		this.api.cartdata(this.cart.meta.persistentId);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		this.frameCounter = savedFrameCounter;

		if (this.hasLuaProgram()) {
			const shouldRunInit = this.shouldRunInitForSnapshot(snapshot);
			this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: shouldRunInit, hotReload: false });
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

	public resumeFromSnapshot(state: unknown): void {
		if (!state || typeof state !== 'object') {
			this.luaRuntimeFailed = false;
			return;
		}
		const originalSnapshot = state as BmsxConsoleState;
		// Resume should never re-run init; keep VM state intact.
		const snapshot: BmsxConsoleState = { ...originalSnapshot, luaRuntimeFailed: false };
		// Clear any previous error overlays and interpreter fault markers so a fresh
		// resume starts clean and can report new errors normally.
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		if (this.luaInterpreter) {
			this.luaInterpreter.clearLastFaultEnvironment();
			this.luaInterpreter.clearLastFaultCallStack?.();
		}
		// Also clear dedupe set so subsequent errors surface again after resume.
		this.handledLuaErrors = new WeakSet<object>();
		// Clear flag and any queued overlay frame before we resume swapping handlers.
		this.luaRuntimeFailed = false;
		publishOverlayFrame(null);
		this.resumeLuaProgramState(snapshot, { runInit: false });
		this.lastFrameTimestampMs = $.platform.clock.now();
		this.setEditorPipelineActive(this.editor?.isActive() === true, true);
		this.redrawAfterStateRestore();
	}

	private applyLuaProgramHotReload(params: { source: string; chunkName: string; override?: string | null }): void {
		const interpreter = this.requireLuaInterpreter();
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		let programAssetId: string | null = null;
		if ('assetId' in program && typeof program.assetId === 'string' && program.assetId.length > 0) {
			programAssetId = program.assetId;
		}
		const normalizedChunk = this.normalizeChunkName(params.chunkName);
		const previousEnvironment = this.luaChunkEnvironmentsByChunkName.get(normalizedChunk) ?? null;
		interpreter.clearLastFaultEnvironment();
		interpreter.execute(params.source, params.chunkName);
		this.cacheChunkEnvironment(interpreter, params.chunkName, programAssetId);
		const nextEnvironment = interpreter.getChunkEnvironment();
		if (previousEnvironment && nextEnvironment && previousEnvironment !== nextEnvironment) {
			this.mergeLuaChunkEnvironmentState(previousEnvironment, nextEnvironment);
		}
		const env = interpreter.getGlobalEnvironment();
		const initName = program.entry?.init ?? 'init';
		const updateName = program.entry?.update ?? 'update';
		const drawName = program.entry?.draw ?? 'draw';
		this.luaInitFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, initName));
		this.luaUpdateFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, updateName));
		this.luaDrawFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, drawName));
		this.luaSnapshotSave = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_save'));
		this.luaSnapshotLoad = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_load'));
		this.luaRuntimeFailed = false;
		this.luaProgramSourceOverride = params.override ?? params.source;
		this.luaChunkName = params.chunkName;
		const hotSource = params.override ?? params.source;
		this.refreshLuaHandlersForChunk(normalizedChunk, hotSource);
		this.refreshLuaHandlersAfterResume(normalizedChunk);
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private reloadLuaProgramState(source: string, chunkName: string, override?: string | null): void {
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		this.applyProgramSourceToCartridge(source, chunkName);
		const hotReloadSource = override ?? source;
		this.luaProgramSourceOverride = hotReloadSource;
		this.luaChunkName = chunkName;
		if (!this.luaInterpreter) {
			this.bootLuaProgram(false);
		}
		else {
			this.applyLuaProgramHotReload({ source: hotReloadSource, chunkName, override: hotReloadSource });
		}
		this.lastFrameTimestampMs = $.platform.clock.now();
		this.setEditorPipelineActive(this.editor?.isActive() === true, true);
		this.redrawAfterStateRestore();
	}

	private shouldRunInitForSnapshot(snapshot: BmsxConsoleState): boolean {
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const hasStructuredSnapshot = snapshot.luaSnapshot !== undefined && snapshot.luaSnapshot !== null;
		const hasFallbackState = snapshot.luaGlobals !== undefined
			|| snapshot.luaLocals !== undefined
			|| snapshot.luaRandomSeed !== undefined;
		return !savedRuntimeFailed && !hasStructuredSnapshot && !hasFallbackState;
	}

	private resumeLuaProgramState(snapshot: BmsxConsoleState, options: { runInit: boolean }): void {
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		if (!this.luaInterpreter) {
			this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: options.runInit, hotReload: false });
			return;
		}

		const targetChunkName = snapshot.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		const currentChunk = this.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		const normalizedTarget = this.normalizeChunkName(targetChunkName);
		const normalizedCurrent = this.normalizeChunkName(currentChunk);

		const requestedOverride = (typeof snapshot.luaProgramSourceOverride === 'string' && snapshot.luaProgramSourceOverride.length > 0)
			? snapshot.luaProgramSourceOverride
			: (typeof this.luaProgramSourceOverride === 'string' ? this.luaProgramSourceOverride : null);

		const currentOverride = typeof this.luaProgramSourceOverride === 'string' ? this.luaProgramSourceOverride : null;
		const shouldHotReload = (requestedOverride !== null && requestedOverride !== currentOverride) || (normalizedTarget !== normalizedCurrent);

		if (shouldHotReload) {
			let source: string;
			try {
				source = requestedOverride ?? this.resolveLuaProgramSource(program);
			}
			catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
			this.applyProgramSourceToCartridge(source, targetChunkName);
			this.luaProgramSourceOverride = requestedOverride;
			this.luaChunkName = targetChunkName;
			try {
				this.applyLuaProgramHotReload({ source, chunkName: targetChunkName, override: requestedOverride });
			}
			catch (error) {
				this.handleLuaError(error);
				throw error;
			}
			// No init on resume, and ensure other modules swap cleanly.
			this.refreshLuaHandlersAfterResume(targetChunkName);
		}
		// If no change, do nothing: keep VM state and compiled chunk intact.
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: BmsxConsoleState, options: { runInit: boolean; hotReload: boolean }): void {
		const program = this.luaProgram;
		if (!program) {
			return;
		}
		const targetChunkName = snapshot.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		let override: string | null = null;
		if (typeof snapshot.luaProgramSourceOverride === 'string') {
			override = snapshot.luaProgramSourceOverride;
		}
		else if (typeof this.luaProgramSourceOverride === 'string') {
			override = this.luaProgramSourceOverride;
		}
		let source: string;
		try {
			source = override ?? this.resolveLuaProgramSource(program);
		}
		catch (error) {
			throw error instanceof Error ? error : new Error(String(error));
		}

		this.applyProgramSourceToCartridge(source, targetChunkName);
		this.luaProgramSourceOverride = override;
		this.luaChunkName = targetChunkName;

		this.initializeLuaInterpreterFromSnapshot({
			source,
			chunkName: targetChunkName,
			snapshot,
			runInit: options.runInit,
			hotReload: options.hotReload,
		});
	}

	private refreshLuaHandlersAfterResume(resumeModuleId: string | null): void {
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

		const pushModuleForHandler = (handlerId: string | null | undefined): void => {
			if (!handlerId) {
				return;
			}
			const descriptor = HandlerRegistry.instance.describe(handlerId);
			if (!descriptor) {
				return;
			}
			const source = descriptor.source;
			if (!source || source.lang !== 'lua') {
				return;
			}
			pushModule(source.module);
		};

		for (const handlerId of this.luaHandlerBindings.keys()) {
			pushModuleForHandler(handlerId);
		}

		for (const handlerSet of this.luaStateMachineHandlerIds.values()) {
			for (const handlerId of handlerSet) {
				pushModuleForHandler(handlerId);
			}
		}

		for (const handlerSet of this.luaBehaviorTreeHandlerIds.values()) {
			for (const handlerId of handlerSet) {
				pushModuleForHandler(handlerId);
			}
		}

		for (const handlerSet of this.luaComponentHandlerIds.values()) {
			for (const handlerId of handlerSet) {
				pushModuleForHandler(handlerId);
			}
		}

		for (const handlerId of this.luaAbilityActionByHandler.keys()) {
			pushModuleForHandler(handlerId);
		}

		for (const handlerId of this.luaServiceEventListeners.keys()) {
			pushModuleForHandler(handlerId);
		}

		if (modules.size === 0) {
			return;
		}
		for (const moduleId of modules) {
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; chunkName: string; snapshot: BmsxConsoleState; runInit: boolean; hotReload: boolean }): void {
		if (params.hotReload) {
			this.applyLuaProgramHotReload({ source: params.source, chunkName: params.chunkName, override: params.snapshot.luaProgramSourceOverride ?? null });
			return;
		}

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter();
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaSnapshotSave = null;
		this.luaSnapshotLoad = null;
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;

		const program = this.luaProgram;
		let programAssetId: string | null = null;
		if (program) {
			this.registerProgramChunk(program, params.chunkName);
			if ('assetId' in program && typeof program.assetId === 'string' && program.assetId.length > 0) {
				programAssetId = program.assetId;
			}
		}

		this.registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		this.loadLuaStateMachineScripts(interpreter);
		this.loadLuaBehaviorTreeScripts(interpreter);
		this.loadLuaServiceScripts(interpreter);

		interpreter.execute(params.source, params.chunkName);
		if (program) {
			this.cacheChunkEnvironment(interpreter, params.chunkName, programAssetId);
		}

		const env = interpreter.getGlobalEnvironment();
		const initName = program?.entry?.init ?? 'init';
		const updateName = program?.entry?.update ?? 'update';
		const drawName = program?.entry?.draw ?? 'draw';
		this.luaInitFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, initName));
		this.luaUpdateFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, updateName));
		this.luaDrawFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, drawName));
		this.luaSnapshotSave = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_save'));
		this.luaSnapshotLoad = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_load'));

		const snapshot = params.snapshot;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		if (snapshot.luaSnapshot !== undefined && snapshot.luaSnapshot !== null && this.luaSnapshotLoad !== null) {
			this.applyLuaSnapshot(snapshot.luaSnapshot);
		}
		else {
			this.restoreFallbackLuaState(snapshot);
		}

		if (params.runInit && this.luaInitFunction !== null && !savedRuntimeFailed) {
			try {
				this.invokeLuaFunction(this.luaInitFunction, []);
			}
			catch (error) {
				this.handleLuaError(error);
			}
		}

		this.frameCounter = snapshot.frameCounter ?? 0;
		this.luaRuntimeFailed = savedRuntimeFailed;
	}

	private redrawAfterStateRestore(): void {
		if (this.hasLuaProgram()) {
			if (this.luaRuntimeFailed) {
				return;
			}
			this.api.begin_frame(this.frameCounter, 0);
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
		this.api.begin_frame(this.frameCounter, 0);
		this.cart.draw(this.api);
	}

	private clearEditorErrorOverlaysIfNoFault(): void {
		if (this.luaRuntimeFailed) return;
		const editor = this.editor as unknown as { clearAllRuntimeErrorOverlays?: () => void } | null;
		if (!editor) return;
		if (typeof editor.clearAllRuntimeErrorOverlays === 'function') {
			editor.clearAllRuntimeErrorOverlays();
		} else {
			// Fallback for older editors: clear only the active tab overlay
			(this.editor as any).clearRuntimeErrorOverlay();
		}
		publishOverlayFrame(null);
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
			try {
				const category = this.resolveLuaHotReloadCategory(assetId);
				const normalizedPath = path.replace(/\\/g, '/');
				let chunkName: string;
				switch (category) {
					case 'fsm':
						chunkName = this.resolveLuaFsmChunkName(assetId, normalizedPath);
						break;
					case 'behavior_tree':
						chunkName = this.resolveLuaBehaviorTreeChunkName(assetId, normalizedPath);
						break;
					case 'service':
						chunkName = this.resolveLuaServiceChunkName(assetId, normalizedPath);
						break;
					default:
						chunkName = `@${normalizedPath}`;
						break;
				}
				this.registerLuaChunkResource(chunkName, { assetId, path: normalizedPath });
				this.refreshLuaHandlersForChunk(chunkName, source);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.recordLuaWarning(`[BmsxConsoleRuntime] Hot reload of '${assetId}' after save failed: ${message}`);
			}
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
		try {
			const category = this.resolveLuaHotReloadCategory(assetId);
			let chunkName: string;
			switch (category) {
				case 'fsm':
					chunkName = this.resolveLuaFsmChunkName(assetId, normalizedPath);
					break;
				case 'behavior_tree':
					chunkName = this.resolveLuaBehaviorTreeChunkName(assetId, normalizedPath);
					break;
				case 'service':
					chunkName = this.resolveLuaServiceChunkName(assetId, normalizedPath);
					break;
				default:
					chunkName = `@${normalizedPath}`;
					break;
			}
			this.refreshLuaHandlersForChunk(chunkName, contents);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordLuaWarning(`[BmsxConsoleRuntime] Hot load of new resource '${assetId}' failed: ${message}`);
		}
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
				if ($.debug) {
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
		if (isLuaTable(value)) {
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
		if (isLuaTable(value)) {
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
					if (isLuaTable(entryValue)) {
						const nestedHandle = entryValue.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
						if (typeof nestedHandle === 'number') {
							// Resume ignores engine-backed objects; their lifetime is controlled
							// by the host platform and rehydrating them would require rebuilding
							// the entire engine state. Dropping them keeps the resume path fast
							// and predictable while preserving the Lua-visible data the user
							// actually authored.
							continue;
						}
					}
					let serializedEntry: unknown;
					try {
						serializedEntry = this.serializeLuaValueForSnapshot(entryValue, visited);
					}
					catch (error) {
						if ($.debug) {
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
				if ($.debug) {
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
				if ($.debug) {
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
		this.freeHandles = [];
		this.freeHandleSet.clear();
		this.disposeAllLuaComponentDefinitions();
		this.disposeAllLuaAbilityDefinitions();
		this.disposeLuaServices();
		this.luaModuleOwners.clear();
		this.handledLuaErrors = new WeakSet<object>();
		setLuaTableCaseInsensitiveKeys(this.caseInsensitiveLua);
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
		const interpreter = createLuaInterpreter();
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;
		this.luaChunkName = chunkName;
		this.luaRuntimeFailed = false;

		try {
			this.registerProgramChunk(program, chunkName);
			this.registerApiBuiltins(interpreter);
			interpreter.setReservedIdentifiers(this.apiFunctionNames);
			this.loadLuaStateMachineScripts(interpreter);
			this.loadLuaBehaviorTreeScripts(interpreter);
			this.loadLuaServiceScripts(interpreter);
			interpreter.execute(source, chunkName);
			let programAssetId: string | null = null;
			if ('assetId' in program && typeof program.assetId === 'string' && program.assetId.length > 0) {
				programAssetId = program.assetId;
			}
			this.cacheChunkEnvironment(interpreter, chunkName, programAssetId);
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
		const initName = program.entry?.init ?? 'init';
		const updateName = program.entry?.update ?? 'update';
		const drawName = program.entry?.draw ?? 'draw';
		this.luaInitFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, initName));
		this.luaUpdateFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, updateName));
		this.luaDrawFunction = this.resolveLuaFunction(this.getLuaGlobalValue(env, drawName));
		this.luaSnapshotSave = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_save'));
		this.luaSnapshotLoad = this.resolveLuaFunction(this.getLuaGlobalValue(env, '__bmsx_snapshot_load'));

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
			try {
				this.reloadLuaProgramState(source, targetChunkName, source);
			}
			catch (error) {
				this.handleLuaError(error);
				throw error;
			}
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
		}
		catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.reloadLuaProgramState(previousSource, previousChunkName, previousOverride ?? previousSource);
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

	public reloadProgramAndResetWorld(source: string): void {
		if (!this.hasLuaProgram()) {
			throw new Error('[BmsxConsoleRuntime] Cannot reload Lua program when no Lua program is active.');
		}
		const program = this.luaProgram;
		if (!program) {
			throw new Error('[BmsxConsoleRuntime] Lua program reference unavailable.');
		}
		if (typeof source !== 'string' || source.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Lua source must be a non-empty string.');
		}
		const chunkName = this.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		this.resetWorldState();
		try {
			this.reloadLuaProgramState(source, chunkName, source);
		} catch (error) {
			this.handleLuaError(error);
			throw error;
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
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			throw new Error('[BmsxConsoleRuntime] Lua interpreter is not available.');
		}
		const luaArgs = args.map((value) => this.jsToLua(value, interpreter));
		return fn.call(luaArgs);
	}

	private handleLuaError(error: unknown): void {
		if (typeof error === 'object' && error !== null && this.handledLuaErrors.has(error as object)) {
			return;
		}
		this.luaRuntimeFailed = true;
		let message: string;
		if (error instanceof Error) {
			message = error.message;
		}
		else {
			message = String(error);
		}
		const runtimeDetails = this.buildRuntimeErrorDetailsForEditor(error, message);
		let line: number | null = null;
		let column: number | null = null;
		let chunkName: string | null = null;
		if (error instanceof LuaError) {
			if (Number.isFinite(error.line) && error.line > 0) {
				line = Math.floor(error.line);
			}
			if (Number.isFinite(error.column) && error.column > 0) {
				column = Math.floor(error.column);
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
					this.editor.showRuntimeErrorInChunk(chunkName, line, column, message, hint, runtimeDetails);
				} else {
					this.editor.showRuntimeErrorInChunk(chunkName, line, column, message, undefined, runtimeDetails);
				}
			}
			catch (editorError) {
				const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
				try {
				this.editor.showRuntimeError(line, column, overlayMessage, runtimeDetails);
				}
				catch (secondaryError) {
					console.warn('[BmsxConsoleRuntime] Failed to display Lua error in console editor.', editorError, secondaryError);
				}
			}
		}
		const logMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		console.error('[BmsxConsoleRuntime] Lua runtime error:', logMessage, error);
		if (typeof error === 'object' && error !== null) {
			this.handledLuaErrors.add(error as object);
		}
	}

	private buildRuntimeErrorDetailsForEditor(error: unknown, message: string): RuntimeErrorDetails | null {
		const interpreter = this.luaInterpreter;
		let luaFrames: RuntimeErrorStackFrame[] = [];
        if (interpreter) {
            const callFrames = interpreter.getLastFaultCallStack();
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
                    const top: RuntimeErrorStackFrame = { origin: 'lua', functionName: fnName, source: src, line, column: col, raw: raw.length > 0 ? raw : '[lua]' };
                    if (src && src.length > 0) {
                        const hint = this.lookupChunkResourceInfoNullable(src);
                        if (hint) {
                            top.chunkAssetId = hint.assetId ?? null;
                            if (hint.path && hint.path.length > 0) top.chunkPath = hint.path;
                        }
                    }
                    luaFrames.unshift(top);
                }
            }
            interpreter.clearLastFaultCallStack();
        }
		let stackText: string | null = null;
		if (error instanceof Error && typeof error.stack === 'string') {
			stackText = error.stack;
		}
		const jsFrames = this.parseJsStackFrames(stackText);
		if (luaFrames.length === 0 && jsFrames.length === 0) {
			return null;
		}
		return {
			message,
			luaStack: luaFrames,
			jsStack: jsFrames,
		};
	}

	private convertLuaCallFrames(callFrames: ReadonlyArray<LuaCallFrame>): RuntimeErrorStackFrame[] {
		const frames: RuntimeErrorStackFrame[] = [];
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
			const runtimeFrame: RuntimeErrorStackFrame = {
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
					runtimeFrame.chunkAssetId = hint.assetId ?? null;
					if (hint.path && hint.path.length > 0) {
						runtimeFrame.chunkPath = hint.path;
					}
				}
			}
			frames.push(runtimeFrame);
		}
		return frames;
	}

	private parseJsStackFrames(stack: string | null): RuntimeErrorStackFrame[] {
		if (!stack || stack.length === 0) {
			return [];
		}
		const sanitized = stack.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const lines = sanitized.split('\n');
		const frames: RuntimeErrorStackFrame[] = [];
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

	private parseJsStackLine(line: string): RuntimeErrorStackFrame | null {
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

	private createApiRuntimeError(interpreter: LuaInterpreter, message: string): LuaRuntimeError {
		interpreter.markFaultEnvironment();
		const range = interpreter.getCurrentCallRange();
		const chunkName = range ? range.chunkName : (this.luaChunkName ?? 'lua');
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		return new LuaRuntimeError(message, chunkName, line, column);
	}

	private registerApiBuiltins(interpreter: LuaInterpreter): void {
		this.apiFunctionNames.clear();

		const env = interpreter.getGlobalEnvironment();
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
				const params = this.extractFunctionParameters(methodDescriptor.value as (...args: unknown[]) => unknown);
				const signature = params.length > 0
					? `${name}(${params.join(', ')})`
					: `${name}()`;
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
						this.handleLuaError(error);
						return [];
					}
					const message = error instanceof Error ? error.message : String(error);
					const runtimeError = this.createApiRuntimeError(interpreter, `[api.${name}] ${message}`);
					this.handleLuaError(runtimeError);
					return [];
				}
			});
				this.registerLuaGlobal(env, name, native);
				this.registerLuaBuiltin({ name, params, signature });
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
					this.handleLuaError(error);
					return [];
				}
				const message = error instanceof Error ? error.message : String(error);
				const runtimeError = this.createApiRuntimeError(interpreter, `[api.${name}] ${message}`);
				this.handleLuaError(runtimeError);
				return [];
			}
				});
				this.registerLuaGlobal(env, name, native);
			}
		}

		this.exposeEngineObjects(env, interpreter);

	}

	private registerLuaBuiltin(metadata: ConsoleLuaBuiltinDescriptor): void {
		if (!metadata || typeof metadata.name !== 'string') {
			return;
		}
		const normalizedName = metadata.name.trim();
		if (normalizedName.length === 0) {
			return;
		}
		const params = Array.isArray(metadata.params) ? metadata.params.slice() : [];
		const signature = typeof metadata.signature === 'string' ? metadata.signature : normalizedName;
		this.luaBuiltinMetadata.set(normalizedName, {
			name: normalizedName,
			params,
			signature,
		});
	}

	private registerLuaGlobal(env: LuaEnvironment, name: string, value: LuaValue): void {
		env.set(name, value);
		this.apiFunctionNames.add(name);
		if (!this.caseInsensitiveLua) {
			return;
		}
		const normalized = name.toLowerCase();
		if (normalized !== name) {
			env.set(normalized, value);
			this.apiFunctionNames.add(normalized);
		}
	}

	private getLuaGlobalValue(env: LuaEnvironment, name: string | null | undefined): LuaValue | null {
		if (!name) {
			return null;
		}
		const direct = env.get(name);
		if (direct !== null) {
			return direct;
		}
		if (!this.caseInsensitiveLua) {
			return null;
		}
		const normalized = name.toLowerCase();
		if (normalized !== name) {
			const fallback = env.get(normalized);
			if (fallback !== null) {
				return fallback;
			}
		}
		return null;
	}

	private getLuaTableEntry(table: LuaTable, keys: readonly string[]): LuaValue | null {
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			let candidate = table.get(key);
			if (candidate !== null) {
				return candidate;
			}
			if (this.caseInsensitiveLua) {
				const normalized = key.toLowerCase();
				if (normalized !== key) {
					candidate = table.get(normalized);
					if (candidate !== null) {
						return candidate;
					}
				}
			}
		}
		return null;
	}

	private getLuaRecordEntry<T>(record: Record<string, unknown> | null | undefined, keys: readonly string[]): T | undefined {
		if (!record) {
			return undefined;
		}
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			if (Object.prototype.hasOwnProperty.call(record, key)) {
				return record[key] as T;
			}
			if (this.caseInsensitiveLua) {
				const normalized = key.toLowerCase();
				if (normalized !== key && Object.prototype.hasOwnProperty.call(record, normalized)) {
					return record[normalized] as T;
				}
			}
		}
		return undefined;
	}

	private resolveHandlePropertyName(instance: object, propertyName: string): string | null {
		if (propertyName in instance) {
			return propertyName;
		}
		if (!this.caseInsensitiveLua) {
			return null;
		}
		const lower = propertyName.toLowerCase();
		let prototype: object | null = instance;
		while (prototype && prototype !== Object.prototype) {
			const names = Object.getOwnPropertyNames(prototype);
			for (let index = 0; index < names.length; index += 1) {
				const candidate = names[index];
				if (candidate === propertyName) {
					return candidate;
				}
				if (candidate.toLowerCase() === lower) {
					return candidate;
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
		return null;
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
		const defaults = BmsxConsoleRuntime.DEFAULT_LUA_BUILTIN_FUNCTIONS;
		for (let i = 0; i < defaults.length; i += 1) {
			this.registerLuaBuiltin(defaults[i]);
		}
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
		const previousMachineIds = new Set(this.luaFsmMachineIds);
		this.luaFsmMachineIds.clear();
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths ? rompack.luaSourcePaths : {};
		const previousDefinitions = new Map<string, StateDefinition | undefined>();
		const changedMachines: string[] = [];
		for (const assetId of Object.keys(luaSources)) {
			if (!this.assetIdRepresentsFsm(assetId)) {
				continue;
			}
			const source = luaSources[assetId];
			if (typeof source !== 'string') {
				throw new Error(`[BmsxConsoleRuntime] FSM Lua asset '${assetId}' is not a string source.`);
			}
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'fsm', assetId };
			try {
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
					this.cacheChunkEnvironment(interpreter, chunkName, assetId);
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
				this.disposeLuaStateMachineHandlers(machineId);
				const prepared = this.prepareLuaStateMachineBlueprint(machineId, blueprintValue, interpreter);
				const existingDefinition = StateDefinitions[machineId];
				const result = applyPreparedStateMachine(machineId, prepared, { force: true });
				this.api.register_prepared_fsm(machineId, prepared, { setup: false });
				this.luaFsmMachineIds.add(machineId);
				previousMachineIds.delete(machineId);
				if (!result.changed || !existingDefinition) {
					continue;
				}
				if (!ActiveStateMachines.has(machineId)) {
					continue;
				}
				existingDefinition.event_list = existingDefinition.event_list ?? [];
				previousDefinitions.set(machineId, existingDefinition);
				changedMachines.push(machineId);
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
		if (previousMachineIds.size > 0) {
			for (const removed of previousMachineIds) {
				this.disposeLuaStateMachineHandlers(removed);
			}
		}
		if (changedMachines.length > 0) {
			const controllersToRebind = this.unsubscribeStateMachineEvents(changedMachines, previousDefinitions);
			this.refreshStateMachines(changedMachines, previousDefinitions, controllersToRebind);
		}
	}

	private unsubscribeStateMachineEvents(machineIds: readonly string[], previousDefinitions: ReadonlyMap<string, StateDefinition | undefined>): Set<StateMachineController> {
		const controllers = new Set<StateMachineController>();

		for (const machineId of machineIds) {
			const instances = ActiveStateMachines.get(machineId);
			if (!instances) {
				throw new Error(`[BmsxConsoleRuntime] Active state machines map has no entry for '${machineId}'.`);
			}
			const oldDefinition = previousDefinitions.get(machineId);
			if (!oldDefinition) {
				throw new Error(`[BmsxConsoleRuntime] Previous definition missing for state machine '${machineId}'.`);
			}
			for (const instance of instances) {
				if (!instance) {
					throw new Error(`[BmsxConsoleRuntime] Active state machine list for '${machineId}' contains null entries.`);
				}
				const target = instance.target;
				if (!target) {
					throw new Error(`[BmsxConsoleRuntime] State machine '${machineId}' has no target.`);
				}
				const controller = target.sc;
				if (!controller) {
					throw new Error(`[BmsxConsoleRuntime] State machine '${machineId}' target '${target.id}' has no controller.`);
				}
				controllers.add(controller);
				const cache = controller._subscribedCache;
				const events = oldDefinition.event_list ?? [];
				for (const event of events) {
					let emitter: Identifier | undefined;
					switch (event.scope) {
						case 'self':
							emitter = target.id;
							break;
						case 'all':
						default:
							emitter = undefined;
							break;
					}
					EventEmitter.instance.off(event.name, controller.auto_dispatch, emitter, true);
					const lane = event.lane ?? 'any';
					const cacheKey = `${event.name}-${emitter ?? 'global'}-${lane}`;
					cache.delete(cacheKey);
				}
			}
		}
		return controllers;
	}

	private refreshStateMachines(machineIds: readonly string[], previousDefinitions: ReadonlyMap<string, StateDefinition | undefined>, controllersToRebind: ReadonlySet<StateMachineController>): void {
		for (const machineId of machineIds) {
			const instances = ActiveStateMachines.get(machineId);
			if (!instances) {
				throw new Error(`[BmsxConsoleRuntime] Active state machines map has no entry for '${machineId}'.`);
			}
			const newDefinition = StateDefinitions[machineId];
			if (!newDefinition) {
				throw new Error(`[BmsxConsoleRuntime] New definition missing for state machine '${machineId}'.`);
			}
			const previousDefinition = previousDefinitions.get(machineId);
			for (const instance of instances) {
				if (!instance) {
					throw new Error(`[BmsxConsoleRuntime] Active state machine list for '${machineId}' contains null entries.`);
				}
				migrateMachineDiff(instance, previousDefinition, newDefinition);
			}
		}
		for (const controller of controllersToRebind) {
			controller.bind();
		}
	}

	private loadLuaBehaviorTreeScripts(interpreter: LuaInterpreter): void {
		const previousTreeIds = new Set(this.luaBehaviorTreeIds);
		this.luaBehaviorTreeIds.clear();
		const rompack = this.api.rompack();
		if (!rompack || !rompack.lua) {
			if (previousTreeIds.size > 0) {
				for (const removed of previousTreeIds) {
					unregisterBehaviorTreeBuilder(removed);
				}
				this.handleRemovedBehaviorTrees(previousTreeIds);
			}
			return;
		}
		const changedTrees: Set<string> = new Set();
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths ? rompack.luaSourcePaths : {};
		for (const assetId of Object.keys(luaSources)) {
			if (!this.assetIdRepresentsBehaviorTree(assetId)) {
				continue;
			}
			const source = luaSources[assetId];
			if (typeof source !== 'string') {
				throw new Error(`[BmsxConsoleRuntime] Behavior tree Lua asset '${assetId}' is not a string source.`);
			}
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'behavior_tree', assetId };
			try {
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
				const chunkName = this.resolveLuaBehaviorTreeChunkName(assetId, typeof sourcePathRaw === 'string' ? sourcePathRaw : null);
				const btInfo: { assetId: string | null; path?: string | null } = { assetId };
				if (pathHint) {
					btInfo.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, btInfo);
				let executionResults: LuaValue[];
				try {
					executionResults = interpreter.execute(source, chunkName);
					this.cacheChunkEnvironment(interpreter, chunkName, assetId);
				}
				catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`[BmsxConsoleRuntime] Failed to execute Behavior tree Lua script '${assetId}': ${message}`);
				}
				if (executionResults.length === 0) {
					throw new Error(`[BmsxConsoleRuntime] Behavior tree Lua script '${assetId}' returned no value.`);
				}
				const descriptorValue = executionResults[0];
				const descriptor = this.luaValueToJs(descriptorValue);
				if (!this.isPlainObject(descriptor)) {
					throw new Error(`[BmsxConsoleRuntime] Behavior tree Lua script '${assetId}' must return a table.`);
				}
				const descriptorRecord = descriptor as Record<string, unknown>;
				const idValue = descriptorRecord.id;
				if (typeof idValue !== 'string' || idValue.trim().length === 0) {
					throw new Error(`[BmsxConsoleRuntime] Behavior tree Lua script '${assetId}' is missing a valid id.`);
				}
				const treeId = idValue.trim();
				this.disposeLuaBehaviorTreeHandlers(treeId);
				let definitionSource: unknown;
				if (Object.prototype.hasOwnProperty.call(descriptorRecord, 'definition')) {
					definitionSource = descriptorRecord['definition'];
				} else if (Object.prototype.hasOwnProperty.call(descriptorRecord, 'tree')) {
					definitionSource = descriptorRecord['tree'];
				} else if (Object.prototype.hasOwnProperty.call(descriptorRecord, 'root')) {
					definitionSource = { root: descriptorRecord['root'] };
				} else if (Object.prototype.hasOwnProperty.call(descriptorRecord, 'type')) {
					const copy: Record<string, unknown> = {};
					for (const [key, entry] of Object.entries(descriptorRecord)) {
						if (key === 'id') {
							continue;
						}
						copy[key] = entry;
					}
					definitionSource = copy;
				} else {
					throw new Error(`[BmsxConsoleRuntime] Behavior tree Lua script '${assetId}' must provide a 'definition' or 'tree' entry.`);
				}
				const prepared = this.prepareLuaBehaviorTreeDefinition(treeId, definitionSource, interpreter, assetId);
				applyPreparedBehaviorTree(treeId, prepared, { force: true });
				const diagnostics = getBehaviorTreeDiagnostics(treeId);
				this.behaviorTreeDiagnostics.set(treeId, diagnostics);
				for (let index = 0; index < diagnostics.length; index += 1) {
					const diagnostic = diagnostics[index];
					if (diagnostic.severity === 'warning') {
						this.recordLuaWarning(`[BehaviorTree:${treeId}] ${diagnostic.message}`);
					}
				}
				this.luaBehaviorTreeIds.add(treeId);
				previousTreeIds.delete(treeId);
				changedTrees.add(treeId);
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
		if (previousTreeIds.size > 0) {
			for (const removed of previousTreeIds) {
				unregisterBehaviorTreeBuilder(removed);
			}
			this.handleRemovedBehaviorTrees(previousTreeIds);
		}
		if (changedTrees.size > 0) {
			this.refreshBehaviorTreeContexts(Array.from(changedTrees));
		}
	}

	private refreshBehaviorTreeContexts(treeIds?: readonly string[]): void {
		const world = $.world;
		const filter = treeIds ? new Set(treeIds) : null;
		for (const object of world.objects({ scope: 'all' })) {
			const contexts = object.btreecontexts;
			for (const treeId in contexts) {
				if (filter && !filter.has(treeId)) {
					continue;
				}
				const context = contexts[treeId];
				const updatedRoot = instantiateBehaviorTree(context.treeId);
				const wasEnabled = context.root.enabled;
				context.root = updatedRoot;
				if (!wasEnabled) {
					updatedRoot.stop();
				}
			}
		}
	}

	private handleRemovedBehaviorTrees(removed: Iterable<string>): void {
		const removedSet = new Set(removed);
		for (const treeId of removedSet) {
			this.behaviorTreeDiagnostics.delete(treeId);
			this.disposeLuaBehaviorTreeHandlers(treeId);
		}
		for (const object of $.world.objects({ scope: 'all' })) {
			const contexts = object.btreecontexts;
			for (const treeId of removedSet) {
				delete contexts[treeId];
			}
		}
	}

	private loadLuaServiceScripts(interpreter: LuaInterpreter): void {
		this.disposeLuaServices();
		const rompack = this.api.rompack();
		if (!rompack || !rompack.lua) {
			return;
		}
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths ? rompack.luaSourcePaths : {};
		for (const assetId of Object.keys(luaSources)) {
			if (!this.assetIdRepresentsService(assetId)) {
				continue;
			}
			const source = luaSources[assetId];
			if (typeof source !== 'string') {
				throw new Error(`[BmsxConsoleRuntime] Service Lua asset '${assetId}' is not a string source.`);
			}
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'service', assetId };
			try {
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
			const chunkName = this.resolveLuaServiceChunkName(assetId, typeof sourcePathRaw === 'string' ? sourcePathRaw : null);
			const serviceInfo: { assetId: string | null; path?: string | null } = { assetId };
			if (pathHint) {
				serviceInfo.path = pathHint;
			}
			this.registerLuaChunkResource(chunkName, serviceInfo);
			let executionResults: LuaValue[];
			try {
				executionResults = interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, assetId);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`[BmsxConsoleRuntime] Failed to execute Service Lua script '${assetId}': ${message}`);
			}
			if (executionResults.length === 0) {
				throw new Error(`[BmsxConsoleRuntime] Service Lua script '${assetId}' returned no value.`);
			}
			const table = executionResults[0];
			if (!(isLuaTable(table))) {
				throw new Error(`[BmsxConsoleRuntime] Service Lua script '${assetId}' must return a table.`);
			}
			const descriptorRaw = this.luaValueToJs(table);
			if (!this.isPlainObject(descriptorRaw)) {
				throw new Error(`[BmsxConsoleRuntime] Service Lua script '${assetId}' must return a plain table.`);
			}
			const descriptor = descriptorRaw as Record<string, unknown>;
			const idValue = descriptor.id;
			if (typeof idValue !== 'string' || idValue.trim().length === 0) {
				throw new Error(`[BmsxConsoleRuntime] Service Lua script '${assetId}' is missing a valid id.`);
			}
			const serviceId = idValue.trim() as Identifier;
			if (this.luaServices.has(serviceId)) {
				throw new Error(`[BmsxConsoleRuntime] Duplicate Lua service id '${serviceId}' detected.`);
			}

			let autoActivate = true;
			const autoActivateRaw = this.getLuaRecordEntry<boolean>(descriptor, ['auto_activate', 'autoActivate']);
			if (typeof autoActivateRaw === 'boolean') {
				autoActivate = autoActivateRaw;
			}

			const hooks: LuaServiceHooks = {};
			const bootCandidate = this.getLuaTableEntry(table, ['on_boot', 'boot', 'initialize']);
			if (bootCandidate !== undefined && bootCandidate !== null) {
				if (!this.isLuaFunctionValue(bootCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_boot' must be a function.`);
				}
				hooks.boot = bootCandidate;
			}
			const activateCandidate = this.getLuaTableEntry(table, ['on_activate', 'activate']);
			if (activateCandidate !== undefined && activateCandidate !== null) {
				if (!this.isLuaFunctionValue(activateCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_activate' must be a function.`);
				}
				hooks.activate = activateCandidate;
			}
			const deactivateCandidate = this.getLuaTableEntry(table, ['on_deactivate', 'deactivate']);
			if (deactivateCandidate !== undefined && deactivateCandidate !== null) {
				if (!this.isLuaFunctionValue(deactivateCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_deactivate' must be a function.`);
				}
				hooks.deactivate = deactivateCandidate;
			}
			const disposeCandidate = this.getLuaTableEntry(table, ['on_dispose', 'dispose']);
			if (disposeCandidate !== undefined && disposeCandidate !== null) {
				if (!this.isLuaFunctionValue(disposeCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_dispose' must be a function.`);
				}
				hooks.dispose = disposeCandidate;
			}
			const tickCandidate = this.getLuaTableEntry(table, ['on_tick', 'tick', 'update']);
			if (tickCandidate !== undefined && tickCandidate !== null) {
				if (!this.isLuaFunctionValue(tickCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_tick' must be a function.`);
				}
				hooks.tick = tickCandidate;
			}
			const getStateCandidate = this.getLuaTableEntry(table, ['get_state', 'getState', 'serialize']);
			if (getStateCandidate !== undefined && getStateCandidate !== null) {
				if (!this.isLuaFunctionValue(getStateCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'get_state' must be a function.`);
				}
				hooks.getState = getStateCandidate;
			}
			const setStateCandidate = this.getLuaTableEntry(table, ['set_state', 'setState', 'deserialize']);
			if (setStateCandidate !== undefined && setStateCandidate !== null) {
				if (!this.isLuaFunctionValue(setStateCandidate)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'set_state' must be a function.`);
				}
				hooks.setState = setStateCandidate;
			}

			const events = new Map<string, LuaFunctionValue>();
			const eventsValue = this.getLuaTableEntry(table, ['events']);
			if (isLuaTable(eventsValue)) {
				for (const [rawKey, handler] of eventsValue.entriesArray()) {
					const eventName = typeof rawKey === 'string' ? rawKey.trim() : '';
					if (eventName.length === 0) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' events must use string keys.`);
					}
					if (!this.isLuaFunctionValue(handler)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' event '${eventName}' must be a function.`);
					}
					events.set(eventName, handler);
				}
			}

			const machines: Identifier[] = [];
			const machinesValue = this.getLuaRecordEntry<unknown>(descriptor, ['machines', 'state_machines', 'stateMachines']);
			if (Array.isArray(machinesValue)) {
				for (let index = 0; index < machinesValue.length; index += 1) {
					const value = machinesValue[index];
					if (typeof value !== 'string' || value.trim().length === 0) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' machines[${index}] must be a string.`);
					}
					machines.push(value.trim() as Identifier);
				}
			} else if (typeof machinesValue === 'string' && machinesValue.trim().length > 0) {
				machines.push(machinesValue.trim() as Identifier);
			}

			const service = new LuaScriptService(serviceId);

			const binding: LuaServiceBinding = {
				service,
				table,
				interpreter,
				hooks,
				events,
				autoActivate,
			};

			this.luaServices.set(serviceId, binding);

			for (let index = 0; index < machines.length; index += 1) {
				service.sc.add_statemachine(machines[index], serviceId);
			}

			if (hooks.getState) {
				service.getState = () => this.invokeLuaServiceHook(binding, hooks.getState!);
			}
			if (hooks.setState) {
				service.setState = (state: unknown) => { this.invokeLuaServiceHook(binding, hooks.setState!, state); };
			}

			const originalActivate = service.activate.bind(service);
			service.activate = () => {
				originalActivate();
				if (hooks.activate) {
					this.invokeLuaServiceHook(binding, hooks.activate);
				}
			};

			const originalDeactivate = service.deactivate.bind(service);
			service.deactivate = () => {
				if (hooks.deactivate) {
					this.invokeLuaServiceHook(binding, hooks.deactivate);
				}
				originalDeactivate();
			};

			const originalDispose = service.dispose.bind(service);
			service.dispose = () => {
				if (hooks.dispose) {
					this.invokeLuaServiceHook(binding, hooks.dispose);
				}
				this.unregisterLuaServiceEvents(service.id);
				this.luaServices.delete(service.id);
				originalDispose();
			};

			service.bind();
			this.registerLuaServiceEvents(binding);

			if (hooks.boot) {
				this.invokeLuaServiceHook(binding, hooks.boot);
			}

			if (binding.autoActivate) {
				service.activate();
			} else if (events.size > 0) {
				service.enableEvents();
			}
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
	}

	private prepareLuaBehaviorTreeDefinition(treeId: string, definitionValue: unknown, interpreter: LuaInterpreter, assetId: string): BehaviorTreeDefinition {
		if (definitionValue === null || definitionValue === undefined) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree '${treeId}' definition in asset '${assetId}' cannot be nil.`);
		}
		if (!this.isPlainObject(definitionValue) && !Array.isArray(definitionValue)) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree '${treeId}' definition in asset '${assetId}' must be a table.`);
		}
		const sanitized = this.cloneLuaBehaviorTreeValue(treeId, ['definition'], definitionValue, interpreter);
		return sanitized as BehaviorTreeDefinition;
	}

	private tickLuaServices(deltaSeconds: number): void {
		if (this.luaServices.size === 0) {
			return;
		}
		for (const binding of this.luaServices.values()) {
			if (!binding.hooks.tick) continue;
			if (!binding.service.active || binding.service.tickEnabled === false) continue;
			this.invokeLuaServiceHook(binding, binding.hooks.tick, deltaSeconds);
			if (this.luaRuntimeFailed) {
				break;
			}
		}
	}

	private disposeLuaServices(): void {
		if (this.luaServices.size === 0) {
			return;
		}
		for (const binding of this.luaServices.values()) {
			try {
				binding.service.dispose();
			}
			catch (error) {
				this.handleLuaError(error);
			}
		}
		this.luaServices.clear();
	}

	public isLuaRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}

	public listBehaviorTreeDiagnostics(): ReadonlyMap<string, BehaviorTreeDiagnostic[]> {
		return this.behaviorTreeDiagnostics;
	}

	private registerLuaServiceEvents(binding: LuaServiceBinding): void {
		if (binding.events.size === 0) {
			return;
		}
		this.unregisterLuaServiceEvents(binding.service.id);
		for (const [eventName, handler] of binding.events) {
			const handlerId = this.makeLuaHandlerId(`service:${binding.service.id}`, [eventName]);
			this.updateLuaHandlerBinding(handlerId, handler, binding.interpreter);
			const sourceRange = this.resolveLuaFunctionSourceRange(handler);
			const moduleId = this.moduleIdFor(
				'service',
				this.currentLuaAssetContext?.assetId ?? null,
				sourceRange?.chunkName ?? this.luaChunkName ?? null
			);
			const symbolName = this.formatLuaHandlerSymbol(['events', eventName], this.resolveLuaFunctionName(handler));
			this.assertLuaHandlerSymbol(handlerId, symbolName);
			const meta = this.buildLuaHandlerMetaFromModule(moduleId, sourceRange, symbolName);
			const slotId = `event.global.${eventName}`;
			const runtime = this;
			const listener: GenericHandler = function (this: Identifiable | undefined, emittedEvent: string, emitterObj: Identifiable, payloadValue?: EventPayload) {
				const bindingRef = runtime.getLuaHandlerBinding(handlerId);
				if (!bindingRef) {
					return undefined;
				}
				const callArgs: unknown[] = [binding.table, emittedEvent, emitterObj, payloadValue];
				try {
					const results = runtime.callLuaFunctionWithInterpreter(bindingRef.fn, callArgs, bindingRef.interpreter);
					return results.length > 0 ? results[0] : undefined;
				} catch (error) {
					runtime.handleLuaError(error);
					return undefined;
				}
			};
			try {
				const unsubscribe = subscribeLua(slotId, listener, meta, {
					category: 'event',
					target: { component: binding.service.id, hook: eventName },
				});
				this.luaServiceEventListeners.set(handlerId, { slot: slotId, unsubscribe });
			} catch (error) {
				this.deleteLuaHandlerBinding(handlerId);
				throw error;
			}
		}
	}

	private unregisterLuaServiceEvents(serviceId: string): void {
		const prefix = `lua.handlers.service:${serviceId}.`;
		const listenerIds = Array.from(this.luaServiceEventListeners.keys());
		for (let index = 0; index < listenerIds.length; index += 1) {
			const handlerId = listenerIds[index];
			if (!handlerId.startsWith(prefix)) {
				continue;
			}
			const listenerEntry = this.luaServiceEventListeners.get(handlerId);
			if (listenerEntry) {
				try {
					listenerEntry.unsubscribe();
				} finally {
					this.luaServiceEventListeners.delete(handlerId);
				}
			}
			this.removeLuaHandlerTracking(handlerId);
		}
	}

	private invokeLuaServiceHook(binding: LuaServiceBinding, fn: LuaFunctionValue, ...args: unknown[]): unknown {
		try {
			const results = this.callLuaFunctionWithInterpreter(fn, [binding.table, ...args], binding.interpreter);
			return results.length > 0 ? results[0] : undefined;
		}
		catch (error) {
			this.handleLuaError(error);
			return undefined;
		}
	}

	private assetIdRepresentsBehaviorTree(assetId: string): boolean {
		if (!assetId) {
			return false;
		}
		const lower = assetId.toLowerCase();
		return lower.includes('.bt.') || lower.endsWith('.bt') || lower.includes('.behaviortree') || lower.includes('.behaviourtree') || lower.includes('.behavior_tree') || lower.includes('.behaviour_tree');
	}

	private assetIdRepresentsFsm(assetId: string): boolean {
		if (!assetId) {
			return false;
		}
		return assetId.indexOf('.fsm') !== -1;
	}

	private assetIdRepresentsService(assetId: string): boolean {
		if (!assetId) {
			return false;
		}
	return assetId.indexOf('.service') !== -1;
}

	private resolveLuaHotReloadCategory(assetId: string): 'fsm' | 'behavior_tree' | 'service' | null {
		if (this.assetIdRepresentsFsm(assetId)) {
			return 'fsm';
		}
		if (this.assetIdRepresentsBehaviorTree(assetId)) {
			return 'behavior_tree';
		}
		if (this.assetIdRepresentsService(assetId)) {
			return 'service';
		}
		return null;
	}

	private resolveLuaBehaviorTreeChunkName(assetId: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@bt/${assetId}`;
	}

	private resolveLuaFsmChunkName(assetId: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@fsm/${assetId}`;
	}

	private resolveLuaServiceChunkName(assetId: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@service/${assetId}`;
	}

	private prepareLuaStateMachineBlueprint(machineId: string, blueprint: Record<string, unknown>, interpreter: LuaInterpreter): StateMachineBlueprint {
		const sanitized = this.cloneLuaBlueprintValue(machineId, [], blueprint, interpreter);
		return sanitized as StateMachineBlueprint;
	}

	private cloneLuaBehaviorTreeValue(treeId: string, path: string[], value: unknown, interpreter: LuaInterpreter): unknown {
		if (this.isLuaFunctionValue(value)) {
			return this.registerLuaBehaviorTreeHandler(treeId, path, value, interpreter);
		}
		if (Array.isArray(value)) {
			const out: unknown[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const nextPath = path.concat(String(index));
				out.push(this.cloneLuaBehaviorTreeValue(treeId, nextPath, value[index], interpreter));
			}
			return out;
		}
		if (this.isPlainObject(value)) {
			const out: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(value)) {
				const nextPath = path.concat(key);
				out[key] = this.cloneLuaBehaviorTreeValue(treeId, nextPath, entry, interpreter);
			}
			return out;
		}
		return value;
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
		let set = this.luaStateMachineHandlerIds.get(machineId);
		if (!set) {
			set = new Set<string>();
			this.luaStateMachineHandlerIds.set(machineId, set);
		}
		set.add(handlerId);
		this.updateLuaHandlerBinding(handlerId, fn, interpreter);

		const registrationRange = this.resolveLuaFunctionSourceRange(fn);
		const moduleId = this.moduleIdFor('fsm', this.currentLuaAssetContext?.assetId ?? null, registrationRange?.chunkName ?? null);
		const symbolName = this.formatLuaHandlerSymbol(path, this.resolveLuaFunctionName(fn));
		this.assertLuaHandlerSymbol(handlerId, symbolName);
		const meta = this.buildLuaHandlerMetaFromModule(moduleId, registrationRange, symbolName);
		this.claimLuaModuleOwnership(meta.module, 'fsm', machineId);
		const runtime = this;

		const handler: GenericHandler = function (this: Stateful, ...args: unknown[]) {
			const binding = runtime.getLuaHandlerBinding(handlerId);
			if (!binding) {
				throw new Error(`[BmsxConsoleRuntime] FSM handler '${handlerId}' binding missing during execution.`);
			}
			const callArgs: unknown[] = [this, ...args];
			const results = runtime.callLuaFunctionWithInterpreter(binding.fn, callArgs, binding.interpreter);
			return results.length > 0 ? results[0] : undefined;
		};

		try {
			registerLuaHandler(handlerId, handler, meta, {
				category: 'fsm',
				target: { machine: machineId, hook: path.join('.') },
			});
		} catch (error) {
			this.deleteLuaHandlerBinding(handlerId);
			this.releaseLuaModuleOwnership(meta.module, 'fsm');
			throw error;
		}
		return handlerId;
	}

	private registerLuaBehaviorTreeHandler(treeId: string, path: string[], fn: LuaFunctionValue, interpreter: LuaInterpreter): string {
		const handlerId = this.makeLuaHandlerId(treeId, path);
		let set = this.luaBehaviorTreeHandlerIds.get(treeId);
		if (!set) {
			set = new Set<string>();
			this.luaBehaviorTreeHandlerIds.set(treeId, set);
		}
		set.add(handlerId);
		this.updateLuaHandlerBinding(handlerId, fn, interpreter);

		const registrationRange = this.resolveLuaFunctionSourceRange(fn);
		const moduleId = this.moduleIdFor('behavior_tree', this.currentLuaAssetContext?.assetId ?? null, registrationRange?.chunkName ?? null);
		const symbolName = this.formatLuaHandlerSymbol(path, this.resolveLuaFunctionName(fn));
		this.assertLuaHandlerSymbol(handlerId, symbolName);
		const meta = this.buildLuaHandlerMetaFromModule(moduleId, registrationRange, symbolName);
		this.claimLuaModuleOwnership(meta.module, 'behavior_tree', treeId);
		const runtime = this;

		const handler: GenericHandler = function (this: Stateful, ...args: unknown[]) {
			const binding = runtime.getLuaHandlerBinding(handlerId);
			if (!binding) {
				throw new Error(`[BmsxConsoleRuntime] Behavior tree handler '${handlerId}' binding missing during execution.`);
			}
			const callArgs: unknown[] = [this, ...args];
			const results = runtime.callLuaFunctionWithInterpreter(binding.fn, callArgs, binding.interpreter);
			return results.length > 0 ? results[0] : undefined;
		};

		try {
			registerLuaHandler(handlerId, handler, meta, {
				category: 'behavior_tree',
				target: { tree: treeId, hook: path.join('.') },
			});
		} catch (error) {
			this.deleteLuaHandlerBinding(handlerId);
			this.releaseLuaModuleOwnership(meta.module, 'behavior_tree');
			throw error;
		}
		return handlerId;
	}

	private disposeLuaBehaviorTreeHandlers(treeId: string): void {
	const entries = this.luaBehaviorTreeHandlerIds.get(treeId);
	if (!entries) {
		return;
	}
	let moduleId: string | null = null;
	for (const handlerId of entries) {
		const desc = HandlerRegistry.instance.describe(handlerId);
		if (!moduleId && desc?.source?.module) {
			moduleId = desc.source.module;
		}
		HandlerRegistry.instance.unregister(handlerId);
		this.removeLuaHandlerTracking(handlerId);
	}
	this.luaBehaviorTreeHandlerIds.delete(treeId);
	if (moduleId) {
		this.releaseLuaModuleOwnership(moduleId, 'behavior_tree');
	}
}

	private disposeLuaStateMachineHandlers(machineId: string): void {
		const entries = this.luaStateMachineHandlerIds.get(machineId);
		if (!entries) {
			return;
		}
		let moduleId: string | null = null;
		for (const handlerId of entries) {
			const desc = HandlerRegistry.instance.describe(handlerId);
			if (!moduleId && desc?.source?.module) {
				moduleId = desc.source.module;
			}
			HandlerRegistry.instance.unregister(handlerId);
			this.removeLuaHandlerTracking(handlerId);
		}
		this.luaStateMachineHandlerIds.delete(machineId);
		if (moduleId) {
			this.releaseLuaModuleOwnership(moduleId, 'fsm');
		}
	}

	private registerLuaComponentHandler(componentId: string, slot: string, fn: LuaFunctionValue, interpreter: LuaInterpreter, symbolPath: string[]): string {
		const handlerId = this.makeLuaHandlerId(`component:${componentId}`, [slot]);
		let set = this.luaComponentHandlerIds.get(componentId);
		if (!set) {
			set = new Set<string>();
			this.luaComponentHandlerIds.set(componentId, set);
		}
		set.add(handlerId);
		this.updateLuaHandlerBinding(handlerId, fn, interpreter);

		const registrationRange = this.resolveLuaFunctionSourceRange(fn);
		const moduleId = this.moduleIdFor('component', this.currentLuaAssetContext?.assetId ?? null, registrationRange?.chunkName ?? this.luaChunkName ?? null);
		const symbolName = this.formatLuaHandlerSymbol(symbolPath, this.resolveLuaFunctionName(fn));
		this.assertLuaHandlerSymbol(handlerId, symbolName);
		const meta = this.buildLuaHandlerMetaFromModule(moduleId, registrationRange, symbolName);
		const runtime = this;

		const handler: GenericHandler = function (this: unknown, ...args: unknown[]) {
			const binding = runtime.getLuaHandlerBinding(handlerId);
			if (!binding) {
				throw new Error(`[BmsxConsoleRuntime] Component handler '${handlerId}' binding missing during execution.`);
			}
			const callArgs: unknown[] = [this, ...args];
			const results = runtime.callLuaFunctionWithInterpreter(binding.fn, callArgs, binding.interpreter);
			return results.length > 0 ? results[0] : undefined;
		};

		try {
			registerLuaHandler(handlerId, handler, meta, {
				category: 'component',
				target: { component: componentId, hook: slot },
			});
		} catch (error) {
			this.deleteLuaHandlerBinding(handlerId);
			throw error;
		}
		return handlerId;
	}

	private disposeLuaComponentHandlers(componentId: string): void {
		const entries = this.luaComponentHandlerIds.get(componentId);
		if (!entries) {
			return;
		}
	for (const handlerId of entries) {
		HandlerRegistry.instance.unregister(handlerId);
		this.removeLuaHandlerTracking(handlerId);
	}
	this.luaComponentHandlerIds.delete(componentId);
	}

	private disposeAllLuaComponentDefinitions(): void {
		for (const componentId of [...this.luaComponentHandlerIds.keys()]) {
			this.disposeLuaComponentHandlers(componentId);
		}
		this.luaComponentDefinitions.clear();
	}

	public registerLuaComponentDefinition(descriptor: Record<string, unknown>): string {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] define_lua_component requires a descriptor table.');
		}
		const interpreter = this.requireLuaInterpreter();
		const idValue = (descriptor as { id?: unknown; name?: unknown }).id ?? (descriptor as { name?: unknown }).name;
		const componentId = this.normalizeLuaIdentifier(idValue, 'define_lua_component');
		const handlersRaw = (descriptor as { handlers?: unknown }).handlers;
		const handlerIds: LuaComponentHandlerIdMap = {};
		this.disposeLuaComponentHandlers(componentId);
		if (handlersRaw && typeof handlersRaw === 'object') {
			const handlerEntries = handlersRaw as Record<string, unknown>;
			for (const [rawKey, candidate] of Object.entries(handlerEntries)) {
				const normalized = this.normalizeLuaComponentHandlerKey(rawKey);
				if (!normalized) {
					continue;
				}
				if (!this.isLuaFunctionValue(candidate)) {
					throw new Error(`[BmsxConsoleRuntime] Handler '${rawKey}' for component '${componentId}' must be a function.`);
				}
				const handlerId = this.registerLuaComponentHandler(componentId, normalized, candidate, interpreter, ['handlers', rawKey]);
				if (normalized === 'onattach') handlerIds.onattach = handlerId;
				if (normalized === 'ondetach') handlerIds.ondetach = handlerId;
				if (normalized === 'ondispose') handlerIds.ondispose = handlerId;
				if (normalized === 'preupdate') handlerIds.preupdate = handlerId;
				if (normalized === 'postupdate') handlerIds.postupdate = handlerId;
			}
		}
		const tagsPre = this.normalizeStringArray((descriptor as { tagsPre?: unknown; tags_pre?: unknown }).tagsPre ?? (descriptor as { tags_pre?: unknown }).tags_pre);
		const tagsPost = this.normalizeStringArray((descriptor as { tagsPost?: unknown; tags_post?: unknown }).tagsPost ?? (descriptor as { tags_post?: unknown }).tags_post);
		const unique = Boolean((descriptor as { unique?: unknown }).unique);
		const initialStateRaw = (descriptor as { state?: unknown; initialState?: unknown }).state ?? (descriptor as { initialState?: unknown }).initialState;
		const initialState = initialStateRaw && typeof initialStateRaw === 'object' ? deepClone(initialStateRaw as Record<string, unknown>) : undefined;
		const record: LuaComponentDefinitionRecord = {
			id: componentId,
			handlerIds,
			initialState,
			tagsPre,
			tagsPost,
			unique,
		};
		this.luaComponentDefinitions.set(componentId, record);
		return componentId;
	}

	public createLuaComponentInstance(opts: { definitionId: string; parentId: Identifier; id_local?: string | null; state?: Record<string, unknown> | null }): LuaComponent {
		const definition = this.luaComponentDefinitions.get(opts.definitionId);
		if (!definition) {
			throw new Error(`[BmsxConsoleRuntime] Lua component definition '${opts.definitionId}' is not registered.`);
		}
		const baseState = definition.initialState ? deepClone(definition.initialState) : {};
		if (opts.state) {
			Object.assign(baseState, deepClone(opts.state));
		}
		return new LuaComponent({
			parentid: opts.parentId,
			id_local: opts.id_local ?? undefined,
			definitionId: definition.id,
			handlerIds: definition.handlerIds,
			initialState: baseState,
			tagsPre: definition.tagsPre,
			tagsPost: definition.tagsPost,
			unique: definition.unique,
		});
	}

	public getLuaComponentDefinition(definitionId: string): LuaComponentDefinitionRecord | undefined {
		return this.luaComponentDefinitions.get(definitionId);
	}

	private registerLuaAbilityHandler(abilityId: string, slot: string, fn: LuaFunctionValue, interpreter: LuaInterpreter): { handlerId: string; actionId: string } {
		const handlerId = this.makeLuaHandlerId(`ability:${abilityId}`, [slot]);
		const actionId = `${handlerId}.action`;
		let handlerSet = this.luaAbilityHandlerIds.get(abilityId);
		if (!handlerSet) {
			handlerSet = new Set<string>();
			this.luaAbilityHandlerIds.set(abilityId, handlerSet);
		}
		handlerSet.add(handlerId);
		this.updateLuaHandlerBinding(handlerId, fn, interpreter);

		const registrationRange = this.resolveLuaFunctionSourceRange(fn);
		const moduleId = this.moduleIdFor('ability', this.currentLuaAssetContext?.assetId ?? null, registrationRange?.chunkName ?? this.luaChunkName ?? null);
		const symbolName = this.formatLuaHandlerSymbol([slot], this.resolveLuaFunctionName(fn));
		this.assertLuaHandlerSymbol(handlerId, symbolName);
		const meta = this.buildLuaHandlerMetaFromModule(moduleId, registrationRange, symbolName);
		const runtime = this;
		const handler: GenericHandler = function (this: unknown, ctxValue: unknown, paramsValue: unknown) {
			const binding = runtime.getLuaHandlerBinding(handlerId);
			if (!binding) {
				throw new Error(`[BmsxConsoleRuntime] Ability handler '${handlerId}' binding missing during execution.`);
			}
			const callArgs: unknown[] = [ctxValue, paramsValue];
			const results = runtime.callLuaFunctionWithInterpreter(binding.fn, callArgs, binding.interpreter);
			return results.length > 0 ? results[0] : undefined;
		};
		try {
			registerLuaHandler(handlerId, handler, meta, {
				category: 'other',
				target: { entity: abilityId, hook: slot },
			});
		} catch (error) {
			this.deleteLuaHandlerBinding(handlerId);
			throw error;
		}

		const actionFn = (ctx: unknown, params: Record<string, unknown> | undefined) => {
			const registered = HandlerRegistry.instance.get(handlerId);
			if (!registered) throw new Error(`[LuaAbility:${abilityId}] Handler '${handlerId}' not registered.`);
			return registered.call(ctx, ctx, params);
		};
		abilityActions.register(actionId, actionFn);
		const actionList = this.luaAbilityActionIds.get(abilityId) ?? [];
		actionList.push(actionId);
		this.luaAbilityActionIds.set(abilityId, actionList);
		this.luaAbilityActionByHandler.set(handlerId, actionId);

		return { handlerId, actionId };
	}


	private disposeLuaAbilityHandlers(abilityId: string): void {
	const handlerEntries = this.luaAbilityHandlerIds.get(abilityId);
	if (handlerEntries) {
		for (const id of handlerEntries) {
			HandlerRegistry.instance.unregister(id);
			this.removeLuaHandlerTracking(id);
		}
		this.luaAbilityHandlerIds.delete(abilityId);
	}
	this.luaAbilityActionIds.delete(abilityId);
	this.luaAbilityDefinitions.delete(abilityId);
	}

	private disposeAllLuaAbilityDefinitions(): void {
		for (const abilityId of [...this.luaAbilityHandlerIds.keys()]) {
			this.disposeLuaAbilityHandlers(abilityId);
		}
		this.luaAbilityDefinitions.clear();
		this.luaAbilityActionIds.clear();
	}

	public registerLuaAbilityDefinition(descriptor: Record<string, unknown>): GameplayAbilityDefinition {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] define_lua_ability requires a descriptor table.');
		}
		const interpreter = this.requireLuaInterpreter();
		const abilityId = this.normalizeLuaIdentifier((descriptor as { id?: unknown }).id, 'define_lua_ability');
		this.disposeLuaAbilityHandlers(abilityId);
		const activationFn = (descriptor as LuaAbilityRegistrationDescriptor).activation;
		if (!activationFn || !this.isLuaFunctionValue(activationFn)) {
			throw new Error(`[BmsxConsoleRuntime] Lua ability '${abilityId}' requires an activation handler.`);
		}
		const completionFn = (descriptor as LuaAbilityRegistrationDescriptor).completion;
		const cancelFn = (descriptor as LuaAbilityRegistrationDescriptor).cancel;
		const activation = this.registerLuaAbilityHandler(abilityId, 'activation', activationFn, interpreter);
		const completion = completionFn && this.isLuaFunctionValue(completionFn)
			? this.registerLuaAbilityHandler(abilityId, 'completion', completionFn, interpreter)
			: null;
		const cancel = cancelFn && this.isLuaFunctionValue(cancelFn)
			? this.registerLuaAbilityHandler(abilityId, 'cancel', cancelFn, interpreter)
			: null;
		const definition: GameplayAbilityDefinition = {
			id: abilityId,
			unique: (descriptor as LuaAbilityRegistrationDescriptor).unique ?? 'ignore',
			requiredTags: this.normalizeStringArray((descriptor as LuaAbilityRegistrationDescriptor).requiredTags),
			blockedTags: this.normalizeStringArray((descriptor as LuaAbilityRegistrationDescriptor).blockedTags),
			activation: [{ type: 'call', action: activation.actionId }],
			completion: completion ? [{ type: 'call', action: completion.actionId }] : undefined,
			cancel: cancel ? [{ type: 'call', action: cancel.actionId }] : undefined,
		};
		const grantTags = this.normalizeStringArray((descriptor as LuaAbilityRegistrationDescriptor).grantTags);
		const removeOnActivate = this.normalizeStringArray((descriptor as LuaAbilityRegistrationDescriptor).removeOnActivate);
		const removeOnEnd = this.normalizeStringArray((descriptor as LuaAbilityRegistrationDescriptor).removeOnEnd);
		if ((grantTags && grantTags.length > 0) || (removeOnActivate && removeOnActivate.length > 0) || (removeOnEnd && removeOnEnd.length > 0)) {
			definition.tags = {
				grant: grantTags && grantTags.length > 0 ? grantTags : undefined,
				removeOnActivate: removeOnActivate && removeOnActivate.length > 0 ? removeOnActivate : undefined,
				removeOnEnd: removeOnEnd && removeOnEnd.length > 0 ? removeOnEnd : undefined,
			};
		}
		const cooldownMs = (descriptor as LuaAbilityRegistrationDescriptor).cooldownMs;
		if (typeof cooldownMs === 'number' && Number.isFinite(cooldownMs) && cooldownMs >= 0) {
			definition.cooldownMs = cooldownMs;
		}
		const costRaw = (descriptor as LuaAbilityRegistrationDescriptor).cost;
		if (Array.isArray(costRaw) && costRaw.length > 0) {
			const sanitized = [];
			for (const entry of costRaw) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}
				const attr = (entry as { attr?: unknown }).attr;
				const amount = (entry as { amount?: unknown }).amount;
				if (typeof attr !== 'string' || attr.trim().length === 0) {
					throw new Error(`[BmsxConsoleRuntime] Lua ability '${abilityId}' cost entries require a non-empty attr.`);
				}
				if (typeof amount !== 'number' || !Number.isFinite(amount)) {
					throw new Error(`[BmsxConsoleRuntime] Lua ability '${abilityId}' cost entries require a finite amount.`);
				}
				sanitized.push({ attr: attr.trim(), amount });
			}
			if (sanitized.length > 0) {
				definition.cost = sanitized;
			}
		}
		try {
			defineAbility(abilityId);
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes('already registered')) {
				throw error;
			}
		}
		this.luaAbilityDefinitions.set(abilityId, definition);
		return definition;
	}

	public getLuaAbilityDefinition(id: string): GameplayAbilityDefinition | undefined {
		return this.luaAbilityDefinitions.get(id);
	}

	private normalizeLuaIdentifier(value: unknown, context: string): string {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				return trimmed;
			}
		}
		throw new Error(`[BmsxConsoleRuntime] ${context} requires a non-empty id.`);
	}

	private normalizeLuaComponentHandlerKey(key: string): keyof LuaComponentHandlerIdMap | null {
		const normalized = key.replace(/[^a-zA-Z]/g, '').toLowerCase();
		switch (normalized) {
			case 'onattach':
				return 'onattach';
			case 'ondetach':
				return 'ondetach';
			case 'ondispose':
				return 'ondispose';
			case 'pre':
			case 'preupdate':
				return 'preupdate';
			case 'post':
			case 'postupdate':
				return 'postupdate';
			default:
				return null;
		}
	}

	private normalizeStringArray(value: unknown): string[] | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value === 'string') {
			const trimmed = value.trim();
			return trimmed.length > 0 ? [trimmed] : undefined;
		}
		if (Array.isArray(value)) {
			const out: string[] = [];
			for (const entry of value) {
				if (typeof entry !== 'string') continue;
				const trimmed = entry.trim();
				if (trimmed.length > 0) out.push(trimmed);
			}
			return out.length > 0 ? out : undefined;
		}
		return undefined;
	}

	public callLuaFunctionWithInterpreter(fn: LuaFunctionValue, args: unknown[], interpreter: LuaInterpreter): unknown[] {
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

	private formatLuaHandlerSymbol(path: ReadonlyArray<string>, fallback?: string | null): string {
		const encode = (segment: string): string => segment
			.replace(/\\/g, '\\\\')
			.replace(/\./g, '\\.');

		const segments: string[] = [];
		for (let index = 0; index < path.length; index += 1) {
			const raw = path[index];
			if (raw === undefined || raw === null) continue;
			const trimmed = String(raw).trim();
			if (trimmed.length === 0) continue;
			segments.push(encode(trimmed));
		}
		if (segments.length > 0) {
			return segments.join('.');
		}
		const fallbackText = (fallback ?? '').trim();
		return fallbackText.length > 0 ? encode(fallbackText) : '<anonymous>';
	}

	private moduleIdFor(
		category: 'fsm' | 'behavior_tree' | 'service' | 'component' | 'ability' | 'other',
		assetId?: string | null,
		chunkName?: string | null
	): string {
		const trimmedChunk = (chunkName ?? '').trim();
		const trimmedAsset = (assetId ?? '').trim();
		let raw: string;
		if (trimmedChunk.length > 0) {
			raw = trimmedChunk;
		} else if (trimmedAsset.length > 0) {
			raw = `${category}/${trimmedAsset}`;
		} else {
			raw = category;
			if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
				try {
					console.warn(`[HotReload] moduleIdFor('${category}') invoked without assetId or chunkName; defaulting to '${raw}'. This may cause collisions.`);
				} catch {
					// ignore logging failures
				}
			}
		}
		return this.normalizeChunkName(raw);
	}

	private assertLuaHandlerSymbol(handlerId: string, symbol: string): void {
		if (!symbol || symbol === '<anonymous>') {
			throw new Error(`[BmsxConsoleRuntime] Handler '${handlerId}' requires a stable non-anonymous symbol (received '${symbol ?? '<unset>'}').`);
		}
	}

	private claimLuaModuleOwnership(moduleId: string, category: 'fsm' | 'behavior_tree', ownerId: string): void {
		const trimmedModule = moduleId.trim();
		if (trimmedModule.length === 0) {
			throw new Error(`[BmsxConsoleRuntime] Lua handler module id is empty for '${ownerId}'.`);
		}
		let record = this.luaModuleOwners.get(trimmedModule);
		if (!record) {
			record = {};
			this.luaModuleOwners.set(trimmedModule, record);
		}
		const existing = record[category];
		if (existing && existing !== ownerId) {
			throw new Error(`[BmsxConsoleRuntime] Module '${trimmedModule}' already owns ${category} '${existing}' (attempted '${ownerId}').`);
		}
		record[category] = ownerId;
	}

	private releaseLuaModuleOwnership(moduleId: string, category?: 'fsm' | 'behavior_tree'): void {
		const trimmed = (moduleId ?? '').trim();
		if (trimmed.length === 0) {
			return;
		}
		if (category) {
			const record = this.luaModuleOwners.get(trimmed);
			if (!record) return;
			delete record[category];
			if (Object.keys(record).length === 0) {
				this.luaModuleOwners.delete(trimmed);
			}
			return;
		}
		this.luaModuleOwners.delete(trimmed);
	}

	private createLuaHandlerBinding(handlerId: string, fn: LuaFunctionValue, interpreter: LuaInterpreter): { fn: LuaFunctionValue; interpreter: LuaInterpreter } {
		const binding = { fn, interpreter };
		this.luaHandlerBindings.set(handlerId, binding);
		return binding;
	}

	private updateLuaHandlerBinding(handlerId: string, fn: LuaFunctionValue, interpreter: LuaInterpreter): { fn: LuaFunctionValue; interpreter: LuaInterpreter } {
		const binding = this.luaHandlerBindings.get(handlerId);
		if (binding) {
			binding.fn = fn;
			binding.interpreter = interpreter;
			return binding;
		}
		return this.createLuaHandlerBinding(handlerId, fn, interpreter);
	}

	private getLuaHandlerBinding(handlerId: string): { fn: LuaFunctionValue; interpreter: LuaInterpreter } | null {
		const binding = this.luaHandlerBindings.get(handlerId);
		return binding ?? null;
	}

	private deleteLuaHandlerBinding(handlerId: string): void {
		this.luaHandlerBindings.delete(handlerId);
	}

	private removeLuaHandlerTracking(handlerId: string): void {
		const prune = (map: Map<string, Set<string>>) => {
			for (const [key, set] of map) {
				if (!set.delete(handlerId)) continue;
				if (set.size === 0) {
					map.delete(key);
				}
			}
		};
		prune(this.luaStateMachineHandlerIds);
		prune(this.luaBehaviorTreeHandlerIds);
		prune(this.luaComponentHandlerIds);
		prune(this.luaAbilityHandlerIds);
		this.luaHandlerBindings.delete(handlerId);
		const listener = this.luaServiceEventListeners.get(handlerId);
		if (listener) {
			try {
				listener.unsubscribe();
			} finally {
				this.luaServiceEventListeners.delete(handlerId);
			}
		}
		const abilityActionId = this.luaAbilityActionByHandler.get(handlerId);
		if (abilityActionId) {
			abilityActions.unregister(abilityActionId);
			this.luaAbilityActionByHandler.delete(handlerId);
			for (const [abilityId, actions] of this.luaAbilityActionIds) {
				const remaining = actions.filter((entry) => entry !== abilityActionId);
				if (remaining.length === 0) {
					this.luaAbilityActionIds.delete(abilityId);
				} else if (remaining.length !== actions.length) {
					this.luaAbilityActionIds.set(abilityId, remaining);
				}
			}
		}
	}

	private resolveLuaFunctionSourceRange(fn: LuaFunctionValue): LuaSourceRange | null {
		if (!fn) {
			return null;
		}
		const candidate = fn as unknown as { getSourceRange?: () => LuaSourceRange };
		if (!candidate || typeof candidate !== 'object') {
			return null;
		}
		if (typeof candidate.getSourceRange !== 'function') {
			return null;
		}
		return candidate.getSourceRange();
	}

	private resolveLuaFunctionName(fn: LuaFunctionValue): string | null {
		if (!fn) {
			return null;
		}
		const name = fn.name;
		if (typeof name !== 'string') {
			return null;
		}
		const trimmed = name.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private mergeLuaChunkEnvironmentState(previous: LuaEnvironment, next: LuaEnvironment): void {
		const nextEntries = new Map<string, LuaValue>();
		const nextArray = next.entries();
		for (let index = 0; index < nextArray.length; index += 1) {
			const [key, value] = nextArray[index];
			nextEntries.set(key, value);
		}
		const previousArray = previous.entries();
		for (let index = 0; index < previousArray.length; index += 1) {
			const [key, value] = previousArray[index];
			if (this.isLuaFunctionValue(value)) {
				continue;
			}
			const nextValue = nextEntries.get(key);
			if (nextValue !== undefined && this.isLuaFunctionValue(nextValue)) {
				continue;
			}
			next.set(key, value);
		}
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
			this.registerLuaGlobal(env, name, luaValue);
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
		const recycled = this.freeHandles.pop();
		const handle = recycled !== undefined ? recycled : this.nextLuaHandleId++;
		if (recycled !== undefined) {
			this.freeHandleSet.delete(handle);
		}
		this.luaObjectToHandle.set(value, handle);
		this.luaHandleToObject.set(handle, new WeakRef<object>(value));
		this.handleFinalizer?.register(value, handle);
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

	private releaseHandle(handle: number): void {
		// Only recycle handles that belong to the current mapping and whose
		// targets have actually been collected. If the handle is unknown to this
		// runtime (e.g. stale from a previous interpreter before reset), do not
		// add it to the free list to avoid accidental reuse.
		const reference = this.luaHandleToObject.get(handle);
		if (!reference) {
			return; // Unknown handle in this runtime; ignore.
		}
		const target = typeof reference.deref === 'function' ? reference.deref() : null;
		if (target) {
			return; // Still alive; nothing to release.
		}
		this.luaHandleToObject.delete(handle);
		this.handleMethodCache.delete(handle);
		if (!this.freeHandleSet.has(handle)) {
			this.freeHandles.push(handle);
			this.freeHandleSet.add(handle);
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
		const reference = this.luaHandleToObject.get(handle);
		const instance = reference && typeof reference.deref === 'function' ? reference.deref() : null;
		if (!instance) {
			this.releaseHandle(handle);
			throw this.createApiRuntimeError(interpreter, `[${typeName}.${member}] Object handle is no longer valid.`);
		}
		return instance;
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
			const resolvedName = this.resolveHandlePropertyName(instance, propertyName);
			if (!resolvedName) {
				return [null];
			}
			let property: unknown;
			try {
				property = Reflect.get(instance as Record<string, unknown>, resolvedName);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${propertyName}] ${message}`);
			}
			if (typeof property === 'function') {
				const fn = this.createHandleMethod(handle, resolvedName, propertyName, typeName, interpreter);
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
				if (isLuaTable(targetTable)) {
					targetTable.set(keyValue, args[2]);
				}
				return [];
			}
			const propertyName = typeof keyValue === 'number' ? String(keyValue) : keyValue;
			const instance = this.expectHandleObject(handle, typeName, propertyName, interpreter);
			const jsValue = this.luaValueToJs(args[2]);
			const resolvedName = this.resolveHandlePropertyName(instance, propertyName) ?? propertyName;
			try {
				Reflect.set(instance as Record<string, unknown>, resolvedName, jsValue);
			}
			catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw this.createApiRuntimeError(interpreter, `[${typeName}.${propertyName}] ${message}`);
			}
			this.evictCachedHandleMethod(handle, propertyName);
			const targetTable = args[0];
			if (isLuaTable(targetTable)) {
				targetTable.delete(propertyName);
			}
			return [];
		});

		const metatable = createLuaTable();
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
		const table = createLuaTable();
		table.set(BmsxConsoleRuntime.LUA_HANDLE_FIELD, handle);
		const typeName = this.resolveObjectTypeName(value);
		table.set(BmsxConsoleRuntime.LUA_TYPE_FIELD, typeName);
		this.attachHandleMetatable(table, handle, typeName, interpreter);
		this.luaObjectWrapperCache.set(value, table);
		return table;
	}

	private createHandleMethod(handle: number, resolvedName: string, displayName: string, typeName: string, interpreter: LuaInterpreter): LuaFunctionValue {
		return createLuaNativeFunction(`${typeName}.${displayName}`, interpreter, (_lua, args) => {
			const instance = this.expectHandleObject(handle, typeName, displayName, interpreter);
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
			const method = Reflect.get(instance as Record<string, unknown>, resolvedName);
			if (typeof method !== 'function') {
				throw new Error(`Property '${displayName}' is not callable.`);
			}
			const result = Reflect.apply(method as Function, instance, jsArgs);
			return this.wrapResultValue(result, interpreter);
		}
		catch (error) {
			if (error instanceof LuaRuntimeError) {
				this.handleLuaError(error);
				return [];
			}
			const message = error instanceof Error ? error.message : String(error);
			const runtimeError = this.createApiRuntimeError(interpreter, `[${typeName}.${displayName}] ${message}`);
			this.handleLuaError(runtimeError);
			return [];
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
				return isLuaTable(value);
			default:
				return typeof value === 'object' && value !== null && 'call' in (value as Record<string, unknown>);
		}
	}

	public luaValueToJs(value: LuaValue): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			const handleValue = value.get(BmsxConsoleRuntime.LUA_HANDLE_FIELD);
			if (typeof handleValue === 'number') {
				const reference = this.luaHandleToObject.get(handleValue);
				const instance = reference && typeof reference.deref === 'function' ? reference.deref() : null;
				if (instance) {
					return instance;
				}
				this.releaseHandle(handleValue);
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

	public jsToLua(value: unknown, interpreter: LuaInterpreter | null = this.luaInterpreter): LuaValue {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (isLuaTable(value)) {
			return value;
		}
		if (Array.isArray(value)) {
			const ensured = this.ensureInterpreter(interpreter);
			const table = createLuaTable();
			for (let index = 0; index < value.length; index += 1) {
				table.set(index + 1, this.jsToLua(value[index], ensured));
			}
			return table;
		}
		if (typeof value === 'object') {
			const ensured = this.ensureInterpreter(interpreter);
			if (value instanceof Map) {
				const table = createLuaTable();
				for (const [key, entry] of value.entries()) {
					table.set(this.jsToLua(key, ensured), this.jsToLua(entry, ensured));
				}
				return table;
			}
			if (value instanceof Set) {
				const table = createLuaTable();
				let index = 1;
				for (const entry of value.values()) {
					table.set(index, this.jsToLua(entry, ensured));
					index += 1;
				}
				return table;
			}
			if (this.isPlainObject(value)) {
				return this.wrapEngineObject(value as object, ensured);
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
			this.reloadLuaProgramState(fetched, chunkName, fetched);
		}
		catch (error) {
			this.luaProgramSourceOverride = previousOverride;
			try {
				this.reloadLuaProgramState(currentSource, chunkName, previousOverride ?? currentSource);
			}
			catch (restoreError) {
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

	private buildLuaHandlerMetaFromModule(
		moduleId: string,
		sourceRange: LuaSourceRange | null,
		symbol: string
	): LuaHandlerMeta {
		return {
			module: this.normalizeChunkName(moduleId),
			symbol,
			lineStart: sourceRange?.start.line,
			lineEnd: sourceRange?.end.line,
		};
	}

	private compileLuaModuleForHotReload(moduleId: string, source: string): LuaHotReloadCompilationResult {
		const interpreter = this.requireLuaInterpreter();
		const normalizedModule = this.normalizeChunkName(moduleId);
		const chunkName = moduleId.startsWith('@') ? moduleId : `@${moduleId}`;
		const executionResults = interpreter.execute(source, chunkName);
		const assetContext = this.currentLuaAssetContext;
		const finalizeOps: Array<() => void> = [];
		if (assetContext?.category === 'fsm' && assetContext.assetId) {
			finalizeOps.push(this.planStateMachineHotReload(assetContext.assetId, normalizedModule, executionResults, interpreter));
		} else if (assetContext?.category === 'behavior_tree' && assetContext.assetId) {
			finalizeOps.push(this.planBehaviorTreeHotReload(assetContext.assetId, normalizedModule, executionResults, interpreter));
		} else if (assetContext?.category === 'service' && assetContext.assetId) {
			finalizeOps.push(this.planServiceHotReload(assetContext.assetId, executionResults, interpreter));
		}
		if (assetContext?.assetId) {
			this.cacheChunkEnvironment(interpreter, chunkName, assetContext.assetId);
		}
		const runtime = this;
		const exports = this.collectHotReloadExports(executionResults, interpreter);
		return {
			exports,
			finalize(_result) {
				if (finalizeOps.length > 0) {
					for (const op of finalizeOps) {
						try {
							op();
						} catch (error) {
							runtime.handleLuaError(error);
						}
					}
				}
			},
		};
	}

	private collectHotReloadExports(values: LuaValue[], interpreter: LuaInterpreter): Record<string, GenericHandler> {
		const runtime = this;
		const visited = new Set<LuaTable>();
		const entries = new Map<string, GenericHandler>();

		const visit = (value: LuaValue, path: string[]): void => {
				if (this.isLuaFunctionValue(value)) {
					const symbol = runtime.formatLuaHandlerSymbol(path, runtime.resolveLuaFunctionName(value) ?? undefined);
					if (!symbol || symbol === '<anonymous>') {
						return;
					}
				const luaFn = value;
				const handler: GenericHandler = function (this: any, ...args: any[]) {
					const callArgs: unknown[] = [this, ...args];
					const results = runtime.callLuaFunctionWithInterpreter(luaFn, callArgs, interpreter);
					return results.length > 0 ? results[0] : undefined;
				};
				entries.set(symbol, handler);
				return;
			}
			if (isLuaTable(value)) {
				if (visited.has(value)) {
					return;
				}
				visited.add(value);
				const tableEntries = value.entriesArray();
				for (let index = 0; index < tableEntries.length; index += 1) {
					const [rawKey, entry] = tableEntries[index];
					let nextSegment: string | null = null;
					if (typeof rawKey === 'string' && rawKey.length > 0) {
						nextSegment = rawKey;
					} else if (typeof rawKey === 'number' && Number.isFinite(rawKey)) {
						if (Number.isInteger(rawKey) && rawKey >= 1) {
							nextSegment = String(rawKey - 1);
						} else {
							nextSegment = String(rawKey);
						}
					}
					if (!nextSegment) continue;
					visit(entry, path.concat(nextSegment));
				}
			}
		};

		for (let index = 0; index < values.length; index += 1) {
			visit(values[index], []);
		}

		const exports: Record<string, GenericHandler> = {};
		for (const [key, handler] of entries) {
			exports[key] = handler;
		}
		return exports;
	}

	private registerLuaChunkResource(chunkName: string, info: { assetId: string | null; path?: string | null }): void {
		if (!chunkName) return;
		const key = this.normalizeChunkName(chunkName);
		this.luaChunkResourceMap.set(key, info);
	}

	private cacheChunkEnvironment(interpreter: LuaInterpreter, chunkName: string, assetId: string | null): void {
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

	private planStateMachineHotReload(assetId: string, moduleName: string, executionResults: LuaValue[], interpreter: LuaInterpreter): () => void {
		if (executionResults.length === 0) {
			throw new Error(`[BmsxConsoleRuntime] FSM asset '${assetId}' returned no value during hot reload.`);
		}
		const blueprintValue = this.luaValueToJs(executionResults[0]);
		if (!this.isPlainObject(blueprintValue)) {
			throw new Error(`[BmsxConsoleRuntime] FSM asset '${assetId}' must return a table.`);
		}
		const machineIdRaw = (blueprintValue as Record<string, unknown>).id;
		if (typeof machineIdRaw !== 'string' || machineIdRaw.trim().length === 0) {
			throw new Error(`[BmsxConsoleRuntime] FSM asset '${assetId}' returned a blueprint without a valid 'id'.`);
		}
		const machineId = machineIdRaw.trim();
		const prepared = this.prepareLuaStateMachineBlueprint(machineId, blueprintValue as Record<string, unknown>, interpreter);
		const runtime = this;
		return function finalizeStateMachine() {
			const previousContext = runtime.currentLuaAssetContext;
			runtime.currentLuaAssetContext = { category: 'fsm', assetId };
			try {
				const applyResult = applyPreparedStateMachine(machineId, prepared, { force: true });
				runtime.api.register_prepared_fsm(machineId, prepared, { setup: false });
				runtime.luaFsmMachineIds.add(machineId);
				if (applyResult.changed && applyResult.previousDefinition && ActiveStateMachines.has(machineId)) {
					const previousDefinitions = new Map<string, StateDefinition | undefined>();
					previousDefinitions.set(machineId, applyResult.previousDefinition);
					const controllersToRebind = runtime.unsubscribeStateMachineEvents([machineId], previousDefinitions);
					runtime.refreshStateMachines([machineId], previousDefinitions, controllersToRebind);
				}
			} finally {
				runtime.currentLuaAssetContext = previousContext;
			}
			const registry = HandlerRegistry.instance;
			const moduleIds = registry.listByModule(moduleName);
			const nextIds = new Set<string>();
			for (const id of moduleIds) {
				const desc = registry.describe(id);
				if (desc?.target?.machine === machineId) {
					nextIds.add(id);
				}
			}
			runtime.luaStateMachineHandlerIds.set(machineId, nextIds);
		};
	}

	private planBehaviorTreeHotReload(assetId: string, moduleName: string, executionResults: LuaValue[], interpreter: LuaInterpreter): () => void {
		if (executionResults.length === 0) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree asset '${assetId}' returned no value during hot reload.`);
		}
		const descriptorValue = this.luaValueToJs(executionResults[0]);
		if (!this.isPlainObject(descriptorValue)) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree asset '${assetId}' must return a table.`);
		}
		const descriptor = descriptorValue as Record<string, unknown>;
		const idValue = descriptor.id;
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree asset '${assetId}' is missing a valid id.`);
		}
		const treeId = idValue.trim();
		let definitionSource: unknown;
		if (Object.prototype.hasOwnProperty.call(descriptor, 'definition')) {
			definitionSource = descriptor['definition'];
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'tree')) {
			definitionSource = descriptor['tree'];
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'root')) {
			definitionSource = { root: descriptor['root'] };
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'type')) {
			const copy: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(descriptor)) {
				if (key === 'id') continue;
				copy[key] = entry;
			}
			definitionSource = copy;
		} else {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree asset '${assetId}' must provide a 'definition' or 'tree' entry.`);
		}
		const prepared = this.prepareLuaBehaviorTreeDefinition(treeId, definitionSource, interpreter, assetId);
		const runtime = this;
		return function finalizeBehaviorTree() {
			const previousContext = runtime.currentLuaAssetContext;
			runtime.currentLuaAssetContext = { category: 'behavior_tree', assetId };
			try {
				applyPreparedBehaviorTree(treeId, prepared, { force: true });
				const diagnostics = getBehaviorTreeDiagnostics(treeId);
				runtime.behaviorTreeDiagnostics.set(treeId, diagnostics);
				for (let index = 0; index < diagnostics.length; index += 1) {
					const diagnostic = diagnostics[index];
					if (diagnostic.severity === 'warning') {
						runtime.recordLuaWarning(`[BehaviorTree:${treeId}] ${diagnostic.message}`);
					}
				}
				runtime.luaBehaviorTreeIds.add(treeId);
				runtime.refreshBehaviorTreeContexts([treeId]);
			} finally {
				runtime.currentLuaAssetContext = previousContext;
			}
			const registry = HandlerRegistry.instance;
			const moduleIds = registry.listByModule(moduleName);
			const nextIds = new Set<string>();
			for (const id of moduleIds) {
				const desc = registry.describe(id);
				if (desc?.target?.tree === treeId) {
					nextIds.add(id);
				}
			}
			runtime.luaBehaviorTreeHandlerIds.set(treeId, nextIds);
		};
	}

	private planServiceHotReload(assetId: string, executionResults: LuaValue[], interpreter: LuaInterpreter): () => void {
		if (executionResults.length === 0) {
			throw new Error(`[BmsxConsoleRuntime] Service asset '${assetId}' returned no value during hot reload.`);
		}
		const table = executionResults[0];
		if (!isLuaTable(table)) {
			throw new Error(`[BmsxConsoleRuntime] Service asset '${assetId}' must return a table.`);
		}
		const descriptorRaw = this.luaValueToJs(table);
		if (!this.isPlainObject(descriptorRaw)) {
			throw new Error(`[BmsxConsoleRuntime] Service asset '${assetId}' must return a descriptor table.`);
		}
		const descriptor = descriptorRaw as Record<string, unknown>;
		const idValue = descriptor.id;
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error(`[BmsxConsoleRuntime] Service asset '${assetId}' is missing a valid id.`);
		}
		const serviceId = idValue.trim() as Identifier;
		const runtime = this;
		return function finalizeService() {
			const previousContext = runtime.currentLuaAssetContext;
			runtime.currentLuaAssetContext = { category: 'service', assetId };
			try {
				const existingBinding = runtime.luaServices.get(serviceId);
				if (existingBinding) {
					existingBinding.service.dispose();
				}

				let autoActivate = true;
				const autoActivateRaw = runtime.getLuaRecordEntry<boolean>(descriptor, ['auto_activate', 'autoActivate']);
				if (typeof autoActivateRaw === 'boolean') {
					autoActivate = autoActivateRaw;
				}

				const hooks: LuaServiceHooks = {};
				const bootCandidate = runtime.getLuaTableEntry(table, ['on_boot', 'boot', 'initialize']);
				if (bootCandidate !== undefined && bootCandidate !== null) {
					if (!runtime.isLuaFunctionValue(bootCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_boot' must be a function.`);
					}
					hooks.boot = bootCandidate;
				}
				const activateCandidate = runtime.getLuaTableEntry(table, ['on_activate', 'activate']);
				if (activateCandidate !== undefined && activateCandidate !== null) {
					if (!runtime.isLuaFunctionValue(activateCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_activate' must be a function.`);
					}
					hooks.activate = activateCandidate;
				}
				const deactivateCandidate = runtime.getLuaTableEntry(table, ['on_deactivate', 'deactivate']);
				if (deactivateCandidate !== undefined && deactivateCandidate !== null) {
					if (!runtime.isLuaFunctionValue(deactivateCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_deactivate' must be a function.`);
					}
					hooks.deactivate = deactivateCandidate;
				}
				const disposeCandidate = runtime.getLuaTableEntry(table, ['on_dispose', 'dispose']);
				if (disposeCandidate !== undefined && disposeCandidate !== null) {
					if (!runtime.isLuaFunctionValue(disposeCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_dispose' must be a function.`);
					}
					hooks.dispose = disposeCandidate;
				}
				const tickCandidate = runtime.getLuaTableEntry(table, ['on_tick', 'tick']);
				if (tickCandidate !== undefined && tickCandidate !== null) {
					if (!runtime.isLuaFunctionValue(tickCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_tick' must be a function.`);
					}
					hooks.tick = tickCandidate;
				}
				const getStateCandidate = runtime.getLuaTableEntry(table, ['get_state', 'getState', 'serialize']);
				if (getStateCandidate !== undefined && getStateCandidate !== null) {
					if (!runtime.isLuaFunctionValue(getStateCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'get_state' must be a function.`);
					}
					hooks.getState = getStateCandidate;
				}
				const setStateCandidate = runtime.getLuaTableEntry(table, ['set_state', 'setState', 'deserialize']);
				if (setStateCandidate !== undefined && setStateCandidate !== null) {
					if (!runtime.isLuaFunctionValue(setStateCandidate)) {
						throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'set_state' must be a function.`);
					}
					hooks.setState = setStateCandidate;
				}

				const events = new Map<string, LuaFunctionValue>();
				const eventsValue = runtime.getLuaTableEntry(table, ['events']);
				if (isLuaTable(eventsValue)) {
					for (const [rawKey, handler] of eventsValue.entriesArray()) {
						const eventName = typeof rawKey === 'string' ? rawKey.trim() : '';
						if (eventName.length === 0) {
							throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' events must use string keys.`);
						}
						if (!runtime.isLuaFunctionValue(handler)) {
							throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' event '${eventName}' must be a function.`);
						}
						events.set(eventName, handler);
					}
				}

				const machines: Identifier[] = [];
				const machinesValue = runtime.getLuaRecordEntry<unknown>(descriptor, ['machines', 'state_machines', 'stateMachines']);
				if (Array.isArray(machinesValue)) {
					for (let index = 0; index < machinesValue.length; index += 1) {
						const value = machinesValue[index];
						if (typeof value !== 'string' || value.trim().length === 0) {
							throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' machines[${index}] must be a string.`);
						}
						machines.push(value.trim() as Identifier);
					}
				} else if (typeof machinesValue === 'string' && machinesValue.trim().length > 0) {
					machines.push(machinesValue.trim() as Identifier);
				}

				const service = new LuaScriptService(serviceId);
				const binding: LuaServiceBinding = {
					service,
					table,
					interpreter,
					hooks,
					events,
					autoActivate,
				};

				runtime.luaServices.set(serviceId, binding);

				for (let index = 0; index < machines.length; index += 1) {
					service.sc.add_statemachine(machines[index], serviceId);
				}

				if (hooks.getState) {
					service.getState = () => runtime.invokeLuaServiceHook(binding, hooks.getState!);
				}
				if (hooks.setState) {
					service.setState = (state: unknown) => { runtime.invokeLuaServiceHook(binding, hooks.setState!, state); };
				}

				const originalActivate = service.activate.bind(service);
				service.activate = () => {
					originalActivate();
					if (hooks.activate) {
						runtime.invokeLuaServiceHook(binding, hooks.activate);
					}
				};

				const originalDeactivate = service.deactivate.bind(service);
				service.deactivate = () => {
					if (hooks.deactivate) {
						runtime.invokeLuaServiceHook(binding, hooks.deactivate);
					}
					originalDeactivate();
				};

				const originalDispose = service.dispose.bind(service);
				service.dispose = () => {
					if (hooks.dispose) {
						runtime.invokeLuaServiceHook(binding, hooks.dispose);
					}
					runtime.unregisterLuaServiceEvents(service.id);
					runtime.luaServices.delete(service.id);
					originalDispose();
				};

				service.bind();
				runtime.registerLuaServiceEvents(binding);

				if (hooks.boot) {
					runtime.invokeLuaServiceHook(binding, hooks.boot);
				}

				if (binding.autoActivate) {
					service.activate();
				} else if (events.size > 0) {
					service.enableEvents();
				}
			} finally {
				runtime.currentLuaAssetContext = previousContext;
			}
		};
	}

	public listLuaSymbols(assetId: string | null, chunkName: string | null): ConsoleLuaSymbolEntry[] {
		const bundle = this.getStaticDefinitions(assetId, chunkName);
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
			const location = this.buildDefinitionLocationFromRange(info.definition, assetId);
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

	public listLuaBuiltinFunctions(): ConsoleLuaBuiltinDescriptor[] {
		const result: ConsoleLuaBuiltinDescriptor[] = [];
		for (const metadata of this.luaBuiltinMetadata.values()) {
			result.push({
				name: metadata.name,
				params: Array.isArray(metadata.params) ? metadata.params.slice() : [],
				signature: metadata.signature,
			});
		}
		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}

	public listAllLuaSymbols(): ConsoleLuaSymbolEntry[] {
		const entries = new Map<string, { info: LuaDefinitionInfo; location: ConsoleLuaDefinitionLocation; priority: number }>();

		const appendDefinitions = (info: { assetId: string | null; path?: string | null }, definitions: ReadonlyArray<LuaDefinitionInfo> | null) => {
			if (!definitions) {
				return;
			}
			for (const definition of definitions) {
				const location = this.buildDefinitionLocationFromRange(definition.definition, info.assetId);
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
		const candidates: Array<{ chunkName: string; info: { assetId: string | null; path?: string | null } }> = [];
		const enqueueCandidate = (chunkName: string | null | undefined, info: { assetId: string | null; path?: string | null }): void => {
			if (!chunkName) {
				return;
			}
			const normalizedChunk = this.normalizeChunkName(chunkName);
			const key = `${info.assetId ?? ''}|${normalizedChunk}`;
			if (enqueuedChunks.has(key)) {
				return;
			}
			enqueuedChunks.add(key);
			const candidateInfo: { assetId: string | null; path?: string | null } = { assetId: info.assetId ?? null };
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
		const programAssetId = (() => {
			const program = this.luaProgram;
			if (!program) return null;
			if ('assetId' in program && typeof program.assetId === 'string') {
				return program.assetId;
			}
			return null;
		})();

		for (const descriptor of descriptors) {
			let assetId = descriptor.assetId ?? null;
			if (!assetId) {
				assetId = this.findAssetIdForPath(descriptor.path);
			}
			if (assetId && programAssetId && assetId === programAssetId) {
				continue;
			}
			const chunkName = descriptor.path ?? descriptor.assetId ?? 'lua_resource';
			const info = { assetId, path: descriptor.path ?? null };
			enqueueCandidate(chunkName, info);
		}

		for (const [chunkName, info] of this.luaChunkResourceMap) {
			const candidateInfo: { assetId: string | null; path?: string | null } = {
				assetId: info.assetId ?? null,
			};
			if (info.path !== undefined) {
				candidateInfo.path = info.path;
			}
			enqueueCandidate(chunkName, candidateInfo);
		}

		const program = this.luaProgram;
		if (program) {
			const programChunk = this.normalizeChunkName(this.resolveLuaProgramChunkName(program));
			const programInfo: { assetId: string | null; path?: string | null } = 'assetId' in program && typeof program.assetId === 'string'
				? { assetId: program.assetId, path: this.resolveResourcePath(program.assetId) ?? undefined }
				: { assetId: null, path: programChunk };
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

	private findStaticDefinitionLocation(assetId: string | null, chain: ReadonlyArray<string>, usageRow: number | null, usageColumn: number | null, preferredChunk: string | null): ConsoleLuaDefinitionLocation | null {
	if (chain.length === 0) {
		return null;
	}
	const bundle = this.getStaticDefinitions(assetId, preferredChunk);
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
				const targetAsset = chunk.info.assetId ?? assetId;
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
	return this.buildDefinitionLocationFromRange(chosen.definition, assetId);
}

	private getStaticDefinitions(assetId: string | null, preferredChunk: string | null): { definitions: ReadonlyArray<LuaDefinitionInfo>; chunks: Array<{ chunkName: string; info: { assetId: string | null; path?: string | null } }>; models: Map<string, LuaSemanticModel> } | null {
		const interpreter = this.requireLuaInterpreter();
		const normalizedPreferred = preferredChunk ? this.normalizeChunkName(preferredChunk) : null;
		const normalizedPreferredPath = preferredChunk ? preferredChunk.replace(/\\/g, '/') : null;
		const matchingChunks: Array<{ chunkName: string; info: { assetId: string | null; path?: string | null } }> = [];
		for (const [chunkName, info] of this.luaChunkResourceMap) {
			const matchesAsset = assetId !== null && info.assetId === assetId;
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
			if (model) {
				models.set(candidate.chunkName, model);
				for (let defIndex = 0; defIndex < model.definitions.length; defIndex += 1) {
					recordDefinition(model.definitions[defIndex]);
				}
			}
		}
		if (byKey.size === 0) {
			return null;
		}
		return { definitions: Array.from(byKey.values()), chunks: matchingChunks, models };
	}

	private buildSemanticModelForChunk(chunkName: string, info: { assetId: string | null; path?: string | null }): LuaSemanticModel | null {
		const source = this.resolveSourceForChunk(chunkName, info);
		if (!source) {
			return null;
		}
		try {
			return buildLuaSemanticModel(source, chunkName);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`[BmsxConsoleRuntime] Failed to parse '${chunkName}': ${message}`);
		}
	}

	private resolveSourceForChunk(chunkName: string, info: { assetId: string | null; path?: string | null }): string | null {
		if (this.editor) {
			try {
				return this.editor.getSourceForChunk(info.assetId, chunkName);
			} catch {
				// Fall back to rompack/program sources.
				console.warn(`[BmsxConsoleRuntime] Editor failed to provide source for chunk '${chunkName}'. Falling back to rompack/program sources.`);
			}
		}
		if (info.assetId) {
			const rompackSource = this.resolveRompackLuaSource(info.assetId);
			if (rompackSource) {
				return rompackSource;
			}
		}
		return this.resolveProgramSourceForChunk(chunkName);
	}

	private resolveRompackLuaSource(assetId: string): string | null {
		const rompack = this.api.rompack();
		if (!rompack || !rompack.lua) {
			return null;
		}
		const source = rompack.lua[assetId];
		return typeof source === 'string' ? source : null;
	}

	private resolveProgramSourceForChunk(chunkName: string): string | null {
		if (!this.luaProgram) {
			return null;
		}
		const programChunk = this.normalizeChunkName(this.resolveLuaProgramChunkName(this.luaProgram));
		const normalizedChunk = this.normalizeChunkName(chunkName);
		if (programChunk !== normalizedChunk) {
			return null;
		}
		return this.getLuaProgramSource(this.luaProgram);
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
		const interpreter = this.requireLuaInterpreter();
		const root = parts[0];
		let value: LuaValue | null = null;
		let scope: ConsoleLuaHoverScope = 'global';
		let found = false;
		let definitionEnv: LuaEnvironment | null = null;
		let definitionRange: LuaSourceRange | null = null;
		const globalEnv = interpreter.getGlobalEnvironment();

		const frameEnv = interpreter.getLastFaultEnvironment();
		if (frameEnv) {
			const resolved = this.resolveIdentifierThroughChain(frameEnv, root, interpreter);
			if (resolved) {
				value = resolved.value;
				scope = resolved.scope;
				found = true;
				definitionEnv = resolved.environment;
			}
		}
		if (!found && assetId) {
			const env = this.luaChunkEnvironmentsByAssetId.get(assetId) ?? null;
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
		const globalEnv = interpreter.getGlobalEnvironment();
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
		if (isLuaTable(value)) {
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
		return this.luaBuiltinMetadata.has(name);
	}

	private refreshLuaHandlersForChunk(chunkName: string, sourceOverride?: string | null): void {
		const normalized = this.normalizeChunkName(chunkName);
		const registry = HandlerRegistry.instance;
		const ids = registry.listByModule(normalized);
		if (ids.length === 0) {
			return;
		}

		const resourceInfo = this.lookupChunkResourceInfo(normalized) ?? { assetId: null };
		const moduleSource = (typeof sourceOverride === 'string' && sourceOverride.length > 0)
			? sourceOverride
			: this.resolveSourceForChunk(normalized, resourceInfo);

		if (typeof moduleSource !== 'string' || moduleSource.length === 0) {
			return;
		}

		const previousContext = this.currentLuaAssetContext;
		const assetId = resourceInfo.assetId ?? null;
		const category = assetId ? this.resolveLuaHotReloadCategory(assetId) : null;
		if (assetId && category) {
			this.currentLuaAssetContext = { category, assetId };
		}

		this.registerLuaChunkResource(chunkName, resourceInfo);

		try {
			this.luaHotReloader.reloadModule(normalized, moduleSource);
			this.clearEditorErrorOverlaysIfNoFault();
		}
		catch (error) {
			this.handleLuaError(error);
		}
		finally {
			this.currentLuaAssetContext = previousContext;
		}
	}

}
