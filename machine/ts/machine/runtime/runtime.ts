import type { LuaDefinitionInfo } from '../../lua/syntax/ast';
import type { LuaEnvironment } from '../../lua/environment';
import { LuaRuntimeError } from '../../lua/errors';
import { LuaHandlerCache } from '../../lua/handler_cache';
import { LuaInterpreter } from '../../lua/runtime';
import {
	convertToError,
	type LuaDebuggerPauseSignal
} from '../../lua/value';
import type { CartManifest, MachineManifest, RuntimeRomPackage } from '../../rompack/format';
import { CART_ROM_HEADER_SIZE } from '../../rompack/format';
import { RomSourceStack, type RawRomSource, type RomSourceLayer } from '../../rompack/source';
import { buildRuntimeRomLayer, type RuntimeRomLayer } from '../../rompack/loader';
import { StringValue, Table, type Value, type ProgramMetadata, type NativeFunction, type NativeObject } from '../cpu/cpu';
import { type LuaSemanticModel, type FileSemanticData } from '../../lua/semantic/model';
import { registerFirmwareBuiltins } from '../firmware/builtins';
import { LuaFunctionRedirectCache } from '../firmware/handler_registry';
import { HandlerCache, LuaJsBridge } from './host/native_bridge';
import type { RuntimeOptions } from './options';
import type { GateGroup } from '../../common/taskgate';
import { taskGate } from '../../common/taskgate';
import {
	buildLuaSources,
	resolveLuaSourceRecord as resolveRegistryLuaSourceRecord,
	type LuaSourceMatch,
	type LuaSourceRecord,
	type LuaSourceRegistry,
	DEFAULT_SYSTEM_PROJECT_ROOT_PATH,
} from '../program/sources';
import { DebugPauseCoordinator } from '../../lua/debug_pause';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/debugger';
import type { LuaBuiltinDescriptor, LuaMemberCompletion } from '../../lua/semantic_contracts';
import type { ParsedLuaChunk } from '../../lua/analysis/parse';
import { configureLuaHeapUsage, getTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
import { FrameLoopState } from './frame/loop';
import { FrameSchedulerState } from '../scheduler/frame';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { CpuExecutionState } from './cpu_executor';
import { CartBootState } from './cart_boot';
import { HostFaultState } from './host_fault';
import { LuaScratchState } from '../program/scratch';
import { callClosureInto, invokeClosureHandler, invokeLuaHandler } from '../program/executor';
import type { ProgramVectorTable } from '../program/loader';
import { resolveRuntimeMemoryMapSpecs } from '../memory/specs';
import { getMachineRegionTimingForWord, MACHINE_REGION_PAL_WORD, PSX_MODEL_PROFILE } from '../model_registry';
import { applyRuntimeTiming, resolveRuntimeTiming } from './boot_timing';
import { refreshDeviceTimings, setFrameTiming } from './timing/config';
import { HZ_SCALE } from './timing/constants';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { IO_SYS_FRAME_MS, IO_SYS_REGION, IO_SYS_TIME_MS } from '../bus/io';
import { Machine } from '../machine';
import type { RuntimeInputSource } from './input';
import { Memory } from '../memory/memory';
import type { MicrotaskQueue } from '../scheduler/microtask_queue';
import {
	BASE_RAM_USED_SIZE,
	PROGRAM_STATIC_RAM_BASE,
	RAM_SIZE,
	configureMemoryMap,
} from '../memory/map';

export type RuntimeProgramVectorTable = {
	resetProtoIndex: number;
	sectionInitProtoIndex: number | null;
	irqProtoIndex: number;
};


export class Runtime {
	public readonly luaJsBridge!: LuaJsBridge;
	public readonly apiFunctionNames = new Set<string>();
	public readonly luaBuiltinMetadata = new Map<string, LuaBuiltinDescriptor>();
	public tickEnabled: boolean = true;
	public readonly timing: TimingState;
	public executionOverlayActive = false;
	public readonly debuggerController = new LuaDebuggerController();
	public readonly pauseCoordinator = new DebugPauseCoordinator();
	public debuggerSuspendSignal: LuaDebuggerPauseSignal = null;
	public debuggerPaused = false;
	public debuggerMetrics: LuaDebuggerSessionMetrics = null;
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
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
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
	public programVectors: RuntimeProgramVectorTable | null = null;
	public cartVectors: ProgramVectorTable | null = null;
	public programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public programBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public cartDataBaseAddress: number | null = null;
	public cartBssBaseAddress: number | null = null;
	public cartStaticModulePaths: ReadonlyArray<string> = [];
	public systemRomSource: RawRomSource = null;
	public cartRomSource: RawRomSource | null = null;
	public activeRomSource: RawRomSource = null;
	public systemProjectRootPath: string = DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public pendingLuaWarnings: string[] = [];
	public readonly luaOutputLines: string[] = [];
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
	public nativeMemberCompletionCache: WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }> = new WeakMap();
	public readonly pathSemanticCache: Map<string, { source: string; model?: LuaSemanticModel; definitions?: ReadonlyArray<LuaDefinitionInfo>; parsed?: ParsedLuaChunk; lines?: readonly string[]; analysis?: FileSemanticData }> = new Map();

	public readonly luaGate: GateGroup = taskGate.group('machine:lua');
	public cartEntryAvailable = true;
	public readonly hostFault: HostFaultState;
	public readonly machine: Machine;
	public readonly cartBoot: CartBootState;
	public get interpreter(): LuaInterpreter {
		return this.luaInterpreter;
	}
	public get hasProgramSymbols(): boolean {
		return this.programMetadata !== null;
	}

	public static async init(systemLayer: RuntimeRomLayer, workspaceOverlay: Uint8Array | undefined, input: RuntimeInputSource, microtasks: MicrotaskQueue, cartridge?: Uint8Array): Promise<Runtime> {
		const systemSource = new RomSourceStack([{ id: systemLayer.id, index: systemLayer.index, payload: systemLayer.payload }]);
		const systemLuaSources = buildLuaSources(systemSource, systemSource, systemLayer.index, ['system']);
		const systemMachine = systemLayer.index.machine;
		if (!cartridge) {
			const systemMemorySpecs = resolveRuntimeMemoryMapSpecs(systemMachine);
			configureMemoryMap(systemMemorySpecs);
			const timing = resolveRuntimeTiming(systemMachine, systemMachine, PSX_MODEL_PROFILE.cpuFreqHz, MACHINE_REGION_PAL_WORD);
			const memory = new Memory({
				systemRom: new Uint8Array(systemLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = new Runtime({
				viewport: { width: timing.viewportWidth, height: timing.viewportHeight },
				memory,
				activeMachineManifest: systemMachine,
				cartManifest: null,
				cartProjectRootPath: null,
				machineRegionWord: timing.regionWord,
				ufpsScaled: timing.ufpsScaled,
				cpuHz: timing.cpuHz,
				cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
				vblankCycles: timing.vblankCycles,
				imgDecBytesPerSec: timing.imgDecBytesPerSec,
				dmaBytesPerSecIso: timing.dmaBytesPerSecIso,
				dmaBytesPerSecBulk: timing.dmaBytesPerSecBulk,
				vdpWorkUnitsPerSec: timing.vdpWorkUnitsPerSec,
				geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
			}, input, microtasks);
			applyRuntimeTiming(runtime, timing);
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

		const memoryLimits = resolveRuntimeMemoryMapSpecs(cartRom.index.machine);
		configureMemoryMap(memoryLimits);
		const timing = resolveRuntimeTiming(cartRom.index.machine, cartRom.index.machine, PSX_MODEL_PROFILE.cpuFreqHz, MACHINE_REGION_PAL_WORD);
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
			viewport: { width: timing.viewportWidth, height: timing.viewportHeight },
			memory,
			activeMachineManifest: cartRom.index.machine,
			cartManifest: cartRom.index.cart_manifest,
			cartProjectRootPath: cartRom.index.projectRootPath,
			machineRegionWord: timing.regionWord,
			ufpsScaled: timing.ufpsScaled,
			cpuHz: timing.cpuHz,
			cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
			vblankCycles: timing.vblankCycles,
			imgDecBytesPerSec: timing.imgDecBytesPerSec,
			dmaBytesPerSecIso: timing.dmaBytesPerSecIso,
			dmaBytesPerSecBulk: timing.dmaBytesPerSecBulk,
			vdpWorkUnitsPerSec: timing.vdpWorkUnitsPerSec,
			geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
		}, input, microtasks);
		applyRuntimeTiming(runtime, timing);
		runtime.configureProgramSources({
			systemRom: systemLayer,
			cartRom,
			overlayRom,
			systemSources: systemLuaSources,
			cartSources: cartLuaSources,
			systemRomSource: systemSource,
			cartRomSource: cartSource,
		});
		return runtime;
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
		this.programVectors = null;
		this.cartVectors = null;
		this.programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
		this.programBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
		this.cartDataBaseAddress = null;
		this.cartBssBaseAddress = null;
		this.cartStaticModulePaths = [];
		this.systemRomSource = params.systemRomSource;
		this.cartRomSource = params.cartRomSource;
		this.activeRomSource = params.systemRomSource;
		this.systemProjectRootPath = params.systemSources.projectRootPath || DEFAULT_SYSTEM_PROJECT_ROOT_PATH;
		this.cartBoot.reset();
	}

	public setLinkedCartVectors(vectors: ProgramVectorTable, dataBaseAddress: number, bssBaseAddress: number, staticModulePaths: ReadonlyArray<string>): void {
		this.cartVectors = vectors;
		this.cartDataBaseAddress = dataBaseAddress;
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
		const vectors = this.cartVectors;
		const dataBaseAddress = this.cartDataBaseAddress;
		const bssBaseAddress = this.cartBssBaseAddress;
		if (vectors === null) {
			throw new Error('cannot start cart: no cart vector table is loaded.');
		}
		if (dataBaseAddress === null) {
			throw new Error('cannot start cart: no cart data base is loaded.');
		}
		if (bssBaseAddress === null) {
			throw new Error('cannot start cart: no cart bss base is loaded.');
		}
		this.programDataBaseAddress = dataBaseAddress;
		this.programBssBaseAddress = bssBaseAddress;
		this.enterCartProgram();
		this._luaPath = this.activeLuaSources.entry_path;
		this.startLoadedProgram(vectors, this.cartStaticModulePaths);
	}

	public startLoadedProgram(vectors: RuntimeProgramVectorTable, staticModulePaths: ReadonlyArray<string>): void {
		this.programVectors = vectors;
		if (vectors.sectionInitProtoIndex !== null) {
			this.runSectionInitializer(vectors.sectionInitProtoIndex);
		}
		this.runStaticModuleInitializers(staticModulePaths);
		this.machine.cpu.start(vectors.resetProtoIndex);
		this.pendingCall = 'entry';
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
		microtasks: MicrotaskQueue,
	) {
		this.frameScheduler = new FrameSchedulerState(this);
		this.frameLoop = new FrameLoopState(this);
		this.vblank = new VblankState(this);
		this.cpuExecution = new CpuExecutionState(this);
		this.hostFault = new HostFaultState(this);
		this.cartBoot = new CartBootState(this);
		this.timing = new TimingState(
			options.ufpsScaled,
			options.cpuHz,
			options.cycleBudgetPerFrame,
			options.machineRegionWord,
			getMachineRegionTimingForWord(options.machineRegionWord).totalScanlines,
			options.imgDecBytesPerSec,
			options.dmaBytesPerSecIso,
			options.dmaBytesPerSecBulk,
			options.vdpWorkUnitsPerSec,
			options.geoWorkUnitsPerSec,
		);
		this.input.setRuntimeInputFrameDurationMs(this.timing.frameDurationMs);
		this.activeMachineManifest = options.activeMachineManifest;
		this.cartManifest = options.cartManifest;
		this.cartProjectRootPath = options.cartProjectRootPath;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.machine = new Machine(
			options.memory,
			options.viewport,
			input,
			microtasks,
		);
		this.machine.memory.clearIoSlots();
		this.machine.memory.mapIoRead(IO_SYS_TIME_MS, () => this.machineTimeMs());
		this.machine.memory.mapIoRead(IO_SYS_FRAME_MS, () => this.timing.frameDurationMs);
		this.machine.memory.mapIoRead(IO_SYS_REGION, () => this.timing.regionWord);
		this.machine.memory.mapIoWrite(IO_SYS_REGION, (_addr, value) => this.applyMachineRegionWord((value as number) >>> 0));
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		this.machine.vdp.initializeVramSurfaces();
		configureLuaHeapUsage({
			getBaseRamUsedBytes: () => this.baseRamUsedBytes(),
			collectTrackedHeapBytes: () => {
				const extraRoots = this.luaScratch.values.acquire();
				try {
					extraRoots.push(this.pairsIterator);
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

	public machineTimeMs(): number {
		return (this.machine.scheduler.currentNowCycles() * 1000 / this.timing.cpuHz) >>> 0;
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

	public createLuaInterpreter(): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge);
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

	public set jsStackEnabled(enabled: boolean) {
		this.includeJsStackTraces = enabled;
	}

	public get jsStackEnabled(): boolean {
		return this.includeJsStackTraces;
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		const timing = this.timing;
		timing.ufpsScaled = ufpsScaled;
		timing.ufps = ufpsScaled / HZ_SCALE;
		timing.frameDurationMs = 1000 / timing.ufps;
		this.input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
	}

	public applyMachineRegionWord(regionWord: number): void {
		const regionTiming = getMachineRegionTimingForWord(regionWord);
		this.timing.regionWord = regionWord >>> 0;
		this.timing.totalScanlines = regionTiming.totalScanlines;
		this.applyUfpsScaled(regionTiming.refreshUfpsScaled);
		setFrameTiming(
			this,
			this.timing.cpuHz,
			calcCyclesPerFrameScaled(this.timing.cpuHz, regionTiming.refreshUfpsScaled),
			resolveVblankCycles(this.timing.cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, this.activeMachineManifest.render_size.height),
		);
	}

	public dispose(): void {
		this.machine.audioController.dispose();
		this.luaInitialized = false;
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
