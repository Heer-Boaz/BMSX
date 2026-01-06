import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Input } from '../input/input';
import { KeyModifier } from '../input/playerinput';
import type { InputMap } from '../input/inputtypes';
import type { LuaChunk, LuaDefinitionInfo } from '../lua/lua_ast';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import { LuaHandlerCache, isLuaHandlerFunction } from '../lua/luahandler_cache';
import { LuaInterpreter, type ExecutionSignal, type LuaCallFrame } from '../lua/luaruntime';
import type { LuaFunctionValue, LuaValue, StackTraceFrame } from '../lua/luavalue';
import {
	convertToError,
	extractErrorMessage,
	isLuaDebuggerPauseSignal,
	isLuaFunctionValue,
	isLuaTable,
	setLuaTableCaseInsensitiveKeys,
	type LuaDebuggerPauseSignal
} from '../lua/luavalue';
import type { StorageService } from '../platform/platform';
import { publishOverlayFrame } from '../render/editor/editor_overlay_queue';
import type { Viewport, BmsxCartridgeBlob, CartridgeIndex } from '../rompack/rompack';
import { CanonicalizationType } from '../rompack/rompack';
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { applyRuntimeAssetLayer, buildRuntimeAssetLayer } from '../rompack/romloader';
import { decodeuint8arr } from '../serializer/binencoder';
import { createIdentifierCanonicalizer } from '../utils/identifier_canonicalizer';
import { clamp01, clamp_fallback } from '../utils/clamp';
import { BmsxVMApi } from './vm_api';
import { VMCPU, Table, OpCode, type Closure, type Value, type Program, type ProgramMetadata, RunResult, createNativeFunction, createNativeObject, isNativeFunction, isNativeObject, type NativeFunction, type NativeObject } from './cpu';
import { StringValue, isStringValue, stringValueToString } from './string_pool';
import { TerminalMode } from './terminal_mode';
import { VMRenderFacade } from './vm_render_facade';
import { VMFont, type VMFontVariant } from './font';
import { createVMCartEditor, getSourceForChunk, type VMCartEditor, setExecutionStopHighlight, clearExecutionStopHighlights, } from './ide/vm_cart_editor';
import { VM_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from './ide/constants';
import { clearNativeMemberCompletionCache } from './ide/intellisense';
import { type FaultSnapshot } from './ide/render/render_error_overlay';
import { type LuaSemanticModel, type FileSemanticData } from './ide/semantic_model';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import type { RuntimeErrorDetails } from './ide/types';
import { ENGINE_LUA_BUILTIN_FUNCTIONS, registerApiBuiltins, seedDefaultLuaBuiltins } from './lua_builtins';
import { LuaFunctionRedirectCache } from './lua_handler_registry';
import { LuaEntrySnapshot, LuaJsBridge } from './lua_js_bridge';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	parseJsStackFrames,
	sanitizeLuaErrorMessage
} from './runtime_error_util';
import { BmsxVMStorage } from './storage';
import type { BmsxVMRuntimeOptions, BmsxVMState, VMLuaBuiltinDescriptor, VMLuaMemberCompletion, LuaMarshalContext } from './types';
import { getWorkspaceCachedSource } from './workspace_cache';
import { applyWorkspaceOverridesToCart } from './workspace';
import type { LuaSourceRecord, LuaSourceRegistry } from './lua_sources';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../lua/luadebugger';
import { ide_state } from './ide/ide_state';
import { getBasePipelineSpecOverrideForIdeOrTerminal, ideExtSpec, terminalExtSpec, vmExtSpec } from './vm_systems';
import type { ParsedLuaChunk } from './ide/lua_parse';
import { RenderSubmission } from '../render/backend/pipeline_interfaces';
import { Msx1Colors } from '../systems/msx';
import type { RectRenderSubmission } from '../render/shared/render_types';
import { compileLuaChunkToProgram, appendLuaChunkToProgram } from './program_compiler';
import { IO_ARG0_OFFSET, IO_BUFFER_BASE, IO_COMMAND_STRIDE, IO_CMD_PRINT, IO_SYS_BOOT_CART, IO_SYS_CART_PRESENT, IO_WRITE_PTR_ADDR, VM_IO_MEMORY_SIZE } from './vm_io';
import { VmHandlerCache } from './vm_handler_cache';
import {
	buildModuleAliasMap,
	buildModuleAliasesFromPaths,
	buildModuleProtoMap,
	decodeProgramAsset,
	decodeProgramSymbolsAsset,
	inflateProgram,
	VM_PROGRAM_ASSET_ID,
	VM_PROGRAM_SYMBOLS_ASSET_ID,
	type VmProgramAsset,
	type VmProgramSymbolsAsset,
} from './vm_program_asset';
import { INSTRUCTION_BYTES, readInstructionWord } from './instruction_format';

export const VM_BUTTON_ACTIONS: ReadonlyArray<string> = [
	'left',
	'right',
	'up',
	'down',
	'b',
	'a',
	'x',
	'y',
	'start',
	'select',
	'rt',
	'lt',
	'rb',
	'lb',
];

// Flip back to 'msx' to restore default font in vm/editor
export const EDITOR_FONT_VARIANT: VMFontVariant = 'tiny';

type VMFrameState = {
	haltGame: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	deltaSeconds: number;
};

class DebugPauseCoordinator {
	private suspension: LuaDebuggerPauseSignal = null;
	private pendingException: LuaRuntimeError | LuaError = null;

	public capture(suspension: LuaDebuggerPauseSignal, pendingException: LuaRuntimeError | LuaError): void {
		this.suspension = suspension;
		this.pendingException = pendingException;
	}

	public hasSuspension(): boolean {
		return this.suspension !== null;
	}

	public getSuspension(): LuaDebuggerPauseSignal {
		return this.suspension;
	}

	public getPendingException(): LuaRuntimeError | LuaError {
		return this.pendingException;
	}

	public clearSuspension(): void {
		this.suspension = null;
		this.pendingException = null;
	}
}

type DebuggerStepOrigin = { path: string; line: number; depth: number };
type VmProgramSource = 'engine' | 'cart';

export var api: BmsxVMApi; // Initialized in BmsxVMRuntime constructor


export class BmsxVMRuntime {
	private static _instance: BmsxVMRuntime = null;
	private static readonly ENGINE_BUILTIN_PRELUDE_PATH = '__engine_builtin_prelude__';
	private static readonly LUA_SNAPSHOT_EXCLUDED_GLOBALS = new Set<string>(['print', 'type', 'tostring', 'tonumber', 'setmetatable', 'getmetatable', 'require', 'pairs', 'ipairs', 'serialize', 'deserialize', 'math', 'easing', 'string', 'os', 'table', 'coroutine', 'debug', 'package', 'api', 'peek', 'poke', 'SYS_CART_PRESENT', 'SYS_BOOT_CART',
	]);
	/**
	 * Preserved render queue when a fault occurs
	 * This is used to restore the render queue to its previous state
	 * so that the console mode can be drawn on top of it.
	 */
	private preservedRenderQueue: RenderSubmission[] = [];

	public static createInstance(options: BmsxVMRuntimeOptions): BmsxVMRuntime {
		const existing = BmsxVMRuntime._instance;
		if (existing) {
			throw new Error('[BmsxVMRuntime] Instance already exists.');
		}
		return new BmsxVMRuntime(options);
	}

	public static async init(cartridge?: BmsxCartridgeBlob): Promise<void> {
		const engineLayer = $.engineLayer;
		const playerIndex = Input.instance.startupGamepadIndex ?? 1;
		$.view.default_font = new VMFont();

		const engineSource = new AssetSourceStack([{ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload }]);
		const engineLuaSources = BmsxVMRuntime.buildLuaSources({
			cartSource: engineSource,
			assetSource: engineSource,
			index: engineLayer.index,
		});

		if (!cartridge) {
			$.setLuaSources(engineLuaSources);
			const runtime = BmsxVMRuntime.createInstance({
				playerIndex,
				canonicalization: engineLayer.index.manifest.vm.canonicalization,
				viewport: engineLayer.index.manifest.vm.viewport,
			});
			runtime.configureProgramSources({
				engineSources: engineLuaSources,
				engineAssetSource: engineSource,
				engineCanonicalization: engineLayer.index.manifest.vm.canonicalization,
			});
			await runtime.boot();
			$.start();
			return;
		}

		const cartLayer = await buildRuntimeAssetLayer({ blob: cartridge, id: 'cart' });
		applyRuntimeAssetLayer($.assets, cartLayer);
		const overlayBlob = $.workspaceOverlay;
		const overlayLayer = overlayBlob ? await buildRuntimeAssetLayer({ blob: overlayBlob, id: 'overlay' }) : null;
		if (overlayLayer) {
			applyRuntimeAssetLayer($.assets, overlayLayer);
		}
		const layers = [];
		if (overlayLayer) {
			layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
		}
		layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
		layers.push({ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload });
		const assetSource = new AssetSourceStack(layers);
		$.setAssetSource(assetSource);
		await $.refreshAudioAssets();
		$.view.primaryAtlas = 0;
		$.assets.project_root_path = cartLayer.index.projectRootPath;

		const cartSource = new AssetSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = BmsxVMRuntime.buildLuaSources({
			cartSource,
			assetSource,
			index: cartLayer.index,
		});

		const inputMappingPerPlayer = cartLayer.index.manifest.input ?? { 1: { keyboard: null, gamepad: null, pointer: null } as InputMap };
		for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
			const mappedIndex = parseInt(playerIndexStr, 10);
			const inputMapping = inputMappingPerPlayer[mappedIndex];
			$.set_inputmap(mappedIndex, inputMapping);
		}

		await applyWorkspaceOverridesToCart({ cart: cartLuaSources, storage: $.platform.storage, includeServer: true });
		$.setLuaSources(engineLuaSources);

		const runtime = BmsxVMRuntime.createInstance({
			playerIndex,
			canonicalization: engineLayer.index.manifest.vm.canonicalization,
			viewport: cartLayer.index.manifest.vm.viewport,
		});
		runtime.configureProgramSources({
			engineSources: engineLuaSources,
			cartSources: cartLuaSources,
			engineAssetSource: engineSource,
			cartAssetSource: cartSource,
			engineCanonicalization: engineLayer.index.manifest.vm.canonicalization,
			cartCanonicalization: cartLayer.index.manifest.vm.canonicalization,
		});
		await runtime.boot();
		$.start();
	}

	private static buildLuaSources(params: { cartSource: RawAssetSource; assetSource: RawAssetSource; index: CartridgeIndex }): LuaSourceRegistry {
		const { cartSource, assetSource, index } = params;
		const registry: LuaSourceRegistry = {
			path2lua: {},
			entry_path: index.manifest.lua.entry_path,
			namespace: index.manifest.vm.namespace,
		};

		for (const asset of index.assets) {
			if (asset.type !== 'lua') {
				continue;
			}
			const baseEntry = cartSource.getEntry(asset.resid);
			if (!baseEntry) {
				continue;
			}
			const activeEntry = assetSource.getEntry(asset.resid);
			if (!activeEntry) {
				continue;
			}
			const baseSrc = decodeuint8arr(cartSource.getBytes(baseEntry));
			const src = decodeuint8arr(assetSource.getBytes(activeEntry));
			const luaAsset: LuaSourceRecord = {
				...activeEntry,
				src,
				base_src: baseSrc,
				update_timestamp: activeEntry.update_timestamp,
			};
			registry.path2lua[luaAsset.source_path] = luaAsset;
			registry.path2lua[luaAsset.normalized_source_path] = luaAsset;
		}

		if (Object.keys(registry.path2lua).length === 0) {
			const entryPath = index.manifest.lua.entry_path;
			const hasProgramAsset = index.assets.some(asset => asset.resid === VM_PROGRAM_ASSET_ID);
			if (hasProgramAsset) {
				const stub: LuaSourceRecord = {
					resid: entryPath,
					type: 'lua',
					src: '',
					base_src: '',
					source_path: entryPath,
					normalized_source_path: entryPath,
					update_timestamp: 0,
				};
				registry.path2lua[stub.source_path] = stub;
				registry.path2lua[stub.normalized_source_path] = stub;
			}
		}

		return registry;
	}

	public static get instance(): BmsxVMRuntime {
		return BmsxVMRuntime._instance!;
	}

	public static destroy(): void {
		// No defense against multiple calls; let it throw if misused.
		BmsxVMRuntime._instance.dispose();
		BmsxVMRuntime._instance = null;
	}

	public setCartEntryAvailable(value: boolean): void {
		this.cartEntryAvailable = value;
	}

	private configureProgramSources(params: {
		engineSources: LuaSourceRegistry;
		cartSources?: LuaSourceRegistry;
		engineAssetSource: RawAssetSource;
		cartAssetSource?: RawAssetSource;
		engineCanonicalization: CanonicalizationType;
		cartCanonicalization?: CanonicalizationType;
	}): void {
		this.engineLuaSources = params.engineSources;
		this.cartLuaSources = params.cartSources ?? null;
		this.engineAssetSource = params.engineAssetSource;
		this.cartAssetSource = params.cartAssetSource ?? null;
		this.engineCanonicalization = params.engineCanonicalization;
		this.cartCanonicalization = params.cartCanonicalization ?? params.engineCanonicalization;
		this.pendingCartBoot = false;
	}

	private activateProgramSource(source: VmProgramSource): void {
		const luaSources = source === 'engine' ? this.engineLuaSources : this.cartLuaSources;
		const canonicalization = source === 'engine' ? this.engineCanonicalization : this.cartCanonicalization;
		$.setLuaSources(luaSources);
		this.applyCanonicalization(canonicalization);
		api.cartdata(luaSources.namespace);
	}

	private requestCartBoot(): void {
		this.pendingCartBoot = true;
	}

	public readonly storage: BmsxVMStorage;
	public readonly storageService: StorageService;
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, VMLuaBuiltinDescriptor>();
	private _activeIdeFontVariant: VMFontVariant = EDITOR_FONT_VARIANT;
	public playerIndex: number;
	public tickEnabled: boolean = true;
	public editor!: VMCartEditor;
	private readonly overlayRenderBackend = new VMRenderFacade();
	public readonly terminal!: TerminalMode;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	private readonly debuggerController = new LuaDebuggerController();
	private readonly pauseCoordinator = new DebugPauseCoordinator();
	public debuggerSuspendSignal: LuaDebuggerPauseSignal = null;
	private debuggerPaused = false;
	private debuggerMetrics: LuaDebuggerSessionMetrics = null;
	private lastIdeInputFrame = -1;
	private lastTerminalInputFrame = -1;
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderBackend.setRenderingViewportType(value);
		this.editor.updateViewport(this.overlayRenderBackend.viewportSize);
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderBackend.viewportSize;
	}

	private shortcutDisposers: Array<() => void> = [];
	private luaInterpreter!: LuaInterpreter;
	private static readonly UPDATE_STATEMENT_BUDGET = 1_000_000;
	private vmInitClosure: Closure = null;
	private vmNewGameClosure: Closure = null;
	private vmUpdateClosure: Closure = null;
	private vmDrawClosure: Closure = null;
	private pendingVmCall: 'update' | 'draw' = null;
	private pendingProgramReload: { runInit?: boolean } = null;
	private readonly cpuMemory: Value[];
	private readonly cpu: VMCPU;
	private vmProgramMetadata: ProgramMetadata | null = null;
	private vmConsoleMetadata: ProgramMetadata | null = null;
	private _luaPath: string = null;
	public get currentPath(): string {
		return this._luaPath;
	}
	private luaVmInitialized = false;
	public get isVmInitialized(): boolean {
		return this.luaVmInitialized;
	}
	private luaRuntimeFailed = false;
	public get hasRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	private includeJsStackTraces = false;
	private currentFrameState: VMFrameState = null;
	private pendingLuaWarnings: string[] = [];
	public readonly vmModuleAliases: Map<string, string> = new Map();
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	public readonly pathFunctionDefinitionKeys: Map<string, Set<string>> = new Map();
	private readonly luaGenericChunksExecuted: Set<string> = new Set();
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-reload.
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	private readonly vmHandlerCache = new VmHandlerCache(
		(fn, thisArg, args) => this.invokeVmHandler(fn, thisArg, args),
		(error, meta) => this.handleVmHandlerError(error, meta),
	);
	private readonly vmModuleProtos = new Map<string, number>();
	private readonly vmModuleCache = new Map<string, Value>();
	private readonly nativeObjectCache = new WeakMap<object, NativeObject>();
	private readonly nativeFunctionCache = new WeakMap<Function, NativeFunction>();
	private readonly nativeMemberCache = new WeakMap<object, Map<string, NativeFunction>>();
	private readonly vmTableIds = new WeakMap<Table, number>();
	private nextVmTableId = 1;
	private vmRandomSeedValue = 0;
	public nativeMemberCompletionCache: WeakMap<object, { dot?: VMLuaMemberCompletion[]; colon?: VMLuaMemberCompletion[] }> = new WeakMap();
	public readonly pathSemanticCache: Map<string, { source: string; model: LuaSemanticModel; definitions: ReadonlyArray<LuaDefinitionInfo>; parsed?: ParsedLuaChunk; lines?: readonly string[]; analysis?: FileSemanticData }> = new Map();

	private readonly luaVmGate = taskGate.group('console:lua_vm');
	private handledLuaErrors = new WeakSet<any>();
	private lastVmCallStack: StackTraceFrame[] = [];
	public faultSnapshot: FaultSnapshot = null;
	private faultOverlayNeedsFlush = false;
	public get doesFaultOverlayNeedFlush(): boolean {
		return this.faultOverlayNeedsFlush;
	}
	public flushedFaultOverlay(): void {
		this.faultOverlayNeedsFlush = false;
	}
	private hasCompletedInitialBoot = false;
	private cartEntryAvailable = true;
	private pendingCartBoot = false;
	private engineLuaSources: LuaSourceRegistry = null;
	private cartLuaSources: LuaSourceRegistry = null;
	private engineAssetSource: RawAssetSource = null;
	private cartAssetSource: RawAssetSource = null;
	private engineCanonicalization: CanonicalizationType = null;
	private cartCanonicalization: CanonicalizationType = null;
	private _canonicalization: CanonicalizationType;
	private canonicalizeIdentifierFn: (value: string) => string;
	public get canonicalization(): CanonicalizationType {
		return this._canonicalization;
	}
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}
	public get hasProgramSymbols(): boolean {
		return this.vmProgramMetadata !== null;
	}

	private constructor(options: BmsxVMRuntimeOptions) {
		BmsxVMRuntime._instance = this;
		this.playerIndex = options.playerIndex;
		this.storageService = $.platform.storage;
		this.storage = new BmsxVMStorage(this.storageService, $.luaSources.namespace);
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this.applyCanonicalization(resolvedCanonicalization);
		this.engineLuaSources = $.luaSources;
		this.engineCanonicalization = resolvedCanonicalization;
		this.cartCanonicalization = resolvedCanonicalization;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.terminal = new TerminalMode(this);
		this.cpuMemory = new Array<Value>(VM_IO_MEMORY_SIZE);
		for (let index = 0; index < this.cpuMemory.length; index += 1) {
			this.cpuMemory[index] = null;
		}
		this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
		this.cpu = new VMCPU(this.cpuMemory);
		this.vmRandomSeedValue = $.platform.clock.now();

		api = new BmsxVMApi({
			storage: this.storage,
			runtime: this,
		});
		this.editor = createVMCartEditor(options.viewport);
		this.overlayResolutionMode = 'viewport';

		seedDefaultLuaBuiltins();
		this.flushLuaWarnings();
		this.registerVMShortcuts();

		this.setDebuggerBreakpoints(ide_state.breakpoints);
		$.pipeline_ext = vmExtSpec; // Activate base VM pipeline extensions by default (for ticking the VM and drawing the VM)
	}

	private applyCanonicalization(canonicalization: CanonicalizationType): void {
		this._canonicalization = canonicalization;
		this.canonicalizeIdentifierFn = createIdentifierCanonicalizer(this._canonicalization);
		setLuaTableCaseInsensitiveKeys(this._canonicalization !== 'none');
		setEditorCaseInsensitivity(this._canonicalization !== 'none');
	}

	private extractErrorLocation(error: unknown): { line: number; column: number; path: string } {
		if (error instanceof LuaError) {
			const rawChunk = typeof error.path === 'string' && error.path.length > 0 ? error.path : null;
			const path = rawChunk && rawChunk.startsWith('@') ? rawChunk.slice(1) : rawChunk;
			return {
				line: Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null,
				column: Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null,
				path: path,
			};
		}
		if (this.lastVmCallStack.length > 0) {
			const frame = this.lastVmCallStack[0];
			return {
				line: frame.line,
				column: frame.column,
				path: frame.source,
			};
		}
		return { line: null, column: null, path: null };
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.requireHandler = (ctx, module) => this.requireLuaModule(ctx, module);
	}

	private createLuaInterpreter(): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge, this._canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.attachDebugger(this.debuggerController);
		interpreter.clearLastFaultEnvironment();
		registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		return interpreter;
	}

	private assignInterpreter(interpreter: LuaInterpreter): void {
		this.luaInterpreter = interpreter;
		this.vmInitClosure = null;
		this.vmNewGameClosure = null;
		this.vmUpdateClosure = null;
		this.vmDrawClosure = null;
		this.vmConsoleMetadata = null;
		this.pendingVmCall = null;
		this.luaRuntimeFailed = false;
		this.luaVmInitialized = false;
	}

	public get activeIdeFontVariant(): VMFontVariant {
		return this._activeIdeFontVariant;
	}

	public set activeIdeFontVariant(variant: VMFontVariant) {
		this._activeIdeFontVariant = variant;
		this.terminal.setFontVariant(variant);
		this.editor.setFontVariant(variant);
	}

	private updateGamePipelineExts(): void {
		if (this.terminal.isActive) {
			$.pipeline_spec_override = getBasePipelineSpecOverrideForIdeOrTerminal();
			$.pipeline_ext = terminalExtSpec; // Activate terminal pipeline extensions
		} else if (this.editor.isActive) {
			$.pipeline_spec_override = getBasePipelineSpecOverrideForIdeOrTerminal();
			$.pipeline_ext = ideExtSpec; // Activate IDE pipeline extensions
		} else {
			$.pipeline_spec_override = null; // Clear any pipeline spec override
			$.pipeline_ext = vmExtSpec; // Activate base VM pipeline extensions
		}
		this.updateOverlayAudioSuspension();
	}

	private updateOverlayAudioSuspension(): void {
		if (this.isOverlayActive()) {
			$.sndmaster.suspendAll('overlay');
		} else {
			$.sndmaster.resumeAll('overlay');
		}
	}

	private toggleTerminalMode(): void {
		if (this.terminal.isActive) {
			this.deactivateTerminalMode();
			return;
		}
		this.activateTerminalMode();
	}

	private activateTerminalMode(): void {
		if (this.terminal.isActive) {
			return;
		}
		this.deactivateEditor();
		this.terminal.activate();
		this.updateGamePipelineExts();
	}

	public deactivateTerminalMode(): void {
		if (!this.terminal.isActive) {
			return;
		}
		this.terminal.deactivate();
		this.updateGamePipelineExts();
	}

	private isOverlayActive(): boolean {
		return this.editor.isActive || this.terminal.isActive;
	}

	private toggleEditor(): void {
		if (this.editor.isActive) {
			this.deactivateEditor();
			return;
		}
		this.activateEditor();
	}

	public activateEditor(): void {
		if (!this.editor) {
			return;
		}
		if (this.terminal.isActive) {
			this.terminal.deactivate();
		}
		if (!this.editor.isActive) {
			this.editor.activate();
		}
		this.updateGamePipelineExts();
	}

	public deactivateEditor(): void {
		if (!this.editor) {
			return;
		}
		if (this.editor.isActive === true) {
			this.editor.deactivate();
		}
		this.updateGamePipelineExts();

	}

	private registerVMShortcuts(): void {
		this.disposeShortcutHandlers();
		const registry = Input.instance.getGlobalShortcutRegistry();
		const disposers: Array<() => void> = [];
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, EDITOR_TOGGLE_KEY, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, VM_TOGGLE_KEY, () => this.toggleTerminalMode()));
		disposers.push(registry.registerGamepadChord(this.playerIndex, EDITOR_TOGGLE_GAMEPAD_BUTTONS, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, GAME_PAUSE_KEY, () => $.toggleDebuggerControls()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, 'KeyT', () => {
			$.consume_button(this.playerIndex, 'KeyT', 'keyboard');
			const next = this._activeIdeFontVariant === 'tiny' ? 'msx' : 'tiny';
			this.activeIdeFontVariant = next;
		}, KeyModifier.ctrl | KeyModifier.shift));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, 'KeyM', () => {
			if (!this.isOverlayActive()) {
				return;
			}
			$.consume_button(this.playerIndex, 'KeyM', 'keyboard');
			this.toggleOverlayResolutionMode();
		}, KeyModifier.ctrl | KeyModifier.alt));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, 'F8', () => {
			const modifiers = $.input.getPlayerInput(this.playerIndex).getModifiersState();
			if (modifiers.ctrl) {
				return;
			}
			if (this.debuggerSuspendSignal) {
				this.stepOverLuaDebugger();
			} else {
				this.debuggerController.requestStepInto();
			}
		}));
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

	public toggleOverlayResolutionMode(): 'offscreen' | 'viewport' {
		const next = this._overlayResolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
		this.overlayResolutionMode = next;
		return next;
	}

	public tickIdeInput(): void {
		const pollFrame = $.input.getPlayerInput(this.playerIndex).pollFrame;
		if (pollFrame === this.lastIdeInputFrame) {
			return;
		}
		this.lastIdeInputFrame = pollFrame;
		this.editor.tickInput();
	}

	public tickTerminalInput(): void {
		const pollFrame = $.input.getPlayerInput(this.playerIndex).pollFrame;
		if (pollFrame === this.lastTerminalInputFrame) {
			return;
		}
		this.lastTerminalInputFrame = pollFrame;
		void this.terminal.handleInput();
	}

	public set jsStackEnabled(enabled: boolean) {
		this.includeJsStackTraces = enabled;
	}

	public get jsStackEnabled(): boolean {
		return this.includeJsStackTraces;
	}

	public recordLuaWarning(message: string): void {
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

	public setDebuggerBreakpoints(breakpoints: Map<string, Set<number>>): void {
		this.debuggerController.setBreakpoints(breakpoints);
	}

	private setDebuggerPaused(paused: boolean): void {
		this.debuggerPaused = paused;
		ide_state.debuggerControls.executionState = paused ? 'paused' : 'inactive';
		ide_state.debuggerControls.sessionMetrics = this.debuggerMetrics;
		if (!paused) {
			clearExecutionStopHighlights();
		}
	}

	private applyDebuggerStopLocation(signal: LuaDebuggerPauseSignal): void {
		const normalizedLine = clamp_fallback(signal.location.line, 1, Number.MAX_SAFE_INTEGER, 1);
		setExecutionStopHighlight(normalizedLine - 1);
	}

	private onLuaDebuggerPause(signal: LuaDebuggerPauseSignal): void {
		if (signal.reason === 'exception' && !this.editor.isActive) {
			this.luaInterpreter.markFaultEnvironment();
			this.handleLuaError(signal.exception);
			return;
		}
		this.debuggerController.handlePause(signal);
		const pendingException = this.luaInterpreter.pendingDebuggerException;
		this.pauseCoordinator.capture(signal, pendingException);
		this.debuggerSuspendSignal = signal;
		this.debuggerMetrics = this.debuggerController.getSessionMetrics();
		this.setDebuggerPaused(true);
		this.applyDebuggerStopLocation(signal);
		if (signal.reason === 'exception') {
			this.recordDebuggerExceptionFault(signal);
			if (this.vmProgramMetadata && this.editor.isActive) {
				const message = this.faultSnapshot.message;
				this.editor.showRuntimeErrorInChunk(this.faultSnapshot.path, this.faultSnapshot.line, this.faultSnapshot.column, message);
			}
		}
	}

	private clearActiveDebuggerPause(): void {
		this.pauseCoordinator.clearSuspension();
		this.debuggerSuspendSignal = null;
		this.setDebuggerPaused(false);
		this.clearRuntimeFault();
		this.debuggerController.clearPauseContext();
		this.editor.clearRuntimeErrorOverlay();
	}

	private handleDebuggerResumeResult(result: ExecutionSignal): void {
		if (result && result.kind === 'pause') {
			this.onLuaDebuggerPause(result as LuaDebuggerPauseSignal);
			return;
		}
		this.clearActiveDebuggerPause();
	}

	private buildDebuggerStepOrigin(suspension: LuaDebuggerPauseSignal): DebuggerStepOrigin {
		return {
			path: suspension.location.path,
			line: suspension.location.line,
			depth: suspension.callStack.length,
		};
	}

	private resolveResumeStrategy(suspension: LuaDebuggerPauseSignal): 'propagate' | 'skip_statement' {
		return suspension.reason === 'exception' ? 'skip_statement' : 'propagate';
	}

	private resumeDebugger(options: { mode: 'continue' | 'step_into' | 'step_out'; strategy: 'propagate' | 'skip_statement' }): void {
		const suspension = this.pauseCoordinator.getSuspension();
		const stepOrigin = this.buildDebuggerStepOrigin(suspension);
		if (options.mode === 'step_into') {
			this.debuggerController.requestStepInto(stepOrigin);
		}
		if (options.mode === 'step_out') {
			this.debuggerController.requestStepOut(suspension.callStack.length, stepOrigin);
		}
		if (options.strategy === 'skip_statement' && suspension.reason === 'exception') {
			this.debuggerController.markSkippedException();
		}
		this.luaInterpreter.debuggerResumeStrategy = options.strategy;
		const result = suspension.resume();
		this.handleDebuggerResumeResult(result);
	}

	public continueLuaDebugger(): void {
		this.resumeDebugger({ mode: 'continue', strategy: 'propagate' });
	}

	public stepOverLuaDebugger(): void {
		// Step-over is intentionally unavailable: the interpreter runs statements atomically, so there is
		// no hook to pause after the current statement without re-entering child calls. We fall back to
		// step-into to keep forward progress predictable.
		this.stepIntoLuaDebugger();
	}

	public stepIntoLuaDebugger(): void {
		const suspension = this.pauseCoordinator.getSuspension();
		this.resumeDebugger({ mode: 'step_into', strategy: this.resolveResumeStrategy(suspension) });
	}

	public stepOutLuaDebugger(): void {
		const suspension = this.pauseCoordinator.getSuspension();
		this.resumeDebugger({ mode: 'step_out', strategy: this.resolveResumeStrategy(suspension) });
	}

	public ignoreLuaException(): void {
		this.resumeDebugger({ mode: 'continue', strategy: 'skip_statement' });
	}

	// private pauseDebuggerForException(location: { path: string; line: number; column: number }, callStack: ReadonlyArray<LuaCallFrame>): void {
	// 	const suspension: LuaDebuggerPauseSignal = {
	// 		kind: 'pause',
	// 		reason: 'exception',
	// 		location: {
	// 			path: location.path,
	// 			line: location.line,
	// 			column: location.column,
	// 		},
	// 		callStack: callStack ?? [],
	// 		resume: () => ({ kind: 'normal' }),
	// 	};
	// 	this.onLuaDebuggerPause(suspension);
	// }

	public async boot(): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'new_game' });
		try {
			this.clearActiveDebuggerPause();
			this.clearRuntimeFault();
			this.luaVmInitialized = false;
			this.invalidateVmModuleAliases();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();
			this.editor.clearRuntimeErrorOverlay();
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset to fresh world
				await $.reset_to_fresh_world();
				$.view.primaryAtlas = 0;
			}
			api.cartdata($.luaSources.namespace);
			this.bootActiveProgram();
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw new Error('[BmsxVMRuntime]: Failed to boot runtime: ' + error);
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	// Frame state is owned by the runtime: it is created per-frame, kept intact for debugger inspection on faults,
	// and only cleared via finalize/abandon during explicit reboot/reset flows.
	// Frame state is owned by the runtime and is always finalized/abandoned by the runtime; faults capture a snapshot for inspection.
	private beginFrameState(): VMFrameState {
		if (this.currentFrameState) {
			throw new Error('[BmsxVMRuntime] Attempted to begin a new frame while another frame is active.');
		}
		const deltaSeconds = $.deltatime_seconds; // Align with fixed-step update cadence to avoid over-counting when substepping
		const state: VMFrameState = {
			haltGame: this.debuggerPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			deltaSeconds,
		};
		this.currentFrameState = state;
		return state;
	}

	public tickUpdate(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		this.processPendingProgramReload();
		if (this.isOverlayActive()) {
			return;
		}
		if (this.currentFrameState !== null) {
			return;
		}
		this.runCartUpdateTick();
	}

	public tickDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		this.processPendingProgramReload();
		if (this.isOverlayActive()) {
			return;
		}
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawGameFrame();
		} finally {
			this.abandonFrameState();
		}
	}

	public tickTerminalMode(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		this.processPendingProgramReload();
		if (this.currentFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.terminal.update(state.deltaSeconds);
	}

	public tickTerminalModeDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawTerminal();
		} finally {
			this.abandonFrameState();
		}
	}

	public tickIDE(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		this.processPendingProgramReload();
		if (this.currentFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.editor.update(state.deltaSeconds);
	}

	public tickIDEDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		if (!this.currentFrameState) {
			return;
		}
		try {
			this.drawIde();
		} finally {
			this.abandonFrameState();
		}
	}

	private runCartUpdateTick(): void {
		let fault: unknown = null;
		try {
			const state = this.beginFrameState();
			this.runUpdatePhase(state);
		} catch (error) {
			fault = error;
			this.handleLuaError(error);
		} finally {
			if (fault !== null && this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	private runUpdatePhase(state: VMFrameState): void {
		if (state.updateExecuted) {
			return;
		}
		if (!this.cartEntryAvailable) {
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
			let shouldRunEngineUpdate = this.vmUpdateClosure === null;
			if (this.pendingVmCall && this.pendingVmCall !== 'update') {
				state.updateExecuted = true;
				return;
			}
			if (this.vmUpdateClosure !== null) {
				if (!this.pendingVmCall) {
					this.cpu.call(this.vmUpdateClosure, [state.deltaSeconds], 0);
					this.pendingVmCall = 'update';
				}
				const budget = BmsxVMRuntime.UPDATE_STATEMENT_BUDGET;
				const result = this.cpu.run(budget);
				this.processVmIo();
				if (result === RunResult.Halted) {
					this.pendingVmCall = null;
					shouldRunEngineUpdate = true;
				}
			}
			if (shouldRunEngineUpdate) {
				this.callEngineModuleMember('update', [$.deltatime]);
				this.processVmIo();
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

	public drawIde(): void {
		try {
			this.overlayRenderBackend.beginFrame();
			this.overlayRenderBackend.setDefaultLayer('ide');
			this.editor.draw();
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
		} finally {
			this.overlayRenderBackend.endFrame();
		}
	}

	public drawTerminal(): void {
		try {
			this.overlayRenderBackend.beginFrame();
			this.overlayRenderBackend.setDefaultLayer('ide');
			this.terminal.draw(this.overlayRenderBackend, this.overlayRenderBackend.viewportSize);
			this.overlayRenderBackend.setDefaultLayer('world');
			this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
		} finally {
			this.overlayRenderBackend.endFrame();
		}
	}

	private drawBlueScreen(): void {
		const viewport = $.view.viewportSize;
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: 0,
				top: 0,
				right: viewport.x,
				bottom: viewport.y,
				z: 0,
			},
			color: Msx1Colors[4],
		};
		this.overlayRenderBackend.rect(rect);
	}

	private drawGameFrame(): void {
		try {
			this.overlayRenderBackend.beginFrame();
			// No try catch here; caller handles faults
			this.overlayRenderBackend.setDefaultLayer('world');
			if (!this.cartEntryAvailable) {
				this.drawBlueScreen();
				this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
				return;
			}
			if (this.luaVmGate.ready) {
				if (this.pendingVmCall === 'update' || this.debuggerPaused || this.luaRuntimeFailed || this.faultSnapshot) {
					this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
				}
				else {
					try {
						let shouldRunEngineDraw = this.vmDrawClosure === null;
						if (this.vmDrawClosure !== null) {
							if (!this.pendingVmCall) {
								this.cpu.call(this.vmDrawClosure, [], 0);
								this.pendingVmCall = 'draw';
							}
							const result = this.cpu.run(BmsxVMRuntime.UPDATE_STATEMENT_BUDGET);
							this.processVmIo();
							if (result === RunResult.Halted) {
								this.pendingVmCall = null;
								shouldRunEngineDraw = true;
							}
						}
						if (shouldRunEngineDraw) {
							this.callEngineModuleMember('draw', []);
							this.processVmIo();
						}
						this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
					} catch (error) {
						this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();

						if (isLuaDebuggerPauseSignal(error)) {
							this.onLuaDebuggerPause(error);
						} else {
							this.handleLuaError(error);
						}
					}
				}
			}
		}
		catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				this.handleLuaError(error);
			}
		} finally {
			this.overlayRenderBackend.endFrame();
		}
	}

	// Clear reference to allow next frame to begin
	public abandonFrameState(): void {
		this.currentFrameState = null;
	}

	public requestProgramReload(options?: { runInit?: boolean }): void {
		this.pendingProgramReload = { runInit: options?.runInit };
	}

	private isEngineProgramActive(): boolean {
		return $.luaSources === this.engineLuaSources;
	}

	private syncSystemRegisters(): void {
		this.cpuMemory[IO_SYS_CART_PRESENT] = $.assets.project_root_path !== $.engineLayer.index.projectRootPath ? 1 : 0;
	}

	private pollSystemBootRequest(): void {
		if (!this.isEngineProgramActive()) {
			return;
		}
		if (!this.cpuMemory[IO_SYS_BOOT_CART]) {
			return;
		}
		this.cpuMemory[IO_SYS_BOOT_CART] = 0;
		this.requestCartBoot();
	}

	private processPendingCartBoot(): void {
		this.syncSystemRegisters();
		this.pollSystemBootRequest();
		if (!this.pendingCartBoot) {
			return;
		}
		if (!this.luaVmGate.ready) {
			return;
		}
		if (this.currentFrameState || this.pendingVmCall) {
			return;
		}
		this.pendingCartBoot = false;
		this.activateProgramSource('cart');
		void this.reloadProgramAndResetWorld();
	}

	private processPendingProgramReload(): void {
		if (!this.pendingProgramReload) {
			return;
		}
		if (!this.hasLuaAssets()) {
			this.pendingProgramReload = null;
			return;
		}
		if (this.currentFrameState || this.pendingVmCall) {
			return;
		}
		const options = this.pendingProgramReload;
		this.pendingProgramReload = null;
		this.reloadLuaProgramState({ runInit: options.runInit });
	}

	public dispose(): void {
		this.disposeShortcutHandlers();
		this.terminal.deactivate();
		this.luaVmInitialized = false;
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
		this.luaInterpreter = null;
		if (BmsxVMRuntime._instance === this) {
			BmsxVMRuntime._instance = null;
		}
	}

	public captureCurrentState(): BmsxVMState {
		const storage = this.storage.dump();
		const vmState = this.captureVmState();
		const state: BmsxVMState = {
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaPath: this._luaPath,
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
			if (vmState.programCounter !== undefined) {
				state.luaProgramCounter = vmState.programCounter;
			}
		}
		return state;
	}

	public async applyState(state: BmsxVMState) {
		if (!state) await this.resetRuntimeToFreshState();
		else this.restoreFromStateSnapshot(state);
	}

	private async resetRuntimeToFreshState() {
		const asset = $.luaSources.path2lua[$.luaSources.entry_path];
		this._luaPath = asset.source_path;
		this.luaVmInitialized = false;
		await this.boot();
	}

	/**
	  * Restore from a snapshot captured via the `state` getter. This is a soft-resume that only restores Lua
	  * global/local state and storage; it does not reset the world or engine state.
	  * It is only used when the user hits "Resume" after a runtime error or debugger pause.
	  */
	private restoreFromStateSnapshot(snapshot: BmsxVMState): void {
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

		api.cartdata($.luaSources.namespace);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}

		this.luaRuntimeFailed = false;
		// const shouldRunInit = snapshot.luaRuntimeFailed !== true;
		this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: false, hotReload: false });

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	public async resumeFromSnapshot(state: BmsxVMState): Promise<void> {
		this.clearActiveDebuggerPause();
		if (!state) {
			this.luaRuntimeFailed = false;
			throw new Error('[BmsxVMRuntime] Cannot resume from invalid state snapshot.');
		}
		const snapshot: BmsxVMState = { ...state, luaRuntimeFailed: false };
		// Clear any previous error overlays and interpreter fault markers so a fresh
		// resume starts clean and can report new errors normally.
		this.editor.clearRuntimeErrorOverlay();
		this.luaInterpreter.clearLastFaultEnvironment();
		this.clearFaultSnapshot();

		// Also clear dedupe set so subsequent errors surface again after resume.
		this.handledLuaErrors = new WeakSet<object>();
		// Clear flag and any queued overlay frame before we resume swapping handlers.
		this.luaRuntimeFailed = false;
		publishOverlayFrame(null);
		this.resumeLuaProgramState(snapshot);
		this.luaVmInitialized = true;
	}

	private hotReloadProgramEntry(params: { path: string; source: string; preserveEngineModules?: boolean }): void {
		const preserveRuntimeFailure = this.luaRuntimeFailed || (this.pauseCoordinator.hasSuspension() && this.pauseCoordinator.getPendingException() !== null);
		const binding = params.path;
		const baseMetadata = this.vmProgramMetadata;
		if (!baseMetadata) {
			throw new Error('[BmsxVMRuntime] Hot reload requires program symbols.');
		}
		const interpreter = this.luaInterpreter;
		interpreter.clearLastFaultEnvironment();
		const chunk = interpreter.compileChunk(params.source, binding);
		const { modules, modulePaths } = this.buildVmModuleChunks(binding);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, {
			baseProgram: this.cpu.getProgram(),
			baseMetadata,
			canonicalization: this._canonicalization,
		});
		this.vmModuleProtos.clear();
		for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
			this.vmModuleProtos.set(modulePath, protoIndex);
		}
		this.vmModuleAliases.clear();
		for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
			this.vmModuleAliases.set(entry.alias, entry.path);
		}
		if (params.preserveEngineModules) {
			this.clearCartModuleCacheForHotReload();
		} else {
			this.vmModuleCache.clear();
		}
		this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
		const prelude = this.runEngineBuiltinPrelude(program, metadata);
		const finalizedMetadata = prelude.metadata;
		this.cpu.start(entryProtoIndex);
		this.pendingVmCall = null;
		this.cpu.instructionBudgetRemaining = null;
		this.cpu.run(null);
		this.processVmIo();
		this.bindLifecycleHandlers();
		this.luaRuntimeFailed = preserveRuntimeFailure;
		this._luaPath = binding;
		this.vmProgramMetadata = finalizedMetadata;
		this.luaVmInitialized = true;
		clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private clearCartModuleCacheForHotReload(): void {
		for (const path of Array.from(this.vmModuleCache.keys())) {
			if (!this.engineLuaSources.path2lua[path]) {
				this.vmModuleCache.delete(path);
			}
		}
	}

	private bindLifecycleHandlers(): void {
		const globals = this.cpu.globals;
		this.vmNewGameClosure = globals.get(this.vmKey('new_game')) as Closure;
		this.vmInitClosure = globals.get(this.vmKey('init')) as Closure;
		this.vmUpdateClosure = globals.get(this.vmKey('update')) as Closure;
		this.vmDrawClosure = globals.get(this.vmKey('draw')) as Closure;
	}

	private runLuaLifecycleHandler(kind: 'init' | 'new_game'): boolean {
		const fn = kind === 'init' ? this.vmInitClosure : this.vmNewGameClosure;
		try {
			if (!fn) throw new Error(`VM lifecycle handler '${kind}' is not defined.`);
			if (kind === 'new_game') {
				this.callEngineModuleMember('reset', []);
			}
			this.cpu.call(fn, [], 0);
			this.cpu.instructionBudgetRemaining = null;
			this.cpu.run(null);
			this.processVmIo();
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

	public reloadLuaProgramState(options: { runInit?: boolean; }): void {
		const runInit = options.runInit !== false;
		let binding = $.luaSources.path2lua[$.luaSources.entry_path] as LuaSourceRecord;
		if (!binding) {
			// This can happen if there is no Lua entry point defined in the cart. For example, when there is no cart loaded and the player still tried to write code and run it.
			// Luckily, this is not a fatal error as the description will point towards `res/code/system_program.lua`
			// binding =  { source_path: $.luaSources.entry_path, resid: $.luaSources.entry_path, type: 'lua', src: '', normalized_source_path: $.luaSources.entry_path, update_timestamp: $.platform.clock.dateNow(), base_src: '' };
			console.info(`[BmsxVMRuntime] No Lua entry point defined; cannot reload program. Please save the entry point and try again.`);
			return;
		}
		this._luaPath = binding.source_path;
		if (!this.luaInterpreter) {
			if (!this.bootLuaProgram()) {
				console.info(`[BmsxVMRuntime] Lua boot failed.`);
				return;
			}
		}
		else {
			this.hotReloadProgramEntry({ source: getSourceForChunk(binding.source_path), path: binding.source_path });
			if (runInit) {
				if (this.runLuaLifecycleHandler('init')) {
					// Initialization successful
					if (!this.runLuaLifecycleHandler('new_game')) {
						console.info(`[BmsxVMRuntime] Lua 'new_game' lifecycle handler failed during reload.`);
					}
				}
			}
		}
		this.luaVmInitialized = true;
	}

	private resumeLuaProgramState(snapshot: BmsxVMState): void {
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const binding = snapshot.luaPath;
		let source: string;
		try {
			source = this.resourceSourceForChunk(binding);
		}
		catch (error) {
			throw convertToError(error);
		}
		this._luaPath = binding;
		try {
			this.hotReloadProgramEntry({ source, path: binding, preserveEngineModules: !this.isEngineProgramActive() });
		}
		catch (error) {
			this.handleLuaError(error);
		}
		this.refreshLuaModulesOnResume(binding);
		clearNativeMemberCompletionCache();
		this.runLuaLifecycleHandler('init');
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: BmsxVMState, options: { runInit: boolean; hotReload: boolean }): void {
		const binding = $.luaSources.path2lua[$.luaSources.entry_path];
		const source = this.resourceSourceForChunk(binding.source_path);

		this._luaPath = binding.source_path;

		this.initializeLuaInterpreterFromSnapshot({
			source,
			path: binding.source_path,
			snapshot,
			runInit: options.runInit,
			hotReload: options.hotReload,
		});
		clearNativeMemberCompletionCache();
	}

	private refreshLuaModulesOnResume(resumeModuleId: string): void {
		const paths = Object.keys($.luaSources.path2lua);
		for (let index = 0; index < paths.length; index += 1) {
			const moduleId = paths[index];
			if (resumeModuleId && moduleId === resumeModuleId) {
				continue;
			}
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; path: string; snapshot: BmsxVMState; runInit: boolean; hotReload: boolean }): void {
		const snapshot = params.snapshot;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const binding = $.luaSources.path2lua[params.path];
		if (params.hotReload) {
			this.hotReloadProgramEntry({ source: params.source, path: binding.source_path, preserveEngineModules: !this.isEngineProgramActive() });
			if (params.runInit && !savedRuntimeFailed) {
				this.runLuaLifecycleHandler('init');
				this.runLuaLifecycleHandler('new_game');
			}
			this.restoreVmState(snapshot);
			if (savedRuntimeFailed) {
				this.luaRuntimeFailed = true;
			}
			return;
		}

		// Path not used right now, but might be useful for loading game state later
		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreter();
		this.assignInterpreter(interpreter);

		this.resetVmState();
		const chunk = interpreter.compileChunk(params.source, binding.source_path);
		const { modules, modulePaths } = this.buildVmModuleChunks(binding.source_path);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, { canonicalization: this._canonicalization });
		this.vmModuleProtos.clear();
		for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
			this.vmModuleProtos.set(modulePath, protoIndex);
		}
		this.vmModuleAliases.clear();
		for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
			this.vmModuleAliases.set(entry.alias, entry.path);
		}
		this.vmModuleCache.clear();
		this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
		const prelude = this.runEngineBuiltinPrelude(program, metadata);
		this.vmProgramMetadata = prelude.metadata;
		this.cpu.start(entryProtoIndex);
		this.pendingVmCall = null;
		this.cpu.instructionBudgetRemaining = null;
		this.cpu.run(null);
		this.processVmIo();
		this.luaVmInitialized = true;

		this.bindLifecycleHandlers();

		if (params.runInit && !savedRuntimeFailed) {
			this.runLuaLifecycleHandler('init');
		}
		this.restoreVmState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private clearEditorErrorOverlaysIfNoFault(): void {
		if (this.luaRuntimeFailed) return;
		this.editor.clearRuntimeErrorOverlay();
		publishOverlayFrame(null);
	}

	private clearFaultSnapshot(): void {
		this.faultSnapshot = null;
		this.faultOverlayNeedsFlush = false;
	}

	private clearRuntimeFault(): void {
		this.luaRuntimeFailed = false;
		this.clearFaultSnapshot();
	}

	private setRuntimeFault(payload: {
		message: string;
		path: string;
		line: number;
		column: number;
		details: RuntimeErrorDetails;
		fromDebugger: boolean;
	}): void {
		this.luaRuntimeFailed = true;
		this.faultSnapshot = payload;
		this.faultSnapshot.timestampMs = $.platform.clock.dateNow();
		this.faultOverlayNeedsFlush = true;
	}

	public clearFaultState(): { cleared: boolean; resumedDebugger: boolean } {
		const hadFault = this.luaRuntimeFailed || this.faultSnapshot !== null || this.debuggerSuspendSignal !== null;
		const wasPaused = this.debuggerSuspendSignal !== null || this.debuggerPaused;
		this.clearRuntimeFault();
		if (wasPaused) {
			this.clearActiveDebuggerPause();
		}
		return { cleared: hadFault, resumedDebugger: wasPaused };
	}

	private recordDebuggerExceptionFault(signal: LuaDebuggerPauseSignal) {
		const exception = this.pauseCoordinator.getPendingException();
		if (this.faultSnapshot && this.luaRuntimeFailed) {
			this.faultOverlayNeedsFlush = true;
			return;
		}
		const signalLine = clamp_fallback(signal.location.line, 1, Number.MAX_SAFE_INTEGER, null);
		const signalColumn = clamp_fallback(signal.location.column, 1, Number.MAX_SAFE_INTEGER, null);
		if (!exception) {
			this.setRuntimeFault({
				message: 'Runtime error',
				path: signal.location.path,
				line: signalLine,
				column: signalColumn,
				details: this.buildRuntimeErrorDetailsForEditor(null, 'Runtime error', signal.callStack),
				fromDebugger: true,
			});
			return;
		}
		const message = sanitizeLuaErrorMessage(extractErrorMessage(exception));
		let path: string = exception.path;
		if (!path || path.length === 0) {
			path = signal.location.path;
		}
		const normalizedLine = clamp_fallback(exception.line, 1, Number.MAX_SAFE_INTEGER, null);
		const normalizedColumn = clamp_fallback(exception.column, 1, Number.MAX_SAFE_INTEGER, null);
		this.setRuntimeFault({
			message,
			path,
			line: normalizedLine ?? signalLine,
			column: normalizedColumn ?? signalColumn,
			details: this.buildRuntimeErrorDetailsForEditor(exception, message, signal.callStack),
			fromDebugger: true,
		});
	}

	public markSourceChunkAsDirty(path: string): void {
		this.luaGenericChunksExecuted.delete(path);
	}

	private captureVmState(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number; programCounter?: number } {
		const interpreter = this.luaInterpreter;
		const globals = this.captureLuaEntryCollection(interpreter.enumerateGlobalEntries());
		const locals = this.captureLuaEntryCollection(interpreter.enumerateChunkEntries());
		const randomSeed = interpreter.randomSeed;
		const programCounter = interpreter.programCounter;
		return {
			globals: globals,
			locals: locals,
			randomSeed: randomSeed,
			programCounter: programCounter,
		};
	}

	private captureLuaEntryCollection(entries: ReadonlyArray<[string, LuaValue]>): LuaEntrySnapshot {
		// The IDE uses this fallback snapshot when a cart does not expose
		// __bmsx_snapshot_save/__bmsx_snapshot_load. It exists purely to let the editor
		// "resume" after a runtime failure without rebooting the whole cart. Unlike a
		// deterministic save-state we lean on the fact that native JS objects stay alive
		// across hot reloads: Lua tables are serialized, native references are kept by
		// identity, and Lua functions get refreshed by the reload pipeline.
		if (!entries || entries.length === 0) {
			return null;
		}
		const ctx = this.luaJsBridge.createLuaSnapshotContext();
		const snapshotRoot: Record<string, unknown> = {};
		let count = 0;
		for (const [name, value] of entries) {
			if (this.shouldSkipLuaSnapshotEntry(name, value)) {
				continue;
			}
			try {
				const serialized = this.luaJsBridge.serializeLuaValueForSnapshot(value, ctx);
				snapshotRoot[name] = serialized;
				count += 1;
			}
			catch (error) {
				console.warn(`[BmsxVMRuntime] Skipped Lua snapshot entry '${name}':`, error);
			}
		}
		return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
	}

	private shouldSkipLuaSnapshotEntry(name: string, value: LuaValue): boolean {
		if (!name || this.apiFunctionNames.has(name)) {
			return true;
		}
		if (BmsxVMRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			return true;
		}
		if (isLuaFunctionValue(value)) {
			return true;
		}
		return false;
	}

	private restoreVmState(snapshot: BmsxVMState): void {
		const interpreter = this.luaInterpreter;
		if (snapshot.luaRandomSeed !== undefined) {
			interpreter.randomSeed = snapshot.luaRandomSeed;
		}
		if (snapshot.luaProgramCounter !== undefined) {
			interpreter.programCounter = snapshot.luaProgramCounter;
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
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(globals);
		for (const [name, value] of entries) {
			if (!name || this.apiFunctionNames.has(name) || BmsxVMRuntime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
				continue;
			}
			const existing = interpreter.getGlobal(name);
			if (isLuaTable(existing) && isLuaTable(value)) {
				this.luaJsBridge.applyLuaTableSnapshot(existing, value);
				continue;
			}
			try {
				interpreter.setGlobal(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxVMRuntime] Failed to restore Lua global '${name}':`, error);
				}
			}
		}
	}

	private restoreLuaLocals(locals: LuaEntrySnapshot): void {
		const interpreter = this.luaInterpreter;
		const entries = this.luaJsBridge.materializeLuaEntrySnapshot(locals);
		for (const [name, value] of entries) {
			if (!name || !interpreter.hasChunkBinding(name)) {
				continue;
			}
			const env = interpreter.pathEnvironment;
			if (env) {
				const current = env.get(name);
				if (isLuaTable(current) && isLuaTable(value)) {
					this.luaJsBridge.applyLuaTableSnapshot(current, value);
					continue;
				}
			}
			try {
				interpreter.assignChunkValue(name, value);
			}
			catch (error) {
				if ($.debug) {
					console.warn(`[BmsxVMRuntime] Failed to restore Lua local '${name}':`, error);
				}
			}
		}
	}

	private resetLuaInteroperabilityState(): void {
		this.luaGenericChunksExecuted.clear();
		this.handledLuaErrors = new WeakSet<object>();
		this.luaFunctionRedirectCache.clear();
		setLuaTableCaseInsensitiveKeys(this._canonicalization !== 'none');
	}

	private resetVmState(): void {
		this.pendingVmCall = null;
		this.pendingCartBoot = false;
		this.vmInitClosure = null;
		this.vmNewGameClosure = null;
		this.vmUpdateClosure = null;
		this.vmDrawClosure = null;
		this.cpu.instructionBudgetRemaining = null;
		this.cpu.globals.clear();
		this.vmModuleCache.clear();
		this.vmModuleProtos.clear();
		for (let index = 0; index < this.cpuMemory.length; index += 1) {
			this.cpuMemory[index] = null;
		}
		this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
		this.cpuMemory[IO_SYS_CART_PRESENT] = 0;
		this.cpuMemory[IO_SYS_BOOT_CART] = 0;
		this.vmRandomSeedValue = $.platform.clock.now();
		this.seedVmGlobals();
	}

	private registerVmGlobal(name: string, value: Value): void {
		const key = this.vmKey(name);
		this.cpu.globals.set(key, value);
	}

	private callEngineModuleMember(name: string, args: ReadonlyArray<Value>): Value[] {
		const engine = this.requireVmModule('engine') as Table;
		const key = this.vmKey(name);
		const member = engine.get(key) as Closure;
		return this.callVmFunction(member, args as Value[]);
	}

	private buildEngineBuiltinPreludeSource(): string {
		const lines: string[] = ['local engine = require("engine")'];
		for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
			const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
			lines.push(`${name} = engine.${name}`);
		}
		return lines.join('\n');
	}

	private runEngineBuiltinPrelude(program: Program, metadata: ProgramMetadata): { program: Program; metadata: ProgramMetadata } {
		const source = this.buildEngineBuiltinPreludeSource();
		const interpreter = this.luaInterpreter;
		interpreter.setReservedIdentifiers([]);
		const chunk = interpreter.compileChunk(source, BmsxVMRuntime.ENGINE_BUILTIN_PRELUDE_PATH);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		const compiled = appendLuaChunkToProgram(program, metadata, chunk, { canonicalization: this._canonicalization });
		this.cpu.setProgram(compiled.program, compiled.metadata);
		this.vmProgramMetadata = compiled.metadata;
		this.callVmFunction({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
		this.processVmIo();
		return { program: compiled.program, metadata: compiled.metadata };
	}

	private applyEngineBuiltinGlobals(): void {
		const engine = this.requireVmModule('engine') as Table;
		for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
			const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
			const member = engine.get(this.vmKey(name)) as Closure;
			this.registerVmGlobal(name, member);
		}
	}

	private seedVmGlobals(): void {
		const isTruthy = (value: Value): boolean => value !== null && value !== false;
		const callVmValue = (callee: Value, args: Value[], out: Value[]): void => {
			if (isNativeFunction(callee)) {
				callee.invoke(args, out);
				return;
			}
			const results = this.callVmFunction(callee as Closure, args);
			out.length = 0;
			for (let index = 0; index < results.length; index += 1) {
				out.push(results[index]);
			}
		};
		const key = (name: string): StringValue => this.internVmString(name);
		const setKey = (table: Table, name: string, value: Value): void => {
			table.set(key(name), value);
		};
		const smoothstep01 = (value: number): number => {
			const x = clamp01(value);
			return x * x * (3 - (2 * x));
		};
		const pingpong01 = (value: number): number => {
			const p = ((value % 2) + 2) % 2;
			return p < 1 ? p : (2 - p);
		};

		const mathTable = new Table(0, 0);
		setKey(mathTable, 'abs', createNativeFunction('math.abs', (args, out) => {
			const value = args[0] as number;
			out.push(Math.abs(value));
		}));
		setKey(mathTable, 'ceil', createNativeFunction('math.ceil', (args, out) => {
			const value = args[0] as number;
			out.push(Math.ceil(value));
		}));
		setKey(mathTable, 'floor', createNativeFunction('math.floor', (args, out) => {
			const value = args[0] as number;
			out.push(Math.floor(value));
		}));
		setKey(mathTable, 'max', createNativeFunction('math.max', (args, out) => {
			let result = args[0] as number;
			for (let index = 1; index < args.length; index += 1) {
				const value = args[index] as number;
				if (value > result) {
					result = value;
				}
			}
			out.push(result);
		}));
		setKey(mathTable, 'min', createNativeFunction('math.min', (args, out) => {
			let result = args[0] as number;
			for (let index = 1; index < args.length; index += 1) {
				const value = args[index] as number;
				if (value < result) {
					result = value;
				}
			}
			out.push(result);
		}));
		setKey(mathTable, 'sqrt', createNativeFunction('math.sqrt', (args, out) => {
			const value = args[0] as number;
			out.push(Math.sqrt(value));
		}));
		setKey(mathTable, 'random', createNativeFunction('math.random', (args, out) => {
			const randomValue = this.nextVmRandom();
			if (args.length === 0) {
				out.push(randomValue);
				return;
			}
			if (args.length === 1) {
				const upper = Math.floor(args[0] as number);
				if (upper < 1) {
					throw this.createApiRuntimeError('math.random upper bound must be positive.');
				}
				out.push(Math.floor(randomValue * upper) + 1);
				return;
			}
			const lower = Math.floor(args[0] as number);
			const upper = Math.floor(args[1] as number);
			if (upper < lower) {
				throw this.createApiRuntimeError('math.random upper bound must be greater than or equal to lower bound.');
			}
			const span = upper - lower + 1;
			out.push(lower + Math.floor(randomValue * span));
		}));
		setKey(mathTable, 'randomseed', createNativeFunction('math.randomseed', (args, out) => {
			const seedValue = args.length > 0 ? (args[0] as number) : $.platform.clock.now();
			this.vmRandomSeedValue = Math.floor(seedValue) >>> 0;
			out.length = 0;
		}));
		setKey(mathTable, 'pi', Math.PI);

		const easingTable = new Table(0, 0);
		setKey(easingTable, 'linear', createNativeFunction('easing.linear', (args, out) => {
			out.push(clamp01(args[0] as number));
		}));
		setKey(easingTable, 'ease_in_quad', createNativeFunction('easing.ease_in_quad', (args, out) => {
			const x = clamp01(args[0] as number);
			out.push(x * x);
		}));
		setKey(easingTable, 'ease_out_quad', createNativeFunction('easing.ease_out_quad', (args, out) => {
			const x = clamp01(1 - (args[0] as number));
			out.push(1 - (x * x));
		}));
		setKey(easingTable, 'ease_in_out_quad', createNativeFunction('easing.ease_in_out_quad', (args, out) => {
			const x = clamp01(args[0] as number);
			if (x < 0.5) {
				out.push(2 * x * x);
				return;
			}
			const y = (-2 * x) + 2;
			out.push(1 - ((y * y) / 2));
		}));
		setKey(easingTable, 'ease_out_back', createNativeFunction('easing.ease_out_back', (args, out) => {
			const x = clamp01(args[0] as number);
			const c1 = 1.70158;
			const c3 = c1 + 1;
			out.push(1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2)));
		}));
		setKey(easingTable, 'smoothstep', createNativeFunction('easing.smoothstep', (args, out) => {
			out.push(smoothstep01(args[0] as number));
		}));
		setKey(easingTable, 'pingpong01', createNativeFunction('easing.pingpong01', (args, out) => {
			out.push(pingpong01(args[0] as number));
		}));
		setKey(easingTable, 'arc01', createNativeFunction('easing.arc01', (args, out) => {
			const value = args[0] as number;
			if (value <= 0.5) {
				out.push(smoothstep01(value * 2));
				return;
			}
			out.push(smoothstep01((1 - value) * 2));
		}));

		this.registerVmGlobal('math', mathTable);
		this.registerVmGlobal('easing', easingTable);
		this.registerVmGlobal('SYS_CART_PRESENT', IO_SYS_CART_PRESENT);
		this.registerVmGlobal('SYS_BOOT_CART', IO_SYS_BOOT_CART);
		this.registerVmGlobal('peek', createNativeFunction('peek', (args, out) => {
			const address = args[0] as number;
			out.push(this.cpuMemory[address]);
		}));
		this.registerVmGlobal('poke', createNativeFunction('poke', (args, out) => {
			const address = args[0] as number;
			this.cpuMemory[address] = args[1];
			out.length = 0;
		}));
		this.registerVmGlobal('type', createNativeFunction('type', (args, out) => {
			const value = args.length > 0 ? args[0] : null;
			out.push(this.vmTypeOf(value));
		}));
		this.registerVmGlobal('tostring', createNativeFunction('tostring', (args, out) => {
			const value = args.length > 0 ? args[0] : null;
			out.push(this.vmToStringValue(value));
		}));
		this.registerVmGlobal('tonumber', createNativeFunction('tonumber', (args, out) => {
			if (args.length === 0) {
				out.push(null);
				return;
			}
			const value = args[0];
			if (typeof value === 'number') {
				out.push(value);
				return;
			}
			if (isStringValue(value)) {
				const text = stringValueToString(value);
				if (args.length >= 2) {
					const baseValue = Math.floor(args[1] as number);
					if (baseValue >= 2 && baseValue <= 36) {
						const parsed = parseInt(text.trim(), baseValue);
						out.push(Number.isFinite(parsed) ? parsed : null);
						return;
					}
				}
				const converted = Number(text);
				out.push(Number.isFinite(converted) ? converted : null);
				return;
			}
			out.push(null);
		}));
		this.registerVmGlobal('assert', createNativeFunction('assert', (args, out) => {
			const condition = args.length > 0 ? args[0] : null;
			if (!isTruthy(condition)) {
				const message = args.length > 1 ? this.vmToString(args[1]) : 'assertion failed!';
				throw this.createApiRuntimeError(message);
			}
			for (let index = 0; index < args.length; index += 1) {
				out.push(args[index]);
			}
		}));
		this.registerVmGlobal('error', createNativeFunction('error', (args, out) => {
			void out;
			const message = args.length > 0 ? this.vmToString(args[0]) : 'error';
			throw this.createApiRuntimeError(message);
		}));
		this.registerVmGlobal('setmetatable', createNativeFunction('setmetatable', (args, out) => {
			const target = args[0] as Table;
			const metatable = args.length > 1 ? (args[1] as Table) : null;
			target.setMetatable(metatable);
			out.push(target);
		}));
		this.registerVmGlobal('getmetatable', createNativeFunction('getmetatable', (args, out) => {
			const target = args[0] as Table;
			out.push(target.getMetatable());
		}));
		this.registerVmGlobal('rawequal', createNativeFunction('rawequal', (args, out) => {
			out.push(args[0] === args[1]);
		}));
		this.registerVmGlobal('rawget', createNativeFunction('rawget', (args, out) => {
			const target = args[0] as Table;
			const key = args.length > 1 ? args[1] : null;
			out.push(target.get(key));
		}));
		this.registerVmGlobal('rawset', createNativeFunction('rawset', (args, out) => {
			const target = args[0] as Table;
			const key = args[1];
			const value = args.length > 2 ? args[2] : null;
			target.set(key, value);
			out.push(target);
		}));
		this.registerVmGlobal('select', createNativeFunction('select', (args, out) => {
			const index = args[0];
			const count = args.length - 1;
			if (isStringValue(index) && stringValueToString(index) === '#') {
				out.push(count);
				return;
			}
			const start = (index as number) >= 0
				? (index as number)
				: count + (index as number) + 1;
			for (let i = start; i <= count; i += 1) {
				out.push(args[i]);
			}
		}));
		this.registerVmGlobal('pcall', createNativeFunction('pcall', (args, out) => {
			const fn = args[0];
			const callArgs: Value[] = [];
			for (let index = 1; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			try {
				callVmValue(fn, callArgs, out);
				out.unshift(true);
			} catch (error) {
				out.length = 0;
				out.push(false, this.internVmString(extractErrorMessage(error)));
			}
		}));
		this.registerVmGlobal('xpcall', createNativeFunction('xpcall', (args, out) => {
			const fn = args[0];
			const handler = args[1];
			const callArgs: Value[] = [];
			for (let index = 2; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			try {
				callVmValue(fn, callArgs, out);
				out.unshift(true);
			} catch (error) {
				const handlerArgs: Value[] = [this.internVmString(extractErrorMessage(error))];
				callVmValue(handler, handlerArgs, out);
				out.unshift(false);
			}
		}));
		this.registerVmGlobal('require', createNativeFunction('require', (args, out) => {
			const moduleName = this.requireVmString(args[0]).trim();
			out.push(this.requireVmModule(moduleName));
		}));
		this.registerVmGlobal('array', createNativeFunction('array', (args, out) => {
			const ctx = this.buildVmContext();
			let result: unknown[] = [];
			if (args.length === 1 && args[0] instanceof Table) {
				result = this.createNativeArrayFromTable(args[0], ctx);
			} else {
				result = new Array(args.length);
				for (let index = 0; index < args.length; index += 1) {
					result[index] = this.toNativeValue(args[index], ctx, new WeakMap());
				}
			}
			out.push(this.getOrCreateNativeObject(result));
		}));
		this.registerVmGlobal('print', createNativeFunction('print', (args, out) => {
			const parts: string[] = [];
			for (let index = 0; index < args.length; index += 1) {
				parts.push(this.formatVmValue(args[index]));
			}
			const text = parts.length === 0 ? '' : parts.join('\t');
			this.terminal.appendStdout(text);
			if ($.view.backendType === 'headless') {
				// eslint-disable-next-line no-console
				console.log(text);
			}
			out.length = 0;
		}));

		const utf8CodepointCount = (text: string): number => {
			let count = 0;
			for (const _char of text) {
				count += 1;
			}
			return count;
		};

		const utf8CodepointIndexToUnitIndex = (text: string, codepointIndex: number): number => {
			if (codepointIndex <= 1) {
				return 0;
			}
			let unitIndex = 0;
			let current = 1;
			for (const char of text) {
				if (current === codepointIndex) {
					return unitIndex;
				}
				unitIndex += char.length;
				current += 1;
			}
			return unitIndex;
		};

		const stringTable = new Table(0, 0);
		setKey(stringTable, 'len', createNativeFunction('string.len', (args, out) => {
			const text = this.requireVmString(args[0]);
			out.push(utf8CodepointCount(text));
		}));
		setKey(stringTable, 'upper', createNativeFunction('string.upper', (args, out) => {
			const text = this.requireVmString(args[0]);
			out.push(this.internVmString(text.toUpperCase()));
		}));
		setKey(stringTable, 'lower', createNativeFunction('string.lower', (args, out) => {
			const text = this.requireVmString(args[0]);
			out.push(this.internVmString(text.toLowerCase()));
		}));
		setKey(stringTable, 'sub', createNativeFunction('string.sub', (args, out) => {
			const text = this.requireVmString(args[0]);
			const length = utf8CodepointCount(text);
			const normalizeIndex = (value: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return 1;
			};
			const startArg = args.length > 1 ? (args[1] as number) : 1;
			const endArg = args.length > 2 ? (args[2] as number) : length;
			let startIndex = normalizeIndex(startArg);
			let endIndex = normalizeIndex(endArg);
			if (startIndex < 1) {
				startIndex = 1;
			}
			if (endIndex > length) {
				endIndex = length;
			}
			if (endIndex < startIndex) {
				out.push(this.internVmString(''));
				return;
			}
			const startUnit = utf8CodepointIndexToUnitIndex(text, startIndex);
			const endUnit = utf8CodepointIndexToUnitIndex(text, endIndex + 1);
			out.push(this.internVmString(text.slice(startUnit, endUnit)));
		}));
		setKey(stringTable, 'find', createNativeFunction('string.find', (args, out) => {
			const source = this.requireVmString(args[0]);
			const pattern = args.length > 1 ? this.requireVmString(args[1]) : '';
			const length = utf8CodepointCount(source);
			const normalizeIndex = (value: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return 1;
			};
			const startIndex = args.length > 2 ? normalizeIndex(args[2] as number) : 1;
			if (startIndex > length) {
				out.push(null);
				return;
			}
			const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
			const plain = args.length > 3 && args[3] === true;
			if (plain) {
				const position = source.indexOf(pattern, Math.max(0, startUnit));
				if (position === -1) {
					out.push(null);
					return;
				}
				const first = utf8CodepointCount(source.slice(0, position)) + 1;
				const last = utf8CodepointCount(source.slice(0, position + pattern.length));
				out.push(first, last);
				return;
			}
			const regexBase = this.buildLuaPatternRegex(pattern);
			const regex = new RegExp(regexBase.source);
			const slice = source.slice(Math.max(0, startUnit));
			const match = regex.exec(slice);
			if (!match) {
				out.push(null);
				return;
			}
			const matchStartUnit = startUnit + match.index;
			const matchEndUnit = matchStartUnit + match[0].length;
			const first = utf8CodepointCount(source.slice(0, matchStartUnit)) + 1;
			const last = utf8CodepointCount(source.slice(0, matchEndUnit));
			if (match.length > 1) {
				out.push(first, last);
				for (let index = 1; index < match.length; index += 1) {
					const value = match[index];
					out.push(value === undefined ? null : this.internVmString(value));
				}
				return;
			}
			out.push(first, last);
		}));
		setKey(stringTable, 'match', createNativeFunction('string.match', (args, out) => {
			const source = this.requireVmString(args[0]);
			const pattern = args.length > 1 ? this.requireVmString(args[1]) : '';
			const length = utf8CodepointCount(source);
			const normalizeIndex = (value: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return 1;
			};
			const startIndex = args.length > 2 ? normalizeIndex(args[2] as number) : 1;
			if (startIndex > length) {
				out.push(null);
				return;
			}
			const regexBase = this.buildLuaPatternRegex(pattern);
			const regex = new RegExp(regexBase.source);
			const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
			const slice = source.slice(Math.max(0, startUnit));
			const match = regex.exec(slice);
			if (!match) {
				out.push(null);
				return;
			}
			if (match.length > 1) {
				for (let index = 1; index < match.length; index += 1) {
					const value = match[index];
					out.push(value === undefined ? null : this.internVmString(value));
				}
				return;
			}
			out.push(this.internVmString(match[0]));
		}));
		setKey(stringTable, 'gsub', createNativeFunction('string.gsub', (args, out) => {
			const source = this.requireVmString(args[0]);
			const pattern = args.length > 1 ? this.requireVmString(args[1]) : '';
			const replacement = args.length > 2 ? args[2] : this.internVmString('');
			const maxReplacements = args.length > 3 && args[3] !== null
				? Math.max(0, Math.floor(args[3] as number))
				: Number.POSITIVE_INFINITY;

			const regex = this.buildLuaPatternRegex(pattern);
			regex.lastIndex = 0;

			let count = 0;
			let result = '';
			let lastIndex = 0;
			const fnArgs: Value[] = [];
			const fnResults: Value[] = [];

			const renderReplacement = (match: RegExpExecArray): string => {
				if (isStringValue(replacement) || typeof replacement === 'number') {
					const template = isStringValue(replacement) ? stringValueToString(replacement) : String(replacement);
					return template.replace(/%([0-9%])/g, (_full, token) => {
						if (token === '%') {
							return '%';
						}
						const index = parseInt(token, 10);
						if (!Number.isFinite(index)) {
							return token;
						}
						if (index === 0) {
							return match[0] ?? '';
						}
						const value = match[index];
						return value === undefined ? '' : value;
					});
				}
				if (replacement instanceof Table) {
					const keyValue = match.length > 1
						? (match[1] === undefined ? null : this.internVmString(match[1]))
						: this.internVmString(match[0]);
					const mapped = replacement.get(keyValue);
					return mapped === null ? match[0] : this.vmToString(mapped);
				}
				if (isNativeFunction(replacement) || (replacement !== null && typeof replacement === 'object' && 'protoIndex' in replacement)) {
					fnArgs.length = 0;
					if (match.length > 1) {
						for (let index = 1; index < match.length; index += 1) {
							const value = match[index];
							fnArgs.push(value === undefined ? null : this.internVmString(value));
						}
						if (fnArgs.length === 0) {
							fnArgs.push(this.internVmString(match[0]));
						}
					} else {
						fnArgs.push(this.internVmString(match[0]));
					}
					callVmValue(replacement, fnArgs, fnResults);
					const value = fnResults.length > 0 ? fnResults[0] : null;
					if (value === null || value === false) {
						return match[0];
					}
					return this.vmToString(value);
				}
				throw this.createApiRuntimeError('string.gsub replacement must be a string, number, function, or table.');
			};

			while (count < maxReplacements) {
				const match = regex.exec(source);
				if (!match) {
					break;
				}
				const start = match.index;
				const end = start + match[0].length;
				result += source.slice(lastIndex, start);
				result += renderReplacement(match);
				lastIndex = end;
				count += 1;
				if (match[0].length === 0) {
					regex.lastIndex += 1;
					if (regex.lastIndex > source.length) {
						break;
					}
				}
			}

			result += source.slice(lastIndex);
			out.push(this.internVmString(result), count);
		}));
		setKey(stringTable, 'gmatch', createNativeFunction('string.gmatch', (args, out) => {
			const source = this.requireVmString(args[0]);
			const pattern = args.length > 1 ? this.requireVmString(args[1]) : '';
			const regex = this.buildLuaPatternRegex(pattern);
			const iterator = createNativeFunction('string.gmatch.iterator', (_args, iterOut) => {
				const match = regex.exec(source);
				if (!match) {
					iterOut.push(null);
					return;
				}
				if (match[0].length === 0) {
					regex.lastIndex += 1;
				}
				if (match.length > 1) {
					for (let index = 1; index < match.length; index += 1) {
						const value = match[index];
						iterOut.push(value === undefined ? null : this.internVmString(value));
					}
					return;
				}
				iterOut.push(this.internVmString(match[0]));
			});
			out.push(iterator);
		}));
		setKey(stringTable, 'byte', createNativeFunction('string.byte', (args, out) => {
			const source = this.requireVmString(args[0]);
			const positionArg = args.length > 1 ? (args[1] as number) : 1;
			const position = Math.floor(positionArg);
			if (position < 1) {
				out.push(null);
				return;
			}
			let current = 1;
			for (const char of source) {
				if (current === position) {
					out.push(char.codePointAt(0) as number);
					return;
				}
				current += 1;
			}
			out.push(null);
		}));
		setKey(stringTable, 'char', createNativeFunction('string.char', (args, out) => {
			if (args.length === 0) {
				out.push(this.internVmString(''));
				return;
			}
			let result = '';
			for (let index = 0; index < args.length; index += 1) {
				const code = args[index] as number;
				result += String.fromCodePoint(Math.floor(code));
			}
			out.push(this.internVmString(result));
		}));
		setKey(stringTable, 'format', createNativeFunction('string.format', (args, out) => {
			const template = this.requireVmString(args[0]);
			const formatted = this.formatVmString(template, args, 1);
			out.push(this.internVmString(formatted));
		}));
		this.registerVmGlobal('string', stringTable);

		const tableLibrary = new Table(0, 0);
		setKey(tableLibrary, 'insert', createNativeFunction('table.insert', (args, out) => {
			const target = args[0] as Table;
			let position: number;
			let value: Value;
			if (args.length === 2) {
				value = args[1];
				position = target.length() + 1;
			} else {
				position = Math.floor(args[1] as number);
				value = args[2];
			}
			const length = target.length();
			for (let index = length; index >= position; index -= 1) {
				target.set(index + 1, target.get(index));
			}
			target.set(position, value);
			out.length = 0;
		}));
		setKey(tableLibrary, 'remove', createNativeFunction('table.remove', (args, out) => {
			const target = args[0] as Table;
			const position = args.length > 1 ? Math.floor(args[1] as number) : target.length();
			const length = target.length();
			const removed = target.get(position);
			for (let index = position; index < length; index += 1) {
				target.set(index, target.get(index + 1));
			}
			target.set(length, null);
			if (removed !== null) {
				out.push(removed);
			}
		}));
		setKey(tableLibrary, 'concat', createNativeFunction('table.concat', (args, out) => {
			const target = args[0] as Table;
			const separator = args.length > 1 ? this.requireVmString(args[1]) : '';
			const length = target.length();
			const normalizeIndex = (value: number, fallback: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return fallback;
			};
			const startIndex = args.length > 2 ? normalizeIndex(args[2] as number, 1) : 1;
			const endIndex = args.length > 3 ? normalizeIndex(args[3] as number, length) : length;
			if (endIndex < startIndex) {
				out.push(this.internVmString(''));
				return;
			}
			const parts: string[] = [];
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : this.vmToString(value));
			}
			out.push(this.internVmString(parts.join(separator)));
		}));
		setKey(tableLibrary, 'pack', createNativeFunction('table.pack', (args, out) => {
			const target = new Table(args.length, 1);
			for (let index = 0; index < args.length; index += 1) {
				target.set(index + 1, args[index]);
			}
			target.set(key('n'), args.length);
			out.push(target);
		}));
		setKey(tableLibrary, 'unpack', createNativeFunction('table.unpack', (args, out) => {
			const target = args[0] as Table;
			const length = target.length();
			const normalizeIndex = (value: number, fallback: number): number => {
				const integer = Math.floor(value);
				if (integer > 0) {
					return integer;
				}
				if (integer < 0) {
					return length + integer + 1;
				}
				return fallback;
			};
			const startIndex = args.length > 1 ? normalizeIndex(args[1] as number, 1) : 1;
			const endIndex = args.length > 2 ? normalizeIndex(args[2] as number, length) : length;
			if (endIndex < startIndex) {
				return;
			}
			for (let index = startIndex; index <= endIndex; index += 1) {
				out.push(target.get(index));
			}
		}));
		setKey(tableLibrary, 'sort', createNativeFunction('table.sort', (args, out) => {
			const target = args[0] as Table;
			const comparator = args.length > 1 ? args[1] : null;
			const length = target.length();
			const values: Value[] = new Array(length);
			for (let index = 1; index <= length; index += 1) {
				values[index - 1] = target.get(index);
			}
			const comparatorArgs: Value[] = [null, null];
			const comparatorResults: Value[] = [];
			values.sort((left, right) => {
				if (comparator !== null) {
					comparatorArgs[0] = left;
					comparatorArgs[1] = right;
					callVmValue(comparator, comparatorArgs, comparatorResults);
					return comparatorResults[0] === true ? -1 : 1;
				}
				if (typeof left === 'number' && typeof right === 'number') {
					return left - right;
				}
				if (isStringValue(left) && isStringValue(right)) {
					if (left === right) {
						return 0;
					}
					return stringValueToString(left) < stringValueToString(right) ? -1 : 1;
				}
				throw this.createApiRuntimeError('table.sort comparison expects numbers or strings.');
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			out.push(target);
		}));
		this.registerVmGlobal('table', tableLibrary);

		const osTable = new Table(0, 0);
		const formatOsDate = (format: string, date: Date): string => {
			const pad = (value: number, size: number): string => {
				let text = Math.floor(value).toString();
				while (text.length < size) {
					text = `0${text}`;
				}
				return text;
			};
			const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			const weekdaysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
			const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
			const year = date.getFullYear();
			const month = date.getMonth() + 1;
			const day = date.getDate();
			const hour = date.getHours();
			const min = date.getMinutes();
			const sec = date.getSeconds();
			const ydayStart = new Date(year, 0, 1);
			const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
			const wday = date.getDay();
			const hour12 = hour % 12 === 0 ? 12 : hour % 12;
			const ampm = hour < 12 ? 'AM' : 'PM';
			let output = '';
			for (let index = 0; index < format.length; index += 1) {
				const ch = format.charAt(index);
				if (ch !== '%') {
					output += ch;
					continue;
				}
				index += 1;
				const code = format.charAt(index);
				switch (code) {
					case 'Y':
						output += pad(year, 4);
						break;
					case 'y':
						output += pad(year % 100, 2);
						break;
					case 'm':
						output += pad(month, 2);
						break;
					case 'd':
						output += pad(day, 2);
						break;
					case 'H':
						output += pad(hour, 2);
						break;
					case 'M':
						output += pad(min, 2);
						break;
					case 'S':
						output += pad(sec, 2);
						break;
					case 'I':
						output += pad(hour12, 2);
						break;
					case 'p':
						output += ampm;
						break;
					case 'a':
						output += weekdaysShort[wday];
						break;
					case 'A':
						output += weekdaysLong[wday];
						break;
					case 'b':
						output += monthsShort[month - 1];
						break;
					case 'B':
						output += monthsLong[month - 1];
						break;
					case 'j':
						output += pad(yday, 3);
						break;
					case 'w':
						output += wday.toString();
						break;
					case 'c':
						output += date.toLocaleString();
						break;
					case 'x':
						output += date.toLocaleDateString();
						break;
					case 'X':
						output += date.toLocaleTimeString();
						break;
					case 'Z': {
						const tz = date.toTimeString();
						const start = tz.indexOf('(');
						const end = tz.lastIndexOf(')');
						if (start !== -1 && end !== -1 && end > start) {
							output += tz.slice(start + 1, end);
						} else {
							output += 'UTC';
						}
						break;
					}
					case '%':
						output += '%';
						break;
					default:
						output += `%${code}`;
						break;
				}
			}
			return output;
		};
		const buildOsDateTable = (date: Date): Table => {
			const year = date.getFullYear();
			const ydayStart = new Date(year, 0, 1);
			const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
			const jan = new Date(year, 0, 1);
			const jul = new Date(year, 6, 1);
			const isDst = date.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
			const table = new Table(0, 9);
			setKey(table, 'year', year);
			setKey(table, 'month', date.getMonth() + 1);
			setKey(table, 'day', date.getDate());
			setKey(table, 'hour', date.getHours());
			setKey(table, 'min', date.getMinutes());
			setKey(table, 'sec', date.getSeconds());
			setKey(table, 'wday', date.getDay() + 1);
			setKey(table, 'yday', yday);
			setKey(table, 'isdst', isDst);
			return table;
		};
		setKey(osTable, 'clock', createNativeFunction('os.clock', (_args, out) => {
			out.push($.platform.clock.now() / 1000);
		}));
		setKey(osTable, 'time', createNativeFunction('os.time', (args, out) => {
			if (args.length > 0 && args[0] !== null) {
				const table = args[0] as Table;
				const year = table.get(key('year')) as number;
				const month = table.get(key('month')) as number;
				const day = table.get(key('day')) as number;
				const hour = table.get(key('hour')) as number;
				const min = table.get(key('min')) as number;
				const sec = table.get(key('sec')) as number;
				const date = new Date(year, month - 1, day, hour, min, sec);
				out.push(Math.floor(date.getTime() / 1000));
				return;
			}
			out.push(Math.floor(Date.now() / 1000));
		}));
		setKey(osTable, 'difftime', createNativeFunction('os.difftime', (args, out) => {
			const t2 = args[0] as number;
			const t1 = args[1] as number;
			out.push(t2 - t1);
		}));
		setKey(osTable, 'date', createNativeFunction('os.date', (args, out) => {
			const format = args.length > 0 && args[0] !== null ? this.requireVmString(args[0]) : '%c';
			const timeValue = args.length > 1 && args[1] !== null ? (args[1] as number) * 1000 : Date.now();
			const date = new Date(timeValue);
			if (format === '*t') {
				out.push(buildOsDateTable(date));
				return;
			}
			out.push(this.internVmString(formatOsDate(format, date)));
		}));
		this.registerVmGlobal('os', osTable);

		const nextFn = createNativeFunction('next', (args, out) => {
			const target = args[0];
			const key = args.length > 1 ? args[1] : null;
			if (target instanceof Table) {
				const entry = target.nextEntry(key);
				if (entry === null) {
					out.push(null);
					return;
				}
				out.push(entry[0], entry[1]);
				return;
			}
			if (isNativeObject(target)) {
				const entry = this.nextNativeEntry(target, key);
				if (entry === null) {
					out.push(null);
					return;
				}
				out.push(entry[0], entry[1]);
				return;
			}
			throw this.createApiRuntimeError('next expects a table or native object.');
		});
		const ipairsIterator = createNativeFunction('ipairs.iterator', (args, out) => {
			const target = args[0];
			const index = args[1] as number;
			const nextIndex = Math.floor(index) + 1;
			if (target instanceof Table) {
				const value = target.get(nextIndex);
				if (value === null) {
					out.push(null);
					return;
				}
				out.push(nextIndex, value);
				return;
			}
			if (isNativeObject(target)) {
				const raw = target.raw as object;
				if (Array.isArray(raw)) {
					const value = (raw as unknown[])[nextIndex - 1];
					if (value === undefined || value === null) {
						out.push(null);
						return;
					}
					out.push(nextIndex, this.toVmValue(value));
					return;
				}
				const value = (raw as Record<string, unknown>)[String(nextIndex)];
				if (value === undefined || value === null) {
					out.push(null);
					return;
				}
				out.push(nextIndex, this.toVmValue(value));
				return;
			}
			throw this.createApiRuntimeError('ipairs expects a table or native object.');
		});
		this.registerVmGlobal('next', nextFn);
			this.registerVmGlobal('pairs', createNativeFunction('pairs', (args, out) => {
				const target = args[0];
				if (!(target instanceof Table) && !isNativeObject(target)) {
					const stack = this.buildVmStackFrames()
						.map(frame => `${frame.source ?? '<unknown>'}:${frame.line ?? '?'}:${frame.column ?? '?'}`)
						.join(' <- ');
					throw this.createApiRuntimeError(`pairs expects a table or native object (got ${this.formatVmValue(target)}). stack=${stack}`);
				}
				out.push(nextFn, target, null);
			}));
		this.registerVmGlobal('ipairs', createNativeFunction('ipairs', (args, out) => {
			const target = args[0];
			if (!(target instanceof Table) && !isNativeObject(target)) {
				throw this.createApiRuntimeError('ipairs expects a table or native object.');
			}
			out.push(ipairsIterator, target, 0);
		}));

		const members = this.collectApiMembers();
		for (const { name, kind, descriptor } of members) {
			if (kind === 'method') {
				const callable = descriptor.value as (...args: unknown[]) => unknown;
				const native = createNativeFunction(`api.${name}`, (args, out) => {
					const ctx = this.buildVmContext();
					const visited = new WeakMap<Table, unknown>();
					const jsArgs: unknown[] = [];
					for (let index = 0; index < args.length; index += 1) {
						const nextCtx = this.extendMarshalContext(ctx, `arg${index}`);
						jsArgs.push(this.toNativeValue(args[index], nextCtx, visited));
					}
					try {
						const result = callable.apply(api, jsArgs);
						this.wrapNativeResult(result, out);
					} catch (error) {
						const message = extractErrorMessage(error);
						throw this.createApiRuntimeError(`[api.${name}] ${message}`);
					}
				});
				this.registerVmGlobal(name, native);
				continue;
			}
			if (descriptor.get) {
				const getter = descriptor.get;
				const native = createNativeFunction(`api.${name}`, (_args, out) => {
					try {
						const result = getter.call(api);
						this.wrapNativeResult(result, out);
					} catch (error) {
						const message = extractErrorMessage(error);
						throw this.createApiRuntimeError(`[api.${name}] ${message}`);
					}
				});
				this.registerVmGlobal(name, native);
			}
		}

		this.exposeVmObjects();
	}

	private nextVmRandom(): number {
		this.vmRandomSeedValue = (this.vmRandomSeedValue * 1664525 + 1013904223) % 4294967296;
		return this.vmRandomSeedValue / 4294967296;
	}

	private buildLuaPatternRegex(pattern: string): RegExp {
		let output = '';
		let inClass = false;
		for (let index = 0; index < pattern.length; index += 1) {
			const ch = pattern.charAt(index);
			if (inClass) {
				if (ch === ']') {
					inClass = false;
					output += ']';
					continue;
				}
				if (ch === '%') {
					index += 1;
					if (index >= pattern.length) {
						throw this.createApiRuntimeError('string.gmatch invalid pattern.');
					}
					output += this.translateLuaPatternEscape(pattern.charAt(index), true);
					continue;
				}
				if (ch === '\\') {
					output += '\\\\';
					continue;
				}
				output += ch;
				continue;
			}
			if (ch === '[') {
				inClass = true;
				output += '[';
				continue;
			}
			if (ch === '%') {
				index += 1;
				if (index >= pattern.length) {
					throw this.createApiRuntimeError('string.gmatch invalid pattern.');
				}
				output += this.translateLuaPatternEscape(pattern.charAt(index), false);
				continue;
			}
			if (ch === '-') {
				output += '*?';
				continue;
			}
			if (ch === '^') {
				output += index === 0 ? '^' : '\\^';
				continue;
			}
			if (ch === '$') {
				output += index === pattern.length - 1 ? '$' : '\\$';
				continue;
			}
			if (ch === '(' || ch === ')' || ch === '.' || ch === '+' || ch === '*' || ch === '?') {
				output += ch;
				continue;
			}
			if (ch === '|' || ch === '{' || ch === '}' || ch === '\\') {
				output += `\\${ch}`;
				continue;
			}
			output += ch;
		}
		if (inClass) {
			throw this.createApiRuntimeError('string.gmatch invalid pattern.');
		}
		return new RegExp(output, 'g');
	}

	private translateLuaPatternEscape(token: string, inClass: boolean): string {
		switch (token) {
			case 'a':
				return inClass ? 'A-Za-z' : '[A-Za-z]';
			case 'd':
				return inClass ? '0-9' : '\\d';
			case 'l':
				return inClass ? 'a-z' : '[a-z]';
			case 'u':
				return inClass ? 'A-Z' : '[A-Z]';
			case 'w':
				return inClass ? 'A-Za-z0-9_' : '[A-Za-z0-9_]';
			case 'x':
				return inClass ? 'A-Fa-f0-9' : '[A-Fa-f0-9]';
			case 'z':
				return '\\x00';
			case 'c':
				return inClass ? '\\x00-\\x1F\\x7F' : '[\\x00-\\x1F\\x7F]';
			case 'g':
				return inClass ? '\\x21-\\x7E' : '[\\x21-\\x7E]';
			case 's':
				return '\\s';
			case 'p': {
				const punctuation = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
				const escaped = punctuation.replace(/[\\\-\]]/g, '\\$&');
				return inClass ? escaped : `[${escaped}]`;
			}
			case '%':
				return '%';
			default:
				return `\\${token}`;
		}
	}

	private vmTypeOf(value: Value): StringValue {
		if (value === null) {
			return this.internVmString('nil');
		}
		if (typeof value === 'boolean') {
			return this.internVmString('boolean');
		}
		if (typeof value === 'number') {
			return this.internVmString('number');
		}
		if (isStringValue(value)) {
			return this.internVmString('string');
		}
		if (value instanceof Table) {
			return this.internVmString('table');
		}
		if (isNativeFunction(value)) {
			return this.internVmString('function');
		}
		if (isNativeObject(value)) {
			return this.internVmString('native');
		}
		return this.internVmString('function');
	}

	private createNativeArrayFromTable(table: Table, context: LuaMarshalContext): unknown[] {
		const tableId = this.getOrAssignVmTableId(table);
		const tableContext = this.extendMarshalContext(context, `table${tableId}`);
		const entries = table.entriesArray();
		const output: unknown[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const [key, value] = entries[index];
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				output[key - 1] = this.toNativeValue(value, this.extendMarshalContext(tableContext, String(key)), new WeakMap());
				continue;
			}
			const segment = this.describeMarshalSegment(key);
			const nextContext = segment ? this.extendMarshalContext(tableContext, segment) : tableContext;
			output.push(this.toNativeValue(value, nextContext, new WeakMap()));
		}
		return output;
	}

	private collectApiMembers(): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor }> {
		const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor }>();
		let prototype: object = Object.getPrototypeOf(api);
		while (prototype && prototype !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(prototype)) {
				if (name === 'constructor') continue;
				const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
				if (!descriptor || map.has(name)) continue;
				if (typeof descriptor.value === 'function') {
					map.set(name, { kind: 'method', descriptor });
				} else if (descriptor.get) {
					map.set(name, { kind: 'getter', descriptor });
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
		return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
	}

	private exposeVmObjects(): void {
		const entries: Array<[string, object]> = [
			['world', $.world],
			['game', $],
			['$', $],
			['registry', $.registry],
		];
		for (const [name, object] of entries) {
			this.registerVmGlobal(name, this.getOrCreateNativeObject(object));
		}
		this.registerVmGlobal('assets', this.getOrCreateAssetsNativeObject());
	}

	private vmToString(value: Value): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value.toString() : 'nan';
		}
		if (isStringValue(value)) {
			return stringValueToString(value);
		}
		if (value instanceof Table) {
			return 'table';
		}
		if (isNativeFunction(value)) {
			return 'function';
		}
		if (isNativeObject(value)) {
			return 'native';
		}
		return 'function';
	}

	private requireVmString(value: Value): string {
		return stringValueToString(value as StringValue);
	}

	public formatVmValue(value: Value): string {
		return this.vmToString(value);
	}

	private formatVmString(template: string, args: ReadonlyArray<Value>, argStart: number): string {
		let argumentIndex = argStart;
		let output = '';

		const takeArgument = (): Value => {
			const value = argumentIndex < args.length ? args[argumentIndex] : null;
			argumentIndex += 1;
			return value;
		};

		const readInteger = (startIndex: number): { found: boolean; value: number; nextIndex: number } => {
			let cursor = startIndex;
			while (cursor < template.length) {
				const code = template.charCodeAt(cursor);
				if (code < 48 || code > 57) {
					break;
				}
				cursor += 1;
			}
			if (cursor === startIndex) {
				return { found: false, value: 0, nextIndex: startIndex };
			}
			return { found: true, value: parseInt(template.slice(startIndex, cursor), 10), nextIndex: cursor };
		};

		for (let index = 0; index < template.length; index += 1) {
			const current = template.charAt(index);
			if (current !== '%') {
				output += current;
				continue;
			}
			if (index === template.length - 1) {
				throw this.createApiRuntimeError('string.format incomplete format specifier.');
			}
			if (template.charAt(index + 1) === '%') {
				output += '%';
				index += 1;
				continue;
			}

			let cursor = index + 1;
			const flags = { leftAlign: false, plus: false, space: false, zeroPad: false, alternate: false };
			while (true) {
				const flag = template.charAt(cursor);
				if (flag === '-') {
					flags.leftAlign = true;
					cursor += 1;
					continue;
				}
				if (flag === '+') {
					flags.plus = true;
					cursor += 1;
					continue;
				}
				if (flag === ' ') {
					flags.space = true;
					cursor += 1;
					continue;
				}
				if (flag === '0') {
					flags.zeroPad = true;
					cursor += 1;
					continue;
				}
				if (flag === '#') {
					flags.alternate = true;
					cursor += 1;
					continue;
				}
				break;
			}

			let width: number = null;
			if (template.charAt(cursor) === '*') {
				const widthArg = Math.trunc(takeArgument() as number);
				if (widthArg < 0) {
					flags.leftAlign = true;
					width = -widthArg;
				} else {
					width = widthArg;
				}
				cursor += 1;
			} else {
				const parsedWidth = readInteger(cursor);
				if (parsedWidth.found) {
					width = parsedWidth.value;
					cursor = parsedWidth.nextIndex;
				}
			}

			let precision: number = null;
			if (template.charAt(cursor) === '.') {
				cursor += 1;
				if (template.charAt(cursor) === '*') {
					const precisionArg = Math.trunc(takeArgument() as number);
					precision = precisionArg >= 0 ? precisionArg : null;
					cursor += 1;
				} else {
					const parsedPrecision = readInteger(cursor);
					precision = parsedPrecision.found ? parsedPrecision.value : 0;
					cursor = parsedPrecision.nextIndex;
				}
			}

			while (template.charAt(cursor) === 'l' || template.charAt(cursor) === 'L' || template.charAt(cursor) === 'h') {
				cursor += 1;
			}

			const specifier = template.charAt(cursor);
			if (specifier.length === 0) {
				throw this.createApiRuntimeError('string.format incomplete format specifier.');
			}

			const signPrefix = (value: number): string => {
				if (value < 0) {
					return '-';
				}
				if (flags.plus) {
					return '+';
				}
				if (flags.space) {
					return ' ';
				}
				return '';
			};

			const applyPadding = (content: string, sign: string, prefix: string, allowZeroPadding: boolean): string => {
				const totalLength = sign.length + prefix.length + content.length;
				if (width !== null && totalLength < width) {
					const paddingLength = width - totalLength;
					if (flags.leftAlign) {
						return `${sign}${prefix}${content}${' '.repeat(paddingLength)}`;
					}
					const padChar = allowZeroPadding ? '0' : ' ';
					if (padChar === '0') {
						return `${sign}${prefix}${'0'.repeat(paddingLength)}${content}`;
					}
					return `${' '.repeat(paddingLength)}${sign}${prefix}${content}`;
				}
				return `${sign}${prefix}${content}`;
			};

			switch (specifier) {
				case 's': {
					const value = takeArgument();
					let text = value === null ? 'nil' : this.vmToString(value);
					if (precision !== null) {
						text = text.substring(0, precision);
					}
					output += applyPadding(text, '', '', false);
					break;
				}
				case 'c': {
					const value = takeArgument() as number;
					const character = String.fromCharCode(Math.trunc(value));
					output += applyPadding(character, '', '', false);
					break;
				}
				case 'd':
				case 'i':
				case 'u':
				case 'o':
				case 'x':
				case 'X': {
					let number = takeArgument() as number;
					let integerValue = Math.trunc(number);
					const unsigned = specifier === 'u' || specifier === 'o' || specifier === 'x' || specifier === 'X';
					if (unsigned) {
						integerValue = integerValue >>> 0;
					}
					const negative = !unsigned && integerValue < 0;
					const sign = negative ? '-' : (specifier === 'd' || specifier === 'i') ? signPrefix(integerValue) : '';
					const magnitude = negative ? -integerValue : integerValue;
					let base = 10;
					if (specifier === 'o') {
						base = 8;
					}
					if (specifier === 'x' || specifier === 'X') {
						base = 16;
					}
					let digits = Math.trunc(magnitude).toString(base);
					if (specifier === 'X') {
						digits = digits.toUpperCase();
					}
					if (precision !== null) {
						const required = Math.max(precision, 0);
						if (digits.length < required) {
							digits = '0'.repeat(required - digits.length) + digits;
						}
						if (precision === 0 && magnitude === 0) {
							digits = '';
						}
					}
					let prefix = '';
					if (flags.alternate) {
						if ((specifier === 'x' || specifier === 'X') && magnitude !== 0) {
							prefix = specifier === 'x' ? '0x' : '0X';
						}
						if (specifier === 'o') {
							if (digits.length === 0) {
								digits = '0';
							} else if (digits.charAt(0) !== '0') {
								digits = `0${digits}`;
							}
						}
					}
					const allowZeroPad = flags.zeroPad && !flags.leftAlign && precision === null;
					output += applyPadding(digits, sign, prefix, allowZeroPad);
					break;
				}
				case 'f':
				case 'F': {
					const number = takeArgument() as number;
					const sign = signPrefix(number);
					const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
					const text = Math.abs(number).toFixed(fractionDigits);
					const formatted = flags.alternate && fractionDigits === 0 && text.indexOf('.') === -1 ? `${text}.` : text;
					const allowZeroPad = flags.zeroPad && !flags.leftAlign;
					output += applyPadding(formatted, sign, '', allowZeroPad);
					break;
				}
				case 'e':
				case 'E': {
					const number = takeArgument() as number;
					const sign = signPrefix(number);
					const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
					let text = Math.abs(number).toExponential(fractionDigits);
					if (specifier === 'E') {
						text = text.toUpperCase();
					}
					const allowZeroPad = flags.zeroPad && !flags.leftAlign;
					output += applyPadding(text, sign, '', allowZeroPad);
					break;
				}
				case 'g':
				case 'G': {
					const number = takeArgument() as number;
					const sign = signPrefix(number);
					const significant = precision === null ? 6 : precision === 0 ? 1 : precision;
					let text = Math.abs(number).toPrecision(significant);
					if (!flags.alternate) {
						if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) {
							const parts = text.split(/e/i);
							let mantissa = parts[0];
							const exponent = parts[1];
							if (mantissa.indexOf('.') !== -1) {
								while (mantissa.endsWith('0')) {
									mantissa = mantissa.slice(0, -1);
								}
								if (mantissa.endsWith('.')) {
									mantissa = mantissa.slice(0, -1);
								}
							}
							text = `${mantissa}e${exponent}`;
						} else if (text.indexOf('.') !== -1) {
							while (text.endsWith('0')) {
								text = text.slice(0, -1);
							}
							if (text.endsWith('.')) {
								text = text.slice(0, -1);
							}
						}
					}
					if (specifier === 'G') {
						text = text.toUpperCase();
					}
					const allowZeroPad = flags.zeroPad && !flags.leftAlign;
					output += applyPadding(text, sign, '', allowZeroPad);
					break;
				}
				case 'q': {
					const value = takeArgument();
					const raw = value === null ? 'nil' : this.vmToString(value);
					let escaped = '"';
					for (let charIndex = 0; charIndex < raw.length; charIndex += 1) {
						const code = raw.charCodeAt(charIndex);
						switch (code) {
							case 10:
								escaped += '\\n';
								break;
							case 13:
								escaped += '\\r';
								break;
							case 9:
								escaped += '\\t';
								break;
							case 92:
								escaped += '\\\\';
								break;
							case 34:
								escaped += '\\"';
								break;
							default:
								if (code < 32 || code === 127) {
									const decimal = code.toString(10);
									escaped += `\\${decimal.padStart(3, '0')}`;
								} else {
									escaped += raw.charAt(charIndex);
								}
								break;
						}
					}
					escaped += '"';
					output += applyPadding(escaped, '', '', false);
					break;
				}
				default:
					throw this.createApiRuntimeError(`string.format unsupported format specifier '%${specifier}'.`);
			}

			index = cursor;
		}

		return output;
	}

	private processVmIo(): void {
		const memory = this.cpuMemory;
		const count = memory[IO_WRITE_PTR_ADDR] as number;
		if (!count) {
			return;
		}
		const base = IO_BUFFER_BASE;
		for (let index = 0; index < count; index += 1) {
			const cmdBase = base + index * IO_COMMAND_STRIDE;
			const cmd = memory[cmdBase] as number;
			switch (cmd) {
					case IO_CMD_PRINT: {
						const arg = memory[cmdBase + IO_ARG0_OFFSET];
						const text = this.formatVmValue(arg);
						this.terminal.appendStdout(text);
						if ($.view.backendType === 'headless') {
							// eslint-disable-next-line no-console
							console.log(text);
						}
						break;
					}
				default:
					throw new Error(`Unknown VM IO command: ${cmd}.`);
			}
		}
		memory[IO_WRITE_PTR_ADDR] = 0;
	}

	private logVmDebugState(): void {
		if (!this.cpu.hasFrames()) {
			return;
		}
		const debug = this.cpu.getDebugState();
		const instr = debug.instr;
		const program = this.cpu.getProgram();
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		if (debug.pc > 0) {
			const previous = readInstructionWord(program.code, debug.pc - 1);
			const prevOp = (previous >>> 18) & 0x3f;
			if (prevOp === OpCode.WIDE) {
				wideA = (previous >>> 12) & 0x3f;
				wideB = (previous >>> 6) & 0x3f;
				wideC = previous & 0x3f;
			}
		}
		const op = (instr >>> 18) & 0x3f;
		const aLow = (instr >>> 12) & 0x3f;
		const bLow = (instr >>> 6) & 0x3f;
		const cLow = instr & 0x3f;
		const a = (wideA << 6) | aLow;
		const b = (wideB << 6) | bLow;
		const c = (wideC << 6) | cLow;
		const ra = debug.registers[a];
		const rb = debug.registers[b];
		const rc = debug.registers[c];
		console.info(`[BmsxVMRuntime] VM debug: pc=${debug.pc} op=${op} a=${a} b=${b} c=${c} ra=${this.formatVmValue(ra)} rb=${this.formatVmValue(rb)} rc=${this.formatVmValue(rc)}`);
	}

	private buildVmStackFrames(): StackTraceFrame[] {
		const callStack = this.cpu.getCallStack();
		const frames: StackTraceFrame[] = [];
		for (let index = callStack.length - 1; index >= 0; index -= 1) {
			const entry = callStack[index];
			const range = this.cpu.getDebugRange(entry.pc);
			const source = range ? range.path : this._luaPath;
			const line = range ? range.start.line : null;
			const column = range ? range.start.column : null;
			const functionName = this.resolveVmFunctionName(entry.protoIndex);
			frames.push({
				origin: 'lua',
				functionName,
				source,
				line,
				column,
				raw: buildLuaFrameRawLabel(functionName, source),
			});
		}
		return frames;
	}

	private resolveVmFunctionName(protoIndex: number): string {
		if (!this.vmProgramMetadata) {
			return `proto:${protoIndex}`;
		}
		const protoId = this.vmProgramMetadata.protoIds[protoIndex];
		const slashIndex = protoId.lastIndexOf('/');
		const hint = slashIndex >= 0 ? protoId.slice(slashIndex + 1) : protoId;
		if (hint.startsWith('decl:')) {
			return hint.slice(5);
		}
		if (hint.startsWith('assign:')) {
			return hint.slice(7);
		}
		if (hint.startsWith('local:')) {
			const rawName = hint.slice(6);
			const hashIndex = rawName.indexOf('#');
			return hashIndex >= 0 ? rawName.slice(0, hashIndex) : rawName;
		}
		if (hint.startsWith('anon:')) {
			return 'anonymous';
		}
		return hint;
	}

	private resolveProgramAssetSource(): RawAssetSource {
		const source = this.isEngineProgramActive() ? this.engineAssetSource : this.cartAssetSource;
		if (!source) {
			throw new Error('[BmsxVMRuntime] Program asset source not configured.');
		}
		return source;
	}

	private hasLuaAssets(): boolean {
		const source = this.resolveProgramAssetSource();
		return source.list('lua').length > 0;
	}

	private loadVmProgramAssets(): { program: VmProgramAsset; symbols: VmProgramSymbolsAsset | null } {
		const source = this.resolveProgramAssetSource();
		const programEntry = source.getEntry(VM_PROGRAM_ASSET_ID);
		if (!programEntry) {
			throw new Error('[BmsxVMRuntime] VM program asset not found.');
		}
		const program = decodeProgramAsset(source.getBytes(programEntry));
		const symbolsEntry = source.getEntry(VM_PROGRAM_SYMBOLS_ASSET_ID);
		const symbols = symbolsEntry ? decodeProgramSymbolsAsset(source.getBytes(symbolsEntry)) : null;
		return { program, symbols };
	}

	private buildVmModuleChunks(entryPath: string): { modules: Array<{ path: string; chunk: LuaChunk }>; modulePaths: string[] } {
		const entryAsset = this.resolveLuaSourceRecord(entryPath);
		const entryKey = entryAsset ? (entryAsset.normalized_source_path ?? entryAsset.source_path ?? entryPath) : entryPath;
		const modules: Array<{ path: string; chunk: LuaChunk }> = [];
		const modulePaths: string[] = [];
		const seen = new Set<string>();
		const registries = this.resolveModuleRegistries();
		for (const registry of registries) {
			if (!registry) {
				continue;
			}
			const luaAssets = Object.values(registry.path2lua);
			for (const asset of luaAssets) {
				if (!asset || asset.type !== 'lua') {
					continue;
				}
				const key = asset.normalized_source_path ?? asset.source_path;
				if (!key || seen.has(key)) {
					continue;
				}
				seen.add(key);
				modulePaths.push(key);
				if (key === entryKey) {
					continue;
				}
				const source = this.resourceSourceForChunk(asset.source_path);
				const chunk = this.luaInterpreter.compileChunk(source, asset.source_path);
				modules.push({ path: key, chunk });
			}
		}
		return { modules, modulePaths };
	}

	private bootVmProgramAsset(options?: { preserveState?: boolean; runInit?: boolean }): boolean {
		const { program, symbols } = this.loadVmProgramAssets();
		this.cartEntryAvailable = true;
		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreter();
		this.assignInterpreter(interpreter);

		this._luaPath = $.luaSources.entry_path;
		if (!options?.preserveState) {
			this.resetVmState();
		}

		const protoMap = buildModuleProtoMap(program.moduleProtos);
		this.vmModuleProtos.clear();
		for (const [path, protoIndex] of protoMap.entries()) {
			this.vmModuleProtos.set(path, protoIndex);
		}
		const aliasMap = buildModuleAliasMap(program.moduleAliases);
		this.vmModuleAliases.clear();
		for (const [alias, path] of aliasMap.entries()) {
			this.vmModuleAliases.set(alias, path);
		}
		this.vmModuleCache.clear();
		this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;

		const inflated = inflateProgram(program.program);
		const metadata = symbols ? symbols.metadata : null;
		this.cpu.setProgram(inflated, metadata);
		this.vmProgramMetadata = metadata;
		this.applyEngineBuiltinGlobals();
		this.processVmIo();

		this.cpu.start(program.entryProtoIndex);
		this.pendingVmCall = null;
		this.cpu.instructionBudgetRemaining = null;
		this.cpu.run(null);
		this.processVmIo();
		this.luaVmInitialized = true;

		this.bindLifecycleHandlers();
		if (options?.runInit === false) {
			return true;
		}
		const ok = this.runLuaLifecycleHandler('init');
		if (!ok) {
			return false;
		}
		return this.runLuaLifecycleHandler('new_game');
	}

	private bootActiveProgram(options?: { preserveState?: boolean; runInit?: boolean }): boolean {
		const ok = this.hasLuaAssets()
			? this.bootLuaProgram({ preserveState: options?.preserveState })
			: this.bootVmProgramAsset(options);
		if (!this.vmProgramMetadata && this.editor.isActive) {
			this.deactivateEditor();
		}
		return ok;
	}

	private bootLuaProgram(options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
		const entryAsset = $.luaSources.path2lua[$.luaSources.entry_path];
		this.cartEntryAvailable = !!entryAsset;

		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreter();
		this.assignInterpreter(interpreter);

		if (!entryAsset) {
			this._luaPath = null;
			return false;
		}
		const path = entryAsset.source_path;
		if (!path || path.length === 0) {
			throw new Error('[BmsxVMRuntime] Cannot boot Lua program: entry asset has no path name.');
		}

		this._luaPath = path;
		if (!options?.preserveState) {
			this.resetVmState();
		}

		try {
			const entryPath = options?.sourceOverride?.path ?? path;
			const entrySource = options?.sourceOverride?.source ?? this.resourceSourceForChunk(entryPath);
			const entryChunk = interpreter.compileChunk(entrySource, entryPath);
			const { modules, modulePaths } = this.buildVmModuleChunks(entryPath);
			const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, { canonicalization: this._canonicalization });
			this.vmModuleProtos.clear();
			for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
				this.vmModuleProtos.set(modulePath, protoIndex);
			}
			this.vmModuleAliases.clear();
			for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
				this.vmModuleAliases.set(entry.alias, entry.path);
			}
			this.vmModuleCache.clear();
			this.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
			const prelude = this.runEngineBuiltinPrelude(program, metadata);
			this.vmProgramMetadata = prelude.metadata;
			this.cpu.start(entryProtoIndex);
			this.pendingVmCall = null;
			this.cpu.instructionBudgetRemaining = null;
			this.cpu.run(null);
			this.processVmIo();
			this.luaVmInitialized = true;
		}
		catch (error) {
			console.info(`[BmsxVMRuntime] Lua boot '${path}' failed.`);
			this.logVmDebugState();
			this.handleLuaError(error);
			return false;
		}

		this.bindLifecycleHandlers();

		const ok = this.runLuaLifecycleHandler('init');
		if (!ok) {
			return false;
		}
		return this.runLuaLifecycleHandler('new_game');
	}

	public async reloadProgramAndResetWorld(options?: { runInit?: boolean }): Promise<void> {
		const vmToken = this.luaVmGate.begin({ blocking: true, tag: 'reload_and_reset' });
		try {
			const preservingSuspension = this.pauseCoordinator.hasSuspension();
			if (!preservingSuspension) {
				this.pauseCoordinator.clearSuspension();
				this.setDebuggerPaused(false);
				this.clearRuntimeFault();
			}

			// Full reboot starts from a clean Lua path environment cache to avoid merging
			// stale per-path tables (from previously loaded modules) into the fresh program.
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();

			// Reload the active program source and reset the world
			await $.reset_to_fresh_world();
			$.view.primaryAtlas = 0;
			try {
				this.resetVmState();
				if (this.hasLuaAssets()) {
					this.reloadLuaProgramState({ runInit: options?.runInit !== false });
				} else {
					this.bootVmProgramAsset({ preserveState: true, runInit: options?.runInit });
					if (!this.vmProgramMetadata && this.editor.isActive) {
						this.deactivateEditor();
					}
				}
			} catch (error) {
				this.handleLuaError(error);
			}
		}
		finally {
			this.luaVmGate.end(vmToken);
		}
	}

	public handleLuaError(whatever: unknown): void {
		const error = convertToError(whatever);
		// Pause signal has its own handler
		if (isLuaDebuggerPauseSignal(error)) {
			console.info('[BmsxVMRuntime] Lua debugger pause signal received: ', error);
			this.onLuaDebuggerPause(error);
			return;
		}

		// Avoid handling the same Error object repeatedly
		if (this.handledLuaErrors.has(error)) {
			return;
		}
		this.logVmDebugState();
		this.lastVmCallStack = this.buildVmStackFrames();

		// Extract message and location info
		const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
		const { line, column, path } = this.extractErrorLocation(error);

		const innermostVmFrame = this.lastVmCallStack.length > 0 ? this.lastVmCallStack[0] : null;
		const resolvedPath = innermostVmFrame ? innermostVmFrame.source : (path ?? this._luaPath);
		const resolvedLine = innermostVmFrame ? innermostVmFrame.line : line;
		const resolvedColumn = innermostVmFrame ? innermostVmFrame.column : column;
		const runtimeDetails = this.buildRuntimeErrorDetailsForEditor(error, message);

		const stackText = buildErrorStackString(
			error instanceof Error && error.name ? error.name : 'Error',
			message,
			runtimeDetails,
			this.includeJsStackTraces,
		);
		this.setRuntimeFault({
			message,
			path: resolvedPath,
			line: resolvedLine,
			column: resolvedColumn,
			details: runtimeDetails,
			fromDebugger: false,
		});
		if (error instanceof Error) {
			error.message = message;
			error.stack = stackText;
		}
		console.error(stackText);
		this.terminal.appendError(error);
		this.activateTerminalMode();
		this.handledLuaErrors.add(error);
	}

	private buildRuntimeErrorDetailsForEditor(error: unknown, message: string, callStack?: ReadonlyArray<LuaCallFrame>): RuntimeErrorDetails {
		if (error instanceof LuaSyntaxError) {
			return null;
		}
		const useInterpreterStack = callStack !== undefined;
		const callFrames = useInterpreterStack ? callStack : null;
		let luaFrames: StackTraceFrame[] = [];
		if (useInterpreterStack) {
			luaFrames = callFrames.length > 0 ? convertLuaCallFrames(callFrames) : [];
		} else if (this.lastVmCallStack.length > 0) {
			luaFrames = this.lastVmCallStack.slice();
		}
		// If the thrown error includes precise location, prepend it as the current frame
		if (error instanceof LuaError) {
			const src = typeof error.path === 'string' && error.path.length > 0 ? error.path : null;
			const line = Number.isFinite(error.line) && error.line > 0 ? Math.floor(error.line) : null;
			const col = Number.isFinite(error.column) && error.column > 0 ? Math.floor(error.column) : null;
			// Only inject if not already represented as the innermost frame
			const innermostCall = callFrames && callFrames.length > 0 ? callFrames[callFrames.length - 1] : null;
			const innermostFrame = luaFrames.length > 0 ? luaFrames[0] : null;
			const effectiveSource = src !== null ? src : innermostFrame ? innermostFrame.source : null;
			const resolvedLine = line !== null ? line : (innermostFrame ? innermostFrame.line : null);
			const resolvedColumn = col !== null ? col : (innermostFrame ? innermostFrame.column : null);
			const alreadyCaptured =
				!!innermostFrame &&
				innermostFrame.source === (effectiveSource ?? '') &&
				innermostFrame.line === (resolvedLine ?? 0) &&
				innermostFrame.column === (resolvedColumn ?? 0);
			if (!alreadyCaptured) {
				const fnName =
					innermostCall && innermostCall.functionName && innermostCall.functionName.length > 0
						? innermostCall.functionName
						: innermostFrame && innermostFrame.functionName && innermostFrame.functionName.length > 0
							? innermostFrame.functionName
							: null;
				if (innermostFrame && effectiveSource && innermostFrame.source === effectiveSource) {
					const hint = effectiveSource;
					const updated: StackTraceFrame = {
						origin: innermostFrame.origin,
						functionName: fnName,
						source: effectiveSource,
						line: resolvedLine,
						column: resolvedColumn,
						raw: buildLuaFrameRawLabel(fnName, effectiveSource),
						pathPath: innermostFrame.pathPath,
					};
					updated.pathPath = hint;
					luaFrames[0] = updated;
				} else {
					const frameSource = src !== null ? src : effectiveSource;
					const top: StackTraceFrame = {
						origin: 'lua',
						functionName: fnName,
						source: frameSource,
						line: resolvedLine,
						column: resolvedColumn,
						raw: buildLuaFrameRawLabel(fnName, frameSource),
					};
					if (frameSource && frameSource.length > 0) {
						const hint = frameSource;
						if (hint) {
							top.pathPath = hint;
						}
					}
					luaFrames.unshift(top);
				}
			}
		}
		const projectRootPath = $.assets.project_root_path;
		const normalizedRoot = projectRootPath && projectRootPath.length > 0
			? projectRootPath.replace(/^\.?\//, '')
			: '';
		if (luaFrames.length > 0) {
			for (const frame of luaFrames) {
				const source = frame.source;
				if (!source || source.length === 0) {
					continue;
				}
				const normalizedSource = source.replace(/^\.?\//, '');
				const workspaceRelative = normalizedSource.startsWith('src/')
					? normalizedSource
					: (normalizedRoot.length > 0 && normalizedSource.startsWith(`${normalizedRoot}/`))
						? normalizedSource
						: (normalizedRoot.length > 0 ? `${normalizedRoot}/${normalizedSource}` : normalizedSource);
				frame.pathPath = workspaceRelative;
			}
		}
		let stackText: string = null;
		if (this.includeJsStackTraces && error instanceof Error && typeof error.stack === 'string') {
			stackText = error.stack;
		}
		const jsFrames = this.includeJsStackTraces ? parseJsStackFrames(stackText) : [];
		if (luaFrames.length === 0 && jsFrames.length === 0) {
			return null;
		}
		return {
			message,
			luaStack: luaFrames,
			jsStack: jsFrames,
		};
	}

	public createApiRuntimeError(message: string): LuaRuntimeError {
		this.luaInterpreter.markFaultEnvironment();
		const debug = this.cpu.getDebugState();
		const range = this.cpu.getDebugRange(debug.pc);
		const path = range ? range.path : (this._luaPath ?? 'lua');
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		return new LuaRuntimeError(message, path, line, column);
	}

	public canonicalizeIdentifier(name: string): string {
		return this.canonicalizeIdentifierFn(name);
	}

	private internVmString(value: string): StringValue {
		return this.cpu.getStringPool().intern(value);
	}

	private vmKey(name: string): StringValue {
		return this.internVmString(this.canonicalizeIdentifier(name));
	}

	private vmToStringValue(value: Value): StringValue {
		return this.internVmString(this.vmToString(value));
	}

	private buildConsoleMetadata(baseProgram: Program): ProgramMetadata {
		const instructionCount = Math.floor(baseProgram.code.length / INSTRUCTION_BYTES);
		const debugRanges: Array<ProgramMetadata['debugRanges'][number]> = new Array(instructionCount);
		for (let index = 0; index < debugRanges.length; index += 1) {
			debugRanges[index] = null;
		}
		const protoIds = new Array<string>(baseProgram.protos.length);
		for (let index = 0; index < protoIds.length; index += 1) {
			protoIds[index] = `proto:${index}`;
		}
		return { debugRanges, protoIds };
	}

	public runVmConsoleChunk(source: string): Value[] {
		const chunk = this.luaInterpreter.compileChunk(source, 'console');
		const currentProgram = this.cpu.getProgram();
		const baseMetadata = this.vmProgramMetadata ?? this.vmConsoleMetadata ?? this.buildConsoleMetadata(currentProgram);
		const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, { canonicalization: this._canonicalization });
		this.cpu.setProgram(compiled.program, compiled.metadata);
		if (this.vmProgramMetadata) {
			this.vmProgramMetadata = compiled.metadata;
		} else {
			this.vmConsoleMetadata = compiled.metadata;
		}
		const results = this.callVmFunction({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
		this.processVmIo();
		return results;
	}

	public callLuaFunction(fn: LuaFunctionValue, args: unknown[]): unknown[] {
		// Marshal JS→Lua, call, then marshal Lua→JS with path context for error breadcrumbs.
		const luaArgs: LuaValue[] = [];
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(this.luaJsBridge.toLua(args[index]));
		}
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		const moduleId = $.luaSources.path2lua[this._luaPath].source_path;
		const baseCtx = { moduleId, path: [] };
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaJsBridge.convertFromLua(results[i], this.extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private callVmFunction(fn: Closure, args: Value[]): Value[] {
		const depth = this.cpu.getFrameDepth();
		this.cpu.callExternal(fn, args);
		const previousBudget = this.cpu.instructionBudgetRemaining;
		this.cpu.instructionBudgetRemaining = null;
		this.cpu.runUntilDepth(depth);
		this.cpu.instructionBudgetRemaining = previousBudget;
		return this.cpu.lastReturnValues;
	}

	private invokeVmHandler(fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs: Value[] = [];
		if (thisArg !== undefined) {
			callArgs.push(this.toVmValue(thisArg));
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(this.toVmValue(args[index]));
		}
		const results = this.callVmFunction(fn, callArgs);
		if (results.length === 0) {
			return undefined;
		}
		const ctx = this.buildVmContext();
		return this.toNativeValue(results[0], ctx, new WeakMap());
	}

	private handleVmHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void {
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		this.handleLuaError(wrappedError);
		throw wrappedError;
	}

	private invokeLuaHandler(fn: LuaFunctionValue, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		// Lua colon syntax injects the receiver as the first argument; we mirror that here so
		// Lua-side handlers defined with ':' see the expected self.
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
		// Annotate the error message with the handler ID if not already present
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		this.luaInterpreter.recordFaultCallStack();
		this.handleLuaError(wrappedError);
		throw wrappedError; // Rethrow for higher-level handling
	}

	public extendMarshalContext(ctx: LuaMarshalContext, segment: string): LuaMarshalContext {
		if (!segment) {
			return ctx;
		}
		return {
			moduleId: ctx.moduleId,
			path: ctx.path.concat(segment),
		};
	}

	private buildVmContext(): LuaMarshalContext {
		let moduleId = 'vm';
		if (this._luaPath) {
			const binding = $.luaSources.path2lua[this._luaPath];
			if (binding) {
				moduleId = binding.source_path;
			}
		}
		return { moduleId, path: [] };
	}

	private describeMarshalSegment(key: Value): string {
		if (isStringValue(key)) {
			return stringValueToString(key);
		}
		if (typeof key === 'number') {
			return String(key);
		}
		return null;
	}

	private parseNativeKeyFromString(key: string): Value {
		const numeric = Number(key);
		if (Number.isInteger(numeric) && String(numeric) === key) {
			return numeric;
		}
		return this.internVmString(key);
	}

	private nativeKeysEqual(left: Value, right: Value): boolean {
		if (left === right) {
			return true;
		}
		if (isStringValue(left) && isStringValue(right)) {
			return stringValueToString(left) === stringValueToString(right);
		}
		if (typeof left === 'number' && isStringValue(right)) {
			return String(left) === stringValueToString(right);
		}
		if (isStringValue(left) && typeof right === 'number') {
			return stringValueToString(left) === String(right);
		}
		return false;
	}

	private collectNativeKeys(raw: object): Value[] {
		const keys: Value[] = [];
		if (Array.isArray(raw)) {
			const arr = raw as unknown[];
			const arrRecord = arr as unknown as Record<string, unknown>;
			for (let index = 0; index < arr.length; index += 1) {
				const value = arr[index];
				if (value === undefined || value === null) {
					continue;
				}
				keys.push(index + 1);
			}
			const ownKeys = Object.keys(arr);
			for (const key of ownKeys) {
				const numeric = Number(key);
				if (Number.isInteger(numeric) && String(numeric) === key && numeric >= 0 && numeric < arr.length) {
					continue;
				}
				const value = arrRecord[key];
				if (value === undefined || value === null) {
					continue;
				}
				keys.push(this.parseNativeKeyFromString(key));
			}
			return keys;
		}
		const obj = raw as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			const value = obj[key];
			if (value === undefined || value === null) {
				continue;
			}
			keys.push(this.parseNativeKeyFromString(key));
		}
		return keys;
	}

	private readNativeRawValue(raw: object, key: Value): unknown {
		if (Array.isArray(raw)) {
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				return (raw as unknown[])[key - 1];
			}
			const rawRecord = raw as unknown as Record<string, unknown>;
			const prop = isStringValue(key) ? stringValueToString(key) : String(key);
			return rawRecord[prop];
		}
		const rawRecord = raw as unknown as Record<string, unknown>;
		const prop = isStringValue(key) ? stringValueToString(key) : String(key);
		return rawRecord[prop];
	}

	private nextNativeEntry(target: NativeObject, after: Value): [Value, Value] | null {
		const raw = target.raw as object;
		const keys = this.collectNativeKeys(raw);
		if (keys.length === 0) {
			return null;
		}
		let nextIndex = 0;
		if (after !== null) {
			nextIndex = -1;
			for (let index = 0; index < keys.length; index += 1) {
				if (this.nativeKeysEqual(keys[index], after)) {
					nextIndex = index + 1;
					break;
				}
			}
			if (nextIndex < 0 || nextIndex >= keys.length) {
				return null;
			}
		}
		const key = keys[nextIndex];
		const value = this.readNativeRawValue(raw, key);
		return [key, this.toVmValue(value)];
	}

	private getOrAssignVmTableId(table: Table): number {
		const existing = this.vmTableIds.get(table);
		if (existing !== undefined) {
			return existing;
		}
		const id = this.nextVmTableId;
		this.vmTableIds.set(table, id);
		this.nextVmTableId += 1;
		return id;
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
			const constructorFn = descriptor as { name?: unknown };
			if (constructorFn && typeof constructorFn.name === 'string' && constructorFn.name.length > 0) {
				return constructorFn.name;
			}
		}
		return 'Object';
	}

	private resolveNativeKey(key: Value): string {
		if (isStringValue(key)) {
			return stringValueToString(key);
		}
		if (typeof key === 'number' && Number.isInteger(key)) {
			return String(key);
		}
		return null;
	}

	private getOrCreateAssetsNativeObject(): NativeObject {
		const assets = $.assets;
		const cached = this.nativeObjectCache.get(assets);
		if (cached) {
			return cached;
		}
		const assetMapKeys = new Set<string>(['img', 'audio', 'model', 'data', 'audioevents']);
		const wrapper = createNativeObject(assets, {
			get: (key) => {
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to retrieve an asset that did not use a string or integer key.');
				}
				const rawValue = assets[prop];
				if (rawValue === undefined) {
					throw new Error(`Asset '${prop}' does not exist.`);
				}
				if (assetMapKeys.has(prop)) {
					return this.getOrCreateAssetMapNativeObject(rawValue as Record<string, unknown>);
				}
				if (typeof rawValue === 'function') {
					return this.getOrCreateNativeMethod(assets, prop);
				}
				return this.toVmValue(rawValue);
			},
			set: (key, entryValue) => {
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.');
				}
				if (entryValue === null) {
					delete assets[prop];
					return;
				}
				const ctx = this.buildVmContext();
				assets[prop] = this.toNativeValue(entryValue, ctx, new WeakMap());
			},
		});
		this.nativeObjectCache.set(assets, wrapper);
		return wrapper;
	}

	private getOrCreateAssetMapNativeObject(map: Record<string, unknown>): NativeObject {
		const cached = this.nativeObjectCache.get(map);
		if (cached) {
			return cached;
		}
		const wrapper = createNativeObject(map, {
			get: (key) => {
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to retrieve an asset that did not use a string or integer key.');
				}
				const rawValue = map[prop];
				if (rawValue === undefined) {
					throw new Error(`Asset '${prop}' does not exist.`);
				}
				if (typeof rawValue === 'function') {
					return this.getOrCreateNativeMethod(map, prop);
				}
				return this.toVmValue(rawValue);
			},
			set: (key, entryValue) => {
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to index native object with unsupported key. Asset maps and methods require string or integer keys.');
				}
				if (entryValue === null) {
					delete map[prop];
					return;
				}
				const ctx = this.buildVmContext();
				map[prop] = this.toNativeValue(entryValue, ctx, new WeakMap());
			},
		});
		this.nativeObjectCache.set(map, wrapper);
		return wrapper;
	}

	private toVmValue(value: unknown): Value {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number') {
			return value;
		}
		if (typeof value === 'string') {
			return this.internVmString(value);
		}
		if (isNativeObject(value as Value)) {
			return value as Value;
		}
		if (isNativeFunction(value as Value)) {
			return value as Value;
		}
		if (value instanceof Table) {
			return value;
		}
		if (Array.isArray(value)) {
			return this.getOrCreateNativeObject(value);
		}
		if (typeof value === 'function') {
			return this.getOrCreateNativeFunction(value);
		}
		if (this.isPlainObject(value)) {
			const table = new Table(0, 0);
			for (const [prop, entry] of Object.entries(value)) {
				table.set(this.internVmString(prop), this.toVmValue(entry));
			}
			return table;
		}
		if (value instanceof Map) {
			const table = new Table(0, 0);
			for (const [key, entry] of value.entries()) {
				table.set(this.toVmValue(key), this.toVmValue(entry));
			}
			return table;
		}
		return this.getOrCreateNativeObject(value as object);
	}

	private toNativeValue(value: Value, context: LuaMarshalContext, visited: WeakMap<Table, unknown>): unknown {
		if (value === null || typeof value === 'boolean' || typeof value === 'number') {
			return value;
		}
		if (isStringValue(value)) {
			return stringValueToString(value);
		}
		if (value instanceof Table) {
			return this.vmTableToNative(value, context, visited);
		}
		if (isNativeObject(value)) {
			return value.raw;
		}
		if (isNativeFunction(value)) {
			return (...args: unknown[]) => {
				const vmArgs: Value[] = [];
				for (let index = 0; index < args.length; index += 1) {
					vmArgs.push(this.toVmValue(args[index]));
				}
				const results: Value[] = [];
				value.invoke(vmArgs, results);
				if (results.length === 0) {
					return undefined;
				}
				return this.toNativeValue(results[0], context, new WeakMap());
			};
		}
		const handler = this.vmHandlerCache.getOrCreate(value as Closure, {
			moduleId: context.moduleId,
			path: context.path,
		});
		return handler;
	}

	private vmTableToNative(table: Table, context: LuaMarshalContext, visited: WeakMap<Table, unknown>): unknown {
		const cached = visited.get(table);
		if (cached !== undefined) {
			return cached;
		}
		const tableId = this.getOrAssignVmTableId(table);
		const tableContext = this.extendMarshalContext(context, `table${tableId}`);
		const entries = table.entriesArray();
		if (entries.length === 0) {
			const empty: Record<string, unknown> = {};
			visited.set(table, empty);
			return empty;
		}
		const numericEntries: Array<{ key: number; value: Value }> = [];
		const otherEntries: Array<{ key: Value; value: Value }> = [];
		let maxNumericIndex = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const [key, entryValue] = entries[index];
			if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
				numericEntries.push({ key, value: entryValue });
				if (key > maxNumericIndex) {
					maxNumericIndex = key;
				}
				continue;
			}
			otherEntries.push({ key, value: entryValue });
		}
		const hasOnlyNumeric = otherEntries.length === 0;
		if (hasOnlyNumeric && numericEntries.length > 0) {
			const result: unknown[] = new Array(maxNumericIndex);
			visited.set(table, result);
			for (let index = 1; index <= maxNumericIndex; index += 1) {
				const nextContext = this.extendMarshalContext(tableContext, String(index));
				result[index - 1] = this.toNativeValue(table.get(index), nextContext, visited);
			}
			return result;
		}
		const objectResult: Record<string, unknown> = {};
		visited.set(table, objectResult);
		for (let index = 0; index < numericEntries.length; index += 1) {
			const entry = numericEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			const nextContext = segment ? this.extendMarshalContext(tableContext, segment) : tableContext;
			objectResult[this.stringifyVmKey(entry.key)] = this.toNativeValue(entry.value, nextContext, visited);
		}
		for (let index = 0; index < otherEntries.length; index += 1) {
			const entry = otherEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			const nextContext = segment ? this.extendMarshalContext(tableContext, segment) : tableContext;
			objectResult[this.stringifyVmKey(entry.key)] = this.toNativeValue(entry.value, nextContext, visited);
		}
		return objectResult;
	}

	private stringifyVmKey(key: Value): string {
		if (isStringValue(key)) {
			return stringValueToString(key);
		}
		return String(key);
	}

	private wrapNativeResult(result: unknown, out: Value[]): void {
		if (Array.isArray(result)) {
			for (let index = 0; index < result.length; index += 1) {
				out.push(this.toVmValue(result[index]));
			}
			return;
		}
		if (result === undefined) {
			return;
		}
		out.push(this.toVmValue(result));
	}

	private getOrCreateNativeObject(value: object): NativeObject {
		const cached = this.nativeObjectCache.get(value);
		if (cached) {
			return cached;
		}
		const isArray = Array.isArray(value);
		const arrayValue = isArray ? (value as unknown[]) : null;
		const wrapper = createNativeObject(value, {
			get: (key) => {
				if (isArray && typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					const index = key - 1;
					if (index >= arrayValue.length) {
						return null;
					}
					const rawValue = arrayValue[index];
					return rawValue === undefined ? null : this.toVmValue(rawValue);
				}
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to index native object with unsupported key.');
				}
				const rawValue = (value as Record<string, unknown>)[prop];
				if (rawValue === undefined) {
					return null;
				}
				if (typeof rawValue === 'function') {
					return this.getOrCreateNativeMethod(value, prop);
				}
				return this.toVmValue(rawValue);
			},
			set: (key, entryValue) => {
				if (isArray && typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					const index = key - 1;
					const ctx = this.buildVmContext();
					arrayValue[index] = this.toNativeValue(entryValue, ctx, new WeakMap());
					return;
				}
				const prop = this.resolveNativeKey(key);
				if (!prop) {
					throw new Error('Attempted to assign native object with unsupported key.');
				}
				if (entryValue === null) {
					delete (value as Record<string, unknown>)[prop];
					return;
				}
				const ctx = this.buildVmContext();
				(value as Record<string, unknown>)[prop] = this.toNativeValue(entryValue, ctx, new WeakMap());
			},
			len: isArray ? () => arrayValue.length : undefined,
		});
		this.nativeObjectCache.set(value, wrapper);
		return wrapper;
	}

	private getOrCreateNativeFunction(fn: Function): NativeFunction {
		const cached = this.nativeFunctionCache.get(fn);
		if (cached) {
			return cached;
		}
		const name = this.resolveNativeTypeName(fn);
		const wrapper = createNativeFunction(name, (args, out) => {
			const ctx = this.buildVmContext();
			const visited = new WeakMap<Table, unknown>();
			const jsArgs: unknown[] = [];
			for (let index = 0; index < args.length; index += 1) {
				jsArgs.push(this.toNativeValue(args[index], ctx, visited));
			}
			const result = fn.apply(undefined, jsArgs);
			this.wrapNativeResult(result, out);
		});
		this.nativeFunctionCache.set(fn, wrapper);
		return wrapper;
	}

	private getOrCreateNativeMethod(target: object, key: string): NativeFunction {
		let bucket = this.nativeMemberCache.get(target);
		if (!bucket) {
			bucket = new Map<string, NativeFunction>();
			this.nativeMemberCache.set(target, bucket);
		}
		const cached = bucket.get(key);
		if (cached) {
			return cached;
		}
		const name = `${this.resolveNativeTypeName(target)}.${key}`;
		const wrapper = createNativeFunction(name, (args, out) => {
			const ctx = this.buildVmContext();
			const visited = new WeakMap<Table, unknown>();
			const member = (target as Record<string, unknown>)[key];
			if (!isLuaHandlerFunction(member)) {
				const jsArgs: unknown[] = [];
				let startIndex = 0;
				if (args.length > 0) {
					const first = this.toNativeValue(args[0], ctx, visited);
					if (first !== target) {
						jsArgs.push(first);
					}
					startIndex = 1;
				}
				for (let index = startIndex; index < args.length; index += 1) {
					jsArgs.push(this.toNativeValue(args[index], ctx, visited));
				}
				if (typeof member !== 'function') {
					throw new Error(`Property '${key}' is not callable.`);
				}
				const result = (member as (...inner: unknown[]) => unknown).apply(target, jsArgs);
				this.wrapNativeResult(result, out);
				return;
			}
			const jsArgs: unknown[] = [];
			for (let index = 0; index < args.length; index += 1) {
				jsArgs.push(this.toNativeValue(args[index], ctx, visited));
			}
			if (typeof member !== 'function') {
				throw new Error(`Property '${key}' is not callable.`);
			}
			const result = (member as (...inner: unknown[]) => unknown).apply(undefined, jsArgs);
			this.wrapNativeResult(result, out);
		});
		bucket.set(key, wrapper);
		return wrapper;
	}

	public invalidateVmModuleAliases(): void {
		this.vmModuleAliases.clear();
		this.pathSemanticCache.clear();
	}

	private requireVmModule(moduleName: string): Value {
		const path = this.vmModuleAliases.get(moduleName);
		if (!path) {
			throw this.createApiRuntimeError(`require('${moduleName}') failed: module not found.`);
		}
		const cached = this.vmModuleCache.get(path);
		if (cached !== undefined) {
			return cached;
		}
		const protoIndex = this.vmModuleProtos.get(path);
		if (protoIndex === undefined) {
			throw this.createApiRuntimeError(`require('${moduleName}') failed: module not compiled.`);
		}
		this.vmModuleCache.set(path, true);
		const results = this.callVmFunction({ protoIndex, upvalues: [] }, []);
		const value = results.length > 0 ? results[0] : null;
		const cachedValue = value === null ? true : value;
		this.vmModuleCache.set(path, cachedValue);
		return cachedValue;
	}

	private requireLuaModule(interpreter: LuaInterpreter, moduleName: string): LuaValue {
		const canonicalName = this.canonicalizeIdentifierFn(moduleName);
		const path = this.vmModuleAliases.get(moduleName) ?? this.vmModuleAliases.get(canonicalName);
		if (!path) {
			throw interpreter.runtimeError(`require('${moduleName}') failed: module not found.`);
		}
		const loaded = interpreter.packageLoadedTable.get(path);
		if (loaded !== undefined && loaded !== null) {
			return loaded;
		}
		interpreter.packageLoadedTable.set(path, true);
		const source = this.resourceSourceForChunk(path);
		if (!source) {
			throw interpreter.runtimeError(`require('${moduleName}') failed: module source unavailable.`);
		}
		const chunk = interpreter.compileChunk(source, path);
		const results = interpreter.executeChunk(chunk);
		const value = results.length > 0 ? results[0] : null;
		const cachedValue = value === null ? true : value;
		interpreter.packageLoadedTable.set(path, cachedValue);
		return cachedValue;
	}

	private refreshLuaHandlersForChunk(path: string, sourceOverride?: string): void {
		this.luaGenericChunksExecuted.delete(path);
		this.reloadGenericLuaChunk(path, sourceOverride);
		clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private reloadGenericLuaChunk(path: string, sourceOverride?: string): void {
		const source = sourceOverride ? sourceOverride : this.resourceSourceForChunk(path);
		this.luaInterpreter.compileChunk(source, path);
		this.luaGenericChunksExecuted.add(path);
	}

	public resourceSourceForChunk(path: string): string {
		// The runtime reads sources from `$.luaSources.path2lua`. Keep the path indices pointing at the same
		// LuaSourceRecord objects (or update both indices together) to avoid stale code after overrides.
		const binding = this.resolveLuaSourceRecord(path);
		if (!binding) return null; // This can happen for non-existent paths, such as debugger tabs that don't refer to real paths
		const cached = getWorkspaceCachedSource(binding.normalized_source_path);
		if (cached !== null) {
			return cached;
		}
		return binding.src;
	}

	public listLuaSourceRegistries(): Array<{ registry: LuaSourceRegistry; readOnly: boolean }> {
		const registries: Array<{ registry: LuaSourceRegistry; readOnly: boolean }> = [];
		if (this.cartLuaSources) {
			registries.push({ registry: this.cartLuaSources, readOnly: false });
		}
		registries.push({ registry: this.engineLuaSources, readOnly: true });
		return registries;
	}

	public resolveLuaSourceRecord(path: string): LuaSourceRecord {
		return $.luaSources.path2lua[path]
			?? this.cartLuaSources?.path2lua[path]
			?? this.engineLuaSources?.path2lua[path]
			?? null;
	}

	private resolveModuleRegistries(): LuaSourceRegistry[] {
		if (this.cartLuaSources && $.luaSources === this.cartLuaSources) {
			return [this.cartLuaSources, this.engineLuaSources];
		}
		return [$.luaSources];
	}
}
