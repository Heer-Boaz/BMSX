import type { LuaDefinitionInfo } from '../../lua/syntax/ast';
import type { LuaEnvironment } from '../../lua/environment';
import { LuaRuntimeError } from '../../lua/errors';
import { LuaHandlerCache } from '../../lua/handler_cache';
import { LuaInterpreter } from '../../lua/runtime';
import {
	convertToError,
	type LuaDebuggerPauseSignal
} from '../../lua/value';
import type { StorageService } from './storage';
import type { CartManifest, MachineManifest, RuntimeRomPackage, Viewport } from '../../rompack/format';
import {
	CART_ROM_HEADER_SIZE,
	DEFAULT_GEO_WORK_UNITS_PER_SEC,
	DEFAULT_VDP_WORK_UNITS_PER_SEC,
	getMachinePerfSpecs,
} from '../../rompack/format';
import { RomSourceStack, type RawRomSource, type RomSourceLayer } from '../../rompack/source';
import { buildRuntimeRomLayer, type RuntimeRomLayer } from '../../rompack/loader';
import { StringValue, Table, type Value, type ProgramMetadata, type NativeFunction, type NativeObject } from '../cpu/cpu';
import { IRQ_NEWGAME, IRQ_REINIT } from '../bus/io';
import type { TerminalMode } from '../../ide/terminal/ui/mode';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { Font, type FontVariant } from '../../render/shared/bmsx_font';
import type { GameView } from '../../render/gameview';
import type { CartEditor } from '../../ide/cart_editor';
import { type LuaSemanticModel, type FileSemanticData } from '../../lua/semantic/model';
import { registerFirmwareBuiltins } from '../firmware/builtins';
import { LuaFunctionRedirectCache } from '../firmware/handler_registry';
import { LuaJsBridge } from './host/native_bridge';
import type { RuntimeOptions } from './options';
import type { GateGroup } from '../../common/taskgate';
import { taskGate } from '../../common/taskgate';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_SYSTEM_PROJECT_ROOT_PATH } from '../../ide/workspace/workspace';
import {
	buildLuaSources,
	resolveLuaSourceRecord as resolveRegistryLuaSourceRecord,
	type LuaSourceMatch,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../program/sources';
import * as workbenchMode from '../../ide/workbench/mode';
import { deactivateEditor, deactivateTerminalMode } from '../../ide/workbench/overlay_modes';
import { handleLuaError } from '../../ide/workbench/runtime_errors';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { DebugPauseCoordinator } from '../../ide/runtime/debug_pause';
import { clearRuntimeFault, createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/debugger';
import type { LuaBuiltinDescriptor, LuaMemberCompletion } from '../../lua/semantic_contracts';
import type { ParsedLuaChunk } from '../../lua/analysis/parse';
import { configureLuaHeapUsage, getTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
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
import { callClosureInto, invokeClosureHandler, invokeLuaHandler } from '../program/executor';
import { resolvePositiveSafeInteger, resolveRuntimeRenderSize } from '../specs';
import { resolveRuntimeMemoryMapSpecs } from '../memory/specs';
import { raiseSystemIrq } from './system_irq';
import {
	applyActiveMachineTiming,
	refreshDeviceTimings,
	setTransferRatesFromManifest,
} from './timing/config';
import { HandlerCache } from './handler_cache';
import { Machine } from '../machine';
import type { RuntimeInputSource } from './input';
import { Memory } from '../memory/memory';
import {
	BASE_RAM_USED_SIZE,
	DEFAULT_VRAM_IMAGE_SLOT_SIZE,
	PROGRAM_BSS_BASE,
	RAM_SIZE,
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


export class Runtime {
	public readonly storageService: StorageService;
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, LuaBuiltinDescriptor>();
	public _activeIdeFontVariant: FontVariant = EDITOR_FONT_VARIANT;
	public tickEnabled: boolean = true;
	public editor!: CartEditor;
	public readonly overlayRenderer = new OverlayRenderer();
	public terminal!: TerminalMode;
	public readonly timing: TimingState;
	public executionOverlayActive = false;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public readonly debuggerController = new LuaDebuggerController();
	public readonly pauseCoordinator = new DebugPauseCoordinator();
	public debuggerSuspendSignal: LuaDebuggerPauseSignal = null;
	public debuggerPaused = false;
	public debuggerMetrics: LuaDebuggerSessionMetrics = null;
	public readonly workbenchFaultState = createRuntimeFaultState();
	public lastIdeInputFrame = -1;
	public lastTerminalInputFrame = -1;
	public set overlayResolutionMode(value: 'offscreen' | 'viewport') {
		this._overlayResolutionMode = value;
		this.overlayRenderer.setRenderingViewportType(this.view, value);
		this.editor.updateViewport(this.overlayRenderer.viewportSize);
	}

	public initializeOverlayViewport(viewport: Viewport): void {
		this._overlayResolutionMode = 'viewport';
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderer.viewportSize;
	}

	public cpuUsageCyclesUsed(): number {
		return this.frameLoop.frameActive ? this.frameLoop.frameState.activeCpuUsedCycles : this.frameScheduler.lastTickCpuUsedCycles;
	}

	public cpuUsageCyclesGranted(): number {
		return this.frameLoop.frameActive
			? this.frameLoop.frameState.cycleBudgetGranted
			: (this.frameScheduler.lastTickSequence === 0 ? this.timing.cycleBudgetPerFrame : this.frameScheduler.lastTickCpuBudgetGranted);
	}

	// disable-next-line single_line_method_pattern -- runtime telemetry boundary mirrors native Runtime and keeps host UI out of VDP internals.
	public vdpUsageWorkUnitsLast(): number {
		return this.machine.vdp.lastFrameCost();
	}

	// disable-next-line single_line_method_pattern -- runtime telemetry boundary mirrors native Runtime and keeps host UI out of VDP internals.
	public vdpUsageFrameHeld(): boolean {
		return this.machine.vdp.lastFrameHeld();
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
	public hostEvalMetadata: ProgramMetadata | null = null;
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
	public overlayDrawFrameOwner: 'terminal' | 'ide' | null = null;
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
	public readonly screen: RenderPresentationState;
	public readonly activeMachineManifest: MachineManifest;
	public readonly cartManifest: CartManifest | null;
	public readonly cartProjectRootPath: string | null;
	public systemRom: RuntimeRomLayer = null;
	public cartRom: RuntimeRomLayer | null = null;
	public overlayRom: RuntimeRomLayer | null = null;
	public systemPackage: RuntimeRomPackage = null;
	public activePackage: RuntimeRomPackage = null;
	public systemLuaSources: LuaSourceRegistry = null;
	public cartLuaSources: LuaSourceRegistry | null = null;
	public activeLuaSources: LuaSourceRegistry = null;
	public cartProgramStarted = false;
	public cartEntryProtoIndex: number | null = null;
	public cartSectionInitProtoIndex: number | null = null;
	public programBssBaseAddress = PROGRAM_BSS_BASE;
	public cartBssBaseAddress: number | null = null;
	public cartStaticModulePaths: ReadonlyArray<string> = [];
	public systemRomSource: RawRomSource = null;
	public cartRomSource: RawRomSource | null = null;
	public activeRomSource: RawRomSource = null;
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
	public readonly nativeFunctionCache = new WeakMap<Function, NativeFunction>();
	public readonly nativeMemberCache = new WeakMap<object, Map<string, NativeFunction>>();
	public readonly tableIds = new WeakMap<Table, number>();
	public nextTableId = 1;
	public pairsIterator: Value = null;
	public ipairsIterator: Value = null;
	public randomSeedValue = 0;
	public nativeMemberCompletionCache: WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }> = new WeakMap();
	public readonly pathSemanticCache: Map<string, { source: string; model?: LuaSemanticModel; definitions?: ReadonlyArray<LuaDefinitionInfo>; parsed?: ParsedLuaChunk; lines?: readonly string[]; analysis?: FileSemanticData }> = new Map();

	public readonly luaGate: GateGroup = taskGate.group('machine:lua');
	public cartEntryAvailable = true;
	public readonly hostFault: HostFaultState;
	public readonly machine: Machine;
	public readonly cartBoot: CartBootState;
	public readonly view: GameView;
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}
	public get hasProgramSymbols(): boolean {
		return this.programMetadata !== null;
	}

	public static async init(systemLayer: RuntimeRomLayer, workspaceOverlay: Uint8Array | undefined, input: RuntimeInputSource, view: GameView, storageService: StorageService, cartridge?: Uint8Array): Promise<Runtime> {
		const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
		const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, ['system']);
		const systemMachine = systemLayer.index.machine;
		if (!cartridge) {
			const systemMemorySpecs = resolveRuntimeMemoryMapSpecs({
				machine: systemMachine,
				systemMachine,
				systemSlotBytes: DEFAULT_VRAM_IMAGE_SLOT_SIZE,
			});
			configureMemoryMap(systemMemorySpecs);
			const systemPerfSpecs = getMachinePerfSpecs(systemMachine);
			const ufpsScaled = resolveUfpsScaled(systemPerfSpecs.ufps);
			const cpuHz = resolvePositiveSafeInteger(systemPerfSpecs.cpu_freq_hz, 'machine.specs.cpu.cpu_freq_hz');
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
			const systemRenderSize = resolveRuntimeRenderSize(systemMachine);
			const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, systemRenderSize.height);
			const memory = new Memory({
				systemRom: new Uint8Array(systemLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = new Runtime({
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
			}, input, view, storageService);
			setTransferRatesFromManifest(runtime, systemPerfSpecs);
			runtime.configureProgramSources({
				systemRom: systemLayer,
				cartRom: null,
				overlayRom: null,
				systemSources: systemLuaSources,
				cartSources: null,
				systemRomSource: systemSource,
				cartRomSource: null,
			});
			return runtime;
		}

		const cartRom = await buildRuntimeRomLayer({ blob: cartridge, id: 'cart' });
		const overlayBlob = workspaceOverlay;
		let overlayRom: RuntimeRomLayer | null = null;
		if (overlayBlob) {
			overlayRom = await buildRuntimeRomLayer({ blob: overlayBlob, id: 'overlay' });
		}
		const sourceLayers: RomSourceLayer[] = [];
		if (overlayRom) {
			sourceLayers.push({ id: overlayRom.id, index: overlayRom.index, payload: overlayRom.payload });
		}
		sourceLayers.push({ id: cartRom.id, index: cartRom.index, payload: cartRom.payload });
		sourceLayers.push({ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload });
		const activeRomSource = new RomSourceStack(sourceLayers);

		const cartSource = new RomSourceStack([{ id: cartRom.id, index: cartRom.index, payload: cartRom.payload }]);
		const cartLuaSources = buildLuaSources(cartSource, activeRomSource, cartRom.index, overlayRom ? ['overlay', 'cart'] : ['cart']);

		const memoryLimits = resolveRuntimeMemoryMapSpecs({
			machine: cartRom.index.machine,
			systemMachine,
			systemSlotBytes: DEFAULT_VRAM_IMAGE_SLOT_SIZE,
		});
		configureMemoryMap(memoryLimits);
		const cartPerfSpecs = getMachinePerfSpecs(cartRom.index.machine);
		const ufpsScaled = resolveUfpsScaled(cartPerfSpecs.ufps);
		const cpuHz = resolvePositiveSafeInteger(cartPerfSpecs.cpu_freq_hz, 'machine.specs.cpu.cpu_freq_hz');
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
		const cartRenderSize = resolveRuntimeRenderSize(cartRom.index.machine);
		const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, cartRenderSize.height);
		let overlayPayload: Uint8Array | undefined;
		if (overlayRom) {
			overlayPayload = new Uint8Array(overlayRom.payload);
		}
		const memory = new Memory({
			systemRom: new Uint8Array(systemLayer.payload),
			cartRom: new Uint8Array(cartRom.payload),
			overlayRom: overlayPayload,
		});
		const runtime = new Runtime({
			viewport: cartRenderSize,
			memory,
			activeMachineManifest: cartRom.index.machine,
			cartManifest: cartRom.index.cart_manifest,
			cartProjectRootPath: cartRom.index.projectRootPath,
			ufpsScaled,
			cpuHz,
			cycleBudgetPerFrame,
			vblankCycles,
			vdpWorkUnitsPerSec: cartPerfSpecs.work_units_per_sec,
			geoWorkUnitsPerSec: cartPerfSpecs.geo_work_units_per_sec,
		}, input, view, storageService);
		setTransferRatesFromManifest(runtime, cartPerfSpecs);
		runtime.configureProgramSources({
			systemRom: systemLayer,
			cartRom,
			overlayRom,
			systemSources: systemLuaSources,
			cartSources: cartLuaSources,
			systemRomSource: systemSource,
			cartRomSource: cartSource,
		});
		await applyWorkspaceOverridesToCart(runtime, {
			cart: cartLuaSources,
			storage: runtime.storageService,
			includeServer: true,
			projectRootPath: cartRom.index.projectRootPath,
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
		this.view.default_font = new Font();
		await this.boot();
	}

	private configureProgramSources(params: {
		systemRom: RuntimeRomLayer;
		cartRom: RuntimeRomLayer | null;
		overlayRom: RuntimeRomLayer | null;
		systemSources: LuaSourceRegistry;
		cartSources: LuaSourceRegistry | null;
		systemRomSource: RawRomSource;
		cartRomSource: RawRomSource | null;
	}): void {
		this.systemRom = params.systemRom;
		this.cartRom = params.cartRom;
		this.overlayRom = params.overlayRom;
		this.systemPackage = params.systemRom.package;
		this.activePackage = params.systemRom.package;
		this.systemLuaSources = params.systemSources;
		this.cartLuaSources = params.cartSources;
		this.activeLuaSources = params.systemSources;
		this.cartProgramStarted = false;
		this.cartEntryProtoIndex = null;
		this.cartSectionInitProtoIndex = null;
		this.programBssBaseAddress = PROGRAM_BSS_BASE;
		this.cartBssBaseAddress = null;
		this.cartStaticModulePaths = [];
		this.systemRomSource = params.systemRomSource;
		this.cartRomSource = params.cartRomSource;
		this.activeRomSource = params.systemRomSource;
		this.systemProjectRootPath = params.systemSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
		this.cartBoot.reset();
	}

	public setLinkedCartEntry(entryProtoIndex: number, sectionInitProtoIndex: number, bssBaseAddress: number, staticModulePaths: ReadonlyArray<string>): void {
		this.cartEntryProtoIndex = entryProtoIndex;
		this.cartSectionInitProtoIndex = sectionInitProtoIndex;
		this.cartBssBaseAddress = bssBaseAddress;
		this.cartStaticModulePaths = staticModulePaths;
	}

	public enterSystemFirmware(): void {
		this.cartProgramStarted = false;
		this.activeLuaSources = this.systemLuaSources;
		this.activeRomSource = this.systemRomSource;
		this.activePackage = this.systemPackage;
	}

	public enterCartProgram(): void {
		if (!this.cartLuaSources) {
			throw new Error('cart Lua sources are not configured.');
		}
		if (!this.cartRomSource) {
			throw new Error('cart ROM source is not configured.');
		}
		this.cartProgramStarted = true;
		this.activeLuaSources = this.cartLuaSources;
		this.activeRomSource = this.cartRomSource;
		if (this.overlayRom) {
			this.activePackage = this.overlayRom.package;
		} else if (this.cartRom) {
			this.activePackage = this.cartRom.package;
		} else {
			throw new Error('cart ROM is not configured.');
		}
	}

	public startCartProgram(): void {
		const entryProtoIndex = this.cartEntryProtoIndex;
		const sectionInitProtoIndex = this.cartSectionInitProtoIndex;
		const bssBaseAddress = this.cartBssBaseAddress;
		if (entryProtoIndex === null) {
			throw new Error('cannot start cart: no cart entry point is loaded.');
		}
		if (sectionInitProtoIndex === null) {
			throw new Error('cannot start cart: no cart section init is loaded.');
		}
		if (bssBaseAddress === null) {
			throw new Error('cannot start cart: no cart bss base is loaded.');
		}
		this.programBssBaseAddress = bssBaseAddress;
		this.enterCartProgram();
		this._luaPath = this.activeLuaSources.entry_path;
		this.startLoadedProgram(entryProtoIndex, sectionInitProtoIndex, this.cartStaticModulePaths, true, true);
	}

	public startLoadedProgram(entryProtoIndex: number, sectionInitProtoIndex: number | null, staticModulePaths: ReadonlyArray<string>, runInit: boolean, runNewGame: boolean): void {
		if (sectionInitProtoIndex !== null) {
			this.runSectionInitializer(sectionInitProtoIndex);
		}
		this.runStaticModuleInitializers(staticModulePaths);
		this.machine.cpu.start(entryProtoIndex);
		this.pendingCall = 'entry';
		this.finishLuaEntryLifecycle(runInit, runNewGame);
	}

	public finishLuaEntryLifecycle(runInit: boolean, runNewGame: boolean): void {
		if (runInit) {
			this.queueLifecycleHandlers(true, runNewGame);
		}
		this.luaInitialized = true;
	}

	private runSectionInitializer(protoIndex: number): void {
		const results = this.luaScratch.values.acquire();
		try {
			callClosureInto(this, { protoIndex, upvalues: [] }, [], results);
		} finally {
			this.luaScratch.values.release(results);
		}
	}

	private runStaticModuleInitializers(paths: ReadonlyArray<string>): void {
		for (let index = 0; index < paths.length; index += 1) {
			this.runStaticModuleInitializer(paths[index]);
		}
		this.machine.cpu.syncGlobalSlotsToTable();
	}

	private runStaticModuleInitializer(path: string): void {
		if (this.moduleCache.has(path)) {
			return;
		}
		const protoIndex = this.moduleProtos.get(path);
		if (protoIndex === undefined) {
			throw this.createApiRuntimeError(`static module init failed: module '${path}' is not compiled.`);
		}
		this.moduleCache.set(path, true);
		const results = this.luaScratch.values.acquire();
		try {
			callClosureInto(this, { protoIndex, upvalues: [] }, [], results);
		} catch (error) {
			this.moduleCache.delete(path);
			throw error;
		} finally {
			this.luaScratch.values.release(results);
		}
		this.moduleCache.delete(path);
	}

	private queueLifecycleHandlers(runInit: boolean, runNewGame: boolean): void {
		const irqMask = (runInit ? IRQ_REINIT : 0) | (runNewGame ? IRQ_NEWGAME : 0);
		if (irqMask !== 0) {
			raiseSystemIrq(this, irqMask);
		}
	}

	public requireModule(moduleName: string): Value {
		const cached = this.moduleCache.get(moduleName);
		if (cached !== undefined) {
			return cached;
		}
		const protoIndex = this.moduleProtos.get(moduleName);
		if (protoIndex === undefined) {
			throw this.createApiRuntimeError(`require('${moduleName}') failed: module not compiled.`);
		}
		this.moduleCache.set(moduleName, true);
		const results = this.luaScratch.values.acquire();
		let value: Value = null;
		try {
			callClosureInto(this, { protoIndex, upvalues: [] }, [], results);
			value = results.length > 0 ? results[0] : null;
		} finally {
			this.luaScratch.values.release(results);
		}
		const cachedValue = value === null ? true : value;
		this.moduleCache.set(moduleName, cachedValue);
		return cachedValue;
	}

	public resolveCurrentModuleId(): string {
		const currentPath = this.currentPath;
		if (!currentPath) {
			return 'runtime';
		}
		const record = this.resolveLuaSourceRecord(currentPath);
		return record ? record.source_path : 'runtime';
	}

	public resolveLuaSourceRecord(path: string): LuaSourceRecord | null {
		return this.resolveLuaSource(path)?.record ?? null;
	}

	public resolveLuaSource(path: string): LuaSourceMatch | null {
		const activeSources = this.activeLuaSources;
		const activeRecord = resolveRegistryLuaSourceRecord(activeSources, path);
		if (activeRecord) {
			return { registry: activeSources, record: activeRecord };
		}
		const cartSources = this.cartLuaSources;
		if (cartSources) {
			const cartRecord = resolveRegistryLuaSourceRecord(cartSources, path);
			if (cartRecord) {
				return { registry: cartSources, record: cartRecord };
			}
		}
		const systemSources = this.systemLuaSources;
		const systemRecord = resolveRegistryLuaSourceRecord(systemSources, path);
		if (systemRecord) {
			return { registry: systemSources, record: systemRecord };
		}
		return null;
	}

	private constructor(
		options: RuntimeOptions,
		private readonly input: RuntimeInputSource,
		view: GameView,
		storageService: StorageService,
	) {
		this.view = view;
		this.frameScheduler = new FrameSchedulerState(this);
		this.frameLoop = new FrameLoopState(this);
		this.screen = new RenderPresentationState(this);
		this.vblank = new VblankState(this);
		this.cpuExecution = new CpuExecutionState(this);
		this.hostFault = new HostFaultState(this);
		this.cartBoot = new CartBootState(this);
		this.timing = new TimingState(options.ufpsScaled, options.cpuHz, options.cycleBudgetPerFrame);
		this.input.setRuntimeInputFrameDurationMs(this.timing.frameDurationMs);
		const initialVdpWorkUnits = options.vdpWorkUnitsPerSec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC;
		const initialGeoWorkUnits = options.geoWorkUnitsPerSec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC;
		this.timing.vdpWorkUnitsPerSec = resolvePositiveSafeInteger(initialVdpWorkUnits, 'machine.specs.vdp.work_units_per_sec');
		this.timing.geoWorkUnitsPerSec = resolvePositiveSafeInteger(initialGeoWorkUnits, 'machine.specs.geo.work_units_per_sec');
		this.storageService = storageService;
		this.activeMachineManifest = options.activeMachineManifest;
		this.cartManifest = options.cartManifest;
		this.cartProjectRootPath = options.cartProjectRootPath;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.machine = new Machine(
			options.memory,
			options.viewport,
			input,
		);
		this.machine.memory.clearIoSlots();
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		this.machine.vdp.initializeVramSurfaces();
		configureLuaHeapUsage({
			getBaseRamUsedBytes: () => this.baseRamUsedBytes(),
			collectTrackedHeapBytes: () => {
				const extraRoots = this.luaScratch.values.acquire();
				try {
					extraRoots.push(this.pairsIterator);
					extraRoots.push(this.ipairsIterator);
					for (const value of this.moduleCache.values()) {
						extraRoots.push(value);
					}
					return this.machine.cpu.collectTrackedHeapBytes(extraRoots);
				}
				finally {
					this.luaScratch.values.release(extraRoots);
				}
			},
		});
		refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.vblank.setVblankCycles(options.vblankCycles);
	}

	public machineElapsedMs(): number {
		return this.machine.scheduler.currentNowCycles() * 1000 / this.timing.cpuHz;
	}

	public baseRamUsedBytes(): number {
		return BASE_RAM_USED_SIZE;
	}

	public ramUsedBytes(): number {
		return this.baseRamUsedBytes() + getTrackedLuaHeapBytes();
	}

	public ramTotalBytes(): number {
		return RAM_SIZE;
	}

	public vramUsedBytes(): number {
		return this.machine.vdp.trackedUsedVramBytes;
	}

	public vramTotalBytes(): number {
		return this.machine.vdp.trackedTotalVramBytes;
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
		registerFirmwareBuiltins(this, interpreter);
		interpreter.setReservedIdentifiers(this.getReservedLuaIdentifiers());
		return interpreter;
	}

	public getReservedLuaIdentifiers(): ReadonlySet<string> {
		return new Set<string>(this.apiFunctionNames);
	}

	public assignInterpreter(interpreter: LuaInterpreter): void {
		this.luaInterpreter = interpreter;
		this.hostEvalMetadata = null;
		this.pendingCall = null;
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
		this.machine.inputController.cancelSampleArm();
		this.machine.cpu.clearHaltUntilIrq();
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
			luaPipeline.bootActiveProgram(this);
		}
		catch (error) {
			handleLuaError(this, error);
			throw new Error(`failed to boot runtime: ${error}`);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private clearBootFaults(): void {
		workbenchMode.clearActiveDebuggerPause(this);
		clearRuntimeFault(this);
	}

	private clearLuaBootState(): void {
		this.luaInitialized = false;
		luaPipeline.invalidateModuleLookups(this);
		this.luaChunkEnvironmentsByPath.clear();
		this.luaGenericChunksExecuted.clear();
		this.editor.clearRuntimeErrorOverlay();
	}

	private async prepareBootRomStartupState(): Promise<void> {
		this.enterSystemFirmware();
		if (!this.terminal) {
			workbenchMode.initializeIdeFeatures(this, resolveRuntimeRenderSize(this.activeMachineManifest));
		}
	}

	public async prepareRebootToBootRom(): Promise<void> {
		this.clearBootFaults();
		deactivateTerminalMode(this);
		deactivateEditor(this);
		this.clearLuaBootState();
		this.cartBoot.reset();
		if (this.cartLuaSources && this.cartProjectRootPath) {
			await applyWorkspaceOverridesToCart(this, {
				cart: this.cartLuaSources,
				storage: this.storageService,
				includeServer: true,
				projectRootPath: this.cartProjectRootPath,
			});
		}
		await applyWorkspaceOverridesToRegistry(this, {
			registry: this.systemLuaSources,
			storage: this.storageService,
			includeServer: true,
			projectRootPath: this.systemProjectRootPath,
		});
		await this.prepareBootRomStartupState();
	}

	public applyCartProgramTiming(): void {
		const perfSpecs = getMachinePerfSpecs(this.activeMachineManifest);
		this.applyUfpsScaled(resolveUfpsScaled(perfSpecs.ufps));
		const cpuHz = resolvePositiveSafeInteger(perfSpecs.cpu_freq_hz, 'machine.specs.cpu.cpu_freq_hz');
		applyActiveMachineTiming(this, cpuHz);
		setTransferRatesFromManifest(this, perfSpecs);
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		this.timing.applyUfpsScaled(ufpsScaled);
		this.input.setRuntimeInputFrameDurationMs(this.timing.frameDurationMs);
	}

	public dispose(): void {
		this.machine.audioController.dispose();
		workbenchMode.disposeShortcutHandlers(this);
		this.terminal.deactivate();
		deactivateEditor(this);
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
		return StringValue.get(this.machine.cpu.stringPool.intern(value));
	}

	public setGlobal(name: string, value: Value): void {
		this.machine.cpu.setGlobalByKey(this.internString(name), value);
	}

	public nextRandom(): number {
		this.randomSeedValue = (this.randomSeedValue * 1664525 + 1013904223) % 4294967296;
		return this.randomSeedValue / 4294967296;
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
