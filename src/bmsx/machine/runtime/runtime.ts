import { $ } from '../../core/engine';
import { taskGate } from '../../core/taskgate';
import { Input } from '../../input/manager';
import type { LuaDefinitionInfo } from '../../lua/syntax/ast';
import type { LuaEnvironment } from '../../lua/environment';
import { LuaRuntimeError } from '../../lua/errors';
import { LuaHandlerCache } from '../../lua/handler_cache';
import { LuaInterpreter } from '../../lua/runtime';
import type { StackTraceFrame } from '../../lua/value';
import {
	convertToError,
	type LuaDebuggerPauseSignal
} from '../../lua/value';
import type { StorageService } from '../../platform/platform';
import type { CartManifest, MachineManifest, Viewport } from '../../rompack/format';
import {
	CART_ROM_HEADER_SIZE,
	DEFAULT_GEO_WORK_UNITS_PER_SEC,
	DEFAULT_VDP_WORK_UNITS_PER_SEC,
	getMachinePerfSpecs,
} from '../../rompack/format';
import { AssetSourceStack, type RawAssetSource } from '../../rompack/source';
import { buildRuntimeAssetLayer } from '../../rompack/loader';
import { Api } from '../firmware/api';
import { Table, type Value, type ProgramMetadata, type NativeFunction, type NativeObject } from '../cpu/cpu';
import { type StringValue } from '../memory/string/pool';
import type { TerminalMode } from '../../ide/terminal/ui/mode';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { Font, type FontVariant } from '../../render/shared/bmsx_font';
import type { CartEditor } from '../../ide/cart_editor';
import { type FaultSnapshot } from '../../ide/editor/render/error_overlay';
import { type CpuFrameSnapshot } from '../cpu/cpu';
import { type LuaSemanticModel, type FileSemanticData } from '../../lua/semantic/model';
import { registerApiBuiltins } from '../firmware/builtins';
import { LuaFunctionRedirectCache } from '../firmware/handler_registry';
import { LuaJsBridge } from '../firmware/js_bridge';
import { RuntimeStorage } from '../firmware/cart_storage';
import type { RuntimeOptions, LuaBuiltinDescriptor, LuaMemberCompletion, GameViewState } from './contracts';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_ENGINE_PROJECT_ROOT_PATH } from '../../ide/workspace/workspace';
import { buildLuaSources, type LuaSourceRegistry } from '../program/sources';
import * as workbenchMode from '../../ide/runtime/workbench_mode';
import { runtimeFault } from '../../ide/runtime/lua_pipeline';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/debugger';
import type { ParsedLuaChunk } from '../../lua/analysis/parse';
import { configureLuaHeapUsage } from '../memory/lua_heap_usage';
import { FrameLoopState } from './frame/loop';
import { createGameViewState } from './game/view_state';
import { FrameSchedulerState } from '../scheduler/frame';
import { RenderPresentationState } from '../../render/presentation_state';
import { calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from './timing';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { CpuExecutionState } from './cpu_executor';
import { CartBootState } from './cart_boot';
import { HostFaultState } from './host_fault';
import { LuaScratchState } from '../program/scratch';
import { invokeClosureHandler, invokeLuaHandler } from '../program/executor';
import { resolveCpuHz, resolveGeoWorkUnitsPerSec, resolveRuntimeRenderSize, resolveVdpWorkUnitsPerSec } from '../specs';
import { resolveRuntimeMemoryMapSpecs } from '../memory/specs';
import { startEngineWithDeferredStartupAudioRefresh } from '../../audio/startup';
import { RuntimeAssetState } from '../memory/asset/state';
import {
	applyActiveMachineTiming,
	refreshDeviceTimings,
	setTransferRatesFromManifest,
} from './timing/config';
import { HandlerCache } from './handler_cache';
import { Machine } from '../machine';
import { Memory } from '../memory/memory';
import {
	configureMemoryMap,
} from '../memory/map';

// Flip back to 'msx' to restore default font in machine/editor
export const EDITOR_FONT_VARIANT: FontVariant = 'tiny';

export type FrameState = {
	haltGame: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
	activeCpuUsedCycles: number;
};

type ProgramSource = 'engine' | 'cart';
type RuntimeAssetLayer = Awaited<ReturnType<typeof buildRuntimeAssetLayer>>;

export var api: Api; // Initialized in Runtime constructor

export class Runtime {
	private static _instance: Runtime = null;

	public static createInstance(options: RuntimeOptions): Runtime {
		if (Runtime._instance) {
			throw runtimeFault('instance already exists.');
		}
		return new Runtime(options);
	}

	public readonly storage: RuntimeStorage;
	public readonly storageService: StorageService;
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, LuaBuiltinDescriptor>();
	public get api(): Api {
		return api;
	}
	public _activeIdeFontVariant: FontVariant = EDITOR_FONT_VARIANT;
	public tickEnabled: boolean = true;
	public editor: CartEditor | null = null;
	public readonly overlayRenderer = new OverlayRenderer();
	public terminal!: TerminalMode;
	public readonly timing: TimingState;
	public executionOverlayActive = false;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public readonly debuggerController = new LuaDebuggerController();
	public pauseCoordinator = workbenchMode.createPauseCoordinator();
	public debuggerSuspendSignal: LuaDebuggerPauseSignal = null;
	public debuggerPaused = false;
	public debuggerMetrics: LuaDebuggerSessionMetrics = null;
	public lastIdeInputFrame = -1;
	public lastTerminalInputFrame = -1;
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderer.setRenderingViewportType(value);
		if (this.editor !== null) {
			this.editor.updateViewport(this.overlayRenderer.viewportSize);
		}
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderer.viewportSize;
	}

	public shortcutDisposers: Array<() => void> = [];
	private luaInterpreter!: LuaInterpreter;
	public pendingCall: 'entry' | null = null;
	public get isDrawPending(): boolean {
		return this.pendingCall === 'entry'
			|| this.debuggerPaused
			|| this.luaRuntimeFailed
			|| this.faultSnapshot !== null;
	}

	public programMetadata: ProgramMetadata | null = null;
	public consoleMetadata: ProgramMetadata | null = null;
	public _luaPath: string = null;
	public get currentPath(): string {
		return this._luaPath;
	}
	public luaInitialized = false;
	public get isInitialized(): boolean {
		return this.luaInitialized;
	}
	public luaRuntimeFailed = false;
	public get hasRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	private includeJsStackTraces = false;
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public readonly frameScheduler = new FrameSchedulerState();
	public readonly frameLoop = new FrameLoopState();
	public readonly screen = new RenderPresentationState();
	public readonly activeMachineManifest: MachineManifest;
	public readonly cartManifest: CartManifest | null;
	public readonly cartProjectRootPath: string | null;
	public readonly gameViewState: GameViewState;
	public readonly vblank = new VblankState();
	public readonly cpuExecution = new CpuExecutionState();
	public pendingLuaWarnings: string[] = [];
	public readonly moduleAliases: Map<string, string> = new Map();
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	public readonly luaGenericChunksExecuted: Set<string> = new Set();
	public readonly luaPatternRegexCache: Map<string, RegExp> = new Map();
	public readonly luaScratch = new LuaScratchState();
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-resume.
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => invokeLuaHandler(this, fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	public readonly closureHandlerCache = new HandlerCache(
		(fn, thisArg, args) => invokeClosureHandler(this, fn, thisArg, args),
		(error, meta) => this.handleClosureHandlerError(error, meta),
	);
	public readonly moduleProtos = new Map<string, number>();
	public readonly moduleCache = new Map<string, Value>();
	public readonly nativeObjectCache = new WeakMap<object, NativeObject>();
	public readonly luaAssetValueCache = new WeakMap<object, Value>();
	public readonly nativeFunctionCache = new WeakMap<Function, NativeFunction>();
	public readonly nativeMemberCache = new WeakMap<object, Map<string, NativeFunction>>();
	public readonly tableIds = new WeakMap<Table, number>();
	public nextTableId = 1;
	public pairsIterator: Value = null;
	public ipairsIterator: Value = null;
	public randomSeedValue = 0;
	public nativeMemberCompletionCache: WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }> = new WeakMap();
	public readonly pathSemanticCache: Map<string, { source: string; model?: LuaSemanticModel; definitions?: ReadonlyArray<LuaDefinitionInfo>; parsed?: ParsedLuaChunk; lines?: readonly string[]; analysis?: FileSemanticData }> = new Map();

	public readonly luaGate = taskGate.group('console:lua');
	public handledLuaErrors = new WeakSet<any>();
	public lastLuaCallStack: StackTraceFrame[] = [];
	public lastCpuFaultSnapshot: CpuFrameSnapshot[] = [];
	public faultSnapshot: FaultSnapshot = null;
	public faultOverlayNeedsFlush = false;
	public get doesFaultOverlayNeedFlush(): boolean {
		return this.faultOverlayNeedsFlush;
	}
	public flushedFaultOverlay(): void {
		this.faultOverlayNeedsFlush = false;
	}
	private hasCompletedInitialBoot = false;
	public cartEntryAvailable = true;
	public readonly hostFault = new HostFaultState();
	public engineLuaSources: LuaSourceRegistry = null;
	public cartLuaSources: LuaSourceRegistry = null;
	public activeLuaSources: LuaSourceRegistry = null;
	public engineAssetSource: RawAssetSource = null;
	public cartAssetSource: RawAssetSource = null;
	public readonly assets = new RuntimeAssetState();
	public readonly machine: Machine;
	public readonly cartBoot = new CartBootState();
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}
	public get hasProgramSymbols(): boolean {
		return this.programMetadata !== null;
	}

	public static async init(cartridge?: Uint8Array): Promise<void> {
		const engineLayer = $.engine_layer;
		const playerIndex = Input.instance.startupGamepadIndex ?? 1;

		const engineSource = new AssetSourceStack([{ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload }]);
		const engineLuaSources = buildLuaSources({
			cartSource: engineSource,
			assetSource: engineSource,
			index: engineLayer.index,
			allowedPayloadIds: ['system'],
			});
			const engineMachine = engineLayer.index.machine;
			const engineProjectRootPath = engineLayer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH;

			if (!cartridge) {
			$.set_source(engineSource);
			$.set_inputmap(1, { keyboard: null, gamepad: null, pointer: null }); // Default input mapping for player 1 is required even with no cart to prevent errors

			$.set_sources(engineLuaSources);
			const engineMemorySpecs = resolveRuntimeMemoryMapSpecs({
				machine: engineMachine,
				engineMachine,
				engineSource,
				assetSource: engineSource,
				assetLayers: [engineLayer],
			});
			configureMemoryMap(engineMemorySpecs);
			const enginePerfSpecs = getMachinePerfSpecs(engineMachine);
			const ufpsScaled = resolveUfpsScaled(enginePerfSpecs.ufps);
			const cpuHz = resolveCpuHz(enginePerfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
			const engineRenderSize = resolveRuntimeRenderSize(engineMachine);
			const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, engineRenderSize.height);
			const memory = new Memory({
				engineRom: new Uint8Array(engineLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = Runtime.createInstance({
				playerIndex,
				viewport: engineRenderSize,
				memory,
				activeMachineManifest: engineMachine,
				cartManifest: null,
				cartProjectRootPath: null,
				ufpsScaled,
				cpuHz,
				cycleBudgetPerFrame,
				vblankCycles,
					vdpWorkUnitsPerSec: enginePerfSpecs.work_units_per_sec,
					geoWorkUnitsPerSec: enginePerfSpecs.geo_work_units_per_sec,
				});
				setTransferRatesFromManifest(runtime, enginePerfSpecs);
				const runtimeAssets = runtime.assets;
				runtimeAssets.biosLayer = engineLayer;
				runtimeAssets.setLayers([engineLayer]);
				runtime.configureProgramSources({
					engineSources: engineLuaSources,
					engineAssetSource: engineSource,
			});
			await Runtime.startPreparedRuntime(runtime, engineLuaSources, engineProjectRootPath);
			return;
		}

		const cartLayer = await buildRuntimeAssetLayer({ blob: cartridge, id: 'cart' });
		const overlayBlob = $.workspace_overlay;
		let overlayLayer: RuntimeAssetLayer | null = null;
			if (overlayBlob) {
				overlayLayer = await buildRuntimeAssetLayer({ blob: overlayBlob, id: 'overlay' });
			}
			const runtimeAssetLayers = overlayLayer ? [engineLayer, cartLayer, overlayLayer] : [engineLayer, cartLayer];
			const layers = [];
			if (overlayLayer) {
			layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
		}
		layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
		layers.push({ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload });
		const assetSource = new AssetSourceStack(layers);
		$.set_source(assetSource);

		const cartSource = new AssetSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = buildLuaSources({
			cartSource,
			assetSource,
			index: cartLayer.index,
			allowedPayloadIds: overlayLayer ? ['overlay', 'cart'] : ['cart'],
		});

		const inputMappingPerPlayer = cartLayer.index.input;
		if (inputMappingPerPlayer) {
			for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
				const mappedIndex = parseInt(playerIndexStr, 10);
				const inputMapping = inputMappingPerPlayer[mappedIndex];
				$.set_inputmap(mappedIndex, inputMapping);
			}
		} else {
			$.set_inputmap(1, Input.DEFAULT_INPUT_MAPPING);
		}

		await applyWorkspaceOverridesToCart({ cart: cartLuaSources, storage: $.platform.storage, includeServer: true });
		$.set_sources(engineLuaSources);

		const memoryLimits = resolveRuntimeMemoryMapSpecs({
			machine: cartLayer.index.machine,
				engineMachine,
				engineSource,
				assetSource,
				assetLayers: runtimeAssetLayers,
			});
		configureMemoryMap(memoryLimits);
		const cartPerfSpecs = getMachinePerfSpecs(cartLayer.index.machine);
		const ufpsScaled = resolveUfpsScaled(cartPerfSpecs.ufps);
		const cpuHz = resolveCpuHz(cartPerfSpecs.cpu_freq_hz);
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
		const cartRenderSize = resolveRuntimeRenderSize(cartLayer.index.machine);
		const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, cartRenderSize.height);
		let overlayRom: Uint8Array | undefined;
		if (overlayLayer) {
			overlayRom = new Uint8Array(overlayLayer.payload);
		}
		const memory = new Memory({
			engineRom: new Uint8Array(engineLayer.payload),
			cartRom: new Uint8Array(cartLayer.payload),
			overlayRom,
		});
		const runtime = Runtime.createInstance({
			playerIndex,
			viewport: cartRenderSize,
			memory,
			activeMachineManifest: cartLayer.index.machine,
			cartManifest: cartLayer.index.cart_manifest,
			cartProjectRootPath: cartLayer.index.projectRootPath,
			ufpsScaled,
			cpuHz,
			cycleBudgetPerFrame,
			vblankCycles,
				vdpWorkUnitsPerSec: cartPerfSpecs.work_units_per_sec,
				geoWorkUnitsPerSec: cartPerfSpecs.geo_work_units_per_sec,
			});
			setTransferRatesFromManifest(runtime, cartPerfSpecs);
			const runtimeAssets = runtime.assets;
			runtimeAssets.biosLayer = engineLayer;
			runtimeAssets.setLayers(runtimeAssetLayers);
			runtimeAssets.cartLayer = cartLayer;
			runtimeAssets.overlayLayer = overlayLayer;
			runtime.configureProgramSources({
			engineSources: engineLuaSources,
			cartSources: cartLuaSources,
			engineAssetSource: engineSource,
			cartAssetSource: cartSource,
		});
		await Runtime.startPreparedRuntime(runtime, engineLuaSources, engineProjectRootPath);
	}

	private static async startPreparedRuntime(runtime: Runtime, engineLuaSources: LuaSourceRegistry, engineProjectRootPath: string): Promise<void> {
		await applyWorkspaceOverridesToRegistry({
			registry: engineLuaSources,
			storage: $.platform.storage,
			includeServer: true,
			projectRootPath: engineProjectRootPath,
		});
		await runtime.prepareBootRomStartupState();
		$.view.default_font = new Font();
		await runtime.boot();
		startEngineWithDeferredStartupAudioRefresh(runtime);
	}

	public static get instance(): Runtime {
		return Runtime._instance!;
	}

	public static get hasInstance(): boolean {
		return Runtime._instance !== null;
	}

	public static destroy(): void {
		// No defense against multiple calls; let it throw if misused.
		Runtime._instance.dispose();
		Runtime._instance = null;
	}

	private configureProgramSources(params: {
		engineSources: LuaSourceRegistry;
		cartSources?: LuaSourceRegistry;
		engineAssetSource: RawAssetSource;
		cartAssetSource?: RawAssetSource;
	}): void {
		this.engineLuaSources = params.engineSources;
		this.cartLuaSources = params.cartSources;
		this.engineAssetSource = params.engineAssetSource;
		this.cartAssetSource = params.cartAssetSource;
		this.cartBoot.reset(this);
	}

	public activateProgramSource(source: ProgramSource): void {
		const luaSources = source === 'engine' ? this.engineLuaSources : this.cartLuaSources;
		this.activeLuaSources = luaSources;
		$.set_sources(luaSources);
		api.cartdata(luaSources.namespace);
	}

	private constructor(options: RuntimeOptions) {
		Runtime._instance = this;
		this.timing = new TimingState(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame);
		const initialVdpWorkUnits = options.vdpWorkUnitsPerSec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC;
		const initialGeoWorkUnits = options.geoWorkUnitsPerSec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC;
		this.timing.vdpWorkUnitsPerSec = resolveVdpWorkUnitsPerSec(initialVdpWorkUnits);
		this.timing.geoWorkUnitsPerSec = resolveGeoWorkUnitsPerSec(initialGeoWorkUnits);
		this.storageService = $.platform.storage;
		this.storage = new RuntimeStorage(this.storageService, $.sources.namespace);
		this.activeMachineManifest = options.activeMachineManifest;
		this.cartManifest = options.cartManifest;
		this.cartProjectRootPath = options.cartProjectRootPath;
		$.set_machine_manifest(this.activeMachineManifest);
		$.set_cart_manifest(this.cartManifest);
		$.set_cart_project_root_path(this.cartProjectRootPath);
		this.engineLuaSources = $.sources;
		this.activeLuaSources = $.sources;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.machine = new Machine(
			options.memory,
			{ width: options.viewport.width, height: options.viewport.height },
			Input.instance,
			$.sndmaster,
		);
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		this.gameViewState = createGameViewState($.view);
		configureLuaHeapUsage({
			getBaseRamUsedBytes: () => this.machine.resourceUsageDetector.getBaseRamUsedBytes(),
			collectTrackedHeapBytes: () => {
				const extraRoots = this.luaScratch.acquireValue();
				try {
					extraRoots.push(this.pairsIterator);
					extraRoots.push(this.ipairsIterator);
					for (const value of this.moduleCache.values()) {
						extraRoots.push(value);
					}
					return this.machine.cpu.collectTrackedHeapBytes(extraRoots);
				}
				finally {
					this.luaScratch.releaseValue(extraRoots);
				}
			},
		});
			refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.vblank.setVblankCycles(this, options.vblankCycles);
		this.randomSeedValue = $.platform.clock.now();

		api = new Api({
			storage: this.storage,
			runtime: this,
		});
		workbenchMode.initializeIdeFeatures(this, options);
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.requireHandler = (ctx, module) => luaPipeline.requireLuaModule(this, ctx, module);
	}

	public createLuaInterpreter(): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge);
		this.configureInterpreter(interpreter);
		interpreter.attachDebugger(this.debuggerController);
		interpreter.clearLastFaultEnvironment();
		registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.getReservedLuaIdentifiers());
		return interpreter;
	}

	public getReservedLuaIdentifiers(): ReadonlySet<string> {
		return new Set<string>(this.apiFunctionNames);
	}

	public assignInterpreter(interpreter: LuaInterpreter): void {
		this.luaInterpreter = interpreter;
		this.consoleMetadata = null;
		this.pendingCall = null;
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
		this.machine.inputController.sampleArmed = false;
		this.vblank.clearHaltUntilIrq(this);
	}

	public get activeIdeFontVariant(): FontVariant {
		return this._activeIdeFontVariant;
	}

	public set jsStackEnabled(enabled: boolean) {
		this.includeJsStackTraces = enabled;
	}

	public get jsStackEnabled(): boolean {
		return this.includeJsStackTraces;
	}

	public async boot(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'new_game' });
		try {
			this.hostFault.clear(this);
			this.clearBootFaults();
			this.clearLuaBootState();
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset the runtime state
				await $.resetRuntime();
				await $.refresh_audio_assets();
			}
			api.cartdata($.sources.namespace);
			luaPipeline.bootActiveProgram(this);
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw runtimeFault(`failed to boot runtime: ${error}`);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private clearBootFaults(): void {
		workbenchMode.clearActiveDebuggerPause(this);
		workbenchMode.clearRuntimeFault(this);
	}

	private clearLuaBootState(): void {
		this.luaInitialized = false;
		luaPipeline.invalidateModuleAliases(this);
		this.luaChunkEnvironmentsByPath.clear();
		this.luaGenericChunksExecuted.clear();
		if (this.editor !== null) {
			this.editor.clearRuntimeErrorOverlay();
		}
	}

	private async prepareBootRomStartupState(): Promise<void> {
		await this.assets.buildMemory(this, { source: this.engineAssetSource, mode: 'full' });
		this.machine.memory.sealEngineAssets();
		this.activateEngineProgramAssets();
	}

	private async restartBootRomStartupState(): Promise<void> {
		await $.resetRuntime();
		await this.prepareBootRomStartupState();
		await $.refresh_audio_assets();
	}

	public async rebootToBootRom(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
		try {
			this.clearBootFaults();
			workbenchMode.deactivateTerminalMode(this);
			workbenchMode.deactivateEditor(this);
			this.clearLuaBootState();
			this.cartBoot.reset(this);
			await applyWorkspaceOverridesToRegistry({
				registry: this.engineLuaSources,
				storage: this.storageService,
				includeServer: true,
				projectRootPath: $.engine_layer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH,
			});
			await this.restartBootRomStartupState();
			api.cartdata($.sources.namespace);
			luaPipeline.bootActiveProgram(this);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private activateEngineProgramAssets(): void {
		$.set_assets(this.assets.biosLayer.assets);
		this.activateProgramSource('engine');
	}

	public activateCartProgramAssets(): void {
		$.set_assets((this.assets.overlayLayer ?? this.assets.cartLayer).assets);
		const perfSpecs = getMachinePerfSpecs(this.activeMachineManifest);
		this.timing.applyUfpsScaled(resolveUfpsScaled(perfSpecs.ufps));
		const cpuHz = resolveCpuHz(perfSpecs.cpu_freq_hz);
		applyActiveMachineTiming(this, cpuHz);
		setTransferRatesFromManifest(this, perfSpecs);
	}

	public dispose(): void {
		this.cartBoot.resetDeferredPreparation();
		workbenchMode.disposeShortcutHandlers(this);
		this.terminal.deactivate();
		workbenchMode.deactivateEditor(this);
		this.luaInitialized = false;
		if (this.editor) {
			this.editor.shutdown();
			this.editor = null;
		}
		this.luaInterpreter = null;
		if (Runtime._instance === this) {
			Runtime._instance = null;
		}
	}

	public createApiRuntimeError(message: string): LuaRuntimeError {
		this.luaInterpreter.markFaultEnvironment();
		const range = this.machine.cpu.getDebugRange(this.machine.cpu.getDebugState().pc);
		return range ? new LuaRuntimeError(message, range.path, range.start.line, range.start.column) : new LuaRuntimeError(message, (this._luaPath ?? 'lua'), 0, 0);
	}

	public internString(value: string): StringValue {
		return this.machine.cpu.getStringPool().intern(value);
	}

	public luaKey(name: string): StringValue {
		return this.internString(name);
	}

	private prepareHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): Error {
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		return wrappedError;
	}

	private handleClosureHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): never {
		const wrappedError = this.prepareHandlerError(error, meta);
		workbenchMode.handleLuaError(this, wrappedError);
		throw wrappedError;
	}

	private handleLuaHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): never {
		const wrappedError = this.prepareHandlerError(error, meta);
		this.luaInterpreter.recordFaultCallStack();
		workbenchMode.handleLuaError(this, wrappedError);
		throw wrappedError;
	}

}
