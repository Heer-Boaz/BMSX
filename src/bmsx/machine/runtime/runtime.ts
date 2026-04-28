import { consoleCore } from '../../core/console';
import { taskGate } from '../../core/taskgate';
import { Input } from '../../input/manager';
import type { LuaDefinitionInfo } from '../../lua/syntax/ast';
import type { LuaEnvironment } from '../../lua/environment';
import { LuaRuntimeError } from '../../lua/errors';
import { LuaHandlerCache } from '../../lua/handler_cache';
import { LuaInterpreter } from '../../lua/runtime';
import {
	convertToError,
	type LuaDebuggerPauseSignal
} from '../../lua/value';
import type { Clock, StorageService } from '../../platform/platform';
import type { CartManifest, MachineManifest, RuntimeRomPackage, Viewport } from '../../rompack/format';
import {
	BIOS_ATLAS_ID,
	CART_ROM_HEADER_SIZE,
	DEFAULT_GEO_WORK_UNITS_PER_SEC,
	DEFAULT_VDP_WORK_UNITS_PER_SEC,
	generateAtlasAssetId,
	getMachinePerfSpecs,
} from '../../rompack/format';
import { RomSourceStack, type RawRomSource } from '../../rompack/source';
import { buildRuntimeRomLayer } from '../../rompack/loader';
import { Api } from '../firmware/api/api';
import { Table, type Value, type ProgramMetadata, type NativeFunction, type NativeObject } from '../cpu/cpu';
import { type StringValue } from '../memory/string/pool';
import type { TerminalMode } from '../../ide/terminal/ui/mode';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { Font, type FontVariant } from '../../render/shared/bmsx_font';
import type { CartEditor } from '../../ide/cart_editor';
import { type LuaSemanticModel, type FileSemanticData } from '../../lua/semantic/model';
import { registerApiBuiltins } from '../firmware/builtins';
import { LuaFunctionRedirectCache } from '../firmware/handler_registry';
import { LuaJsBridge } from '../firmware/js_bridge';
import { RuntimeStorage } from '../firmware/cart_storage';
import { RuntimeOptions, LuaBuiltinDescriptor, LuaMemberCompletion } from './contracts';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_SYSTEM_PROJECT_ROOT_PATH } from '../../ide/workspace/workspace';
import { buildLuaSources, resolveLuaSourceRecordFromRegistries, type LuaSourceRegistry } from '../program/sources';
import * as workbenchMode from '../../ide/workbench/mode';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/debugger';
import type { ParsedLuaChunk } from '../../lua/analysis/parse';
import { configureLuaHeapUsage } from '../memory/lua_heap_usage';
import { FrameLoopState } from './frame/loop';
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
import { RuntimeRomLayers } from '../../rompack/runtime_layers';
import { configureVdpSlots } from '../../core/vdp_slot_bootstrap';
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

export type ProgramSource = 'system' | 'cart';
type RuntimeRomLayer = Awaited<ReturnType<typeof buildRuntimeRomLayer>>;

export var api: Api; // Initialized in Runtime constructor

function resolveSystemSlotBytes(systemSource: RawRomSource): number {
	const systemSlot = systemSource.getEntry(generateAtlasAssetId(BIOS_ATLAS_ID));
	if (!systemSlot || !systemSlot.imgmeta) {
		throw new Error('system ROM slot metadata is missing.');
	}
	const { width, height } = systemSlot.imgmeta;
	if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
		throw new Error('system ROM slot dimensions must be positive integers.');
	}
	return width * height * 4;
}

export class Runtime {
	public readonly storage: RuntimeStorage;
	public readonly storageService: StorageService;
	public readonly clock: Clock;
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, LuaBuiltinDescriptor>();
	public get api(): Api {
		return api;
	}
	public _activeIdeFontVariant: FontVariant = EDITOR_FONT_VARIANT;
	public tickEnabled: boolean = true;
	public editor!: CartEditor;
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
	public readonly workbenchFaultState = workbenchMode.createRuntimeFaultState();
	public lastIdeInputFrame = -1;
	public lastTerminalInputFrame = -1;
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderer.setRenderingViewportType(consoleCore.view, value);
		if (this.editor) {
			this.editor.updateViewport(this.overlayRenderer.viewportSize);
		}
	}

	public initializeOverlayViewport(viewport: Viewport): void {
		this._overlayResolutionMode = 'viewport';
		this.overlayRenderer.setViewportSize(viewport);
		if (this.editor) {
			this.editor.updateViewport(viewport);
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
			|| this.luaRuntimeFailed;
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
	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
	public readonly screen: RenderPresentationState;
	public readonly activeMachineManifest: MachineManifest;
	public readonly cartManifest: CartManifest | null;
	public readonly cartProjectRootPath: string | null;
	public systemProjectRootPath: string = DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public pendingLuaWarnings: string[] = [];
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
	public readonly luaRomEntryValueCache = new WeakMap<object, Value>();
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
	private hasCompletedInitialBoot = false;
	public cartEntryAvailable = true;
	public readonly hostFault: HostFaultState;
	public systemLuaSources: LuaSourceRegistry = null;
	public cartLuaSources: LuaSourceRegistry = null;
	public activeLuaSources: LuaSourceRegistry = null;
	public activeProgramSource: ProgramSource = 'system';
	public systemRomSource: RawRomSource = null;
	public cartRomSource: RawRomSource = null;
	public activeRomSource: RawRomSource = null;
	public activePackage: RuntimeRomPackage = null;
	public readonly rom: RuntimeRomLayers;
	public readonly machine: Machine;
	public readonly cartBoot: CartBootState;
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}
	public get hasProgramSymbols(): boolean {
		return this.programMetadata !== null;
	}

	public static async init(systemLayer: RuntimeRomLayer, workspaceOverlay: Uint8Array | undefined, cartridge?: Uint8Array): Promise<Runtime> {
		const playerIndex = Input.instance.startupGamepadIndex ?? 1;

		const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
		const systemLuaSources = buildLuaSources({
			cartSource: systemSource,
			romSource: systemSource,
			index: systemLayer.index,
			allowedPayloadIds: ['system'],
		});
		const systemMachine = systemLayer.index.machine;

		if (!cartridge) {
			Input.instance.getPlayerInput(1).setInputMap({ keyboard: null, gamepad: null, pointer: null }); // Default input mapping for player 1 is required even with no cart to prevent errors

			const systemMemorySpecs = resolveRuntimeMemoryMapSpecs({
				machine: systemMachine,
				systemMachine,
				systemSlotBytes: resolveSystemSlotBytes(systemSource),
			});
			configureMemoryMap(systemMemorySpecs);
			const systemPerfSpecs = getMachinePerfSpecs(systemMachine);
			const ufpsScaled = resolveUfpsScaled(systemPerfSpecs.ufps);
			const cpuHz = resolveCpuHz(systemPerfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
			const systemRenderSize = resolveRuntimeRenderSize(systemMachine);
			const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, systemRenderSize.height);
			const memory = new Memory({
				systemRom: new Uint8Array(systemLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = new Runtime({
				playerIndex,
				viewport: systemRenderSize,
				memory,
				activeMachineManifest: systemMachine,
				cartManifest: null,
				cartProjectRootPath: null,
				ufpsScaled,
				cpuHz,
				cycleBudgetPerFrame,
				vblankCycles,
				vdpWorkUnitsPerSec: systemPerfSpecs.work_units_per_sec,
				geoWorkUnitsPerSec: systemPerfSpecs.geo_work_units_per_sec,
			});
			setTransferRatesFromManifest(runtime, systemPerfSpecs);
			const romLayers = runtime.rom;
			romLayers.biosLayer = systemLayer;
			romLayers.setLayers([systemLayer]);
			runtime.configureProgramSources({
				systemSources: systemLuaSources,
				systemRomSource: systemSource,
			});
			return runtime;
		}

		const cartLayer = await buildRuntimeRomLayer({ blob: cartridge, id: 'cart' });
		const overlayBlob = workspaceOverlay;
		let overlayLayer: RuntimeRomLayer | null = null;
		if (overlayBlob) {
			overlayLayer = await buildRuntimeRomLayer({ blob: overlayBlob, id: 'overlay' });
		}
		const runtimeRomLayers = overlayLayer ? [systemLayer, cartLayer, overlayLayer] : [systemLayer, cartLayer];
		const layers = [];
		if (overlayLayer) {
			layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
		}
		layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
		layers.push({ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload });
		const romSource = new RomSourceStack(layers);

		const cartSource = new RomSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = buildLuaSources({
			cartSource,
			romSource,
			index: cartLayer.index,
			allowedPayloadIds: overlayLayer ? ['overlay', 'cart'] : ['cart'],
		});

		const inputMappingPerPlayer = cartLayer.index.input;
		if (inputMappingPerPlayer) {
			for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
				const mappedIndex = parseInt(playerIndexStr, 10);
				const inputMapping = inputMappingPerPlayer[mappedIndex];
				Input.instance.getPlayerInput(mappedIndex).setInputMap(inputMapping);
			}
		} else {
			Input.instance.getPlayerInput(1).setInputMap(Input.DEFAULT_INPUT_MAPPING);
		}

		const memoryLimits = resolveRuntimeMemoryMapSpecs({
			machine: cartLayer.index.machine,
			systemMachine,
			systemSlotBytes: resolveSystemSlotBytes(systemSource),
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
			systemRom: new Uint8Array(systemLayer.payload),
			cartRom: new Uint8Array(cartLayer.payload),
			overlayRom,
		});
		const runtime = new Runtime({
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
		const romLayers = runtime.rom;
		romLayers.biosLayer = systemLayer;
		romLayers.setLayers(runtimeRomLayers);
		romLayers.cartLayer = cartLayer;
		romLayers.overlayLayer = overlayLayer;
		runtime.configureProgramSources({
			systemSources: systemLuaSources,
			cartSources: cartLuaSources,
			systemRomSource: systemSource,
			cartRomSource: cartSource,
		});
		await applyWorkspaceOverridesToCart(runtime, {
			cart: cartLuaSources,
			storage: runtime.storageService,
			includeServer: true,
			projectRootPath: cartLayer.index.projectRootPath,
		});
			return runtime;
		}

		public async startPreparedRuntime(): Promise<void> {
			await applyWorkspaceOverridesToRegistry(this, {
				registry: this.systemLuaSources,
				storage: this.storageService,
				includeServer: true,
				projectRootPath: this.systemProjectRootPath,
			});
			await this.prepareBootRomStartupState();
			await consoleCore.refreshRenderSurfaces();
			consoleCore.view.default_font = new Font();
			await this.boot();
		}

	public static destroy(runtime: Runtime): void {
		runtime.dispose();
	}

	private configureProgramSources(params: {
		systemSources: LuaSourceRegistry;
		cartSources?: LuaSourceRegistry;
		systemRomSource: RawRomSource;
		cartRomSource?: RawRomSource;
	}): void {
		this.systemLuaSources = params.systemSources;
		this.cartLuaSources = params.cartSources;
		this.systemRomSource = params.systemRomSource;
		this.cartRomSource = params.cartRomSource;
		this.systemProjectRootPath = params.systemSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
		this.cartBoot.reset();
	}

	public activateProgramSource(source: ProgramSource): void {
		const luaSources = source === 'system' ? this.systemLuaSources : this.cartLuaSources;
		const romSource = source === 'system' ? this.systemRomSource : this.cartRomSource;
		if (!luaSources) {
			throw new Error(`${source} Lua sources are not configured.`);
		}
		if (!romSource) {
			throw new Error(`${source} ROM source is not configured.`);
		}
		this.activeProgramSource = source;
		this.activeLuaSources = luaSources;
		this.activeRomSource = romSource;
		this.rom.activeSource = romSource;
		api.cartdata(luaSources.namespace);
	}

	public resolveCurrentModuleId(): string {
		const currentPath = this.currentPath;
		if (!currentPath) {
			return 'runtime';
		}
		const binding = resolveLuaSourceRecordFromRegistries(currentPath, [
			this.activeLuaSources,
			this.cartLuaSources,
			this.systemLuaSources,
		]);
		if (!binding) {
			return 'runtime';
		}
		return binding.source_path;
	}

	private constructor(options: RuntimeOptions) {
		this.frameScheduler = new FrameSchedulerState(this);
		this.frameLoop = new FrameLoopState(this);
		this.screen = new RenderPresentationState(this);
		this.vblank = new VblankState(this);
		this.cpuExecution = new CpuExecutionState(this);
		this.hostFault = new HostFaultState(this);
		this.rom = new RuntimeRomLayers();
		this.cartBoot = new CartBootState(this);
		this.timing = new TimingState(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame);
		Input.instance.setFrameDurationMs(this.timing.frameDurationMs);
		const initialVdpWorkUnits = options.vdpWorkUnitsPerSec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC;
		const initialGeoWorkUnits = options.geoWorkUnitsPerSec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC;
		this.timing.vdpWorkUnitsPerSec = resolveVdpWorkUnitsPerSec(initialVdpWorkUnits);
		this.timing.geoWorkUnitsPerSec = resolveGeoWorkUnitsPerSec(initialGeoWorkUnits);
		this.storageService = consoleCore.platform.storage;
		this.clock = consoleCore.platform.clock;
		this.storage = new RuntimeStorage(this.storageService, options.activeMachineManifest.namespace);
		this.activeMachineManifest = options.activeMachineManifest;
		this.cartManifest = options.cartManifest;
		this.cartProjectRootPath = options.cartProjectRootPath;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		api = new Api({
			storage: this.storage,
			runtime: this,
		});
		this.machine = new Machine(
			options.memory,
			{ width: options.viewport.width, height: options.viewport.height },
			Input.instance,
			consoleCore.sndmaster,
			api,
		);
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
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
		this.vblank.setVblankCycles(options.vblankCycles);
		this.randomSeedValue = this.clock.now();
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.requireHandler = (ctx, module) => luaPipeline.requireLuaModule(this, ctx, module);
		interpreter.outputHandler = (text) => this.terminal.appendStdout(text);
	}

	public createLuaInterpreter(): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge);
		this.configureInterpreter(interpreter);
		interpreter.attachDebugger(this.debuggerController);
		interpreter.clearLastFaultEnvironment();
		registerApiBuiltins(this, interpreter);
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
		this.vblank.clearHaltUntilIrq();
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
			this.hostFault.clear();
			this.clearBootFaults();
			this.clearLuaBootState();
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset the runtime state
				await consoleCore.resetRuntime();
				consoleCore.bootstrapStartupAudio();
			}
			api.cartdata(this.activeLuaSources.namespace);
			luaPipeline.bootActiveProgram(this);
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw new Error(`failed to boot runtime: ${error}`);
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
		luaPipeline.invalidateModuleLookups(this);
		this.luaChunkEnvironmentsByPath.clear();
		this.luaGenericChunksExecuted.clear();
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}
	}

	private async prepareBootRomStartupState(): Promise<void> {
		await configureVdpSlots({
			machine: this.machine,
			systemRecords: this.systemRomSource.list(),
			layers: this.rom.listLayers(),
		});
		this.activateSystemProgram();
		if (!this.terminal) {
			workbenchMode.initializeIdeFeatures(this, resolveRuntimeRenderSize(this.activeMachineManifest));
		}
	}

	private async restartBootRomStartupState(): Promise<void> {
		await consoleCore.resetRuntime();
		await this.prepareBootRomStartupState();
		await consoleCore.refreshRenderSurfaces();
		consoleCore.bootstrapStartupAudio();
	}

	public async rebootToBootRom(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
		try {
			this.clearBootFaults();
			workbenchMode.deactivateTerminalMode(this);
			workbenchMode.deactivateEditor(this);
			this.clearLuaBootState();
			this.cartBoot.reset();
			await applyWorkspaceOverridesToRegistry(this, {
				registry: this.systemLuaSources,
				storage: this.storageService,
				includeServer: true,
				projectRootPath: this.systemProjectRootPath,
			});
			await this.restartBootRomStartupState();
			api.cartdata(this.activeLuaSources.namespace);
			luaPipeline.bootActiveProgram(this);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private activateSystemProgram(): void {
		this.activePackage = this.rom.systemPackage();
		this.activateProgramSource('system');
	}

	public activateCartProgram(): void {
		this.activePackage = this.rom.activeCartPackage();
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
			this.editor.shutdown();
		this.luaInterpreter = null;
	}

	public createApiRuntimeError(message: string): LuaRuntimeError {
		this.luaInterpreter.markFaultEnvironment();
		const range = this.machine.cpu.getDebugRange(this.machine.cpu.getDebugState().pc);
		return range ? new LuaRuntimeError(message, range.path, range.start.line, range.start.column) : new LuaRuntimeError(message, (this._luaPath ?? 'lua'), 0, 0);
	}

	// disable-next-line single_line_method_pattern -- runtime string interning is the public CPU string-pool boundary.
	public internString(value: string): StringValue {
		return this.machine.cpu.getStringPool().intern(value);
	}

	// disable-next-line single_line_method_pattern -- Lua keys intentionally share runtime string interning.
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
		throw wrappedError;
	}

	private handleLuaHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): never {
		const wrappedError = this.prepareHandlerError(error, meta);
		this.luaInterpreter.recordFaultCallStack();
		throw wrappedError;
	}

}
