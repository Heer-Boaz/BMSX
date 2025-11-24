import type { StorageService, InputEvt } from '../platform/platform';
import { BmsxConsoleApi } from './api';
import { CONSOLE_API_METHOD_METADATA } from './api_metadata';
import { BmsxConsoleStorage } from './storage';
import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram, ConsoleResourceDescriptor, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaResourceCreationRequest, ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry, ConsoleLuaBuiltinDescriptor, ConsoleLuaMemberCompletionRequest, ConsoleLuaMemberCompletion } from './types';
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
import { type EventPayload } from '../core/eventemitter';
import type { GameEvent } from '../core/game_event';
import type { Identifier, Identifiable } from '../rompack/rompack';
import { OverlayPipelineController } from '../core/pipelines/overlay_controller';
import { ConsoleRenderFacade } from './console_render_facade';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import { LuaHandlerCache, type LuaHandlerFn, isLuaHandlerFn } from '../lua/handler_cache';
import { ActiveStateMachines, StateDefinitions, applyPreparedStateMachine } from '../fsm/fsmlibrary';
import { StateDefinitionBuilders } from '../fsm/fsmdecorators';
import { instantiateBehaviorTree, unregisterBehaviorTreeBuilder, applyPreparedBehaviorTree, getBehaviorTreeDiagnostics, Blackboard } from '../ai/behaviourtree';
import type { BehaviorTreeDefinition, BehaviorTreeDiagnostic } from '../ai/behaviourtree';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { LuaSourceRange, LuaDefinitionInfo, LuaDefinitionKind } from '../lua/ast';
import { createConsoleCartEditor, type ConsoleCartEditor, } from './ide/console_cart_editor';
import { toggleEditorFromShortcut } from './ide/input_controller';
import type { RuntimeErrorDetails } from './ide/types';
import type { StackTraceFrame } from 'bmsx/lua/runtime';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import type { ConsoleFontVariant } from './font';
import { buildLuaSemanticModel, type LuaSemanticModel } from './ide/semantic_model';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceStateFilePath, buildWorkspaceStorageKey, WORKSPACE_FILE_ENDPOINT } from './workspace';
import { collectWorkspaceOverrides, type WorkspaceOverrideRecord } from './workspace';
import { LuaComponent } from '../component/lua_component';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import { InputIntentComponent } from '../component/inputintentcomponent';
import type { LuaComponentHandlerMap } from '../component/lua_component';
import { defineActionEffect } from '../action_effects/effect_registry';
import type { ActionEffectDefinition, ActionEffectHandlerContext, ActionEffectHandlerResult, ActionEffectId } from '../action_effects/effect_types';
import type { ScriptHandler } from '../lua/script_handler';
import { deep_clone } from '../utils/deep_clone';
import { WorldObject } from '../core/object/worldobject';
import { Reviver } from '../serializer/gameserializer';
import type { RevivableObjectArgs } from '../serializer/serializationhooks';
import { Input } from '../input/input';
import type { PlayerInput } from '../input/playerinput';
import type { InputMap, KeyboardInputMapping, GamepadInputMapping, PointerInputMapping, KeyboardBinding, GamepadBinding, PointerBinding, ButtonState } from '../input/inputtypes';
import { ConsoleMode } from './console_mode';
import { EDITOR_TOGGLE_KEY, CONSOLE_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS } from './ide/constants';
import { setDebuggerRuntimeAccessor } from './runtime_accessors';
import {
	emitDebuggerLifecycleEvent,
	type DebuggerResumeMode,
	type DebuggerPauseDisplayPayload,
	type DebuggerPauseFrameHint,
} from './debugger_lifecycle';
import { arrayify } from '../utils/arrayify';
import { safeclamp } from '../utils/safeclamp';
import { ConsoleCommandDispatcher } from './console_commands';

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
const COMPONENT_DESCRIPTOR_RESERVED_KEYS = new Set<string>([
	'class',
	'className',
	'type',
	'preset',
	'params',
	'arguments',
	'options',
	'config',
	'id',
	'id_local',
]);
const COMPONENT_OPTION_RESERVED_KEYS = new Set<string>(['id', 'id_local']);

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

setDebuggerRuntimeAccessor(() => BmsxConsoleRuntime.instance);

type HttpResponse = {
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
	json(): Promise<unknown>;
};

type LuaServiceHooks = {
	boot?: LuaHandlerFn;
	activate?: LuaHandlerFn;
	deactivate?: LuaHandlerFn;
	dispose?: LuaHandlerFn;
	tick?: LuaHandlerFn;
	get_state?: LuaHandlerFn;
	set_state?: LuaHandlerFn;
};

type LuaServiceBinding = {
	service: Service;
	table: LuaTable;
	hooks: LuaServiceHooks;
	events: Map<string, LuaHandlerFn>;
	auto_activate: boolean;
};

type LuaServiceSnapshot = {
	state?: unknown;
	active: boolean;
	events_enabled: boolean;
};

type LuaComponentDefinitionRecord = {
	id: string;
	handlers: LuaComponentHandlerMap;
	initial_state?: Record<string, unknown>;
	tagsPre?: ReadonlyArray<string>;
	tagsPost?: ReadonlyArray<string>;
	unique?: boolean;
};

type LuaConsoleComponentDescriptor = {
	classname: string;
	options: Record<string, unknown>;
};

export type ConsoleWorldObjectComponentEntry =
	| { kind: 'component'; descriptor: LuaConsoleComponentDescriptor }
	| { kind: 'preset'; presetId: string; params: Record<string, unknown> };

export type ConsoleWorldObjectSystemEntry = {
	id: string;
	context?: string | null;
	auto_tick?: boolean | null;
	active?: boolean | null;
};

export type ConsoleWorldObjectSpawnOptions = {
	components: ConsoleWorldObjectComponentEntry[];
	fsms: ConsoleWorldObjectSystemEntry[];
	behavior_trees: ConsoleWorldObjectSystemEntry[];
	effects: string[];
	tags: string[];
	defaults?: Record<string, unknown> | null;
};


type ConsoleWorldObjectDefinitionRecord = {
	id: string;
	base_classname: string;
	base_ctor: new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
	constructor: new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
	class_ref: string;
	class_table: LuaTable;
	components: ConsoleWorldObjectComponentEntry[];
	defaults?: Record<string, unknown>;
	fsms: ConsoleWorldObjectSystemEntry[];
	behavior_trees: ConsoleWorldObjectSystemEntry[];
	effects: string[];
	tags: string[];
	asset_id: string | null;
};

type ConsoleServiceDefinitionRecord = {
	id: string;
	fsms: ConsoleWorldObjectSystemEntry[];
	behavior_trees: ConsoleWorldObjectSystemEntry[];
	effects: string[];
	tags: string[];
	auto_activate: boolean;
	asset_id: string | null;
};

type LuaComponentPresetRecord = {
	id: string;
	module_id: string;
	build: LuaHandlerFn;
	asset_id?: string | null;
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
	interpreter: LuaInterpreter;
	path: string[];
};

class ConsoleScriptService extends Service {
	constructor(id: Identifier) {
		super({ id, deferBind: true });
	}
}

export var api: BmsxConsoleApi; // Initialized in BmsxConsoleRuntime constructor

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
		{ name: 'require', params: ['moduleName'], signature: 'require(moduleName)' },
		{ name: 'table.concat', params: ['list', 'separator?', 'start?', 'end?'], signature: 'table.concat(list [, sep [, i [, j]]])' },
		{ name: 'table.insert', params: ['list', 'pos?', 'value'], signature: 'table.insert(list [, pos], value)' },
		{ name: 'table.pack', params: ['...'], signature: 'table.pack(...)' },
		{ name: 'table.remove', params: ['list', 'pos?'], signature: 'table.remove(list [, pos])' },
		{ name: 'table.sort', params: ['list', 'comp?'], signature: 'table.sort(list [, comp])' },
		{ name: 'table.unpack', params: ['list', 'i?', 'j?'], signature: 'table.unpack(list [, i [, j]])' },
	];
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

	public static createInstance(options: BmsxConsoleRuntimeOptions): void {
		const existing = BmsxConsoleRuntime._instance;
		if (existing) {
			const sameCart = existing.cart.meta.persistentId === options.cart.meta.persistentId;
			if (!sameCart) {
				existing.dispose();
			}
		}
		BmsxConsoleRuntime._instance = new BmsxConsoleRuntime(options);
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
	private readonly storage: BmsxConsoleStorage;
	private readonly storageService: StorageService;
	private readonly apiFunctionNames = new Set<string>();
	private readonly luaBuiltinMetadata = new Map<string, ConsoleLuaBuiltinDescriptor>();
	private readonly caseInsensitiveLua: boolean;
	private luaProgram: BmsxConsoleLuaProgram | null;
	private playerIndex: number;
	private editor: ConsoleCartEditor | null = null;
	private readonly overlayRenderBackend = new ConsoleRenderFacade();
	private readonly consoleMode: ConsoleMode;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderBackend.setRenderingViewportType(value);
		const editor = this.editor;
		if (editor) editor.updateViewport(this.overlayRenderBackend.viewportSize);
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
	private luaProgramSourceOverride: string | null = null;
	private luaInterpreter!: LuaInterpreter;
	private fsmLuaInterpreter: LuaInterpreter | null = null;
	private luaInitFunction: LuaFunctionValue | null = null;
	private luaUpdateFunction: LuaFunctionValue | null = null;
	private luaDrawFunction: LuaFunctionValue | null = null;
	private luaChunkName: string | null = null;
	private luaSnapshotSave: LuaFunctionValue | null = null;
	private luaSnapshotLoad: LuaFunctionValue | null = null;
	private luaVmInitialized = false;
	private luaRuntimeFailed = false;
	private readonly luaDebuggerController: LuaDebuggerController = new LuaDebuggerController();
	private luaDebuggerSuspension: LuaDebuggerPauseSignal | null = null;
	private debuggerHaltsGame = false;
	private debuggerAutoActivateOnNextPause = false;
	private lastFrameTimestampMs = 0;
	private overlayState = { console: false, editor: false };
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
	private readonly consoleFsmMachineIds: Set<string> = new Set<string>();
	private readonly consoleFsmsByAsset: Map<string, Set<string>> = new Map();
	private readonly consoleBehaviorTreeIds: Set<string> = new Set<string>();
	private readonly consoleBehaviorTreesByAsset: Map<string, Set<string>> = new Map();
	private readonly componentDefinitions: Map<string, LuaComponentDefinitionRecord> = new Map();
	private readonly componentPresets: Map<string, LuaComponentPresetRecord> = new Map();
	private readonly consoleComponentPresetsByAsset: Map<string, Set<string>> = new Map();
	private readonly worldObjectDefinitions: Map<string, ConsoleWorldObjectDefinitionRecord> = new Map();
	private readonly worldObjectDefinitionsByClassRef: Map<string, ConsoleWorldObjectDefinitionRecord> = new Map();
	private readonly consoleWorldObjectsByAsset: Map<string, Set<string>> = new Map();
	private readonly serviceDefinitions: Map<string, ConsoleServiceDefinitionRecord> = new Map();
	private readonly consoleServiceDefinitionsByAsset: Map<string, Set<string>> = new Map();
	private readonly consoleServicesByAsset: Map<string, Set<string>> = new Map();
	private readonly luaGenericAssetsExecuted: Set<string> = new Set();
	private readonly effectDefinitions: Map<ActionEffectId, ActionEffectDefinition> = new Map();
	private readonly worldObjectFsmAttachments: WeakMap<WorldObject, Set<string>> = new WeakMap();
	private readonly worldObjectBtAttachments: WeakMap<WorldObject, Set<string>> = new WeakMap();
	private readonly worldObjectEffectAttachments: WeakMap<WorldObject, Set<string>> = new WeakMap();
	private readonly serviceFsmAttachments: WeakMap<Service, Set<string>> = new WeakMap();
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, interpreter, thisArg, args) => this.invokeLuaHandler(fn, interpreter, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	private readonly consoleServiceEventListeners = new Map<string, () => void>();
	private handledLuaErrors = new WeakSet<object>();
	private pendingRuntimeErrorOverlay:
		| {
			chunkName: string | null;
			line: number | null;
			column: number | null;
			message: string;
			hint: DebuggerPauseFrameHint;
			details: RuntimeErrorDetails | null;
		}
		| null = null;
	private currentLuaAssetContext: { category: 'fsm' | 'behavior_tree' | 'service' | 'component_preset' | 'worldobject' | 'other'; asset_id: string } | null = null;
	private readonly behaviorTreeDiagnostics: Map<string, BehaviorTreeDiagnostic[]> = new Map();
	private readonly consoleServices: Map<string, LuaServiceBinding> = new Map();
	private readonly rompackOriginalLua: Map<string, string> = new Map();
	private readonly workspaceLuaOverrides: Map<string, WorkspaceOverrideRecord> = new Map();
	private hasBooted = false;
	private workspaceOverrideToken = 0;
	private hasWorkspaceLuaOverrides = false;
	private static readonly WORLD_OBJECT_RESERVED_DEFAULT_KEYS = new Set<string>(['id', 'sc', 'btreecontexts']);
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
		const rompack = $.rompack;
		this.caseInsensitiveLua = options.caseInsensitiveLua ?? (rompack.caseInsensitiveLua ?? true);
		setLuaTableCaseInsensitiveKeys(this.caseInsensitiveLua);
		setEditorCaseInsensitivity(this.caseInsensitiveLua);
		this.consoleMode = new ConsoleMode({
			playerIndex: options.playerIndex,
			fontVariant: EDITOR_FONT_VARIANT,
			caseInsensitive: this.caseInsensitiveLua,
			listLuaSymbols: (asset_id, chunkName) => this.listLuaSymbols(asset_id, chunkName),
			listGlobalLuaSymbols: () => this.listAllLuaSymbols(),
			listLuaModuleSymbols: (moduleName) => this.listLuaModuleSymbols(moduleName),
			listBuiltinLuaFunctions: () => this.listLuaBuiltinFunctions(),
			listLuaObjectMembers: (request) => this.listLuaObjectMembers(request),
		});
		this.consoleCommands = new ConsoleCommandDispatcher({
			clearScreen: () => { this.consoleMode.clearOutput(); },
			continueExecution: () => { this.continueFromConsole(); },
			exitApplication: () => { $.request_shutdown(); },
			reboot: () => { this.boot(); },
			openEditor: () => { this.closeConsoleMode(false); this.openEditor(); },
			resetWorkspace: () => { this.clearWorkspaceLuaOverrides(); },
			nukeWorkspace: () => { this.nukeWorkspace(); },
			refreshWorkspaceOverrides: (hotReload) => { this.refreshWorkspaceOverrides(hotReload); },
			getWorkspaceOverrides: () => this.workspaceLuaOverrides,
			appendStdout: (text, color) => { this.consoleMode.appendStdout(text, color); },
			appendStderr: (text) => { this.consoleMode.appendStderr(text); },
			appendSystem: (text) => { this.consoleMode.appendSystemMessage(text); },
		});
		this.consoleMode.setPromptPrefix(this.consoleCommands.getPrompt());
		this.enableEvents();
		const policyOverride = options.luaSourceFailurePolicy ?? {};
		this.luaFailurePolicy = { ...DEFAULT_LUA_FAILURE_POLICY, ...policyOverride };
		this.cart = options.cart;
		this.playerIndex = options.playerIndex;
		this.storageService = options.storage ?? $.platform.storage;
		this.storage = new BmsxConsoleStorage(this.storageService, options.cart.meta.persistentId);

		api = new BmsxConsoleApi({
			playerindex: this.playerIndex,
			storage: this.storage,
		});
		api.set_render_backend(this.overlayRenderBackend);
		this.overlayResolutionMode = 'viewport';
		this.luaProgram = this.cart.luaProgram ?? null;
		for (const [asset_id, source] of Object.entries(rompack.lua)) {
			this.rompackOriginalLua.set(asset_id, source);
		}
		this.seedDefaultLuaBuiltins();
		this.initializeEditor();
		this.subscribeGlobalDebuggerHotkeys();
		this.resetFrameTiming();
		this.boot();
		void this.prefetchLuaSourceFromFilesystem();
	}

	private requireLuaInterpreter(): LuaInterpreter {
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			throw new Error('[BmsxConsoleRuntime] Lua interpreter unavailable.');
		}
		return interpreter;
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
			return {
				line: Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null,
				column: Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null,
				chunkName: typeof error.chunkName === 'string' && error.chunkName.length > 0 ? error.chunkName : null,
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
		interpreter.setCaseInsensitiveNativeAccess(this.caseInsensitiveLua);
		interpreter.setHostAdapter({
			toLua: (value, ctx) => this.jsToLua(value, ctx),
			toJs: (luaValue, ctx) => {
				const moduleId = this.moduleIdFor('other', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
				return this.luaValueToJs(luaValue, { moduleId, interpreter: ctx, path: [] });
			},
			serializeNative: (native) => this.snapshotEncodeNative(native),
			deserializeNative: (token) => this.snapshotDecodeNative(token),
		});
		interpreter.setRequireHandler((ctx, module) => this.requireLuaModule(ctx, module));
		this.refreshDebuggerAttachment(interpreter);
	}

	private refreshDebuggerAttachment(interpreter: LuaInterpreter): void {
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
		this.setDebuggerPaused(true, { syncGlobal: false });
		const editorActive = this.editor?.isActive() === true;
		const shouldActivateEditor = signal.reason === 'exception'
			? editorActive || autoActivateOnPause
			: signal.reason === 'breakpoint' || autoActivateOnPause;
		if (shouldActivateEditor) {
			try {
				this.openEditor();
			}
			catch (activationError) {
				console.warn('[BmsxConsoleRuntime] Failed to activate console editor during debugger pause.', activationError);
			}
		}
		if (signal.reason === 'exception') {
			this.prepareDebuggerExceptionOverlay(signal);
			if (editorActive || shouldActivateEditor) {
				this.flushPendingRuntimeErrorOverlay();
			}
		} else {
			this.flushPendingRuntimeErrorOverlay();
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
					? Array.from(interpreter.getLastFaultCallStack())
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

	private setDebuggerPaused(paused: boolean, { syncGlobal }: { syncGlobal?: boolean } = {}): void {
		if (syncGlobal !== false) {
			$.paused = paused;
		}
		const state = this.currentFrameState;
		if (state) {
			state.debugPaused = paused;
		}
	}

	private clearActiveDebuggerPause(): void {
		const hadSuspension = this.luaDebuggerSuspension !== null;
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false, { syncGlobal: false });
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
			this.pendingRuntimeErrorOverlay = null;
			if (this.editor) {
				this.editor.clearRuntimeErrorOverlay();
			}
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

	private resumeDebugger(command: LuaDebuggerResumeCommand, stepOut = false): void {
		const suspension = this.luaDebuggerSuspension;
		let options: { stepDepthOverride?: number } | undefined;
		if (stepOut) {
			const targetDepth = Math.max(0, suspension.callStack.length - 1);
			options = { stepDepthOverride: targetDepth };
		}
		this.resumeLuaDebugger(command, options);
	}

	public setLuaBreakpoints(breakpoints: ReadonlyMap<string, ReadonlySet<number>>): void {
		const controller = this.luaDebuggerController;
		controller.setBreakpoints(breakpoints);
	}

	public continueLuaDebugger(): void {
		this.resumeDebugger('continue');
	}

	public stepIntoLuaDebugger(): void {
		this.resumeDebugger('step_into');
	}

	public stepOverLuaDebugger(): void {
		this.resumeDebugger('step_over');
	}

	public stepOutLuaDebugger(): void {
		this.resumeDebugger('step_out', true);
	}

	public ignoreLuaException(): void {
		this.resumeDebugger('ignore_exception');
	}

	public stepOutLuaException(): void {
		this.resumeDebugger('step_out_exception', true);
	}

	private pollConsoleHotkeys(): void {
		const playerInput = this.getPlayerInput();
		const getState = (code: string) => playerInput.getButtonState(code, 'keyboard');
		const consume = (code: string) => playerInput.consumeButton(code, 'keyboard');
		const shiftDown = getState('ShiftLeft')?.pressed === true || getState('ShiftRight')?.pressed === true;
		const ctrlDown = getState('ControlLeft')?.pressed === true || getState('ControlRight')?.pressed === true;
		if (ctrlDown && this.shouldAcceptConsoleHotkey('KeyP', getState('KeyP'))) {
			consume('KeyP');
			this.toggleConsoleMode();
			return;
		}
		if (this.consoleMode.isActive && ctrlDown && shiftDown) {
			const resolutionState = getState('KeyR');
			if (this.shouldAcceptConsoleHotkey('console-resolution', resolutionState)) {
				consume('KeyR');
				this.toggleOverlayResolutionMode();
			}
		}
		const editorActive = this.editor?.isActive() === true;
		if (this.handleGlobalDebuggerHotkeys({ shiftDown, ctrlDown, editorActive, getState, consume })) {
			return;
		}
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
		if (typeof event.deviceId !== 'string' || !event.deviceId.startsWith('keyboard')) {
			return;
		}
		const playerInput = this.getPlayerInput();
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
		if (this.editor?.isActive() !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		this.beginGlobalDebuggerStepping();
	}

	private handleGlobalDebuggerHotkeys(args: {
		shiftDown: boolean;
		ctrlDown: boolean;
		editorActive: boolean;
		getState: (code: string) => ButtonState | null | undefined;
		consume: (code: string) => void;
	}): boolean {
		if (args.ctrlDown) {
			return false;
		}
		const { getState, consume } = args;
		const f8State = getState('F8');
		if (this.shouldAcceptConsoleHotkey('debugger-f8-step', f8State)) {
			consume('F8');
			console.log(
				`[LuaDebugger] Global F8 hotkey detected (suspended=${this.luaDebuggerSuspension ? 'yes' : 'no'}).`,
			);
			this.beginGlobalDebuggerStepping();
			return true;
		}
		return false;
	}

	private beginGlobalDebuggerStepping(): void {
		if (this.luaDebuggerSuspension) {
			console.log('[LuaDebugger] Global F8 step-over requested while suspended.');
			if (this.editor?.isActive() !== true) {
				this.debuggerAutoActivateOnNextPause = true;
			}
			this.stepOverLuaDebugger();
			return;
		}
		const controller = this.luaDebuggerController;
		if (this.editor?.isActive() !== true) {
			this.debuggerAutoActivateOnNextPause = true;
		}
		if (controller.hasActiveSteppingRequest()) {
			console.log('[LuaDebugger] Global F8 step already pending; waiting for next pause.');
			return;
		}
		console.log('[LuaDebugger] Global F8 step armed for next statement.');
		controller.requestStepInto();
	}

	private shouldAcceptConsoleHotkey(code: string, state: ButtonState | null | undefined): boolean {
		if (!state || state.pressed !== true) {
			this.consoleHotkeyLatch.delete(code);
			return false;
		}
		const pressId = typeof state.pressId === 'number' ? state.pressId : null;
		if (pressId !== null) {
			const existing = this.consoleHotkeyLatch.get(code);
			if (existing === pressId) {
				return false;
			}
			this.consoleHotkeyLatch.set(code, pressId);
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
			this.closeConsoleMode(true);
			return;
		}
		this.openConsoleMode();
	}

	private handleEditorShortcutToggle(): void {
		if (!this.editor) {
			return;
		}
		if (this.consoleMode.isActive) {
			this.closeConsoleMode(true);
			this.openEditor();
			return;
		}
		toggleEditorFromShortcut();
		if (this.editor.isActive()) {
			this.flushPendingRuntimeErrorOverlay();
		}
	}

	private registerConsoleShortcuts(): void {
		this.disposeShortcutHandlers();
		const registry = Input.instance.getGlobalShortcutRegistry();
		const disposers: Array<() => void> = [];
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, EDITOR_TOGGLE_KEY, () => this.handleEditorShortcutToggle()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, CONSOLE_TOGGLE_KEY, () => this.toggleConsoleMode()));
		disposers.push(registry.registerGamepadChord(this.playerIndex, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => this.handleEditorShortcutToggle()));
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

	private openConsoleMode(): void {
		if (this.consoleMode.isActive) {
			return;
		}
		if (this.editor.isActive()) {
			this.editor.deactivate();
		}
		this.consoleMode.activate();
	}

	private closeConsoleMode(_resumeGame: boolean): void {
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

	private getPlayerInput(): PlayerInput {
		const playerInput = Input.instance.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			throw new Error(`[BmsxConsoleRuntime] Player input handler for index ${this.playerIndex} is not initialised.`);
		}
		return playerInput;
	}

	private renderConsoleOverlay(): void {
		if (!this.consoleMode.isActive) {
			return;
		}
		this.overlayRenderBackend.beginFrame();
		this.consoleMode.draw(api, this.overlayRenderBackend, this.overlayRenderBackend.viewportSize);
		this.overlayRenderBackend.endFrame();
		this.overlayRenderedThisFrame = true;
	}

	private advanceConsoleMode(deltaSeconds: number): void {
		if (!this.consoleMode.isActive) {
			return;
		}
		this.consoleMode.update(deltaSeconds);
		const playerInput = this.getPlayerInput();
		const command = this.consoleMode.handleInput(playerInput, deltaSeconds);
		if (command === null) {
			return;
		}
		this.handleConsoleCommand(command);
	}

	private handleConsoleCommand(rawCommand: string): void {
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
			if (this.consoleCommands.handle(trimmed)) {
				return;
			}
		} catch (error) {
			this.consoleMode.appendStderr(this.extractErrorMessage(error));
			return;
		}
		this.executeConsoleCommand(trimmed);
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
			this.continueLuaDebugger();
		}
		this.closeConsoleMode(true);
	}

	private executeConsoleCommand(command: string): void {
		const source = this.prepareConsoleChunk(command);
		if (source.length === 0) {
			return;
		}
		let interpreter: LuaInterpreter;
		try {
			interpreter = this.requireLuaInterpreter();
		} catch (error) {
			this.consoleMode.appendStderr('Lua interpreter unavailable.');
			return;
		}
		const env = interpreter.getGlobalEnvironment();
		const previousPrint = env.get('print');
		const previousInsensitivePrint = this.caseInsensitiveLua ? env.get('PRINT') : null;
		const consolePrint = createLuaNativeFunction('console_print', interpreter, (_ctx, args) => {
			const text = args.map(arg => this.consoleValueToString(arg)).join('\t');
			this.consoleMode.appendStdout(text);
			return [];
		});
		env.set('print', consolePrint);
		if (this.caseInsensitiveLua) {
			env.set('PRINT', consolePrint);
		}
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
			if (previousPrint !== null) {
				env.set('print', previousPrint);
			}
			if (this.caseInsensitiveLua && previousInsensitivePrint !== null) {
				env.set('PRINT', previousInsensitivePrint);
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

	private findasset_idForPath(path: string | null | undefined): string | null {
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

	public boot(): void {
		this.luaDebuggerSuspension = null;
		this.debuggerHaltsGame = false;
		this.setDebuggerPaused(false);
		this.luaRuntimeFailed = false;
		this.luaVmInitialized = false;
		this.luaChunkResourceMap.clear();
		this.resourcePathCache.clear();
		this.invalidateLuaModuleIndex();
		this.luaChunkEnvironmentsByAssetId.clear();
		this.luaChunkEnvironmentsByChunkName.clear();
		this.luaGenericAssetsExecuted.clear();
		this.applyLocalWorkspaceDirtyLuaOverrides(false);
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
		if (this.hasBooted) {
			this.resetWorldState();
		}
		api.cartdata(this.cart.meta.persistentId);
		if (this.luaProgram) {
			this.bootLuaProgram(true);
		} else {
			this.resetLuaInteroperabilityState();
			this.fsmLuaInterpreter = null;
			const fsmInterpreter = this.ensureFsmLuaInterpreter();
			this.loadLuaComponentPresetScripts(fsmInterpreter);
			this.loadLuaWorldObjectDefinitionScripts(fsmInterpreter);
			this.loadLuaStateMachineScripts(fsmInterpreter);
			this.loadLuaBehaviorTreeScripts(fsmInterpreter);
			this.loadLuaServiceScripts(fsmInterpreter);
			this.cart.init(api);
		}
		this.resetFrameTiming();
		this.hasBooted = true;
		void this.applyServerWorkspaceDirtyLuaOverrides();
	}

	private resetWorldState(): void {
		this.abandonFrameState();
		$.reset_to_fresh_world({ preserveConsoleRuntime: true });
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
		this.updateOverlayState(consoleActive, editorActive);
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
			this.runConsolePhase(state);
			this.runEditorPhase(state);
			this.runUpdatePhaseInternal(state);
			this.runDrawPhaseInternal(state);
		} catch (error) {
			fault = error;
			throw error;
		} finally {
			if (fault !== null || this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	public onWorldStepAborted(): void {
		this.abandonFrameState();
	}

	private runConsolePhase(state: ConsoleFrameState): void {
		this.pollConsoleHotkeys();
		this.advanceConsoleMode(state.deltaSeconds);
		state.consoleEvaluated = true;
		state.consoleActive = this.consoleMode.isActive;
		this.updateFrameHaltingState(state);
	}

	private runEditorPhase(state: ConsoleFrameState): void {
		const editor = this.editor;
		if (editor && !state.consoleActive) {
			editor.update(state.deltaSeconds);
		}
		const editorActive = editor?.isActive() === true && !state.consoleActive;
		state.editorEvaluated = true;
		state.editorActive = editorActive;
		this.updateFrameHaltingState(state);
	}

	private runUpdatePhaseInternal(state: ConsoleFrameState): void {
		const playerInput = this.getPlayerInput();
		const getState = (code: string) => playerInput.getButtonState(code, 'keyboard');
		const consume = (code: string) => playerInput.consumeButton(code, 'keyboard');
		const shiftDown = getState('ShiftLeft')?.pressed === true || getState('ShiftRight')?.pressed === true;
		const ctrlDown = getState('ControlLeft')?.pressed === true || getState('ControlRight')?.pressed === true;
		this.handleGlobalDebuggerHotkeys({
			shiftDown,
			ctrlDown,
			editorActive: state.editorActive === true,
			getState,
			consume,
		});
		if (state.updateExecuted) {
			return;
		}
		if (state.editorActive) {
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
				this.tickLuaServices(state.deltaForUpdate);
			} else {
				this.cart.update(api, state.deltaSeconds);
				this.tickLuaServices(state.deltaForUpdate);
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

	private abandonFrameState(): void {
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
		this.disposeAllWorldObjectDefinitions();
		this.disposeLuaServices();
		this.luaInterpreter = null;
		this.fsmLuaInterpreter = null;
		this.consoleFsmMachineIds.clear();
		super.dispose();
		if (BmsxConsoleRuntime._instance === this) {
			BmsxConsoleRuntime._instance = null;
		}
	}

	private prepareForPreservedWorldReset(): void {
		this.pendingLuaWarnings = [];
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
		const primaryasset_id = this.luaProgram.asset_id;
		this.editor = createConsoleCartEditor({
			playerIndex: this.playerIndex,
			metadata: this.cart.meta,
			viewport,
			caseInsensitiveLua: this.caseInsensitiveLua,
			loadSource: () => this.luaProgram ? this.getLuaProgramSource(this.luaProgram) : '',
			saveSource: (source: string) => this.saveLuaProgram(source),
			listResources: () => this.getResourceDescriptors(),
			loadLuaResource: (asset_id: string) => $.rompack.lua[asset_id],
			saveLuaResource: (asset_id: string, source: string) => this.saveLuaResourceSource(asset_id, source),
			createLuaResource: (request) => this.createLuaResource(request),
			inspectLuaExpression: (request: ConsoleLuaHoverRequest) => this.inspectLuaExpression(request),
			listLuaObjectMembers: (request) => this.listLuaObjectMembers(request),
			listLuaModuleSymbols: (moduleName) => this.listLuaModuleSymbols(moduleName),
			primaryasset_id,
			listLuaSymbols: (asset_id: string | null, chunkName: string | null) => this.listLuaSymbols(asset_id, chunkName),
			listGlobalLuaSymbols: () => this.listAllLuaSymbols(),
			listBuiltinLuaFunctions: () => this.listLuaBuiltinFunctions(),
			fontVariant: EDITOR_FONT_VARIANT,
			workspaceRootPath: this.resolveCartProjectRootPath(),
			themeVariant: this.cart.meta.ideTheme,
		});
		this.flushLuaWarnings();
		this.registerConsoleShortcuts();
	}

	public openEditor(): void {
		this.editor.activate();
		this.updateOverlayState(true, true, true);
		this.flushPendingRuntimeErrorOverlay();
	}

	public override getState(): BmsxConsoleState | undefined {
		const interpreterReady = this.luaInterpreter !== null && this.luaInterpreter.getChunkEnvironment() !== null;
		const storageState = this.storage.dump();
		const luaSnapshot = this.captureLuaSnapshot();
		const cartState = this.luaProgram ? undefined : this.cart.captureState(api);
		const fallbackLuaState = this.luaVmInitialized && interpreterReady && luaSnapshot === undefined ? this.captureFallbackLuaState() : null;
		const state: BmsxConsoleState = {
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
		this.luaVmInitialized = false;
		this.boot();
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

		if (this.luaProgram) {
			const shouldRunInit = this.shouldRunInitForSnapshot(snapshot);
			this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: shouldRunInit, hotReload: false });
		} else if (snapshot.cartState !== undefined) {
			this.cart.restoreState(api, snapshot.cartState);
		}

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor.isActive(), true);
		this.redrawAfterStateRestore();
	}

	public resumeFromSnapshot(state: unknown): void {
		this.clearActiveDebuggerPause();
		if (!state) {
			this.luaRuntimeFailed = false;
			throw new Error('[BmsxConsoleRuntime] Cannot resume from invalid state snapshot.');
		}
		const originalSnapshot = state as BmsxConsoleState;
		// Resume should never re-run init; keep VM state intact.
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
		this.processPendingLuaAssets('resume');
		this.resumeLuaProgramState(snapshot, { runInit: false });
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor.isActive(), true);
		this.redrawAfterStateRestore();
		this.luaVmInitialized = this.luaInterpreter !== null;
	}

	private applyLuaProgramHotReload(params: { source: string; chunkName: string; override?: string | null }): void {
		const interpreter = this.requireLuaInterpreter();
		const program = this.luaProgram;
		if (!program) {
			throw new Error('[BmsxConsoleRuntime] No Lua program available for hot reload.');
		}
		let programasset_id: string | null = program.asset_id;
		const normalizedChunk = this.normalizeChunkName(params.chunkName);
		const previousEnvironment = this.luaChunkEnvironmentsByChunkName.get(normalizedChunk) ?? null;
		interpreter.clearLastFaultEnvironment();
		interpreter.execute(params.source, params.chunkName);
		this.cacheChunkEnvironment(interpreter, params.chunkName, programasset_id);
		const hotModuleId = this.moduleIdFor('other', programasset_id, params.chunkName);
		const nextEnvironment = interpreter.getChunkEnvironment();
		if (previousEnvironment && nextEnvironment && previousEnvironment !== nextEnvironment) {
			this.mergeLuaChunkEnvironmentState(previousEnvironment, nextEnvironment);
		}
		this.rebindChunkEnvironmentHandlers(hotModuleId, interpreter);
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
		this.luaVmInitialized = true;
		const hotSource = params.override ?? params.source;
		this.refreshLuaHandlersForChunk(normalizedChunk, hotSource);
		this.refreshLuaHandlersAfterResume(normalizedChunk);
		this.clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private reloadLuaProgramState(source: string, chunkName: string, override?: string | null): void {
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
		this.resetFrameTiming();
		this.updateOverlayState(this.consoleMode.isActive, this.editor.isActive(), true);
		this.redrawAfterStateRestore();
		this.luaVmInitialized = this.luaInterpreter !== null;
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
			throw new Error('[BmsxConsoleRuntime] No Lua program available for resume.');
		}
		if (!this.luaInterpreter) {
			this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: options.runInit, hotReload: false });
			return;
		}

		this.processPendingLuaAssets('resume');

		const targetChunkName = this.canonicalizeProgramChunkName(program, snapshot.luaChunkName ?? null);
		const currentChunk = this.canonicalizeProgramChunkName(program, this.luaChunkName);
		const normalizedTarget = this.normalizeChunkName(targetChunkName);
		const normalizedCurrent = this.normalizeChunkName(currentChunk);

		const requestedOverride = snapshot.luaProgramSourceOverride ?? null;

		const currentOverride = this.luaProgramSourceOverride ?? null;
		const shouldHotReload = (requestedOverride !== null && requestedOverride !== currentOverride) || (normalizedTarget !== normalizedCurrent);

		if (shouldHotReload) {
			let source: string;
			try {
				source = requestedOverride ?? this.resolveLuaProgramSource(program);
			}
			catch (error) {
				throw this.normalizeError(error);
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
			this.clearNativeMemberCompletionCache();
			this.applyLuaResumeState(snapshot);
			return;
		}
		// Interpreter already has the original chunk; reapply the captured Lua state.
		this.applyLuaResumeState(snapshot);
	}

	private applyLuaResumeState(snapshot: BmsxConsoleState): void {
		const interpreter = this.luaInterpreter;
		if (!interpreter) {
			throw new Error('[BmsxConsoleRuntime] No Lua interpreter available for resume.');
		}
		const hasStructuredSnapshot = snapshot.luaSnapshot !== undefined && snapshot.luaSnapshot !== null;
		if (hasStructuredSnapshot && this.luaSnapshotLoad !== null) {
			this.applyLuaSnapshot(snapshot.luaSnapshot);
			return;
		}
		this.restoreFallbackLuaState(snapshot);
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: BmsxConsoleState, options: { runInit: boolean; hotReload: boolean }): void {
		const program = this.luaProgram;
		if (!program) {
			throw new Error('[BmsxConsoleRuntime] No Lua program available for reload.');
		}
		const targetChunkName = this.canonicalizeProgramChunkName(program, snapshot.luaChunkName ?? null);
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
			throw this.normalizeError(error);
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
		this.clearNativeMemberCompletionCache();
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

		if (modules.size === 0) {
			return;
		}
		for (const moduleId of modules) {
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private rebindChunkEnvironmentHandlers(moduleId: string, interpreter: LuaInterpreter): void {
		const env = interpreter.getChunkEnvironment();
		if (!env) {
			throw new Error('[BmsxConsoleRuntime] No Lua environment available for rebind.');
		}
		const visited = new WeakSet<LuaTable>();
		for (const [key, value] of env.entries()) {
			const path = [key];
			if (value !== null && value !== undefined) {
				this.rebindHandlersFromLuaValue(moduleId, value, interpreter, path, visited);
			}
		}
	}

	private rebindHandlersFromLuaValue(
		moduleId: string,
		value: LuaValue,
		interpreter: LuaInterpreter,
		path: ReadonlyArray<string>,
		visited: WeakSet<LuaTable>,
	): void {
		if (this.isLuaFunctionValue(value)) {
			this.luaHandlerCache.rebind(moduleId, path, value, interpreter);
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
			this.rebindHandlersFromLuaValue(moduleId, entry, interpreter, nextPath, visited);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; chunkName: string; snapshot: BmsxConsoleState; runInit: boolean; hotReload: boolean }): void {
		if (params.hotReload) {
			this.applyLuaProgramHotReload({ source: params.source, chunkName: params.chunkName, override: params.snapshot.luaProgramSourceOverride ?? null });
			return;
		}

		this.resetLuaInteroperabilityState();
		const interpreter = createLuaInterpreter();
		this.configureInterpreter(interpreter);
		interpreter.clearLastFaultEnvironment();
		this.luaInterpreter = interpreter;
		this.luaSnapshotSave = null;
		this.luaSnapshotLoad = null;
		this.luaInitFunction = null;
		this.luaUpdateFunction = null;
		this.luaDrawFunction = null;

		const program = this.luaProgram;
		let programasset_id: string | null = null;
		if (program) {
			this.registerProgramChunk(program, params.chunkName);
			programasset_id = program.asset_id;
		}

		this.registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		this.loadLuaComponentPresetScripts(interpreter);
		this.loadLuaStateMachineScripts(interpreter);
		this.loadLuaBehaviorTreeScripts(interpreter);
		this.loadLuaServiceScripts(interpreter);

		interpreter.execute(params.source, params.chunkName);
		this.loadLuaWorldObjectDefinitionScripts(interpreter);
		if (program) {
			this.cacheChunkEnvironment(interpreter, params.chunkName, programasset_id);
		}
		this.luaVmInitialized = true;

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
				if (isLuaDebuggerPauseSignal(error)) {
					this.onLuaDebuggerPause(error);
				} else {
					this.handleLuaError(error);
				}
			}
		}

		this.luaRuntimeFailed = savedRuntimeFailed;
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

	private flushPendingRuntimeErrorOverlay(): void {
		if (!this.pendingRuntimeErrorOverlay || !this.editor) {
			return;
		}
		const payload = this.pendingRuntimeErrorOverlay;
		try {
			if (payload.hint) {
				this.editor.showRuntimeErrorInChunk(
					payload.chunkName,
					payload.line,
					payload.column,
					payload.message,
					payload.hint,
					payload.details,
				);
			} else {
				this.editor.showRuntimeError(payload.line, payload.column, payload.message, payload.details);
			}
			this.pendingRuntimeErrorOverlay = null;
		}
		catch (error) {
			console.warn('[BmsxConsoleRuntime] Deferred runtime error overlay rendering failed; will retry.', error);
		}
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

	private buildConsoleStackLines(details: RuntimeErrorDetails | null): string[] {
		if (!details) {
			return [];
		}
		const frames: StackTraceFrame[] = [];
		for (let index = 0; index < details.luaStack.length; index += 1) {
			frames.push(details.luaStack[index]);
		}
		for (let index = 0; index < details.jsStack.length; index += 1) {
			frames.push(details.jsStack[index]);
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
		const stackLines = this.buildConsoleStackLines(details);
		for (let index = 0; index < stackLines.length; index += 1) {
			this.consoleMode.appendStderr(stackLines[index]);
		}
	}

	private prepareDebuggerExceptionOverlay(signal: LuaDebuggerPauseSignal): void {
		const interpreter = this.luaInterpreter;
		const exception = interpreter?.consumeLastDebuggerException?.() ?? null;
		if (!exception) {
			return;
		}
		const message = exception.message ?? 'Runtime error';
		let chunkName: string | null = exception.chunkName ?? null;
		if (!chunkName || chunkName.length === 0) {
			chunkName = signal.location.chunk;
		}
		const normalizedLine = safeclamp(exception.line, 1, Number.MAX_SAFE_INTEGER, null);
		const normalizedColumn = safeclamp(exception.column, 1, Number.MAX_SAFE_INTEGER, null);
		const fallbackLine = safeclamp(signal.location.line, 1, Number.MAX_SAFE_INTEGER, null);
		const fallbackColumn = safeclamp(signal.location.column, 1, Number.MAX_SAFE_INTEGER, null);
		const hint = this.lookupChunkResourceInfoNullable(chunkName);
		const details = this.buildRuntimeErrorDetailsForEditor(exception, message);
		this.pendingRuntimeErrorOverlay = {
			chunkName,
			line: normalizedLine ?? fallbackLine,
			column: normalizedColumn ?? fallbackColumn,
			message,
			hint,
			details,
		};
	}

	private async saveLuaResourceSource(asset_id: string, source: string): Promise<void> {
		const cartPath = $.rompack.luaSourcePaths[asset_id];
		const filesystemPath = this.resolveFilesystemPathForCartPath(cartPath!);
		await this.persistLuaSourceToFilesystem(filesystemPath, source);
		const rompack = $.rompack;
		rompack.lua[asset_id] = source;
		try {
			const category = this.resolveLuaHotReloadCategory(asset_id);
			const normalizedPath = cartPath.replace(/\\/g, '/');
			let chunkName: string;
			switch (category) {
				case 'fsm':
					chunkName = this.resolveLuaFsmChunkName(asset_id, normalizedPath);
					break;
				case 'behavior_tree':
					chunkName = this.resolveLuaBehaviorTreeChunkName(asset_id, normalizedPath);
					break;
				case 'service':
					chunkName = this.resolveLuaServiceChunkName(asset_id, normalizedPath);
					break;
				default:
					chunkName = `@${normalizedPath}`;
					break;
			}
			this.registerLuaChunkResource(chunkName, { asset_id, path: normalizedPath });
			this.luaGenericAssetsExecuted.delete(asset_id);
			let loadError: unknown = null;
			try {
				this.processPendingLuaAssets('lua:save');
			} catch (error) {
				loadError = error;
			}
			this.refreshLuaHandlersForChunk(chunkName, source);
			if (loadError) {
				const message = this.extractErrorMessage(loadError);
				this.recordLuaWarning(`[BmsxConsoleRuntime] Hot reload of '${asset_id}' after save failed: ${message}`);
			}
		} catch (error) {
			const message = this.extractErrorMessage(error);
			this.recordLuaWarning(`[BmsxConsoleRuntime] Hot reload of '${asset_id}' after save failed: ${message}`);
		}
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
		let hotLoadError: unknown = null;
		try {
			this.processPendingLuaAssets('lua:create');
		} catch (error) {
			hotLoadError = error;
		}
		const descriptor: ConsoleResourceDescriptor = { path: normalizedPath, type: 'lua', asset_id };
		try {
			const category = this.resolveLuaHotReloadCategory(asset_id);
			let chunkName: string;
			switch (category) {
				case 'fsm':
					chunkName = this.resolveLuaFsmChunkName(asset_id, normalizedPath);
					break;
				case 'behavior_tree':
					chunkName = this.resolveLuaBehaviorTreeChunkName(asset_id, normalizedPath);
					break;
				case 'service':
					chunkName = this.resolveLuaServiceChunkName(asset_id, normalizedPath);
					break;
				default:
					chunkName = `@${normalizedPath}`;
					break;
			}
			this.refreshLuaHandlersForChunk(chunkName, contents);
			if (hotLoadError) {
				const message = this.extractErrorMessage(hotLoadError);
				this.recordLuaWarning(`[BmsxConsoleRuntime] Hot load of new resource '${asset_id}' encountered issues: ${message}`);
			}
		} catch (error) {
			const message = this.extractErrorMessage(error);
			this.recordLuaWarning(`[BmsxConsoleRuntime] Hot load of new resource '${asset_id}' failed: ${message}`);
		}
		return descriptor;
	}

	private captureFallbackLuaState(): { globals?: Record<string, unknown>; locals?: Record<string, unknown>; randomSeed?: number } | null {
		const interpreter = this.luaInterpreter;
		const globals = this.captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
		const locals = this.captureLuaEntryCollection(interpreter.enumerateChunkEntries());
		const randomSeed = interpreter.getRandomSeed();
		return {
			globals: globals,
			locals: locals,
			randomSeed: randomSeed,
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
				console.warn(`[BmsxConsoleRuntime] Skipped Lua snapshot entry '${name}':`, error);
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
		if (isLuaNativeValue(value)) {
			const encoded = this.snapshotEncodeNative(value.native);
			return encoded !== undefined ? encoded : null;
		}
		if (isLuaTable(value)) {
			if (visited.has(value)) {
				throw new Error('Cyclic Lua table structures are not supported by the console snapshot.');
			}
			visited.add(value);
			try {
				const entries = value.entriesArray();
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
					if (typeof key === 'string' && key === '__index') {
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
							serializedEntry = this.serializeLuaValueForSnapshot(entryValue, visited);
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
						serializedKey = this.serializeLuaSnapshotKey(key, visited);
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
			finally {
				visited.delete(value);
			}
		}
		throw new Error('Unsupported Lua value encountered during snapshot serialization.');
	}

	private serializeLuaSnapshotKey(key: LuaValue, visited: Set<LuaTable>): unknown {
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
			return this.serializeLuaValueForSnapshot(key, visited);
		}
		return this.serializeLuaValueForSnapshot(key, visited);
	}

	private deserializeLuaSnapshotKey(raw: unknown, interpreter: LuaInterpreter): LuaValue {
		if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
			return raw as LuaValue;
		}
		if (typeof raw === 'object' && raw !== null) {
			const decoded = this.snapshotDecodeNative(raw);
			if (decoded) {
				return this.wrapNativeValue(decoded, interpreter);
			}
		}
		return this.jsToLua(raw, interpreter);
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
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return undefined;
			}
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
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return;
			}
			console.error('[BmsxConsoleRuntime] Failed to restore Lua snapshot:', error);
		}
	}

	private restoreFallbackLuaState(snapshot: BmsxConsoleState): void {
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

	private restoreLuaGlobals(globals: Record<string, unknown>): void {
		const interpreter = this.luaInterpreter;
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
		this.componentDefinitions.clear();
		this.disposeAllWorldObjectDefinitions();
		this.componentPresets.clear();
		this.serviceDefinitions.clear();
		this.disposeAllEffectDefinitions();
		this.disposeLuaServices();
		this.luaGenericAssetsExecuted.clear();
		this.handledLuaErrors = new WeakSet<object>();
		setLuaTableCaseInsensitiveKeys(this.caseInsensitiveLua);
	}

	private bootLuaProgram(runInit: boolean): void {
		const program = this.luaProgram;
		const source = this.getLuaProgramSource(program);
		const chunkName = this.resolveLuaProgramChunkName(program);

		this.resetLuaInteroperabilityState();
		this.luaSnapshotSave = null;
		this.luaSnapshotLoad = null;
		const interpreter = createLuaInterpreter();
		this.configureInterpreter(interpreter);
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
			this.loadLuaComponentPresetScripts(interpreter);
			this.loadLuaStateMachineScripts(interpreter);
			this.loadLuaBehaviorTreeScripts(interpreter);
			this.loadLuaServiceScripts(interpreter);
			interpreter.execute(source, chunkName);
			this.loadLuaWorldObjectDefinitionScripts(interpreter);
			let programasset_id: string | null = null;
			if ('asset_id' in program && typeof program.asset_id === 'string' && program.asset_id.length > 0) {
				programasset_id = program.asset_id;
			}
			this.cacheChunkEnvironment(interpreter, chunkName, programasset_id);
			this.luaVmInitialized = true;
		}
		catch (error) {
			console.info(`[BmsxConsoleRuntime] Lua boot '${chunkName}' failed.`);
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
				console.info(`[BmsxConsoleRuntime] Lua init for '${chunkName}' failed.`);
				this.handleLuaError(error);
				return;
			}
		}
	}

	private getPendingLuaAssetIds(): string[] {
		const rompack = $.rompack;
		const pending: string[] = [];
		for (const [asset_id] of Object.entries(rompack.lua)) {
			if (!this.luaGenericAssetsExecuted.has(asset_id)) {
				pending.push(asset_id);
			}
		}
		return pending;
	}

	private processPendingLuaAssets(context: string): void {
		const pending = this.getPendingLuaAssetIds();
		if (pending.length === 0) {
			return;
		}
		let interpreter: LuaInterpreter | null = null;
		if (this.luaProgram) {
			interpreter = this.luaInterpreter;
		} else {
			interpreter = this.ensureFsmLuaInterpreter();
		}
		if ($.debug) {
			const summary = pending.join(', ');
			console.info(`[BmsxConsoleRuntime] Loading ${pending.length} pending Lua asset(s) for ${context}: ${summary}`);
		}
		const previousChunkName = this.luaChunkName;
		try {
			this.loadLuaComponentPresetScripts(interpreter);
			this.loadLuaStateMachineScripts(interpreter);
			this.loadLuaBehaviorTreeScripts(interpreter);
			this.loadLuaServiceScripts(interpreter);
			this.loadLuaWorldObjectDefinitionScripts(interpreter);
		} catch (error) {
			this.handleLuaError(error);
			throw this.normalizeError(error);
		} finally {
			this.luaChunkName = previousChunkName;
		}
	}

	public async saveLuaProgram(source: string): Promise<void> {
		const program = this.luaProgram;
		const cartSavePath = this.resolveLuaSourcePath(program);
		if (!cartSavePath) {
			if ('asset_id' in program && program.asset_id) {
				throw new Error(`[BmsxConsoleRuntime] Lua source path unavailable for asset '${program.asset_id}'. Rebuild the rompack with filesystem metadata to enable saving.`);
			}
			throw new Error('[BmsxConsoleRuntime] Lua program does not reference a filesystem source.');
		}
		const savePath = this.resolveFilesystemPathForCartPath(cartSavePath);
		const previousOverride = this.luaProgramSourceOverride;
		const previousChunkName = this.resolveLuaProgramChunkName(program);
		const previousSource = this.getLuaProgramSource(program);
		const targetChunkName = previousChunkName;
		const shouldValidate = this.validationStrategy === BmsxLuaValidationStrategy.FullExecution;
		if (!shouldValidate && $.debug === true) {
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
			const rompack = $.rompack;
			const programasset_id = ('asset_id' in program && typeof program.asset_id === 'string') ? program.asset_id : null;
			if (programasset_id) {
				rompack.lua[programasset_id] = source;
			}
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
			this.handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to persist Lua source to '${cartSavePath}'`, { error });
			if (this.luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
	}

	public async reloadLuaProgram(source: string): Promise<void> {
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
		const program = this.luaProgram;
		const chunkName = this.luaChunkName ?? this.resolveLuaProgramChunkName(program);
		this.resetWorldState();
		try {
			this.reloadLuaProgramState(source, chunkName, source);
		} catch (error) {
			this.handleLuaError(error);
			throw error;
		}
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
		const interpreter = this.luaInterpreter;
		if (interpreter === null) {
			throw new Error('[BmsxConsoleRuntime] Lua interpreter is not available.');
		}
		const luaArgs = args.map((value) => this.jsToLua(value, interpreter));
		return fn.call(luaArgs);
	}

	private applyInputMappingFromLua(mapping: Record<string, unknown>, interpreter: LuaInterpreter, playerIndex: number): void {
		const keyboardLayer = this.convertLuaInputLayer(mapping['keyboard'], interpreter, 'keyboard') as KeyboardInputMapping | undefined;
		const gamepadLayer = this.convertLuaInputLayer(mapping['gamepad'], interpreter, 'gamepad') as GamepadInputMapping | undefined;
		const pointerLayer = this.convertLuaInputLayer(mapping['pointer'], interpreter, 'pointer') as PointerInputMapping | undefined;

		const existing = Input.instance.getPlayerInput(playerIndex).inputMap;
		const next: InputMap = {
			keyboard: keyboardLayer ?? existing?.keyboard ?? {},
			gamepad: gamepadLayer ?? existing?.gamepad ?? {},
			pointer: pointerLayer ?? existing?.pointer ?? Input.clonePointerMapping(),
		};
		$.set_inputmap(playerIndex, next);
	}

	private convertLuaInputLayer(value: unknown, interpreter: LuaInterpreter, kind: 'keyboard' | 'gamepad' | 'pointer'): KeyboardInputMapping | GamepadInputMapping | PointerInputMapping | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value !== 'object') {
			throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} mapping must be a table.`);
		}
		const result: Record<string, Array<KeyboardBinding | GamepadBinding | PointerBinding>> = {};
		for (const [action, rawBindings] of Object.entries(value as Record<string, unknown>)) {
			if (!action || typeof action !== 'string') {
				continue;
			}
			const entries = this.normalizeBindingList(kind, action, rawBindings, interpreter);
			if (entries.length === 0) {
				continue;
			}
			result[action] = entries as Array<KeyboardBinding | GamepadBinding | PointerBinding>;
		}
		return result as KeyboardInputMapping | GamepadInputMapping | PointerInputMapping;
	}

	private normalizeBindingList(kind: 'keyboard' | 'gamepad' | 'pointer', action: string, rawBindings: unknown, interpreter: LuaInterpreter): Array<KeyboardBinding | GamepadBinding | PointerBinding> {
		const items = arrayify(rawBindings);
		const normalized: Array<KeyboardBinding | GamepadBinding | PointerBinding> = [];
		for (const item of items) {
			if (item === undefined || item === null) {
				throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} binding for action '${action}' cannot be nil.`);
			}
			if (typeof item === 'string') {
				if (item.length === 0) {
					throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} binding for action '${action}' cannot be an empty string.`);
				}
				normalized.push(item);
				continue;
			}
			if (typeof item === 'object') {
				const record = item as Record<string, unknown>;
				const idValue = record.id;
				if (typeof idValue !== 'string' || idValue.length === 0) {
					throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} binding for action '${action}' must provide a non-empty string id.`);
				}
				const binding: { id: string; scale?: number; invert?: boolean } = { id: idValue };
				if ('scale' in record && record.scale !== undefined && record.scale !== null) {
					const scale = Number(record.scale);
					if (!Number.isFinite(scale)) {
						throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} binding for action '${action}' has an invalid scale value.`);
					}
					binding.scale = scale;
				}
				if ('invert' in record && record.invert !== undefined && record.invert !== null) {
					binding.invert = Boolean(record.invert);
				}
				normalized.push(binding as KeyboardBinding | GamepadBinding | PointerBinding);
				continue;
			}
			throw this.createApiRuntimeError(interpreter, `set_input_map: ${kind} binding for action '${action}' must be a string or a table with an 'id' field.`);
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
		const editorWasActive = this.editor?.isActive() === true;

		this.luaRuntimeFailed = true;
		const interpreter = this.luaInterpreter;
		const callStackSnapshot = interpreter ? Array.from(interpreter.getLastFaultCallStack()) : [];
		const runtimeDetails = this.buildRuntimeErrorDetailsForEditor(error, message);
		this.pauseDebuggerForException({ chunkName, line, column }, callStackSnapshot);
		if (!this.editor && this.luaProgram) {
			this.initializeEditor();
		}
		const editorIsActive = this.editor?.isActive() === true;
		const hint = this.lookupChunkResourceInfoNullable(chunkName);
		this.pendingRuntimeErrorOverlay = {
			chunkName,
			line,
			column,
			message,
			hint,
			details: runtimeDetails,
		};
		if (editorIsActive || editorWasActive) {
			this.flushPendingRuntimeErrorOverlay();
		} else {
			this.openConsoleMode();
			this.presentRuntimeErrorInConsole(chunkName, line, column, message, runtimeDetails);
			this.updateOverlayState(true, false, true);
		}
		const logMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		console.error('[BmsxConsoleRuntime] Lua runtime error:', logMessage, error);
		if (chunkName && chunkName.startsWith('console:')) {
			try {
				this.consoleMode.appendStderr(logMessage);
			} catch (appendError) {
				console.warn('[BmsxConsoleRuntime] Failed to append console runtime error output.', appendError);
			}
		}
		// Remember we've handled this Error-like object so we don't duplicate reporting.
		if (typeof error === 'object' && error !== null) {
			this.handledLuaErrors.add(error as object);
		}
	}

	private buildRuntimeErrorDetailsForEditor(error: unknown, message: string): RuntimeErrorDetails | null {
		const interpreter = this.luaInterpreter;
		let luaFrames: StackTraceFrame[] = [];
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
		const registerWorldobject = createLuaNativeFunction('register_worldobject', interpreter, (luaInterpreter, args) => {
			if (args.length === 0 || !isLuaTable(args[0])) {
				throw this.createApiRuntimeError(luaInterpreter, 'register_worldobject(def) requires a table argument.');
			}
			const defTable = args[0] as LuaTable;
			const moduleId = this.moduleIdFor('worldobject', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
			const idValue = defTable.get('id');
			if (typeof idValue !== 'string' || idValue.trim().length === 0) {
				throw this.createApiRuntimeError(luaInterpreter, 'register_worldobject(def) requires def.id to be a non-empty string.');
			}
			const classValue = defTable.get('class');
			let className: string;
			if (typeof classValue === 'string' && classValue.trim().length > 0) {
				className = classValue.trim();
			} else if (isLuaTable(classValue)) {
				const derived = idValue.match(/([A-Za-z0-9_]+)$/);
				className = derived && derived[1] && derived[1].length > 0 ? derived[1] : 'WorldObject';
				this.registerLuaClass(className, classValue as LuaTable, interpreter);
				defTable.set('class', className);
			} else {
				throw this.createApiRuntimeError(luaInterpreter, 'register_worldobject(def) requires def.class to be a string or table.');
			}
			const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter: luaInterpreter, path: [] });
			const descriptor = this.luaValueToJs(defTable, marshalCtx);
			if (!descriptor || typeof descriptor !== 'object') {
				throw this.createApiRuntimeError(luaInterpreter, 'register_worldobject(def) failed to marshal descriptor table.');
			}
			const id = this.registerWorldObjectDefinition(descriptor as Record<string, unknown>);
			return [id];
		});
		this.registerLuaGlobal(env, 'register_worldobject', registerWorldobject);
		this.registerLuaBuiltin({ name: 'register_worldobject', params: ['def'], signature: 'register_worldobject(def)' });

		const resolveButtonAction = (luaInterpreter: LuaInterpreter, value: LuaValue, fnName: string): string => {
			if (typeof value !== 'number' || Number.isNaN(value)) {
				throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) expects a numeric button index.`);
			}
			const index = Math.trunc(value);
			if (index < 0 || index >= CONSOLE_BUTTON_ACTIONS.length) {
				throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) button index must be between 0 and ${CONSOLE_BUTTON_ACTIONS.length - 1}.`);
			}
			return CONSOLE_BUTTON_ACTIONS[index];
		};

		const resolvePlayerIndex = (luaInterpreter: LuaInterpreter, value: LuaValue | undefined, fnName: string): number => {
			if (value === undefined || value === null) {
				throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) expects the optional player index to be numeric.`);
				return this.playerIndex;
			}
			if (typeof value !== 'number' || Number.isNaN(value)) {
				throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) expects the optional player index to be numeric.`);
			}
			const normalized = Math.trunc(value);
			if (normalized < 0) {
				throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) player index cannot be negative.`);
			}
			return normalized + 1;
		};

		const registerButtonFunction = (fnName: 'btn' | 'btnp' | 'btnr', modifier: string) => {
			const native = createLuaNativeFunction(fnName, interpreter, (luaInterpreter, args) => {
				if (args.length === 0) {
					throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) requires at least one argument.`);
				}
				const action = resolveButtonAction(luaInterpreter, args[0], fnName);
				const playerIndex = resolvePlayerIndex(luaInterpreter, args.length >= 2 ? args[1] : undefined, fnName);
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
					throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) expects a valid input mapping to be defined.`);
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
						throw this.createApiRuntimeError(luaInterpreter, `${fnName}(button [, player]) unknown action '${actionDefinition}'`);
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

		const setInputMapNative = createLuaNativeFunction('set_input_map', interpreter, (luaInterpreter, args) => {
			if (args.length === 0 || !isLuaTable(args[0])) {
				throw this.createApiRuntimeError(luaInterpreter, 'set_input_map(mapping [, player]) requires a table as the first argument.');
			}
			const mappingTable = args[0] as LuaTable;
			const targetPlayer = args.length >= 2
				? resolvePlayerIndex(luaInterpreter, args[1], 'set_input_map')
				: this.playerIndex;
			const moduleId = this.moduleIdFor('other', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
			const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter: luaInterpreter, path: [] });
			const mappingValue = this.luaValueToJs(mappingTable, marshalCtx);
			if (!mappingValue || typeof mappingValue !== 'object') {
				throw this.createApiRuntimeError(luaInterpreter, 'set_input_map(mapping [, player]) requires mapping to be a table.');
			}
			this.applyInputMappingFromLua(mappingValue as Record<string, unknown>, luaInterpreter, targetPlayer);
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
				if (name === 'define_effect') {
					const native = createLuaNativeFunction('api.define_effect', interpreter, (luaInterpreter, args) => {
						if (args.length === 0 || !isLuaTable(args[0])) {
							throw this.createApiRuntimeError(luaInterpreter, 'define_effect(def) requires a table argument.');
						}
						try {
							const id = this.registerEffectDefinitionFromLua(args[0] as LuaTable, luaInterpreter);
							return this.wrapResultValue(id, interpreter);
						} catch (error) {
							if (this.isLuaError(error)) {
								this.handleLuaError(error);
								return [];
							}
							const message = this.extractErrorMessage(error);
							const runtimeError = this.createApiRuntimeError(luaInterpreter, `[api.define_effect] ${message}`);
							this.handleLuaError(runtimeError);
							return [];
						}
					});
					this.registerLuaGlobal(env, name, native);
					this.registerLuaBuiltin({ name, params: ['def'], signature: 'define_effect(def)' });
					continue;
				}
				if (name === 'register_service') {
					const native = createLuaNativeFunction('api.register_service', interpreter, (luaInterpreter, args) => {
						if (args.length === 0 || !isLuaTable(args[0])) {
							throw this.createApiRuntimeError(luaInterpreter, 'register_service(def) requires a table argument.');
						}
						const table = args[0] as LuaTable;
						try {
							const moduleId = this.moduleIdFor('service', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
							const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter: luaInterpreter, path: [] });
							const descriptorRaw = this.luaValueToJs(table, marshalCtx);
							if (!this.isPlainObject(descriptorRaw)) {
								throw new Error('register_service descriptor must be a table.');
							}
							this.instantiateLuaService({
								table,
								descriptor: descriptorRaw as Record<string, unknown>,
								moduleId,
								interpreter: luaInterpreter,
								asset_id: this.currentLuaAssetContext?.asset_id ?? null,
							});
							return [];
						} catch (error) {
							if (this.isLuaError(error)) {
								this.handleLuaError(error);
								return [];
							}
							const message = this.extractErrorMessage(error);
							const runtimeError = this.createApiRuntimeError(luaInterpreter, `[api.register_service] ${message}`);
							this.handleLuaError(runtimeError);
							return [];
						}
					});
					this.registerLuaGlobal(env, name, native);
					this.registerLuaBuiltin({ name, params: ['def'], signature: 'register_service(def)' });
					continue;
				}
				const callable = descriptor.value;
				if (typeof callable !== 'function') {
					throw this.createApiRuntimeError(interpreter, `API method '${name}' is not callable.`);
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
							throw this.createApiRuntimeError(interpreter, `API method '${name}' has invalid parameter metadata.`);
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
				const native = createLuaNativeFunction(`api.${name}`, interpreter, (_lua, args) => {
					const category = this.resolveApiMethodMarshalCategory(name);
					const moduleId = this.moduleIdFor(category, this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
					const baseCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
					const jsArgs = Array.from(args, (arg, index) => this.luaValueToJs(arg, this.extendMarshalContext(baseCtx, `arg${index}`)));
					try {
						const target = api as unknown as Record<string, unknown>;
						const method = target[name];
						if (typeof method !== 'function') {
							throw new Error(`Method '${name}' is not callable.`);
						}
						const result = (method as (...inner: unknown[]) => unknown).apply(api, jsArgs);
						return this.wrapResultValue(result, interpreter);
					} catch (error) {
						if (this.isLuaError(error)) {
							this.handleLuaError(error);
							return [];
						}
						const message = this.extractErrorMessage(error);
						const runtimeError = this.createApiRuntimeError(interpreter, `[api.${name}] ${message}`);
						this.handleLuaError(runtimeError);
						return [];
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
				const native = createLuaNativeFunction(`api.${name}`, interpreter, () => {
					try {
						const value = getter.call(api);
						return this.wrapResultValue(value, interpreter);
					} catch (error) {
						if (this.isLuaError(error)) {
							this.handleLuaError(error);
							return [];
						}
						const message = this.extractErrorMessage(error);
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
		const normalizedName = metadata.name.trim();
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

	private registerLuaClass(className: string, classTable: LuaTable, interpreter: LuaInterpreter): void {
		if (!className || className.length === 0) {
			return;
		}
		const env = interpreter.getGlobalEnvironment();
		env.set(className, classTable);
		if (this.caseInsensitiveLua) {
			const normalized = className.toLowerCase();
			if (normalized !== className) {
				env.set(normalized, classTable);
			}
		}
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
		this.configureInterpreter(interpreter);
		this.registerApiBuiltins(interpreter);
		this.fsmLuaInterpreter = interpreter;
		return interpreter;
	}

	private loadLuaStateMachineScripts(interpreter: LuaInterpreter): void {
		this.executeGenericLuaAssets(interpreter);

		const rompack = $.rompack;
		const previousMachineIds = new Set(this.consoleFsmMachineIds);
		this.consoleFsmMachineIds.clear();
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		const processedAssets: Set<string> = new Set();
		const trackedAssets = new Set(this.consoleFsmsByAsset.keys());
		const asset_ids = this.sortLuaasset_ids(luaSources, sourcePaths, asset_id => trackedAssets.has(asset_id), trackedAssets);
		for (let index = 0; index < asset_ids.length; index += 1) {
			const asset_id = asset_ids[index]!;
			const source = luaSources[asset_id];
			processedAssets.add(asset_id);
			const previousasset_ids = new Set(this.consoleFsmsByAsset.get(asset_id) ?? []);
			this.consoleFsmsByAsset.set(asset_id, new Set());
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'fsm', asset_id };
			try {
				const sourcePathRaw = sourcePaths[asset_id];
				const pathHint = sourcePathRaw ?? this.resolveResourcePath(asset_id);
				const chunkName = this.resolveLuaFsmChunkName(asset_id, sourcePathRaw ?? null);
				const fsmInfo: { asset_id: string | null; path?: string | null } = { asset_id };
				if (pathHint) {
					fsmInfo.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, fsmInfo);
				const results = interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
				if (results.length > 0) {
					const moduleId = this.moduleIdFor('fsm', asset_id, chunkName);
					const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
					const blueprintValue = this.luaValueToJs(results[0], marshalCtx) as Record<string, unknown>;
					this.registerStateMachineDefinition(blueprintValue);
				}
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
			const assetSet = this.consoleFsmsByAsset.get(asset_id) ?? new Set();
			for (const machineId of assetSet) {
				previousMachineIds.delete(machineId);
			}
			for (const machineId of previousasset_ids) {
				if (!assetSet.has(machineId)) {
					this.unregisterLuaStateMachine(machineId);
					previousMachineIds.delete(machineId);
				}
			}
		}
		for (const [asset_id, ids] of Array.from(this.consoleFsmsByAsset.entries())) {
			if (processedAssets.has(asset_id)) {
				continue;
			}
			for (const machineId of ids) {
				this.unregisterLuaStateMachine(machineId);
				previousMachineIds.delete(machineId);
			}
			this.consoleFsmsByAsset.delete(asset_id);
		}
		if (previousMachineIds.size > 0) {
			for (const removed of previousMachineIds) {
				this.unregisterLuaStateMachine(removed);
			}
		}
	}

	private loadLuaBehaviorTreeScripts(interpreter: LuaInterpreter): void {
		this.executeGenericLuaAssets(interpreter);

		const previousTreeIds = new Set(this.consoleBehaviorTreeIds);
		this.consoleBehaviorTreeIds.clear();
		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		const trackedAssets = new Set(this.consoleBehaviorTreesByAsset.keys());
		const asset_ids = this.sortLuaasset_ids(luaSources, sourcePaths, asset_id => trackedAssets.has(asset_id), trackedAssets);
		const processedAssets: Set<string> = new Set();
		for (let index = 0; index < asset_ids.length; index += 1) {
			const asset_id = asset_ids[index]!;
			const source = luaSources[asset_id];
			processedAssets.add(asset_id);
			const previousAssetTrees = new Set(this.consoleBehaviorTreesByAsset.get(asset_id) ?? []);
			this.consoleBehaviorTreesByAsset.set(asset_id, new Set());
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'behavior_tree', asset_id };
			try {
				const sourcePathRaw = sourcePaths[asset_id];
				const pathHint = sourcePathRaw ?? this.resolveResourcePath(asset_id);
				const chunkName = this.resolveLuaBehaviorTreeChunkName(asset_id, sourcePathRaw ?? null);
				const btInfo: { asset_id: string | null; path?: string | null } = { asset_id };
				if (pathHint) {
					btInfo.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, btInfo);
				const executionResults = interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
				if (executionResults.length > 0) {
					const moduleId = this.moduleIdFor('behavior_tree', asset_id, chunkName);
					const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
					const descriptor = this.luaValueToJs(executionResults[0], marshalCtx) as Record<string, unknown>;
					this.registerBehaviorTreeDefinition(descriptor);
				}
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
			const treeSet = this.consoleBehaviorTreesByAsset.get(asset_id) ?? new Set();
			for (const treeId of treeSet) {
				previousTreeIds.delete(treeId);
			}
			for (const treeId of previousAssetTrees) {
				if (!treeSet.has(treeId)) {
					unregisterBehaviorTreeBuilder(treeId);
					previousTreeIds.delete(treeId);
				}
			}
		}
		for (const [asset_id, ids] of Array.from(this.consoleBehaviorTreesByAsset.entries())) {
			if (processedAssets.has(asset_id)) {
				continue;
			}
			for (const treeId of ids) {
				unregisterBehaviorTreeBuilder(treeId);
				previousTreeIds.delete(treeId);
			}
			this.consoleBehaviorTreesByAsset.delete(asset_id);
		}
		if (previousTreeIds.size > 0) {
			for (const removed of previousTreeIds) {
				unregisterBehaviorTreeBuilder(removed);
			}
			this.handleRemovedBehaviorTrees(previousTreeIds);
		}
	}

	private sortLuaasset_ids(
		luaSources: Record<string, unknown>,
		sourcePaths: Record<string, unknown>,
		predicate: (asset_id: string) => boolean,
		extra?: ReadonlySet<string>,
	): string[] {
		const candidates: string[] = [];
		for (const asset_id of Object.keys(luaSources)) {
			if (predicate(asset_id) || (extra && extra.has(asset_id))) {
				candidates.push(asset_id);
			}
		}
		const keyFor = (asset_id: string): string => {
			const raw = sourcePaths[asset_id];
			if (typeof raw === 'string' && raw.length > 0) {
				return raw;
			}
			const resolved = this.resolveResourcePath(asset_id);
			if (resolved && resolved.length > 0) {
				return resolved;
			}
			return asset_id;
		};
		candidates.sort((left, right) => keyFor(left).localeCompare(keyFor(right)));
		return candidates;
	}

	private handleRemovedBehaviorTrees(removed: Iterable<string>): void {
		const removedSet = new Set(removed);
		for (const treeId of removedSet) {
			this.behaviorTreeDiagnostics.delete(treeId);
			this.consoleBehaviorTreeIds.delete(treeId);
		}
		for (const object of $.world.objects({ scope: 'all' })) {
			const contexts = object.btreecontexts;
			for (const treeId of removedSet) {
				delete contexts[treeId];
			}
		}
	}

	public registerBehaviorTreeDefinition(descriptor: Record<string, unknown>): void {
		const treeId = (descriptor as { id: string }).id.trim();
		let definitionSource: unknown;
		if (Object.prototype.hasOwnProperty.call(descriptor, 'definition')) {
			definitionSource = (descriptor as { definition?: unknown }).definition;
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'tree')) {
			definitionSource = (descriptor as { tree?: unknown }).tree;
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'root')) {
			definitionSource = { root: (descriptor as { root?: unknown }).root };
		} else if (Object.prototype.hasOwnProperty.call(descriptor, 'type')) {
			const copy: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(descriptor)) {
				if (key === 'id') {
					continue;
				}
				copy[key] = value;
			}
			definitionSource = copy;
		} else {
			definitionSource = descriptor;
		}
		const asset_id = this.currentLuaAssetContext?.asset_id ?? null;
		const prepared = this.prepareLuaBehaviorTreeDefinition(treeId, definitionSource, asset_id ?? 'runtime');
		applyPreparedBehaviorTree(treeId, prepared, { force: true });
		const diagnostics = getBehaviorTreeDiagnostics(treeId);
		this.behaviorTreeDiagnostics.set(treeId, diagnostics);
		for (let index = 0; index < diagnostics.length; index += 1) {
			const diagnostic = diagnostics[index];
			if (diagnostic.severity === 'warning') {
				this.recordLuaWarning(`[BehaviorTree:${treeId}] ${diagnostic.message}`);
			}
		}
		this.consoleBehaviorTreeIds.add(treeId);
		if (asset_id) {
			let set = this.consoleBehaviorTreesByAsset.get(asset_id);
			if (!set) {
				set = new Set();
				this.consoleBehaviorTreesByAsset.set(asset_id, set);
			}
			set.add(treeId);
		}
	}

	private loadLuaComponentPresetScripts(interpreter: LuaInterpreter): void {
		this.executeGenericLuaAssets(interpreter);

		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		const trackedAssets = new Set(this.consoleComponentPresetsByAsset.keys());
		const asset_ids = this.sortLuaasset_ids(luaSources, sourcePaths, asset_id => trackedAssets.has(asset_id), trackedAssets);
		const processedAssets = new Set<string>();
		for (let index = 0; index < asset_ids.length; index += 1) {
			const asset_id = asset_ids[index]!;
			const source = luaSources[asset_id];
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'component_preset', asset_id };
			try {
				const sourcePathRaw = sourcePaths[asset_id];
				const pathHint = sourcePathRaw ?? this.resolveResourcePath(asset_id);
				const chunkName = this.resolveLuaComponentPresetChunkName(asset_id, sourcePathRaw ?? null);
				const presetInfo: { asset_id: string | null; path?: string | null } = { asset_id };
				if (pathHint) {
					presetInfo.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, presetInfo);
				interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
				processedAssets.add(asset_id);
			}
			catch (error) {
				const message = this.extractErrorMessage(error);
				throw new Error(`[BmsxConsoleRuntime] Failed to execute Component preset Lua script '${asset_id}': ${message}`);
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
		for (const [asset_id, presetIds] of Array.from(this.consoleComponentPresetsByAsset.entries())) {
			if (processedAssets.has(asset_id)) {
				continue;
			}
			for (const presetId of presetIds) {
				this.componentPresets.delete(presetId);
			}
			this.consoleComponentPresetsByAsset.delete(asset_id);
		}
	}

	private executeGenericLuaAssets(interpreter: LuaInterpreter): void {
		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		for (const asset_id of Object.keys(luaSources)) {
			if (this.luaGenericAssetsExecuted.has(asset_id)) {
				continue;
			}
			const source = luaSources[asset_id];
			const sourcePath = sourcePaths[asset_id] ?? null;
			const previousAssetContext = this.currentLuaAssetContext;
			const previousChunkName = this.luaChunkName;
			const chunkName = this.resolveLuaModuleChunkName(asset_id, sourcePath);
			try {
				this.currentLuaAssetContext = { category: 'other', asset_id };
				this.luaChunkName = chunkName;
				this.registerLuaChunkResource(chunkName, { asset_id: asset_id, path: sourcePath ?? undefined });
				interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
				this.luaGenericAssetsExecuted.add(asset_id);
			}
			catch (error) {
				throw error;
			}
			finally {
				this.luaChunkName = previousChunkName;
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
	}
	private loadLuaWorldObjectDefinitionScripts(interpreter: LuaInterpreter): void {
		this.executeGenericLuaAssets(interpreter);

		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		const trackedAssets = new Set(this.consoleWorldObjectsByAsset.keys());
		const asset_ids = this.sortLuaasset_ids(luaSources, sourcePaths, asset_id => trackedAssets.has(asset_id), trackedAssets);
		const processedAssets = new Set<string>();
		for (let index = 0; index < asset_ids.length; index += 1) {
			const asset_id = asset_ids[index]!;
			const source = luaSources[asset_id];
			processedAssets.add(asset_id);
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'worldobject', asset_id };
			try {
				const sourcePathRaw = sourcePaths[asset_id];
				const pathHint = sourcePathRaw ?? this.resolveResourcePath(asset_id);
				const chunkName = this.resolveLuaWorldObjectChunkName(asset_id, sourcePathRaw ?? null);
				const info: { asset_id: string | null; path?: string | null } = { asset_id };
				if (pathHint) {
					info.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, info);
				interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
		for (const [asset_id, ids] of Array.from(this.consoleWorldObjectsByAsset.entries())) {
			if (processedAssets.has(asset_id)) {
				continue;
			}
			for (const worldobjectId of ids) {
				this.disposeWorldObjectDefinition(worldobjectId);
			}
			this.consoleWorldObjectsByAsset.delete(asset_id);
		}
	}

	private instantiateLuaService(
		opts: { table: LuaTable; descriptor: Partial<Service>; moduleId: string; interpreter: LuaInterpreter; asset_id: string | null },
		snapshots?: Map<string, LuaServiceSnapshot>,
	): Identifier {
		const { table, descriptor, moduleId, interpreter, asset_id } = opts;
		const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
		const idValue = descriptor.id;
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Service descriptor requires a non-empty id.');
		}
		const serviceId = idValue.trim() as Identifier;
		if (this.consoleServices.has(serviceId)) {
			throw new Error(`[BmsxConsoleRuntime] Duplicate Lua service id '${serviceId}' detected.`);
		}

		const autoActivate = (descriptor as { auto_activate?: boolean }).auto_activate ?? true;

		const hooks: LuaServiceHooks = {};
		const bootCandidate = this.getLuaTableEntry(table, ['on_boot', 'boot', 'initialize']);
		if (bootCandidate !== undefined && bootCandidate !== null) {
			if (!this.isLuaFunctionValue(bootCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_boot' must be a function.`);
			}
			const handler = this.luaValueToJs(bootCandidate, this.extendMarshalContext(marshalCtx, 'hooks.boot'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_boot' must be a Lua handler.`);
			}
			hooks.boot = handler;
		}
		const activateCandidate = this.getLuaTableEntry(table, ['on_activate', 'activate']);
		if (activateCandidate !== undefined && activateCandidate !== null) {
			if (!this.isLuaFunctionValue(activateCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_activate' must be a function.`);
			}
			const handler = this.luaValueToJs(activateCandidate, this.extendMarshalContext(marshalCtx, 'hooks.activate'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_activate' must be a Lua handler.`);
			}
			hooks.activate = handler;
		}
		const deactivateCandidate = this.getLuaTableEntry(table, ['on_deactivate', 'deactivate']);
		if (deactivateCandidate !== undefined && deactivateCandidate !== null) {
			if (!this.isLuaFunctionValue(deactivateCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_deactivate' must be a function.`);
			}
			const handler = this.luaValueToJs(deactivateCandidate, this.extendMarshalContext(marshalCtx, 'hooks.deactivate'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_deactivate' must be a Lua handler.`);
			}
			hooks.deactivate = handler;
		}
		const disposeCandidate = this.getLuaTableEntry(table, ['on_dispose', 'ondispose']);
		if (disposeCandidate !== undefined && disposeCandidate !== null) {
			if (!this.isLuaFunctionValue(disposeCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_dispose' must be a function.`);
			}
			const handler = this.luaValueToJs(disposeCandidate, this.extendMarshalContext(marshalCtx, 'hooks.dispose'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_dispose' must be a Lua handler.`);
			}
			hooks.dispose = handler;
		}
		const tickCandidate = this.getLuaTableEntry(table, ['on_tick', 'tick']);
		if (tickCandidate !== undefined && tickCandidate !== null) {
			if (!this.isLuaFunctionValue(tickCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_tick' must be a function.`);
			}
			const handler = this.luaValueToJs(tickCandidate, this.extendMarshalContext(marshalCtx, 'hooks.tick'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'on_tick' must be a Lua handler.`);
			}
			hooks.tick = handler;
		}
		const getStateCandidate = this.getLuaTableEntry(table, ['get_state', 'getState', 'serialize']);
		if (getStateCandidate !== undefined && getStateCandidate !== null) {
			if (!this.isLuaFunctionValue(getStateCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'get_state' must be a function.`);
			}
			const handler = this.luaValueToJs(getStateCandidate, this.extendMarshalContext(marshalCtx, 'hooks.get_state'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'get_state' must be a Lua handler.`);
			}
			hooks.get_state = handler;
		}
		const setStateCandidate = this.getLuaTableEntry(table, ['set_state', 'setState', 'deserialize']);
		if (setStateCandidate !== undefined && setStateCandidate !== null) {
			if (!this.isLuaFunctionValue(setStateCandidate)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'set_state' must be a function.`);
			}
			const handler = this.luaValueToJs(setStateCandidate, this.extendMarshalContext(marshalCtx, 'hooks.set_state'));
			if (!isLuaHandlerFn(handler)) {
				throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' hook 'set_state' must be a Lua handler.`);
			}
			hooks.set_state = handler;
		}

		const events = new Map<string, LuaHandlerFn>();
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
				const jsHandler = this.luaValueToJs(handler, this.extendMarshalContext(marshalCtx, `events.${eventName}`));
				if (!isLuaHandlerFn(jsHandler)) {
					throw new Error(`[BmsxConsoleRuntime] Service '${serviceId}' event '${eventName}' must be a Lua handler.`);
				}
				events.set(eventName, jsHandler);
			}
		}

		const machines: Identifier[] = [];
		const machinesValue = (descriptor as { machines?: unknown }).machines;
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

		const service = new ConsoleScriptService(serviceId);
		const binding: LuaServiceBinding = {
			service,
			table,
			hooks,
			events,
			auto_activate: autoActivate,
		};

		this.consoleServices.set(serviceId, binding);

		for (let index = 0; index < machines.length; index += 1) {
			service.sc.add_statemachine(machines[index], serviceId);
		}

		if (hooks.get_state) {
			service.getState = () => this.invokeLuaServiceHook(binding, hooks.get_state!);
		}
		if (hooks.set_state) {
			service.setState = (state: unknown) => { this.invokeLuaServiceHook(binding, hooks.set_state!, state); };
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
			this.consoleServices.delete(service.id);
			for (const [key, set] of this.consoleServicesByAsset.entries()) {
				if (set.delete(service.id) && set.size === 0 && key !== '__service_global__') {
					this.consoleServicesByAsset.delete(key);
				}
			}
			originalDispose();
		};

		service.bind();
		const definition = this.serviceDefinitions.get(serviceId);
		if (definition) {
			this.attachServiceFsms(service, definition.fsms);
			if (definition.behavior_trees.length > 0) {
				this.recordLuaWarning(`[Service:${serviceId}] Behavior trees are not currently supported for services.`);
			}
			if (definition.effects.length > 0) {
				this.recordLuaWarning(`[Service:${serviceId}] Effects are not currently supported for services.`);
			}
			if (definition.tags.length > 0) {
				this.recordLuaWarning(`[Service:${serviceId}] Tags are not currently supported for services.`);
			}
			binding.auto_activate = definition.auto_activate;
		}
		this.registerLuaServiceEvents(binding);

		if (hooks.boot) {
			this.invokeLuaServiceHook(binding, hooks.boot);
		}

		const snapshot = snapshots?.get(serviceId);
		this.finalizeLuaServiceActivation(binding, snapshot);
		if (snapshots && snapshot) {
			snapshots.delete(serviceId);
		}

		const assetKey = asset_id ?? '__service_global__';
		let set = this.consoleServicesByAsset.get(assetKey);
		if (!set) {
			set = new Set();
			this.consoleServicesByAsset.set(assetKey, set);
		}
		set.add(serviceId);
		return serviceId;
	}

	private finalizeLuaServiceActivation(binding: LuaServiceBinding, snapshot?: LuaServiceSnapshot): void {
		if (snapshot && snapshot.state !== undefined && binding.hooks.set_state) {
			try {
				this.invokeLuaServiceHook(binding, binding.hooks.set_state, snapshot.state);
			} catch (error) {
				this.handleLuaError(error);
			}
		}
		const shouldActivate = snapshot ? snapshot.active : binding.auto_activate;
		if (shouldActivate) {
			if (!binding.service.active) {
				binding.service.activate();
			}
			return;
		}
		const shouldEnableEvents = snapshot ? snapshot.events_enabled : binding.events.size > 0;
		if (shouldEnableEvents && !binding.service.eventhandling_enabled) {
			binding.service.enableEvents();
		}
	}

	private captureLuaServiceSnapshot(binding: LuaServiceBinding): LuaServiceSnapshot {
		let state: unknown;
		try {
			state = binding.service.getState();
		} catch (error) {
			this.handleLuaError(error);
		}
		return {
			state,
			active: binding.service.active,
			events_enabled: binding.service.eventhandling_enabled === true,
		};
	}

	private loadLuaServiceScripts(interpreter: LuaInterpreter): void {
		this.executeGenericLuaAssets(interpreter);
		const rompack = $.rompack;
		const luaSources = rompack.lua;
		const sourcePaths = rompack.luaSourcePaths;
		const trackedAssets = new Set(this.consoleServiceDefinitionsByAsset.keys());
		const asset_ids = this.sortLuaasset_ids(luaSources, sourcePaths, asset_id => trackedAssets.has(asset_id), trackedAssets);
		const processedAssets = new Set<string>();
		for (let index = 0; index < asset_ids.length; index += 1) {
			const asset_id = asset_ids[index]!;
			const source = luaSources[asset_id];
			processedAssets.add(asset_id);
			const previousIds = new Set(this.consoleServicesByAsset.get(asset_id) ?? []);
			const snapshots = new Map<string, LuaServiceSnapshot>();
			for (const serviceId of previousIds) {
				const binding = this.consoleServices.get(serviceId);
				if (!binding) continue;
				snapshots.set(serviceId, this.captureLuaServiceSnapshot(binding));
				binding.service.dispose();
			}
			this.consoleServicesByAsset.set(asset_id, new Set());
			const previousAssetContext = this.currentLuaAssetContext;
			this.currentLuaAssetContext = { category: 'service', asset_id };
			try {
				const sourcePathRaw = sourcePaths[asset_id];
				const pathHint = sourcePathRaw ?? this.resolveResourcePath(asset_id);
				const chunkName = this.resolveLuaServiceChunkName(asset_id, sourcePathRaw ?? null);
				const serviceInfo: { asset_id: string | null; path?: string | null } = { asset_id };
				if (pathHint) {
					serviceInfo.path = pathHint;
				}
				this.registerLuaChunkResource(chunkName, serviceInfo);
				const executionResults = interpreter.execute(source, chunkName);
				this.cacheChunkEnvironment(interpreter, chunkName, asset_id);
				if (executionResults.length > 0) {
					const table = executionResults[0] as LuaTable;
					const moduleId = this.moduleIdFor('service', asset_id, chunkName);
					const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
					const descriptorRaw = this.luaValueToJs(table, marshalCtx) as Record<string, unknown>;
					this.instantiateLuaService({
						table,
						descriptor: descriptorRaw as Record<string, unknown>,
						moduleId,
						interpreter,
						asset_id,
					}, snapshots);
				}
			}
			finally {
				this.currentLuaAssetContext = previousAssetContext;
			}
		}
		for (const [asset_id, bindings] of Array.from(this.consoleServicesByAsset.entries())) {
			if (processedAssets.has(asset_id) || asset_id === '__service_global__') {
				continue;
			}
			for (const serviceId of bindings) {
				const binding = this.consoleServices.get(serviceId);
				if (binding) {
					binding.service.dispose();
				}
			}
			this.consoleServicesByAsset.delete(asset_id);
		}
		for (const [asset_id, serviceIds] of Array.from(this.consoleServiceDefinitionsByAsset.entries())) {
			if (processedAssets.has(asset_id)) {
				continue;
			}
			if (serviceIds) {
				for (const serviceId of serviceIds) {
					this.serviceDefinitions.delete(serviceId);
				}
			}
			this.consoleServiceDefinitionsByAsset.delete(asset_id);
		}
	}

	private prepareLuaBehaviorTreeDefinition(treeId: string, definitionValue: unknown, asset_id: string): BehaviorTreeDefinition {
		if (definitionValue === null || definitionValue === undefined) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree '${treeId}' definition in asset '${asset_id}' cannot be nil.`);
		}
		if (this.isLuaValue(definitionValue)) {
			const interpreter = this.requireLuaInterpreter();
			const moduleId = this.moduleIdFor('behavior_tree', asset_id, this.luaChunkName ?? null);
			const ctx = this.ensureMarshalContext({ moduleId, interpreter, path: ['definition'] });
			return this.luaValueToJs(definitionValue as LuaValue, ctx) as BehaviorTreeDefinition;
		}
		if (!this.isPlainObject(definitionValue) && !Array.isArray(definitionValue)) {
			throw new Error(`[BmsxConsoleRuntime] Behavior tree '${treeId}' definition in asset '${asset_id}' must be a table.`);
		}
		return definitionValue as BehaviorTreeDefinition;
	}

	private tickLuaServices(deltaSeconds: number): void {
		for (const binding of this.consoleServices.values()) {
			if (!binding.hooks.tick) continue;
			if (!binding.service.active || binding.service.tickEnabled === false) continue;
			this.invokeLuaServiceHook(binding, binding.hooks.tick, deltaSeconds);
			if (this.luaRuntimeFailed) {
				break;
			}
		}
	}

	private disposeLuaServices(): void {
		for (const binding of this.consoleServices.values()) {
			try {
				binding.service.dispose();
			}
			catch (error) {
				this.handleLuaError(error);
			}
		}
		this.consoleServices.clear();
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
			const listener = (event: GameEvent) => {
				try {
					const emitterObj = (event.emitter as Identifiable) ?? binding.service;
					const { type, timeStamp, emitter, target, ...rest } = event as Record<string, unknown>;
					const payloadValue = Object.keys(rest).length > 0 ? (rest as EventPayload) : undefined;
					return handler(binding.table, event.type, emitterObj, payloadValue);
				} catch (error) {
					if (isLuaDebuggerPauseSignal(error)) {
						this.onLuaDebuggerPause(error);
						return undefined;
					}
					this.handleLuaError(error);
					return undefined;
				}
			};
			const disposer = binding.service.events.on({ event_name: eventName, handler: listener, subscriber: this });
			const key = `${binding.service.id}:${handler.__hid}`;
			this.consoleServiceEventListeners.set(key, disposer);
		}
	}

	private unregisterLuaServiceEvents(serviceId: string): void {
		for (const [key, disposer] of Array.from(this.consoleServiceEventListeners.entries())) {
			if (!key.startsWith(`${serviceId}:`)) {
				continue;
			}
			disposer();
			this.consoleServiceEventListeners.delete(key);
		}
	}

	private invokeLuaServiceHook(binding: LuaServiceBinding, fn: LuaHandlerFn, ...args: unknown[]): unknown {
		try {
			return fn(binding.table, ...args);
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return undefined;
			}
			this.handleLuaError(error);
			return undefined;
		}
	}

	private resolveLuaHotReloadCategory(asset_id: string): 'fsm' | 'behavior_tree' | 'service' | 'component_preset' | 'worldobject' | null {
		if (this.consoleFsmsByAsset.has(asset_id)) {
			return 'fsm';
		}
		if (this.consoleBehaviorTreesByAsset.has(asset_id)) {
			return 'behavior_tree';
		}
		if (this.consoleServiceDefinitionsByAsset.has(asset_id) || this.consoleServicesByAsset.has(asset_id)) {
			return 'service';
		}
		if (this.consoleComponentPresetsByAsset.has(asset_id)) {
			return 'component_preset';
		}
		if (this.consoleWorldObjectsByAsset.has(asset_id)) {
			return 'worldobject';
		}
		return null;
	}

	private resolveLuaBehaviorTreeChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@bt/${asset_id}`;
	}

	private resolveLuaFsmChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@fsm/${asset_id}`;
	}

	private resolveLuaComponentPresetChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@component/${asset_id}`;
	}

	private resolveLuaWorldObjectChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@worldobject/${asset_id}`;
	}

	private resolveLuaServiceChunkName(asset_id: string, sourcePath: string | null): string {
		if (sourcePath && sourcePath.length > 0) {
			return `@${sourcePath}`;
		}
		return `@service/${asset_id}`;
	}

	private prepareLuaStateMachineBlueprint(
		machineId: string,
		blueprint: unknown,
		interpreter: LuaInterpreter,
		moduleId: string,
	): StateMachineBlueprint {
		if (blueprint === null || blueprint === undefined) {
			throw new Error(`[BmsxConsoleRuntime] FSM '${machineId}' returned an empty blueprint.`);
		}
		if (this.isLuaValue(blueprint)) {
			const ctx = this.ensureMarshalContext({ moduleId, interpreter, path: ['blueprint'] });
			const converted = this.luaValueToJs(blueprint as LuaValue, ctx) as StateMachineBlueprint;
			return converted;
		}
		if (!this.isPlainObject(blueprint)) {
			throw new Error(`[BmsxConsoleRuntime] FSM '${machineId}' blueprint must be a table.`);
		}
		return blueprint as StateMachineBlueprint;
	}

	private unregisterLuaStateMachine(machineId: string): void {
		delete StateDefinitionBuilders[machineId];
		const prefix = `${machineId}:/`;
		for (const key of Object.keys(StateDefinitions)) {
			if (key === machineId || key.startsWith(prefix)) {
				delete StateDefinitions[key];
			}
		}
		ActiveStateMachines.delete(machineId);
		this.consoleFsmMachineIds.delete(machineId);
		for (const set of this.consoleFsmsByAsset.values()) {
			set.delete(machineId);
		}
	}

	public registerStateMachineDefinition(descriptor: Record<string, unknown>): void {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] registerStateMachineDefinition expects a descriptor table.');
		}
		const idValue = (descriptor as { id?: unknown }).id;
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] FSM descriptor requires a non-empty id.');
		}
		const machineId = idValue.trim();
		const interpreter = this.requireLuaInterpreter();
		const moduleId = this.moduleIdFor('fsm', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
		const prepared = this.prepareLuaStateMachineBlueprint(machineId, descriptor, interpreter, moduleId);
		applyPreparedStateMachine(machineId, prepared, { force: true });
		api.register_prepared_fsm(machineId, prepared, { setup: false });
		this.consoleFsmMachineIds.add(machineId);
		const asset_id = this.currentLuaAssetContext?.asset_id ?? null;
		if (asset_id) {
			let set = this.consoleFsmsByAsset.get(asset_id);
			if (!set) {
				set = new Set();
				this.consoleFsmsByAsset.set(asset_id, set);
			}
			set.add(machineId);
		}
	}

	public registerComponentDefinition(descriptor: Record<string, unknown>): string {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] define_component requires a descriptor table.');
		}
		const idValue = (descriptor as { id?: unknown; name?: unknown }).id ?? (descriptor as { name?: unknown }).name;
		const componentId = this.normalizeLuaIdentifier(idValue, 'define_component');
		const handlersRaw = (descriptor as { handlers?: unknown }).handlers;
		const handlers: LuaComponentHandlerMap = {};
		if (handlersRaw && typeof handlersRaw === 'object') {
			const handlerEntries = handlersRaw as Record<string, unknown>;
			for (const [rawKey, candidate] of Object.entries(handlerEntries)) {
				if (typeof candidate !== 'function' || !isLuaHandlerFn(candidate)) {
					throw new Error(`[BmsxConsoleRuntime] Handler '${rawKey}' for component '${componentId}' must be a Lua function.`);
				}
				handlers[rawKey] = candidate;
			}
		}
		const tagsPre = this.normalizeStringArray((descriptor as { tagsPre?: unknown; tags_pre?: unknown }).tagsPre ?? (descriptor as { tags_pre?: unknown }).tags_pre);
		const tagsPost = this.normalizeStringArray((descriptor as { tagsPost?: unknown; tags_post?: unknown }).tagsPost ?? (descriptor as { tags_post?: unknown }).tags_post);
		const unique = Boolean((descriptor as { unique?: unknown }).unique);
		const initialStateRaw = (descriptor as { state?: unknown; initialState?: unknown }).state ?? (descriptor as { initialState?: unknown }).initialState;
		const initialState = initialStateRaw && typeof initialStateRaw === 'object' ? deep_clone(initialStateRaw as Record<string, unknown>) : undefined;
		const record: LuaComponentDefinitionRecord = {
			id: componentId,
			handlers,
			initial_state: initialState,
			tagsPre,
			tagsPost,
			unique,
		};
		this.componentDefinitions.set(componentId, record);
		return componentId;
	}

	public createComponentInstance(opts: { definition_id: string; parent_id: Identifier; id_local?: string | null; state?: Record<string, unknown> | null }): LuaComponent {
		const definition = this.componentDefinitions.get(opts.definition_id);
		if (!definition) {
			throw new Error(`[BmsxConsoleRuntime] Lua component definition '${opts.definition_id}' is not registered.`);
		}
		const baseState = definition.initial_state ? deep_clone(definition.initial_state) : {};
		if (opts.state) {
			Object.assign(baseState, deep_clone(opts.state));
		}
		return new LuaComponent({
			parent_or_id: opts.parent_id,
			id_local: opts.id_local ?? undefined,
			definitionId: definition.id,
			handlers: definition.handlers,
			initialState: baseState,
			tagsPre: definition.tagsPre,
			tagsPost: definition.tagsPost,
			unique: definition.unique,
		});
	}

	public getWorldObjectDefinition(id: string): ConsoleWorldObjectDefinitionRecord | undefined {
		return this.worldObjectDefinitions.get(id);
	}

	public registerComponentPreset(descriptor: Record<string, unknown>): string {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] define_component_preset requires a descriptor table.');
		}
		const moduleId = this.moduleIdFor('other', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
		const idValue = this.getLuaRecordEntry<string>(descriptor, ['id', 'name']);
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error('[BmsxConsoleRuntime] Component preset requires a non-empty id.');
		}
		const presetId = this.normalizeLuaIdentifier(idValue, 'define_component_preset');
		this.disposeComponentPreset(presetId);
		const buildCandidate = (descriptor as { build?: unknown }).build;
		if (!buildCandidate || typeof buildCandidate !== 'function' || !isLuaHandlerFn(buildCandidate as Function)) {
			throw new Error(`[BmsxConsoleRuntime] Component preset '${presetId}' requires a Lua build function.`);
		}
		const buildHandler = buildCandidate as LuaHandlerFn;
		const asset_id = this.currentLuaAssetContext?.asset_id ?? null;
		const presetRecord: LuaComponentPresetRecord = {
			id: presetId,
			module_id: moduleId,
			build: buildHandler,
			asset_id: asset_id,
		};
		this.componentPresets.set(presetId, presetRecord);
		if (asset_id) {
			let set = this.consoleComponentPresetsByAsset.get(asset_id);
			if (!set) {
				set = new Set();
				this.consoleComponentPresetsByAsset.set(asset_id, set);
			}
			set.add(presetId);
		}
		return presetId;
	}

	private disposeComponentPreset(id: string): void {
		if (!id) {
			return;
		}
		const record = this.componentPresets.get(id);
		if (record && record.asset_id) {
			const set = this.consoleComponentPresetsByAsset.get(record.asset_id);
			if (set) {
				set.delete(id);
				if (set.size === 0) {
					this.consoleComponentPresetsByAsset.delete(record.asset_id);
				}
			}
		}
		this.componentPresets.delete(id);
	}

	public registerServiceDefinition(descriptor: Record<string, unknown>): Record<string, unknown> {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] define_service requires a descriptor table.');
		}
		const serviceId = this.normalizeLuaIdentifier((descriptor as { id?: unknown }).id, 'define_service');
		const fsms = this.normalizeWorldObjectFsmList((descriptor as { fsms?: unknown }).fsms);
		const behaviorTrees = this.normalizeWorldObjectBehaviorTreeList((descriptor as { behavior_trees?: unknown }).behavior_trees);
		const effects = this.normalizeStringArray((descriptor as { effects?: unknown }).effects) ?? [];
		const tags = this.normalizeStringArray((descriptor as { tags?: unknown }).tags) ?? [];
		const autoActivate = (descriptor as { auto_activate?: boolean }).auto_activate ?? true;
		const record: ConsoleServiceDefinitionRecord = {
			id: serviceId,
			fsms,
			behavior_trees: behaviorTrees,
			effects,
			tags,
			auto_activate: autoActivate,
			asset_id: this.currentLuaAssetContext?.asset_id ?? null,
		};
		const previous = this.serviceDefinitions.get(serviceId);
		if (previous && previous.asset_id) {
			const set = this.consoleServiceDefinitionsByAsset.get(previous.asset_id);
			if (set) {
				set.delete(serviceId);
				if (set.size === 0) {
					this.consoleServiceDefinitionsByAsset.delete(previous.asset_id);
				}
			}
		}
		this.serviceDefinitions.set(serviceId, record);
		if (record.asset_id) {
			let set = this.consoleServiceDefinitionsByAsset.get(record.asset_id);
			if (!set) {
				set = new Set();
				this.consoleServiceDefinitionsByAsset.set(record.asset_id, set);
			}
			set.add(serviceId);
		}
		if (!Object.prototype.hasOwnProperty.call(descriptor, 'auto_activate')) {
			(descriptor as { auto_activate?: boolean }).auto_activate = autoActivate;
		}
		return descriptor;
	}

	private normalizeLuaWorldObjectComponents(raw: unknown): ConsoleWorldObjectComponentEntry[] {
		if (!raw) {
			return [];
		}
		if (!Array.isArray(raw)) {
			throw new Error('[BmsxConsoleRuntime] Lua world object components must be provided as an array.');
		}
		const normalized: ConsoleWorldObjectComponentEntry[] = [];
		for (let i = 0; i < raw.length; i += 1) {
			const entry = raw[i];
			if (!entry || (typeof entry !== 'object' && typeof entry !== 'string')) {
				throw new Error(`[BmsxConsoleRuntime] Component descriptor at index ${i} must be a table or string.`);
			}
			if (typeof entry === 'string') {
				const trimmed = entry.trim();
				if (trimmed.length === 0) {
					throw new Error(`[BmsxConsoleRuntime] Component descriptor at index ${i} must not be empty.`);
				}
				normalized.push({ kind: 'component', descriptor: { classname: trimmed, options: {} } });
				continue;
			}
			const record = entry as Record<string, unknown>;
			const presetCandidate = this.getLuaRecordEntry<string>(record, ['preset', 'presetId', 'preset_id']);
			if (typeof presetCandidate === 'string' && presetCandidate.trim().length > 0) {
				const paramsRaw = this.getLuaRecordEntry<Record<string, unknown>>(record, ['params', 'arguments', 'options', 'config']);
				let params: Record<string, unknown> = {};
				if (paramsRaw !== undefined) {
					if (!this.isPlainObject(paramsRaw)) {
						throw new Error(`[BmsxConsoleRuntime] Component preset '${presetCandidate}' params must be a table/object.`);
					}
					params = this.prepareComponentOptions(paramsRaw as Record<string, unknown>, COMPONENT_OPTION_RESERVED_KEYS);
				}
				normalized.push({ kind: 'preset', presetId: presetCandidate.trim(), params });
				continue;
			}
			const className = this.getLuaRecordEntry<string>(record, ['class', 'className', 'type']);
			if (typeof className !== 'string' || className.trim().length === 0) {
				throw new Error(`[BmsxConsoleRuntime] Component descriptor at index ${i} is missing a class name.`);
			}
			let options: Record<string, unknown>;
			if (record.options !== undefined) {
				if (!this.isPlainObject(record.options)) {
					throw new Error(`[BmsxConsoleRuntime] Component descriptor at index ${i} options must be a table/object.`);
				}
				options = this.prepareComponentOptions(record.options as Record<string, unknown>, COMPONENT_OPTION_RESERVED_KEYS);
			} else {
				options = this.prepareComponentOptions(record);
			}
			normalized.push({ kind: 'component', descriptor: { classname: className.trim(), options } });
		}
		return normalized;
	}

	private expandComponentEntries(entries: ConsoleWorldObjectComponentEntry[]): Array<{ className: string; options: Record<string, unknown> }> {
		const descriptors: Array<{ className: string; options: Record<string, unknown> }> = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]!;
			if (entry.kind === 'component') {
				descriptors.push({
					className: entry.descriptor.classname,
					options: entry.descriptor.options,
				});
				continue;
			}
			const preset = this.componentPresets.get(entry.presetId);
			if (!preset) {
				throw new Error(`[BmsxConsoleRuntime] Component preset '${entry.presetId}' is not registered.`);
			}
			const result = preset.build(entry.params ?? {}) as Array<Record<string, unknown>>;
			for (let r = 0; r < result.length; r += 1) {
				const record = result[r]!;
				const className = this.getLuaRecordEntry<string>(record, ['class', 'className', 'type'])!.trim();
				let options: Record<string, unknown>;
				if (record.options !== undefined) {
					if (!this.isPlainObject(record.options)) {
						throw new Error(`[BmsxConsoleRuntime] Component preset '${entry.presetId}' options must be a table/object.`);
					}
					options = this.prepareComponentOptions(record.options as Record<string, unknown>, COMPONENT_OPTION_RESERVED_KEYS);
				} else {
					options = this.prepareComponentOptions(record);
				}
				descriptors.push({ className, options });
			}
		}
		return descriptors;
	}

	private componentEntryKey(entry: ConsoleWorldObjectComponentEntry): string | null {
		const raw =
			entry.kind === 'component'
				? entry.descriptor.options.id_local
				: entry.params.id_local;
		return typeof raw === 'string' ? raw.toLowerCase() : null;
	}

	private prepareComponentOptions(
		source: Record<string, unknown>,
		reservedKeys: ReadonlySet<string> = COMPONENT_DESCRIPTOR_RESERVED_KEYS,
	): Record<string, unknown> {
		const options: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(source)) {
			if (reservedKeys.has(key)) {
				continue;
			}
			options[key] = value;
		}
		const idLocal = this.extractCanonicalComponentId(source);
		if (idLocal) {
			options.id_local = idLocal;
		}
		return options;
	}

	private extractCanonicalComponentId(source: Record<string, unknown> | undefined | null): string | null {
		if (!source) {
			return null;
		}
		const raw = source.id_local;
		return typeof raw === 'string' ? raw : null;
	}

	private normalizeWorldObjectDefaults(raw: unknown, label: string): Record<string, unknown> | undefined {
		if (raw === undefined || raw === null) {
			return undefined;
		}
		if (!this.isPlainObject(raw)) {
			throw new Error(`[BmsxConsoleRuntime] ${label} must be a table/object.`);
		}
		return deep_clone(raw as Record<string, unknown>);
	}

	private normalizeWorldObjectFsmList(raw: unknown): ConsoleWorldObjectSystemEntry[] {
		const entries = this.normalizeWorldObjectSystemEntries(raw, {
			label: 'fsms',
			idKeys: ['id'],
			contextKeys: ['context'],
			allowAutoTick: false,
			activeKeys: ['active'],
		});
		return entries;
	}

	private normalizeWorldObjectBehaviorTreeList(raw: unknown): ConsoleWorldObjectSystemEntry[] {
		return this.normalizeWorldObjectSystemEntries(raw, {
			label: 'behavior trees',
			idKeys: ['id'],
			contextKeys: ['context'],
			allowAutoTick: true,
			activeKeys: ['active'],
		});
	}

	private normalizeWorldObjectSystemEntries(
		raw: unknown,
		options: { label: string; idKeys: string[]; contextKeys?: string[]; allowAutoTick: boolean; activeKeys?: string[] },
	): ConsoleWorldObjectSystemEntry[] {
		if (raw === undefined || raw === null) {
			return [];
		}
		const entries: ConsoleWorldObjectSystemEntry[] = [];
		const push = (value: Record<string, unknown>, indexLabel: string) => {
			const idValue = this.getLuaRecordEntry<string>(value, options.idKeys);
			if (typeof idValue !== 'string' || idValue.trim().length === 0) {
				throw new Error(`[BmsxConsoleRuntime] ${options.label} entry ${indexLabel} is missing a valid id.`);
			}
			const entry: ConsoleWorldObjectSystemEntry = { id: idValue.trim() };
			if (options.contextKeys) {
				const contextValue = this.getLuaRecordEntry<string>(value, options.contextKeys);
				if (typeof contextValue === 'string' && contextValue.trim().length > 0) {
					entry.context = contextValue.trim();
				}
			}
			if (options.allowAutoTick) {
				const autoValue = this.getLuaRecordEntry<unknown>(value, ['auto_tick']);
				if (typeof autoValue === 'boolean') {
					entry.auto_tick = autoValue;
				}
			}
			if (options.activeKeys) {
				const activeValue = this.getLuaRecordEntry<unknown>(value, options.activeKeys);
				if (typeof activeValue === 'boolean') {
					entry.active = activeValue;
				}
			}
			entries.push(entry);
		};
		if (typeof raw === 'string') {
			const trimmed = raw.trim();
			if (trimmed.length === 0) {
				throw new Error(`[BmsxConsoleRuntime] ${options.label} string entries must not be empty.`);
			}
			entries.push({ id: trimmed });
			return entries;
		}
		if (Array.isArray(raw)) {
			for (let i = 0; i < raw.length; i += 1) {
				const value = raw[i];
				if (typeof value === 'string') {
					const trimmed = value.trim();
					if (trimmed.length === 0) {
						throw new Error(`[BmsxConsoleRuntime] ${options.label}[${i}] must not be empty.`);
					}
					entries.push({ id: trimmed });
					continue;
				}
				if (!this.isPlainObject(value)) {
					throw new Error(`[BmsxConsoleRuntime] ${options.label}[${i}] must be a table/object.`);
				}
				push(value as Record<string, unknown>, `[${i}]`);
			}
			return entries;
		}
		if (this.isPlainObject(raw)) {
			push(raw as Record<string, unknown>, '');
			return entries;
		}
		throw new Error(`[BmsxConsoleRuntime] ${options.label} must be provided as a string, table, or array.`);
	}

	private mergeSystemEntries(base: ReadonlyArray<ConsoleWorldObjectSystemEntry>, override: ReadonlyArray<ConsoleWorldObjectSystemEntry>): ConsoleWorldObjectSystemEntry[] {
		const merged: ConsoleWorldObjectSystemEntry[] = [];
		const seen = new Set<string>();
		const add = (entry: ConsoleWorldObjectSystemEntry) => {
			const key = `${(entry.context ?? '').toLowerCase()}::${entry.id.toLowerCase()}`;
			if (seen.has(key)) {
				return;
			}
			merged.push({
				id: entry.id,
				context: entry.context ?? undefined,
				auto_tick: entry.auto_tick ?? undefined,
				active: entry.active ?? undefined,
			});
			seen.add(key);
		};
		for (const entry of base) add(entry);
		for (const entry of override) add(entry);
		return merged;
	}

	private mergeStringLists(base: ReadonlyArray<string>, override: ReadonlyArray<string>): string[] {
		if (base.length === 0 && override.length === 0) {
			return [];
		}
		const merged: string[] = [];
		const seen = new Set<string>();
		const add = (value: string) => {
			const trimmed = value.trim();
			if (trimmed.length === 0) {
				return;
			}
			const key = trimmed.toLowerCase();
			if (seen.has(key)) {
				return;
			}
			merged.push(trimmed);
			seen.add(key);
		};
		for (const value of base) add(value);
		for (const value of override) add(value);
		return merged;
	}

	private ensureAttachmentSet<T extends object>(map: WeakMap<T, Set<string>>, host: T): Set<string> {
		let set = map.get(host);
		if (!set) {
			set = new Set<string>();
			map.set(host, set);
		}
		return set;
	}

	public registerWorldObjectDefinition(descriptor: Record<string, unknown>): string {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleRuntime] register_worldobject requires a descriptor table.');
		}
		const interpreter = this.requireLuaInterpreter();
		const moduleId = this.moduleIdFor('other', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
		const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
		const idValue = this.getLuaRecordEntry<string>(descriptor, ['id', 'name']);
		const classRefRaw = this.getLuaRecordEntry<string>(descriptor, ['class', 'prototype', 'luaclass', 'klass']);
		const objectId = this.normalizeLuaIdentifier(idValue ?? classRefRaw, 'register_worldobject');
		let classRef = classRefRaw;
		if (!classRef || classRef.trim().length === 0) {
			const fallback = objectId.split('.').pop();
			classRef = fallback && fallback.length > 0 ? fallback : objectId;
		}
		const normalizedClassRef = this.normalizeLuaIdentifier(classRef, 'register_worldobject.class');

		this.disposeWorldObjectDefinition(objectId);

		const classTable = this.resolveLuaClassTable(normalizedClassRef, interpreter);

		const baseCandidate =
			this.getLuaRecordEntry<string>(descriptor, ['base', 'extends', 'super']) ??
			this.luaValueToJs(this.getLuaTableEntry(classTable, ['base', 'extends', 'super']) ?? null, this.extendMarshalContext(marshalCtx, 'class.base'));
		const baseRef = typeof baseCandidate === 'string' && baseCandidate.trim().length > 0 ? baseCandidate : 'WorldObject';
		const baseCtor = this.resolveWorldObjectConstructor(baseRef);

		const componentsRaw = this.getLuaRecordEntry<unknown>(descriptor, ['components']) ??
			this.luaValueToJs(this.getLuaTableEntry(classTable, ['components']) ?? null, this.extendMarshalContext(marshalCtx, 'class.components'));
		const componentEntries = this.normalizeLuaWorldObjectComponents(componentsRaw);

		const defaultsSource = this.getLuaRecordEntry<Record<string, unknown>>(descriptor, ['defaults', 'state', 'properties'])
			?? (() => {
				const value = this.getLuaTableEntry(classTable, ['defaults', 'state', 'properties']);
				return value === null ? undefined : this.luaValueToJs(value, this.extendMarshalContext(marshalCtx, 'class.defaults'));
			})();
		const defaults = defaultsSource !== undefined ? this.normalizeWorldObjectDefaults(defaultsSource, 'register_worldobject.defaults') : undefined;

		const fsmCandidate =
			(descriptor as { fsms?: unknown }).fsms ??
			(() => {
				const value = this.getLuaTableEntry(classTable, ['fsms']);
				return value === null ? undefined : this.luaValueToJs(value, this.extendMarshalContext(marshalCtx, 'class.fsms'));
			})();
		const fsms = this.normalizeWorldObjectFsmList(fsmCandidate);

		const behaviorTreesRaw = (descriptor as { behavior_trees?: unknown }).behavior_trees ??
			(() => {
				const value = this.getLuaTableEntry(classTable, ['behavior_trees']);
				return value === null ? undefined : this.luaValueToJs(value, this.extendMarshalContext(marshalCtx, 'class.behavior_trees'));
			})();
		const behaviorTrees = this.normalizeWorldObjectBehaviorTreeList(behaviorTreesRaw);

		const effectsList = this.normalizeStringArray(
			(descriptor as { effects?: unknown }).effects ??
			(() => {
				const value = this.getLuaTableEntry(classTable, ['effects']);
				return value === null ? undefined : this.luaValueToJs(value, this.extendMarshalContext(marshalCtx, 'class.effects'));
			})(),
		) ?? [];

		const tagsList = this.normalizeStringArray(
			(descriptor as { tags?: unknown }).tags ??
			(() => {
				const value = this.getLuaTableEntry(classTable, ['tags']);
				return value === null ? undefined : this.luaValueToJs(value, this.extendMarshalContext(marshalCtx, 'class.tags'));
			})(),
		) ?? [];

		const asset_id = this.currentLuaAssetContext?.asset_id ?? null;
		const record: ConsoleWorldObjectDefinitionRecord = {
			id: objectId,
			base_classname: baseRef ?? 'WorldObject',
			base_ctor: baseCtor,
			constructor: WorldObject as unknown as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject,
			class_ref: normalizedClassRef,
			class_table: classTable,
			components: componentEntries,
			defaults,
			fsms,
			behavior_trees: behaviorTrees,
			effects: effectsList,
			tags: tagsList,
			asset_id: asset_id,
		};

		record.constructor = this.createConsoleWorldObjectConstructor(record);
		this.worldObjectDefinitions.set(objectId, record);
		this.worldObjectDefinitionsByClassRef.set(normalizedClassRef, record);
		if (asset_id) {
			let set = this.consoleWorldObjectsByAsset.get(asset_id);
			if (!set) {
				set = new Set();
				this.consoleWorldObjectsByAsset.set(asset_id, set);
			}
			set.add(objectId);
		}

		Reviver.constructors[objectId] = record.constructor as unknown as new () => unknown;
		Reviver.constructors[normalizedClassRef] = record.constructor as unknown as new () => unknown;
		(globalThis as Record<string, unknown>)[objectId] = record.constructor;
		(globalThis as Record<string, unknown>)[normalizedClassRef] = record.constructor;

		for (const object of $.world.objects({ scope: 'all' })) {
			const marker = object as { __lua_definition_id?: string };
			if (marker.__lua_definition_id !== objectId) continue;
			this.initializeConsoleWorldObjectInstance(object, record, { runFactory: false, invokeReload: true });
			this.invokeWorldObjectMethod(object, ['on_reload', 'reload']);
		}

		return objectId;
	}

	private createConsoleWorldObjectConstructor(def: ConsoleWorldObjectDefinitionRecord): new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject {
		const runtime = this;
		const baseCtor = def.base_ctor;
		return class console_wo_instance extends baseCtor {
			public readonly __lua_definition_id: string = def.id;
			constructor(opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) {
				super(opts);
				runtime.initializeConsoleWorldObjectInstance(this, def);
			}

			override dispose(): void {
				try {
					runtime.invokeWorldObjectMethod(this, ['on_dispose', 'ondispose']);
				}
				finally {
					super.dispose();
				}
			}
		};
	}

	private initializeConsoleWorldObjectInstance(host: WorldObject, def: ConsoleWorldObjectDefinitionRecord, opts?: { runFactory?: boolean; invokeReload?: boolean }): void {
		const interpreter = this.requireLuaInterpreter();
		this.ensureConsoleClassPrototype(def.class_table);
		const value = this.jsToLua(host, interpreter);
		if (isLuaNativeValue(value)) {
			value.setMetatable(def.class_table);
		}
		if (opts?.invokeReload) {
			const reloadCandidate = this.getLuaTableEntry(def.class_table, ['on_reload', 'reload', 'refresh']);
			if (reloadCandidate !== null && this.isLuaFunctionValue(reloadCandidate)) {
				const args: LuaValue[] = [def.class_table, value];
				try {
					reloadCandidate.call(args);
				}
				catch (error) {
					this.handleLuaError(error);
				}
			}
			return;
		}
		if (opts?.runFactory === false) {
			return;
		}
		const factoryCandidate = this.getLuaTableEntry(def.class_table, ['create', 'constructor', 'factory', 'new']);
		if (factoryCandidate !== null && this.isLuaFunctionValue(factoryCandidate)) {
			const args: LuaValue[] = [def.class_table, value];
			factoryCandidate.call(args);
		}
	}

	public onConsoleWorldObjectSpawned(host: WorldObject): void {
		this.invokeWorldObjectMethod(host, ['on_spawn', 'spawn']);
	}

	private getConsoleWorldObjectDefinitionForHost(host: WorldObject): ConsoleWorldObjectDefinitionRecord | null {
		const marker = host as { __lua_definition_id?: string };
		const defId = marker.__lua_definition_id;
		if (!defId) {
			return null;
		}
		const def = this.worldObjectDefinitions.get(defId);
		return def ?? null;
	}

	private ensureConsoleClassPrototype(classTable: LuaTable): void {
		const meta = classTable.getMetatable();
		const indexValue = meta ? meta.get('__index') : classTable.get('__index');
		if (indexValue === null) {
			classTable.set('__index', classTable);
		}
	}

	private invokeWorldObjectMethod(host: WorldObject, methodKeys: readonly string[]): void {
		try {
			const interpreter = this.requireLuaInterpreter();
			const nativeValue = this.jsToLua(host, interpreter);
			if (!isLuaNativeValue(nativeValue)) {
				return;
			}
			const definition = this.getConsoleWorldObjectDefinitionForHost(host);
			const prototypeTable = definition?.class_table ?? nativeValue.getMetatable();
			const isLuaWorldObject = definition !== null || prototypeTable !== null;
			for (let index = 0; index < methodKeys.length; index += 1) {
				const key = methodKeys[index];
				if (!key) {
					throw new Error('[BmsxConsoleRuntime] invokeWorldObjectMethod received an empty method key.');
				}
				if (prototypeTable) {
					const luaCandidate = this.getLuaTableEntry(prototypeTable, [key]);
					if (luaCandidate !== null && this.isLuaFunctionValue(luaCandidate)) {
						this.callLuaFunctionWithInterpreter(luaCandidate, [host], interpreter);
						return;
					}
				}
				if (isLuaWorldObject) {
					const instanceCandidate = interpreter.getNativeMemberValue(nativeValue, key, null);
					if (instanceCandidate !== null && this.isLuaFunctionValue(instanceCandidate)) {
						this.callLuaFunctionWithInterpreter(instanceCandidate, [host], interpreter);
						return;
					}
					continue;
				}
				const candidate = interpreter.getNativeMemberValue(nativeValue, key, null);
				if (candidate === null) {
					continue;
				}
				const fn = interpreter.expectFunction(candidate, `Method '${key}' not found on native value.`, null);
				this.callLuaFunctionWithInterpreter(fn, [host], interpreter);
				return;
			}
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
				return;
			}
			this.handleLuaError(error);
		}
	}

	private resolveLuaClassTable(classRef: string, interpreter: LuaInterpreter): LuaTable {
		const env = interpreter.getGlobalEnvironment();
		const segments = classRef.split('.');
		if (segments.length === 0) {
			throw new Error('[BmsxConsoleRuntime] register_worldobject.class requires a non-empty identifier.');
		}
		let value = this.getLuaGlobalValue(env, segments[0]) as LuaValue | null;
		if (value === null) {
			throw new Error(`[BmsxConsoleRuntime] Lua class '${classRef}' not found.`);
		}
		for (let index = 1; index < segments.length; index += 1) {
			if (!isLuaTable(value)) {
				throw new Error(`[BmsxConsoleRuntime] Lua class path '${classRef}' resolved to a non-table value.`);
			}
			const next = this.getLuaTableEntry(value, [segments[index]!]);
			if (next === null) {
				throw new Error(`[BmsxConsoleRuntime] Lua class '${classRef}' not found.`);
			}
			value = next;
		}
		if (!isLuaTable(value)) {
			throw new Error(`[BmsxConsoleRuntime] Lua class '${classRef}' resolved to a non-table value.`);
		}
		return value;
	}

	private disposeWorldObjectDefinition(id: string): void {
		const existing = this.worldObjectDefinitions.get(id);
		if (!existing) {
			return;
		}
		this.worldObjectDefinitions.delete(id);
		if (this.worldObjectDefinitionsByClassRef.get(existing.class_ref) === existing) {
			this.worldObjectDefinitionsByClassRef.delete(existing.class_ref);
		}
		if (existing.asset_id) {
			const set = this.consoleWorldObjectsByAsset.get(existing.asset_id);
			if (set) {
				set.delete(id);
				if (set.size === 0) {
					this.consoleWorldObjectsByAsset.delete(existing.asset_id);
				}
			}
		}
		if (Reviver.constructors[id] === existing.constructor) {
			delete Reviver.constructors[id];
		}
		const globalScope = globalThis as Record<string, unknown>;
		if (globalScope[id] === existing.constructor) {
			delete globalScope[id];
		}
	}

	private disposeAllWorldObjectDefinitions(): void {
		for (const id of [...this.worldObjectDefinitions.keys()]) {
			this.disposeWorldObjectDefinition(id);
		}
	}

	public applyConsoleWorldObjectDefaults(classRef: string, target: ConsoleWorldObjectSpawnOptions): void {
		let def = this.worldObjectDefinitionsByClassRef.get(classRef);
		if (!def) {
			def = this.worldObjectDefinitions.get(classRef);
		}
		if (!def) {
			return;
		}
		const mergedComponents = [...def.components];
		if (target.components.length > 0) {
			const overrideEntries = target.components;
			for (let index = 0; index < overrideEntries.length; index += 1) {
				const entry = overrideEntries[index]!;
				const key = this.componentEntryKey(entry);
				if (key) {
					for (let existingIndex = mergedComponents.length - 1; existingIndex >= 0; existingIndex -= 1) {
						const existingKey = this.componentEntryKey(mergedComponents[existingIndex]!);
						if (existingKey && existingKey === key) {
							mergedComponents.splice(existingIndex, 1);
						}
					}
				}
				mergedComponents.push(entry);
			}
		}
		target.components = mergedComponents;

		if (def.defaults) {
			const mergedDefaults = deep_clone(def.defaults);
			if (target.defaults) {
				Object.assign(mergedDefaults, deep_clone(target.defaults));
			}
			target.defaults = mergedDefaults;
		} else if (target.defaults) {
			target.defaults = deep_clone(target.defaults);
		}

		target.fsms = this.mergeSystemEntries(def.fsms, target.fsms);
		target.behavior_trees = this.mergeSystemEntries(def.behavior_trees, target.behavior_trees);
		target.effects = this.mergeStringLists(def.effects, target.effects);
		target.tags = this.mergeStringLists(def.tags, target.tags);
	}

	public materializeComponentEntries(entries: ConsoleWorldObjectComponentEntry[]): Array<{ className: string; options: Record<string, unknown> }> {
		return this.expandComponentEntries(entries);
	}

	public primeLuaWorldObjectInstance(host: WorldObject, options: ConsoleWorldObjectSpawnOptions): void {
		// Attach behavior trees before FSMs so FSM "entering_state" or
		// immediate events can safely tick BT contexts on first frame.
		this.attachWorldObjectBehaviorTrees(host, options.behavior_trees);
		this.attachWorldObjectFsms(host, options.fsms);

		if (options.defaults && Object.keys(options.defaults).length > 0) {
			const hostRecord = host as unknown as Record<string, unknown>;
			for (const [key, value] of Object.entries(options.defaults)) {
				if (BmsxConsoleRuntime.WORLD_OBJECT_RESERVED_DEFAULT_KEYS.has(key)) {
					continue;
				}
				hostRecord[key] = deep_clone(value);
			}
		}

		if (options.tags.length > 0) {
			this.recordLuaWarning(`[WorldObject:${host.id}] Tags are not supported by the InputActionToEffect system.`);
		}

		if (host.get_unique_component(InputIntentComponent) && !host.get_unique_component(ActionEffectComponent)) {
			this.recordLuaWarning(`[WorldObject:${host.id}] InputIntentComponent present without ActionEffectComponent; effect triggers will be unavailable.`);
		}
		if (host.get_unique_component(ActionEffectComponent) && options.effects.length === 0) {
			this.recordLuaWarning(`[WorldObject:${host.id}] ActionEffectComponent attached but no effects declared on the definition.`);
		}

		this.attachWorldObjectEffects(host, options.effects);
	}
	private attachWorldObjectFsms(host: WorldObject, entries: ReadonlyArray<ConsoleWorldObjectSystemEntry>): void {
		if (!entries || entries.length === 0) {
			return;
		}
		const attached = this.ensureAttachmentSet(this.worldObjectFsmAttachments, host);
		for (const entry of entries) {
			if (!entry || typeof entry.id !== 'string' || entry.id.trim().length === 0) {
				continue;
			}
			const machineId = entry.id.trim();
			const contextKey = entry.context && entry.context.trim().length > 0 ? entry.context.trim() : machineId;
			const attachmentKey = `${contextKey.toLowerCase()}::${machineId.toLowerCase()}`;
			if (attached.has(attachmentKey)) {
				continue;
			}
			host.sc.ensureStatemachine(machineId, host.id);
			if (entry.active === false) {
				host.sc.pause_statemachine(machineId);
			} else if (entry.active === true) {
				host.sc.resume_statemachine(machineId);
			}
			attached.add(attachmentKey);
		}
	}

	private attachWorldObjectBehaviorTrees(host: WorldObject, entries: ReadonlyArray<ConsoleWorldObjectSystemEntry>): void {
		if (!entries || entries.length === 0) {
			return;
		}
		const attached = this.ensureAttachmentSet(this.worldObjectBtAttachments, host);
		const contexts = host.btreecontexts;
		for (const entry of entries) {
			if (!entry || typeof entry.id !== 'string' || entry.id.trim().length === 0) {
				continue;
			}
			const treeId = entry.id.trim();
			const contextKey = entry.context && entry.context.trim().length > 0 ? entry.context.trim() : treeId;
			const attachmentKey = `${contextKey.toLowerCase()}::${treeId.toLowerCase()}`;
			if (attached.has(attachmentKey)) {
				continue;
			}
			if (!contexts[contextKey]) {
				const blackboard = new Blackboard({ id: contextKey });
				const root = instantiateBehaviorTree(treeId);
				contexts[contextKey] = {
					tree_id: treeId,
					running: entry.auto_tick === true,
					root,
					blackboard,
				};
			} else if (entry.auto_tick === true) {
				contexts[contextKey].running = true;
			}
			attached.add(attachmentKey);
		}
	}

	private attachWorldObjectEffects(host: WorldObject, effects: ReadonlyArray<string>): void {
		if (!effects || effects.length === 0) {
			return;
		}
		const component = host.get_unique_component(ActionEffectComponent);
		if (!component) {
			this.recordLuaWarning(`[WorldObject:${host.id}] Unable to grant effects (${effects.join(', ')}) because ActionEffectComponent is not attached.`);
			return;
		}
		const attached = this.ensureAttachmentSet(this.worldObjectEffectAttachments, host);
		for (const effectIdRaw of effects) {
			if (typeof effectIdRaw !== 'string' || effectIdRaw.trim().length === 0) {
				continue;
			}
			const effectId = effectIdRaw.trim() as ActionEffectId;
			const key = effectId.toLowerCase();
			if (attached.has(key)) {
				continue;
			}
			const definition = this.effectDefinitions.get(effectId);
			// Effects must be defined before the world object is registered/spawned; ensures handlers are wired once and rehydrated on reload.
			if (!definition) {
				throw new Error(`[BmsxConsoleRuntime] World object '${host.id}' declares effect '${effectId}', but it has not been registered. Ensure 'define_effect' runs before the world object definition attaches effects.`);
			}
			component.grant_effect(definition);
			attached.add(key);
		}
	}

	private attachServiceFsms(service: Service, entries: ReadonlyArray<ConsoleWorldObjectSystemEntry>): void {
		if (!entries || entries.length === 0) {
			return;
		}
		const attached = this.ensureAttachmentSet(this.serviceFsmAttachments, service);
		for (const entry of entries) {
			if (!entry || typeof entry.id !== 'string' || entry.id.trim().length === 0) {
				continue;
			}
			const machineId = entry.id.trim();
			const contextKey = entry.context && entry.context.trim().length > 0 ? entry.context.trim() : machineId;
			const attachmentKey = `${contextKey.toLowerCase()}::${machineId.toLowerCase()}`;
			if (attached.has(attachmentKey)) {
				continue;
			}
			service.sc.ensureStatemachine(machineId, service.id);
			if (entry.active === false) {
				service.sc.pause_statemachine(machineId);
			} else if (entry.active === true) {
				service.sc.resume_statemachine(machineId);
			}
			attached.add(attachmentKey);
		}
	}

	private ensureEffectHandler(effectId: ActionEffectId, candidate: ScriptHandler<[ActionEffectHandlerContext], ActionEffectHandlerResult> | undefined): ScriptHandler<[ActionEffectHandlerContext], ActionEffectHandlerResult> {
		if (!candidate) {
			throw new Error(`[BmsxConsoleRuntime] Effect '${effectId}' requires a handler.`);
		}
		if (isLuaHandlerFn(candidate)) {
			const binding = this.luaHandlerCache.unwrap(candidate);
			if (!binding) {
				return candidate;
			}
			const moduleId = this.moduleIdFor('effect', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
			const path = ['effect', effectId, 'on_trigger'];
			return this.luaHandlerCache.getOrCreate(binding.fn, { moduleId, interpreter: binding.interpreter, path });
		}
		if (typeof candidate === 'function') {
			return candidate;
		}
		throw new Error(`[BmsxConsoleRuntime] Effect '${effectId}' handler must be a function.`);
	}

	public registerEffectDefinition(descriptor: ActionEffectDefinition): ActionEffectDefinition {
		if (!descriptor) {
			throw new Error('[BmsxConsoleRuntime] define_effect requires a descriptor table.');
		}
		const effectId = this.normalizeLuaIdentifier<ActionEffectId>(descriptor.id, 'define_effect');
		this.disposeEffectDefinition(effectId);
		const onTrigger = this.ensureEffectHandler(effectId, descriptor.handler);
		const eventName = descriptor.event && descriptor.event.trim().length > 0 ? descriptor.event.trim() : undefined;
		const definition: ActionEffectDefinition = {
			id: effectId,
			event: eventName,
			cooldown_ms: descriptor.cooldown_ms,
			handler: ctx => this.invokeEffectHandler(effectId, onTrigger, ctx),
		};
		try {
			defineActionEffect(definition);
		} catch (error) {
			const message = this.extractErrorMessage(error);
			if (!message.includes('already registered')) {
				throw error;
			}
		}
		this.effectDefinitions.set(effectId, definition);
		this.refreshEffectGrants(effectId, definition);
		return definition;
	}

	private invokeEffectHandler(effectId: ActionEffectId, handler: ScriptHandler<[ActionEffectHandlerContext], ActionEffectHandlerResult>, ctx: ActionEffectHandlerContext): ActionEffectHandlerResult {
		if (isLuaHandlerFn(handler)) {
			const binding = this.luaHandlerCache.unwrap(handler);
			if (!binding) {
				throw new Error(`[BmsxConsoleRuntime] Lua effect handler '${handler.__hid}' is not bound.`);
			}
			let result: unknown;
			try {
				result = this.callLuaFunctionWithInterpreter(binding.fn, [ctx, ctx.payload], binding.interpreter);
			}
			catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					this.onLuaDebuggerPause(error);
					return undefined;
				}
				this.handleLuaError(error);
				return undefined;
			}
			const moduleId = handler.__hmod ?? this.moduleIdFor('effect', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
			const path = handler.__hpath ? handler.__hpath.split('.') : ['effect', String(effectId), 'on_trigger'];
			const marshalCtx = this.ensureMarshalContext({ moduleId, interpreter: binding.interpreter, path });
			const normalized = this.luaValueToJs(result as LuaValue, marshalCtx);
			return this.normalizeEffectHandlerResult(normalized);
		}
		// JS handler
		return (handler as (ctx: ActionEffectHandlerContext) => ActionEffectHandlerResult)(ctx);
	}

	private normalizeEffectHandlerResult(result: unknown): ActionEffectHandlerResult {
		if (result === undefined) return undefined;
		if (result && typeof result === 'object' && !Array.isArray(result)) {
			const payloadObj = result as { event?: unknown; payload?: unknown };
			const event = typeof payloadObj.event === 'string' && payloadObj.event.trim().length > 0 ? payloadObj.event.trim() : undefined;
			if (payloadObj.payload !== undefined || event !== undefined) {
				return { event, payload: payloadObj.payload };
			}
		}
		return { payload: result as unknown };
	}

	private disposeEffectDefinition(effectId: ActionEffectId): void {
		this.effectDefinitions.delete(effectId);
	}

	private disposeAllEffectDefinitions(): void {
		this.effectDefinitions.clear();
	}

	public registerEffectDefinitionFromLua(descriptorTable: LuaTable, interpreter: LuaInterpreter): ActionEffectDefinition {
		const moduleId = this.moduleIdFor('effect', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
		let idValue: string | null = null;
		let idHint = 'anon'; // For error messages only (before we know the real id)?????????????????????
		let eventValue: string | undefined;
		let cooldownValue: number | undefined;
		let onTrigger: LuaHandlerFn | undefined;
		for (const [rawKey, rawValue] of descriptorTable.entriesArray()) {
			const keyText = String(rawKey);
			switch (keyText) {
				case 'id':
					idValue = rawValue as string;
					idHint = rawValue as string;
					break;
				case 'event':
					eventValue = rawValue as string | undefined;
					break;
				case 'cooldown_ms':
					cooldownValue = rawValue as number | undefined;
					break;
				case 'on_trigger':
					if (this.isLuaFunctionValue(rawValue)) {
						onTrigger = this.luaHandlerCache.getOrCreate(rawValue, {
							moduleId,
							interpreter,
							path: ['effect', idHint, 'on_trigger'],
						});
					}
					else throw new Error(`[BmsxConsoleRuntime] Effect '${idHint}' on_trigger must be a function.`);
					break;
				default:
					// Handle unknown keys
					console.warn(`[BmsxConsoleRuntime] Effect '${idHint}' has unknown key '${keyText}'.`);
					break;
			}
		}
		const finalId = this.normalizeLuaIdentifier<ActionEffectId>(idValue, 'define_effect');
		if (!finalId) {
			throw new Error('[BmsxConsoleRuntime] define_effect requires a non-empty id.');
		}

		const descriptor: ActionEffectDefinition = {
			id: finalId,
			event: eventValue,
			cooldown_ms: cooldownValue,
			handler: onTrigger,
		};
		return this.registerEffectDefinition(descriptor);
	}

	private refreshEffectGrants(effectId: ActionEffectId, definition: ActionEffectDefinition): void {
		for (const [host, component] of $.world.objects_with_components(ActionEffectComponent, { scope: 'active' })) {
			const attached = this.worldObjectEffectAttachments.get(host);
			if (!attached || !attached.has(effectId.toLowerCase())) continue;
			component.grant_effect(definition);
		}
	}

	public getEffectDefinition(id: string): ActionEffectDefinition | undefined {
		return this.effectDefinitions.get(id as ActionEffectId);
	}

	public getWorkspaceRootPath(): string | null {
		return this.resolveCartProjectRootPath();
	}

	public getWorkspaceOverrides(): ReadonlyMap<string, { source: string; path: string | null }> {
		return this.workspaceLuaOverrides;
	}

	private resolveWorldObjectConstructor(ref: string | null | undefined): new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject {
		const fallback = WorldObject as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
		if (!ref) {
			return fallback;
		}
		const trimmed = ref.trim();
		if (trimmed.length === 0 || trimmed === 'WorldObject') {
			return fallback;
		}
		const ctorUnknown = this.resolveConstructorReference(trimmed);
		if (typeof ctorUnknown !== 'function') {
			throw new Error(`[BmsxConsoleRuntime] World object constructor '${trimmed}' not found.`);
		}
		const ctor = ctorUnknown as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
		if (!(ctor.prototype instanceof WorldObject)) {
			throw new Error(`[BmsxConsoleRuntime] Constructor '${trimmed}' does not extend WorldObject.`);
		}
		return ctor;
	}

	private resolveConstructorReference(ref: string): unknown {
		if (!ref) {
			return undefined;
		}
		const constructors = Reviver.constructors;
		if (constructors && Object.prototype.hasOwnProperty.call(constructors, ref)) {
			return constructors[ref];
		}
		const globalScope = globalThis as Record<string, unknown>;
		if (globalScope && typeof globalScope[ref] === 'function') {
			return globalScope[ref];
		}
		return undefined;
	}

	private normalizeLuaIdentifier<T extends string = string>(value: unknown, context: string): T {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				return trimmed as T;
			}
		}
		throw new Error(`[BmsxConsoleRuntime] ${context} requires a non-empty id.`);
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
		const moduleId = this.moduleIdFor('other', this.currentLuaAssetContext?.asset_id ?? null, this.luaChunkName ?? null);
		const baseCtx = this.ensureMarshalContext({ moduleId, interpreter, path: [] });
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaValueToJs(results[i], this.extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private invokeLuaHandler(fn: LuaFunctionValue, interpreter: LuaInterpreter, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs: unknown[] = [];
		if (thisArg !== undefined) {
			callArgs.push(thisArg);
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		const results = this.callLuaFunctionWithInterpreter(fn, callArgs, interpreter);
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
		const interpreter = this.requireLuaInterpreter();
		const moduleId = this.luaChunkName ?? 'lua::runtime';
		return {
			moduleId,
			interpreter,
			path: [],
		};
	}

	private extendMarshalContext(ctx: LuaMarshalContext, segment: string): LuaMarshalContext {
		if (!segment) {
			return ctx;
		}
		return {
			moduleId: ctx.moduleId,
			interpreter: ctx.interpreter,
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
		category: 'fsm' | 'behavior_tree' | 'service' | 'component' | 'effect' | 'worldobject' | 'other',
		asset_id?: string | null,
		chunkName?: string | null,
	): string {
		const trimmedChunk = (chunkName ?? '').trim();
		const trimmedAsset = (asset_id ?? '').trim();
		let raw: string;
		if (trimmedChunk.length > 0) {
			// Important: effect handlers must not share the plain chunk module id to avoid
			// being swapped out by generic hot-reload when the script does not export symbols.
			// Prefix effect handlers with a distinct namespace.
			raw = category === 'effect' ? `${category}/${trimmedChunk}` : trimmedChunk;
		}
		else if (trimmedAsset.length > 0) {
			raw = `${category}/${trimmedAsset}`;
		}
		else {
			raw = category;
			if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
				try {
					console.warn(`[HotReload] moduleIdFor('${category}') invoked without asset_id or chunkName; defaulting to '${raw}'. This may cause collisions.`);
				}
				catch {
					// ignore logging failures
				}
			}
		}
		return this.normalizeChunkName(raw);
	}

	private resolveApiMethodMarshalCategory(name: string): 'fsm' | 'behavior_tree' | 'service' | 'component' | 'effect' | 'worldobject' | 'other' {
		switch (name) {
			case 'register_fsm':
				return 'fsm';
			case 'register_behavior_tree':
				return 'behavior_tree';
			case 'register_service':
				return 'service';
			case 'define_component':
			case 'register_component':
			case 'define_component_preset':
			case 'register_component_preset':
				return 'component';
			case 'define_effect':
			case 'register_effect':
				return 'effect';
			case 'register_worldobject':
				return 'worldobject';
			default:
				return 'other';
		}
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

	private exposeEngineObjects(env: LuaEnvironment, interpreter: LuaInterpreter): void {
		const rompackView = this.buildLuaRompackView();
		const entries: Array<[string, unknown]> = [
			['world', $.world],
			['game', $],
			['registry', $.registry],
			['events', $.event_emitter],
			['rompack', rompackView],
		];
		for (const [name, object] of entries) {
			if (object === undefined || object === null) {
				continue;
			}
			const luaValue = this.jsToLua(object, interpreter);
			this.registerLuaGlobal(env, name, luaValue);
		}
	}

	private buildLuaRompackView(): Record<string, unknown> | null {
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
			caseInsensitiveLua: rompack.caseInsensitiveLua ?? null,
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
			switch (key) {
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
		if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		if (this.isLuaFunctionValue(value)) {
			return this.luaHandlerCache.getOrCreate(value, {
				moduleId: marshalCtx.moduleId,
				path: marshalCtx.path.slice(),
				interpreter: marshalCtx.interpreter,
			});
		}
		if (isLuaNativeValue(value)) {
			return value.native;
		}
		if (isLuaTable(value)) {
			const entries = value.entriesArray();
			if (entries.length === 0) {
				return {};
			}
			const arrayValues: unknown[] = [];
			const objectValues: Record<string, unknown> = {};
			let sequentialCount = 0;
			let processedEntries = 0;
			for (const [key, entryValue] of entries) {
				processedEntries += 1;
				const segment = this.describeMarshalSegment(key);
				const converted = this.luaValueToJs(entryValue, segment ? this.extendMarshalContext(marshalCtx, segment) : marshalCtx);
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
		if (isLuaNativeValue(value)) {
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
			if (this.isPlainObject(value)) {
				const record = value as Record<string, unknown>;
				if ('__native__' in record) {
					const decoded = this.snapshotDecodeNative(record);
					if (decoded) {
						return this.wrapNativeValue(decoded, ensured);
					}
					return null;
				}
				if (record.__bmsx_table__ === 'map' && Array.isArray(record.entries)) {
					const entries = record.entries as Array<{ key: unknown; value: unknown }>;
					const table = createLuaTable();
					for (const entry of entries) {
						const keyValue = this.deserializeLuaSnapshotKey(entry.key, ensured);
						if (keyValue === undefined || keyValue === null) {
							continue;
						}
						const valueValue = this.jsToLua(entry.value, ensured);
						table.set(keyValue, valueValue);
					}
					return table;
				}
				const table = createLuaTable();
				for (const [prop, entry] of Object.entries(record)) {
					table.set(prop, this.jsToLua(entry, ensured));
				}
				return table;
			}
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
			return this.wrapNativeValue(value as object, ensured);
		}
		if (typeof value === 'function') {
			if (isLuaHandlerFn(value)) {
				const binding = this.luaHandlerCache.unwrap(value);
				if (binding) {
					return binding.fn;
				}
			}
			const ensured = this.ensureInterpreter(interpreter);
			return this.wrapNativeValue(value, ensured);
		}
		return null;
	}

	private wrapNativeValue(value: object | Function, interpreter: LuaInterpreter): LuaNativeValue {
		return interpreter.getOrCreateNativeValue(value, this.resolveNativeTypeName(value));
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

	private getLuaProgramSource(program: BmsxConsoleLuaProgram): string {
		if (this.luaProgramSourceOverride !== null) {
			return this.luaProgramSourceOverride;
		}
		return this.resolveLuaProgramSource(program);
	}

	private resolveLuaSourcePath(program: BmsxConsoleLuaProgram): string | null {
		if ('asset_id' in program) {
			return $.rompack.luaSourcePaths[program.asset_id] ?? null;
		}
		return null;
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
		if (this.hasWorkspaceLuaOverrides) {
			return;
		}
		const program = this.luaProgram!;
		const path = this.resolveLuaSourcePath(program)!;
		const fetched = await this.fetchLuaSourceFromFilesystem(path);
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
			throw this.normalizeError(error);
		}
	}

	private resolveLuaProgramSource(program: BmsxConsoleLuaProgram): string {
		if (program.overrideSource !== undefined && program.overrideSource !== null) {
			return program.overrideSource;
		}
		if (program.source !== undefined && program.source !== null) {
			return program.source;
		}
		return $.rompack.lua[program.asset_id];
	}

	private applyProgramSourceToCartridge(source: string, chunkName: string): void {
		const program = this.luaProgram!;
		if (program.source !== undefined && program.source !== null) {
			const mutable = program as typeof program & { source: string; chunkName: string };
			mutable.source = source;
			mutable.chunkName = chunkName;
			this.registerProgramChunk(mutable, chunkName);
			return;
		}
		const cartridge = this.cart as { luaProgram?: BmsxConsoleLuaProgram };
		const updated: BmsxConsoleLuaProgram = {
			asset_id: program.asset_id,
			overrideSource: source,
			chunkName,
			entry: program.entry,
			source: program.source,
			main: program.main,
		};
		cartridge.luaProgram = updated;
		this.luaProgram = updated;
		this.registerProgramChunk(updated, chunkName);
	}

	private canonicalizeProgramChunkName(program: BmsxConsoleLuaProgram, chunkName: string | null | undefined): string {
		let candidate: string;
		if (typeof chunkName === 'string' && chunkName.length > 0) {
			candidate = chunkName;
		}
		else if ('asset_id' in program && typeof program.asset_id === 'string' && program.asset_id.length > 0) {
			candidate = program.asset_id;
		}
		else {
			return 'bmsx-lua';
		}
		if (!('asset_id' in program) || typeof program.asset_id !== 'string' || program.asset_id.length === 0) {
			return candidate;
		}
		const normalizedCandidate = this.normalizeChunkName(candidate);
		const normalizedAsset = this.normalizeChunkName(program.asset_id);
		const resolvedPath = this.resolveResourcePath(program.asset_id);
		if (typeof resolvedPath === 'string' && resolvedPath.length > 0) {
			const normalizedPath = this.normalizeChunkName(resolvedPath);
			if (normalizedCandidate === normalizedAsset || normalizedCandidate === normalizedPath) {
				return `@${resolvedPath}`;
			}
		}
		else if (normalizedCandidate === normalizedAsset) {
			return `@lua/${program.asset_id}`;
		}
		return candidate;
	}

	private resolveLuaProgramChunkName(program: BmsxConsoleLuaProgram): string {
		return this.canonicalizeProgramChunkName(program, program.chunkName);
	}

	private registerProgramChunk(program: BmsxConsoleLuaProgram, chunkName: string): void {
		let asset_id: string | null = null;
		let resolvedPath: string | null = null;
		if ('asset_id' in program && program.asset_id) {
			asset_id = program.asset_id;
			resolvedPath = this.resolveResourcePath(program.asset_id);
		}
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

	private resolveLuaModuleChunkName(asset_id: string, sourcePath: string | null): string {
		const category = this.resolveLuaHotReloadCategory(asset_id);
		switch (category) {
			case 'fsm':
				return this.resolveLuaFsmChunkName(asset_id, sourcePath);
			case 'behavior_tree':
				return this.resolveLuaBehaviorTreeChunkName(asset_id, sourcePath);
			case 'service':
				return this.resolveLuaServiceChunkName(asset_id, sourcePath);
			case 'component_preset':
				return this.resolveLuaComponentPresetChunkName(asset_id, sourcePath);
			case 'worldobject':
				return this.resolveLuaWorldObjectChunkName(asset_id, sourcePath);
			default:
				if (sourcePath && sourcePath.length > 0) {
					return `@${sourcePath}`;
				}
				return `@lua/${asset_id}`;
		}
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

	private cacheChunkEnvironment(interpreter: LuaInterpreter, chunkName: string, asset_id: string | null): void {
		const environment = interpreter.getChunkEnvironment();
		if (!environment) {
			return;
		}
		const normalizedChunk = this.normalizeChunkName(chunkName);
		this.pruneRemovedChunkFunctionExports(
			normalizedChunk,
			environment,
			interpreter.getChunkDefinitions(chunkName),
			interpreter.getGlobalEnvironment(),
		);
		this.luaChunkEnvironmentsByChunkName.set(normalizedChunk, environment);
		if (asset_id && asset_id.length > 0) {
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
			const record: LuaRequireModuleRecord = {
				packageKey: canonicalPath,
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
			throw this.createApiRuntimeError(interpreter, `require(moduleName) received an invalid module name '${moduleName}'.`);
		}
		const record = this.luaModuleAliases.get(aliasKey);
		if (!record) {
			throw this.createApiRuntimeError(interpreter, `Module '${moduleName}' not found.`);
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
		const previousAssetContext = this.currentLuaAssetContext;
		const previousChunkName = this.luaChunkName;
		this.currentLuaAssetContext = { category: 'other', asset_id: record.asset_id };
		this.luaChunkName = record.chunkName;
		try {
			const results = interpreter.execute(source, record.chunkName);
			this.cacheChunkEnvironment(interpreter, record.chunkName, record.asset_id);
			const moduleValue = results.length > 0 && results[0] !== null ? results[0] : true;
			packageLoaded.set(record.packageKey, moduleValue);
			return moduleValue;
		}
		catch (error) {
			packageLoaded.delete(record.packageKey);
			if (this.isLuaError(error)) {
				throw error;
			}
			const message = this.extractErrorMessage(error);
			throw this.createApiRuntimeError(interpreter, message);
		}
		finally {
			this.luaModuleLoadingKeys.delete(record.packageKey);
			this.luaChunkName = previousChunkName;
			this.currentLuaAssetContext = previousAssetContext;
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

	private lookupChunkResourceInfoNullable(chunkName: string | null): { asset_id: string | null; path?: string | null } | null {
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
		if (overrides.size === 0) {
			return;
		}
		this.applyWorkspaceLuaOverrides(overrides, hotReload);
	}

	private applyWorkspaceLuaOverrides(overrides: Map<string, WorkspaceOverrideRecord>, hotReload: boolean): void {
		const rompack = $.rompack;
		let updated = false;
		let mainUpdated = false;
		const mainAssetId = this.luaProgram && this.luaProgram.main === true ? this.luaProgram.asset_id : null;
		for (const [asset_id, record] of overrides) {
			const { source, path, cartPath } = record;
			this.workspaceLuaOverrides.set(asset_id, { source, path, cartPath });
			if (rompack.lua[asset_id] !== source) {
				rompack.lua[asset_id] = source;
				updated = true;
				if (mainAssetId && asset_id === mainAssetId) {
					this.luaProgramSourceOverride = source;
					mainUpdated = true;
				}
			}
		}
		this.hasWorkspaceLuaOverrides = this.workspaceLuaOverrides.size > 0;
		this.luaGenericAssetsExecuted.clear();
		if (!updated || !hotReload) {
			return;
		}
		if (mainUpdated && this.luaProgram) {
			const chunkName = this.resolveLuaProgramChunkName(this.luaProgram);
			const source = this.luaProgramSourceOverride ?? this.resolveLuaProgramSource(this.luaProgram);
			this.reloadLuaProgramState(source, chunkName, source);
			return;
		}
		this.processPendingLuaAssets('workspace:dirty');
	}

	private async applyServerWorkspaceDirtyLuaOverrides(): Promise<void> {
		const token = this.workspaceOverrideToken;
		const root = this.resolveCartProjectRootPath();
		if (!root) {
			return;
		}
		const overrides = await this.fetchWorkspaceDirtyLuaOverrides(root);
		if (token !== this.workspaceOverrideToken) {
			return;
		}
		if (overrides.size === 0) {
			return;
		}
		this.applyWorkspaceLuaOverrides(overrides, true);
	}

	public refreshWorkspaceOverrides(hotReload: boolean): void {
		this.applyLocalWorkspaceDirtyLuaOverrides(hotReload);
	}

	private async fetchWorkspaceDirtyLuaOverrides(root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
		const rompack = $.rompack;
		const tasks: Array<Promise<{ asset_id: string; contents: string; path: string | null; cartPath: string } | null>> = [];
		for (const [asset_id, cartPath] of Object.entries(rompack.luaSourcePaths)) {
			if (typeof cartPath !== 'string' || cartPath.length === 0) {
				continue;
			}
			const workspacePath = this.resolveFilesystemPathForCartPath(cartPath);
			const dirtyPath = buildWorkspaceDirtyEntryPath(root, workspacePath);
			tasks.push(this.fetchWorkspaceFile(dirtyPath).then((contents) => {
				if (contents === null) {
					return null;
				}
				return { asset_id, contents, path: dirtyPath, cartPath: workspacePath };
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
			overrides.set(result.asset_id, { source: result.contents, path: result.path, cartPath: result.cartPath });
		}
		return overrides;
	}

	private async fetchWorkspaceFile(path: string): Promise<string | null> {
		if (typeof fetch !== 'function') {
			return null;
		}
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
		let response: HttpResponse;
		try {
			response = await fetch(url, { method: 'GET', cache: 'no-store' });
		} catch {
			return null;
		}
		if (!response.ok) {
			return null;
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return null;
		}
		if (!payload || typeof payload !== 'object') {
			return null;
		}
		const record = payload as { contents?: unknown };
		if (typeof record.contents !== 'string') {
			return null;
		}
		return record.contents;
	}

	private async deleteWorkspaceFile(path: string): Promise<void> {
		if (typeof fetch !== 'function') {
			return;
		}
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
		try {
			await fetch(url, { method: 'DELETE' });
		} catch {
			return;
		}
	}

	public clearWorkspaceLuaOverrides(): void {
		this.workspaceOverrideToken = this.workspaceOverrideToken + 1;
		const rompack = $.rompack;
		let mainSource: string | null = null;
		const programasset_id = this.luaProgram && 'asset_id' in this.luaProgram ? this.luaProgram.asset_id : null;
		for (const [asset_id, source] of this.rompackOriginalLua) {
			rompack.lua[asset_id] = source;
			if (programasset_id && asset_id === programasset_id) {
				mainSource = source;
			}
		}
		this.luaProgramSourceOverride = null;
		this.hasWorkspaceLuaOverrides = false;
		this.luaGenericAssetsExecuted.clear();
		this.workspaceLuaOverrides.clear();
		const root = this.resolveCartProjectRootPath();
		if (root) {
			for (const cartPath of Object.values(rompack.luaSourcePaths)) {
				if (typeof cartPath !== 'string' || cartPath.length === 0) {
					continue;
				}
				const workspacePath = this.resolveFilesystemPathForCartPath(cartPath);
				const dirtyPath = buildWorkspaceDirtyEntryPath(root, workspacePath);
				const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
				this.storageService.removeItem(storageKey);
				void this.deleteWorkspaceFile(dirtyPath);
			}
			const statePath = buildWorkspaceStateFilePath(root);
			const stateKey = buildWorkspaceStorageKey(root, statePath);
			this.storageService.removeItem(stateKey);
			void this.deleteWorkspaceFile(statePath);
		}
		if (!this.luaInterpreter || !this.luaProgram || mainSource === null) {
			return;
		}
		const chunkName = this.resolveLuaProgramChunkName(this.luaProgram);
		this.reloadLuaProgramState(mainSource, chunkName, mainSource);
		this.processPendingLuaAssets('workspace:reset');
	}

	public nukeWorkspace(): void {
		this.clearWorkspaceLuaOverrides();
		this.workspaceLuaOverrides.clear();
		this.hasWorkspaceLuaOverrides = false;
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
			if ('asset_id' in program && typeof program.asset_id === 'string') {
				return program.asset_id;
			}
			return null;
		})();

		for (const descriptor of descriptors) {
			let asset_id = descriptor.asset_id ?? null;
			if (!asset_id) {
				asset_id = this.findasset_idForPath(descriptor.path);
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
			const programChunk = this.normalizeChunkName(this.resolveLuaProgramChunkName(program));
			const programInfo: { asset_id: string | null; path?: string | null } = 'asset_id' in program && typeof program.asset_id === 'string'
				? { asset_id: program.asset_id, path: this.resolveResourcePath(program.asset_id) ?? undefined }
				: { asset_id: null, path: programChunk };
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
		const interpreter = this.requireLuaInterpreter();
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

	private resolveLuaChainValue(parts: string[], asset_id: string | null): ({ kind: 'value'; value: LuaValue; scope: ConsoleLuaHoverScope; definitionRange: LuaSourceRange | null } | { kind: 'not_defined'; scope: ConsoleLuaHoverScope }) | null {
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

	private refreshLuaHandlersForChunk(chunkName: string, _sourceOverride?: string | null): void {
		const normalized = this.normalizeChunkName(chunkName);
		const resourceInfo = this.lookupChunkResourceInfo(normalized) ?? { asset_id: null };
		const asset_id = resourceInfo.asset_id ?? null;
		if (!asset_id) {
			return;
		}
		this.luaGenericAssetsExecuted.delete(asset_id);
		const category = this.resolveLuaHotReloadCategory(asset_id);
		if (!category) {
			return;
		}
		this.registerLuaChunkResource(chunkName, resourceInfo);
		const interpreter = this.requireLuaInterpreter();
		switch (category) {
			case 'fsm':
				this.loadLuaStateMachineScripts(interpreter);
				break;
			case 'behavior_tree':
				this.loadLuaBehaviorTreeScripts(interpreter);
				break;
			case 'service':
				this.loadLuaServiceScripts(interpreter);
				break;
			case 'component_preset':
				this.loadLuaComponentPresetScripts(interpreter);
				break;
			case 'worldobject':
				this.loadLuaWorldObjectDefinitionScripts(interpreter);
				break;
			default:
				break;
		}
		this.clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}
}
