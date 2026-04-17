import { $, renderGate, runGate } from '../../core/engine_core';
import { taskGate } from '../../core/taskgate';
import { Input } from '../../input/input';
import type { InputMap } from '../../input/inputtypes';
import type { LuaDefinitionInfo } from '../../lua/syntax/lua_ast';
import { LuaEnvironment } from '../../lua/luaenvironment';
import { LuaRuntimeError } from '../../lua/luaerrors';
import { LuaHandlerCache } from '../../lua/luahandler_cache';
import { LuaInterpreter } from '../../lua/luaruntime';
import type { LuaFunctionValue, LuaValue, StackTraceFrame } from '../../lua/luavalue';
import {
	convertToError,
	isLuaCallSignal,
	setLuaTableCaseInsensitiveKeys,
	type LuaDebuggerPauseSignal
} from '../../lua/luavalue';
import type { StorageService } from '../../platform/platform';
import type { SkyboxImageIds } from '../../render/shared/render_types';
import type { AudioMeta, CartridgeLayerId, ImgMeta, MachineManifest, RomAsset, RomImgAsset, Viewport, RuntimeAssets, id2res } from '../../rompack/rompack';
import {
	CanonicalizationType,
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	CART_ROM_HEADER_SIZE,
	DEFAULT_GEO_WORK_UNITS_PER_SEC,
	DEFAULT_VDP_WORK_UNITS_PER_SEC,
	ENGINE_ATLAS_INDEX,
	getMachineMemorySpecs,
	getMachinePerfSpecs,
	generateAtlasName,
} from '../../rompack/rompack';
import { AssetSourceStack, type RawAssetSource } from '../../rompack/asset_source';
import { buildRuntimeAssetLayer, parseCartHeader, type RuntimeAssetLayer } from '../../rompack/romloader';
import { parseRomMetadataSection } from '../../rompack/rom_metadata';
import { decodeBinary, decodeBinaryWithPropTable } from '../../common/serializer/binencoder';
import { createIdentifierCanonicalizer } from '../../lua/syntax/identifier_canonicalizer';
import { Api } from '../firmware/firmware_api';
import { CPU, Table, type Closure, type Value, type Program, type ProgramMetadata, RunResult, type NativeFunction, type NativeObject } from '../cpu/cpu';
import { type StringValue } from '../memory/string_pool';
import type { TerminalMode } from '../../ide/terminal/ui/terminal_mode';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { Font, type FontVariant } from '../../render/shared/bmsx_font';
import { clearBackQueues } from '../../render/shared/render_queues';
import { clearHardwareLighting } from '../../render/shared/hardware_lighting';
import type { CartEditor } from '../../ide/cart_editor';
import { type FaultSnapshot } from '../../ide/editor/render/render_error_overlay';
import { type CpuFrameSnapshot } from '../cpu/cpu';
import { type LuaSemanticModel, type FileSemanticData } from '../../ide/editor/contrib/intellisense/semantic_model';
import { registerApiBuiltins } from '../firmware/lua_builtins';
import { LuaFunctionRedirectCache } from '../firmware/lua_handler_registry';
import { LuaJsBridge, buildMarshalContext, extendMarshalContext, syncLuaAssetField, toNativeValue, toRuntimeValue } from '../firmware/lua_js_bridge';
import { RuntimeStorage } from './storage';
import type { RuntimeOptions, LuaBuiltinDescriptor, LuaMemberCompletion } from './types';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_ENGINE_PROJECT_ROOT_PATH } from '../../ide/workspace/workspace';
import { buildLuaSources, type LuaSourceRegistry } from '../program/lua_sources';
import * as runtimeIde from '../../ide/runtime/runtime_ide';
import * as runtimeLuaPipeline from '../../ide/runtime/runtime_lua_pipeline';
import { registerAudioAssets as registerAudioAssetsFromSource } from './runtime_assets';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../../lua/luadebugger';
import type { ParsedLuaChunk } from '../../ide/language/lua/lua_parse';
import { ResourceUsageDetector } from './resource_usage_detector';
import { configureLuaHeapUsage } from '../memory/lua_heap_usage';
import { RuntimeFrameLoopState } from './runtime_frame_loop';
import { RuntimeMachineSchedulerState } from './runtime_machine_scheduler';
import {
	DeviceScheduler,
	TIMER_KIND_DEVICE_SERVICE,
	TIMER_KIND_VBLANK_BEGIN,
	TIMER_KIND_VBLANK_END,
} from '../scheduler/device_scheduler';
import { RuntimeScreenState } from './runtime_screen';
import { calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from './runtime_timing';
import { RuntimeTimingState } from './runtime_timing_state';
import {
	HOST_FAULT_FLAG_ACTIVE,
	HOST_FAULT_FLAG_STARTUP_BLOCKING,
	HOST_FAULT_STAGE_NONE,
	HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IRQ_NEWGAME,
	IRQ_REINIT,
	IRQ_VBLANK,
} from '../bus/io';
import { HandlerCache } from './handler_cache';
import { Machine } from '../machine';
import { Memory, ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE, type AssetEntry } from '../memory/memory';
import { DmaController } from '../devices/dma/dma_controller';
import { GeometryController } from '../devices/geometry/geometry_controller';
import { ImgDecController } from '../devices/imgdec/imgdec_controller';
import { InputController } from '../devices/input/input_controller';
import { AudioController } from '../devices/audio/audio_controller';
import { IrqController } from '../devices/irq/irq_controller';
import {
	CART_ROM_BASE,
	DEFAULT_GEO_SCRATCH_SIZE,
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_ATLAS_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	SYSTEM_ROM_BASE,
	STRING_HANDLE_ENTRY_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	configureMemoryMap,
	type MemoryMapSpecs as MemoryMapSpecs,
} from '../memory/memory_map';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, VDP } from '../devices/vdp/vdp';
import { PROGRAM_ASSET_ID } from '../program/program_asset';
import { createVdpBlitterExecutor } from '../../render/vdp/vdp_blitter';

function runtimeFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

// Flip back to 'msx' to restore default font in machine/editor
export const EDITOR_FONT_VARIANT: FontVariant = 'tiny';

const MAX_POOLED_RUNTIME_SCRATCH_ARRAYS = 32;
const ASSET_DATA_ALIGNMENT_BYTES = 0x1000;
const DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1 << 20; // 1 MiB

type FrameState = {
	haltGame: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
	activeCpuUsedCycles: number;
};

type EditorViewOptionsSnapshot = {
	crtPostprocessingEnabled: boolean;
};

type ProgramSource = 'engine' | 'cart';
type RuntimeAssetCollectionKey = 'img' | 'audio' | 'model' | 'data' | 'bin' | 'audioevents';
type RuntimeLayerLookup = Partial<Record<CartridgeLayerId, RuntimeAssetLayer>>;

export var api: Api; // Initialized in Runtime constructor

function buildRuntimeLayerLookup(layers: ReadonlyArray<RuntimeAssetLayer>): RuntimeLayerLookup {
	const lookup: RuntimeLayerLookup = {};
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index]!;
		lookup[layer.id] = layer;
	}
	return lookup;
}

function getRuntimeLayerAssets(layer: RuntimeAssetLayer, kind: RuntimeAssetCollectionKey): RuntimeAssets[RuntimeAssetCollectionKey] {
	switch (kind) {
		case 'img': return layer.assets.img;
		case 'audio': return layer.assets.audio;
		case 'model': return layer.assets.model;
		case 'data': return layer.assets.data;
		case 'bin': return layer.assets.bin;
		case 'audioevents': return layer.assets.audioevents;
	}
}

function resolveLayerForPayload(lookup: RuntimeLayerLookup, payloadId: CartridgeLayerId): RuntimeAssetLayer {
	const layer = lookup[payloadId];
	if (!layer) {
		throw runtimeFault(`asset layer '${payloadId}' not configured.`);
	}
	return layer;
}

function resolveRuntimeLayerAssetFromEntry<T>(lookup: RuntimeLayerLookup, kind: RuntimeAssetCollectionKey, entry: RomAsset): T {
	const payloadId = entry.payload_id;
	if (!payloadId) {
		throw runtimeFault(`asset '${entry.resid}' missing payload_id.`);
	}
	const layer = resolveLayerForPayload(lookup, payloadId);
	const assets = getRuntimeLayerAssets(layer, kind) as Record<string, T>;
	const asset = assets[entry.resid];
	if (!asset) {
		throw runtimeFault(`${kind} asset '${entry.resid}' missing from '${payloadId}' layer.`);
	}
	return asset;
}

function resolveRuntimeLayerAssetById<T>(lookup: RuntimeLayerLookup, source: RawAssetSource, kind: RuntimeAssetCollectionKey, id: string): T {
	const entry = source.getEntry(id);
	if (!entry) {
		throw runtimeFault(`${kind} asset '${id}' not found.`);
	}
	return resolveRuntimeLayerAssetFromEntry<T>(lookup, kind, entry);
}

export class Runtime {
	private static readonly ENGINE_IRQ_MASK = (IRQ_REINIT | IRQ_NEWGAME) >>> 0;
	private static _instance: Runtime = null;

	public static createInstance(options: RuntimeOptions): Runtime {
		const existing = Runtime._instance;
		if (existing) {
			throw runtimeFault('instance already exists.');
		}
		return new Runtime(options);
	}

	private static resolvePositiveSafeInteger(value: number | undefined, label: string): number {
		if (value === undefined) {
			throw runtimeFault(`${label} is required.`);
		}
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw runtimeFault(`${label} must be a positive safe integer.`);
		}
		return value;
	}

	private static resolveCpuHz(value: number | undefined): number {
		return Runtime.resolvePositiveSafeInteger(value, 'machine.specs.cpu.cpu_freq_hz');
	}

	private static resolveBytesPerSec(value: number | undefined, label: string): number {
		return Runtime.resolvePositiveSafeInteger(value, label);
	}

	private static resolveVdpWorkUnitsPerSec(value: number | undefined): number {
		return Runtime.resolvePositiveSafeInteger(value, 'machine.specs.vdp.work_units_per_sec');
	}

	private static resolveGeoWorkUnitsPerSec(value: number | undefined): number {
		return Runtime.resolvePositiveSafeInteger(value, 'machine.specs.geo.work_units_per_sec');
	}

	private static resolveRenderSize(machine: { render_size: { width: number; height: number; } }): Viewport {
		const width = Runtime.resolvePositiveSafeInteger(machine.render_size.width, 'machine.render_size.width');
		const height = Runtime.resolvePositiveSafeInteger(machine.render_size.height, 'machine.render_size.height');
		return { width, height };
	}

	public setCycleBudgetPerFrame(value: number): void {
		if (value === this.cycleBudgetPerFrame) {
			return;
		}
		this.cycleBudgetPerFrame = value;
		runtimeLuaPipeline.registerGlobal(this, 'sys_max_cycles_per_frame', value);
		this.refreshDeviceTimings(this.deviceScheduler.currentNowCycles());
		if (this.vblankCycles > 0) {
			if (this.vblankCycles > this.cycleBudgetPerFrame) {
				throw runtimeFault('vblank_cycles must be less than or equal to cycles_per_frame.');
			}
			this.vblankStartCycle = this.cycleBudgetPerFrame - this.vblankCycles;
			this.resetVblankState();
		}
	}

	public getLastTickBudgetGranted(): number {
		if (this.lastTickSequence === 0) {
			return this.cycleBudgetPerFrame;
		}
		return this.lastTickCpuBudgetGranted;
	}

	public getCpuUsedCyclesLastTick(): number {
		if (this.lastTickSequence === 0) {
			return 0;
		}
		return this.lastTickCpuUsedCycles;
	}

	public getActiveCpuCyclesGranted(): number {
		return this.getLastTickBudgetGranted();
	}

	public getVdpWorkUnitsPerSec(): number {
		return this.vdpWorkUnitsPerSec;
	}

	public getActiveCpuUsedCyclesLastTick(): number {
		return this.getCpuUsedCyclesLastTick();
	}

	public getTrackedRamUsedBytes(): number {
		return this.resourceUsageDetector.getRamUsedBytes();
	}

	public getTrackedVramUsedBytes(): number {
		return this.resourceUsageDetector.getVramUsedBytes();
	}

	public getTrackedVramTotalBytes(): number {
		return this.resourceUsageDetector.getVramTotalBytes();
	}

	public hasActiveTick(): boolean {
		return this.currentFrameState !== null;
	}

	public runWithBudget(state: FrameState): RunResult {
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = $.platform.clock.now();
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		const budgetBefore = state.cycleBudgetRemaining;
		let remaining = budgetBefore;
		let result = RunResult.Yielded;
		this.runDueTimers();
		while (remaining > 0) {
			let sliceBudget = remaining;
			const nextDeadline = this.deviceScheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - this.deviceScheduler.nowCycles;
				if (deadlineBudget <= 0) {
					this.runDueTimers();
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			this.deviceScheduler.beginCpuSlice(sliceBudget);
			result = this.cpu.run(sliceBudget);
			this.deviceScheduler.endCpuSlice();
			const sliceRemaining = this.cpu.instructionBudgetRemaining;
			const consumed = sliceBudget - sliceRemaining;
			if (consumed > 0) {
				remaining -= consumed;
				state.activeCpuUsedCycles += consumed;
				this.advanceTime(consumed);
			}
			if (this.cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
				break;
			}
			if (consumed <= 0) {
				throw runtimeFault('CPU yielded without consuming cycles.');
			}
		}
		state.cycleBudgetRemaining = remaining;
		if (debugCycle) {
			if (result === RunResult.Yielded) {
				this.debugCycleYields += 1;
				this.debugCycleYieldsTotal += 1;
			}
			this.debugCycleRemainingAcc += remaining;
			const now = $.platform.clock.now();
			const elapsedMs = now - this.debugCycleReportAtMs;
			if (elapsedMs >= 1000) {
				const scale = 1000 / elapsedMs;
				const runsPerSec = this.debugCycleRuns * scale;
				const yieldsPerSec = this.debugCycleYields * scale;
				const yieldPct = (this.debugCycleYields / this.debugCycleRuns) * 100;
				const avgRemaining = this.debugCycleRemainingAcc / this.debugCycleRuns;
				console.info(`runs=${runsPerSec.toFixed(3)} yields=${yieldsPerSec.toFixed(3)} yield%=${yieldPct.toFixed(2)} avgRemaining=${avgRemaining.toFixed(1)} budget=${this.cycleBudgetPerFrame}`);
				this.debugCycleReportAtMs = now;
				this.debugCycleRuns = 0;
				this.debugCycleYields = 0;
				this.debugCycleRemainingAcc = 0;
			}
		}
		return result;
	}

	private refreshDeviceTimings(nowCycles: number): void {
		this.machine.refreshDeviceTimings({
			cpuHz: this._cpuHz,
			dmaBytesPerSecIso: this.dmaBytesPerSecIso,
			dmaBytesPerSecBulk: this.dmaBytesPerSecBulk,
			imgDecBytesPerSec: this.imgDecBytesPerSec,
			geoWorkUnitsPerSec: this.geoWorkUnitsPerSec,
			vdpWorkUnitsPerSec: this.vdpWorkUnitsPerSec,
		}, nowCycles);
	}

	private advanceTime(cycles: number): void {
		if (cycles <= 0) {
			return;
		}
		this.machine.advanceDevices(cycles);
		this.runDueTimers();
	}

	private getCyclesIntoFrame(): number {
		return this.deviceScheduler.nowCycles - this.frameStartCycle;
	}

	private resetSchedulerState(): void {
		this.deviceScheduler.reset();
		this.frameStartCycle = 0;
	}

	private runDueTimers(): void {
		while (this.deviceScheduler.hasDueTimer()) {
			const event = this.deviceScheduler.popDueTimer();
			this.dispatchTimer(event >> 8, event & 0xff);
		}
	}

	private dispatchTimer(kind: number, payload: number): void {
		switch (kind) {
			case TIMER_KIND_VBLANK_BEGIN:
				this.handleVblankBeginTimer();
				return;
			case TIMER_KIND_VBLANK_END:
				this.handleVblankEndTimer();
				return;
			case TIMER_KIND_DEVICE_SERVICE:
				this.runDeviceService(payload);
				return;
			default:
				throw runtimeFault(`unknown timer kind ${kind}.`);
		}
	}

	private scheduleCurrentFrameTimers(): void {
		this.deviceScheduler.scheduleVblankEnd(this.frameStartCycle + this.cycleBudgetPerFrame);
		if (this.vblankStartCycle > 0 && this.getCyclesIntoFrame() < this.vblankStartCycle) {
			this.deviceScheduler.scheduleVblankBegin(this.frameStartCycle + this.vblankStartCycle);
		}
	}

	private handleVblankBeginTimer(): void {
		if (!this.vblankActive) {
			this.enterVblank();
		}
	}

	private handleVblankEndTimer(): void {
		if (this.vblankActive) {
			this.leaveVblank();
		}
		this.frameStartCycle = this.deviceScheduler.nowCycles;
		this.scheduleCurrentFrameTimers();
		if (this.vblankStartCycle === 0) {
			this.enterVblank();
		}
	}

	private runDeviceService(deviceKind: number): void {
		this.machine.runDeviceService(deviceKind);
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
	public readonly timing: RuntimeTimingState;
	public executionOverlayActive = false;
	private _overlayResolutionMode: 'offscreen' | 'viewport'; // Set in constructor
	public readonly debuggerController = new LuaDebuggerController();
	public pauseCoordinator = runtimeIde.createPauseCoordinator();
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
		return this.hasEntryContinuation()
			|| this.debuggerPaused
			|| this.luaRuntimeFailed
			|| this.faultSnapshot !== null;
	}

	private hasEntryContinuation(): boolean {
		return this.pendingCall === 'entry';
	}

	private isUpdatePhasePending(): boolean {
		return this.hasEntryContinuation();
	}
	public readonly memory: Memory;
	public readonly cpu: CPU;
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
	public get cpuHz(): number {
		return this._cpuHz;
	}
	public setCpuHz(value: number): void {
		this._cpuHz = value;
		this.refreshDeviceTimings(this.deviceScheduler.currentNowCycles());
	}
	public applyActiveMachineTiming(cpuHz: number): void {
		const perfSpecs = getMachinePerfSpecs($.machine_manifest);
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, this.timing.ufpsScaled);
		const renderSize = Runtime.resolveRenderSize($.machine_manifest);
		const vblankCycles = resolveVblankCycles(cpuHz, this.timing.ufpsScaled, renderSize.height);
		this.setCpuHz(cpuHz);
		this.setCycleBudgetPerFrame(cycleBudgetPerFrame);
		this.setVblankCycles(vblankCycles);
		this.setVdpWorkUnitsPerSec(perfSpecs.work_units_per_sec);
		this.setGeoWorkUnitsPerSec(perfSpecs.geo_work_units_per_sec);
	}

	public setVdpWorkUnitsPerSec(value: number): void {
		this.vdpWorkUnitsPerSec = Runtime.resolveVdpWorkUnitsPerSec(value);
		this.vdp.setTiming(this._cpuHz, this.vdpWorkUnitsPerSec, this.deviceScheduler.currentNowCycles());
	}

	public setGeoWorkUnitsPerSec(value: number): void {
		this.geoWorkUnitsPerSec = Runtime.resolveGeoWorkUnitsPerSec(value);
		this.geometryController.setTiming(this._cpuHz, this.geoWorkUnitsPerSec, this.deviceScheduler.currentNowCycles());
	}

	public setTransferRatesFromManifest(specs: { imgdec_bytes_per_sec: number; dma_bytes_per_sec_iso: number; dma_bytes_per_sec_bulk: number; work_units_per_sec: number; geo_work_units_per_sec: number; }): void {
		this.imgDecBytesPerSec = Runtime.resolveBytesPerSec(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
		this.dmaBytesPerSecIso = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
		this.dmaBytesPerSecBulk = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
		this.setVdpWorkUnitsPerSec(specs.work_units_per_sec);
		this.setGeoWorkUnitsPerSec(specs.geo_work_units_per_sec);
		this.refreshDeviceTimings(this.deviceScheduler.currentNowCycles());
	}

	public setVblankCycles(cycles: number): void {
		if (cycles <= 0) {
			throw runtimeFault('vblank_cycles must be greater than 0.');
		}
		if (cycles > this.cycleBudgetPerFrame) {
			throw runtimeFault('vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankCycles = cycles;
		this.vblankStartCycle = this.cycleBudgetPerFrame - this.vblankCycles;
		this.resetVblankState();
	}

	public resetVblankState(): void {
		this.resetSchedulerState();
		this.vblankActive = false;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.inputController.sampleArmed = false;
		this.irqController.postLoad();
		this.resetHaltIrqWait();
		this.vdp.resetStatus();
		if (this.vblankStartCycle === 0) {
			this.setVblankStatus(true);
		}
		this.scheduleCurrentFrameTimers();
		this.refreshDeviceTimings(this.deviceScheduler.nowCycles);
	}

	public resetRenderBuffers(): void {
		this.machine.resetRenderBuffers();
	}

	private setVblankStatus(active: boolean): void {
		this.vblankActive = active;
		this.vdp.setVblankStatus(active);
	}

	private enterVblank(): void {
		// IRQ flags are level/pending; multiple VBLANK edges while pending coalesce.
		this.vblankSequence += 1;
		this.commitFrameOnVblankEdge();
		this.inputController.onVblankEdge();
		this.setVblankStatus(true);
		this.irqController.raise(IRQ_VBLANK);
		const frameState = this.currentFrameState;
		if (frameState !== null && this.isFrameBoundaryHalt()) {
			this.completeTickIfPending(frameState, this.vblankSequence);
			this.clearBackQueuesAfterIrqWake = true;
		}
	}

	private leaveVblank(): void {
		this.setVblankStatus(false);
	}

	public clearHaltUntilIrq(): void {
		this.cpu.clearHaltUntilIrq();
		this.resetHaltIrqWait();
		this.clearBackQueuesAfterIrqWake = false;
	}

	private resetHaltIrqWait(): void {
		this.haltIrqWaitArmed = false;
		this.haltIrqSignalSequence = 0;
	}

	private tryCompleteTickOnPendingVblankIrq(state: FrameState): boolean {
		if (!this.isFrameBoundaryHalt()) {
			return false;
		}
		if (this.vblankSequence === 0) {
			return false;
		}
		const pendingFlags = this.irqController.pendingFlags();
		if ((pendingFlags & IRQ_VBLANK) === 0) {
			return false;
		}
		if (this.lastCompletedVblankSequence === this.vblankSequence) {
			return false;
		}
		this.completeTickIfPending(state, this.vblankSequence);
		this.clearBackQueuesAfterIrqWake = true;
		this.cpu.clearHaltUntilIrq();
		this.resetHaltIrqWait();
		return true;
	}

	private commitFrameOnVblankEdge(): void {
		this.vdp.syncRegisters();
		this.vdp.presentReadyFrameOnVblankEdge();
		this.vdp.commitViewSnapshot();
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) {
			return;
		}
		this.activeTickCompleted = true;
		this.machineScheduler.enqueueTickCompletion(this, frameState);
		this.lastCompletedVblankSequence = vblankSequence;
	}

	public captureVblankState(): { cyclesIntoFrame: number; inputSampleArmed: boolean } {
		return {
			cyclesIntoFrame: this.getCyclesIntoFrame(),
			inputSampleArmed: this.inputController.sampleArmed,
		};
	}

	public restoreVblankState(state: { cyclesIntoFrame: number; inputSampleArmed?: boolean }): void {
		this.clearHaltUntilIrq();
		this.machineScheduler.reset(this);
		this.frameLoop.reset();
		this.screen.reset();
		this.inputController.sampleArmed = state.inputSampleArmed === true;
		this.resetSchedulerState();
		this.deviceScheduler.setNowCycles(state.cyclesIntoFrame);
		this.frameStartCycle = 0;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		this.irqController.postLoad();
		const vblankActive = (this.vblankStartCycle === 0)
			|| (this.getCyclesIntoFrame() >= this.vblankStartCycle);
		this.setVblankStatus(vblankActive);
		this.scheduleCurrentFrameTimers();
		this.refreshDeviceTimings(this.deviceScheduler.nowCycles);
	}
	private includeJsStackTraces = false;
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;
	private clearBackQueuesAfterIrqWake = false;
	private haltIrqSignalSequence = 0;
	private haltIrqWaitArmed = false;
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	public cycleBudgetPerFrame: number;
	private vblankCycles = 0;
	private vblankStartCycle = 0;
	private vblankActive = false;
	private vdpWorkUnitsPerSec = 0;
	private geoWorkUnitsPerSec = 0;
	private _cpuHz: number;
	private imgDecBytesPerSec = 0;
	private dmaBytesPerSecIso = 0;
	private dmaBytesPerSecBulk = 0;
	private frameStartCycle = 0;
	public lastTickSequence: number = 0;
	public lastTickBudgetGranted: number = 0;
	public lastTickCpuBudgetGranted: number = 0;
	public lastTickCpuUsedCycles: number = 0;
	public lastTickBudgetRemaining: number = 0;
	public lastTickVisualFrameCommitted: boolean = true;
	public lastTickVdpFrameCost: number = 0;
	public lastTickVdpFrameHeld: boolean = false;
	public lastTickCompleted: boolean = false;
	private activeTickCompleted = false;
	public readonly deviceScheduler: DeviceScheduler;
	public readonly machineScheduler = new RuntimeMachineSchedulerState();
	public readonly frameLoop = new RuntimeFrameLoopState();
	public readonly screen = new RuntimeScreenState();
	private debugCycleReportAtMs: number = 0;
	private debugCycleRuns: number = 0;
	private debugCycleYields: number = 0;
	private debugCycleRemainingAcc: number = 0;
	private debugCycleRunsTotal: number = 0;
	public debugCycleYieldsTotal: number = 0;
	public pendingLuaWarnings: string[] = [];
	public lastTickConsumedSequence: number = 0;
	public readonly moduleAliases: Map<string, string> = new Map();
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	public readonly luaGenericChunksExecuted: Set<string> = new Set();
	public readonly luaPatternRegexCache: Map<string, RegExp> = new Map();
	private readonly valueScratchPool: Value[][] = [];
	private readonly stringScratchPool: string[][] = [];
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-resume.
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	public readonly closureHandlerCache = new HandlerCache(
		(fn, thisArg, args) => this.invokeClosureHandler(fn, thisArg, args),
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
	private readonly assetMemoryGate = taskGate.group('asset:ram');
	public handledLuaErrors = new WeakSet<any>();
	public lastLuaCallStack: StackTraceFrame[] = [];
	public lastCpuFaultSnapshot: CpuFrameSnapshot[] = [];
	public faultSnapshot: FaultSnapshot = null;
	public faultOverlayNeedsFlush = false;
	private hostFaultMessage: string | null = null;
	public get doesFaultOverlayNeedFlush(): boolean {
		return this.faultOverlayNeedsFlush;
	}
	public flushedFaultOverlay(): void {
		this.faultOverlayNeedsFlush = false;
	}
	private hasCompletedInitialBoot = false;
	public cartEntryAvailable = true;
	public pendingCartBoot = false;
	public engineLuaSources: LuaSourceRegistry = null;
	public cartLuaSources: LuaSourceRegistry = null;
	public engineAssetSource: RawAssetSource = null;
	public cartAssetSource: RawAssetSource = null;
	private biosAssetLayer: RuntimeAssetLayer = null;
	private assetLayerLookup: RuntimeLayerLookup = {};
	public cartAssetLayer: RuntimeAssetLayer = null;
	private overlayAssetLayer: RuntimeAssetLayer = null;
	private readonly imageMetaByHandle = new Map<number, ImgMeta>();
	private readonly audioMetaByHandle = new Map<number, AudioMeta>();
	public readonly vdp: VDP;
	public readonly machine: Machine;
	private readonly resourceUsageDetector: ResourceUsageDetector;
	private editorViewOptionsSnapshot: EditorViewOptionsSnapshot = null;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
	public readonly imgDecController: ImgDecController;
	public readonly inputController: InputController;
	public readonly audioController: AudioController;
	public readonly irqController: IrqController;
	private engineCanonicalization: CanonicalizationType = null;
	public cartCanonicalization: CanonicalizationType = null;
	public preparedCartProgram: {
		program: Program;
		metadata: ProgramMetadata;
		entryProtoIndex: number;
		moduleProtoMap: Map<string, number>;
		moduleAliases: Array<{ alias: string; path: string }>;
		entryPath: string;
		canonicalization: CanonicalizationType;
	} = null;
	private deferredCartBootPreparationHandle: { stop(): void } = null;
	private deferredCartBootPreparationScheduled = false;
	private deferredCartBootPreparationCompleted = false;
	private _canonicalization: CanonicalizationType;
	private canonicalizeIdentifierFn: (value: string) => string;
	public get canonicalization(): CanonicalizationType {
		return this._canonicalization;
	}
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

		if (!cartridge) {
			$.set_asset_source(engineSource);
			$.set_cart_manifest(null);
			$.set_machine_manifest(engineLayer.index.machine);
			$.set_cart_project_root_path(null);
			$.set_inputmap(1, { keyboard: null, gamepad: null, pointer: null }); // Default input mapping for player 1 is required even with no cart to prevent errors

			$.set_lua_sources(engineLuaSources);
			const engineMemorySpecs = Runtime.resolveMemoryMapSpecs({
				machine: engineLayer.index.machine,
				engineMachine: engineLayer.index.machine,
				engineSource,
				assetSource: engineSource,
				assetLayers: [engineLayer],
			});
			configureMemoryMap(engineMemorySpecs);
			const enginePerfSpecs = getMachinePerfSpecs(engineLayer.index.machine);
			const ufpsScaled = resolveUfpsScaled(enginePerfSpecs.ufps);
			const cpuHz = Runtime.resolveCpuHz(enginePerfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
			const engineRenderSize = Runtime.resolveRenderSize(engineLayer.index.machine);
			const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, engineRenderSize.height);
			const memory = new Memory({
				engineRom: new Uint8Array(engineLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = Runtime.createInstance({
				playerIndex,
				canonicalization: engineLayer.index.machine.canonicalization,
				viewport: engineRenderSize,
				memory,
				ufpsScaled,
				cpuHz,
				cycleBudgetPerFrame,
				vblankCycles,
				vdpWorkUnitsPerSec: enginePerfSpecs.work_units_per_sec,
				geoWorkUnitsPerSec: enginePerfSpecs.geo_work_units_per_sec,
			});
			runtime.setTransferRatesFromManifest(enginePerfSpecs);
			runtime.biosAssetLayer = engineLayer;
			runtime.assetLayerLookup = buildRuntimeLayerLookup([engineLayer]);
			runtime.configureProgramSources({
				engineSources: engineLuaSources,
				engineAssetSource: engineSource,
				engineCanonicalization: engineLayer.index.machine.canonicalization,
			});
			await applyWorkspaceOverridesToRegistry({
				registry: engineLuaSources,
				storage: $.platform.storage,
				includeServer: true,
				projectRootPath: engineLayer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH,
			});
			await runtime.prepareBootRomStartupState();
			$.view.default_font = new Font();
			await runtime.boot();
			Runtime.startEngineWithDeferredStartupAudioRefresh();
			return;
		}

		const cartLayer = await buildRuntimeAssetLayer({ blob: cartridge, id: 'cart' });
		const overlayBlob = $.workspace_overlay;
		const overlayLayer = overlayBlob ? await buildRuntimeAssetLayer({ blob: overlayBlob, id: 'overlay' }) : null;
		const layers = [];
		if (overlayLayer) {
			layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
		}
		layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
		layers.push({ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload });
		const assetSource = new AssetSourceStack(layers);
		$.set_asset_source(assetSource);
		$.set_cart_manifest(cartLayer.index.cart_manifest);
		$.set_machine_manifest(cartLayer.index.machine);
		$.set_cart_project_root_path(cartLayer.index.projectRootPath);

		const cartSource = new AssetSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = buildLuaSources({
			cartSource,
			assetSource,
			index: cartLayer.index,
			allowedPayloadIds: overlayLayer ? ['overlay', 'cart'] : ['cart'],
		});

		const inputMappingPerPlayer = cartLayer.index.input ?? { 1: { keyboard: null, gamepad: null, pointer: null } as InputMap };
		for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
			const mappedIndex = parseInt(playerIndexStr, 10);
			const inputMapping = inputMappingPerPlayer[mappedIndex];
			$.set_inputmap(mappedIndex, inputMapping);
		}

		await applyWorkspaceOverridesToCart({ cart: cartLuaSources, storage: $.platform.storage, includeServer: true });
		$.set_lua_sources(engineLuaSources);

		const memoryLimits = Runtime.resolveMemoryMapSpecs({
			machine: cartLayer.index.machine,
			engineMachine: engineLayer.index.machine,
			engineSource,
			assetSource,
			assetLayers: overlayLayer ? [engineLayer, cartLayer, overlayLayer] : [engineLayer, cartLayer],
		});
		configureMemoryMap(memoryLimits);
		const cartPerfSpecs = getMachinePerfSpecs(cartLayer.index.machine);
		const ufpsScaled = resolveUfpsScaled(cartPerfSpecs.ufps);
		const cpuHz = Runtime.resolveCpuHz(cartPerfSpecs.cpu_freq_hz);
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
		const cartRenderSize = Runtime.resolveRenderSize(cartLayer.index.machine);
		const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, cartRenderSize.height);
		const memory = new Memory({
			engineRom: new Uint8Array(engineLayer.payload),
			cartRom: new Uint8Array(cartLayer.payload),
			overlayRom: overlayLayer ? new Uint8Array(overlayLayer.payload) : null,
		});
		const runtime = Runtime.createInstance({
			playerIndex,
			canonicalization: engineLayer.index.machine.canonicalization,
			viewport: cartRenderSize,
			memory,
			ufpsScaled,
			cpuHz,
			cycleBudgetPerFrame,
			vblankCycles,
			vdpWorkUnitsPerSec: cartPerfSpecs.work_units_per_sec,
			geoWorkUnitsPerSec: cartPerfSpecs.geo_work_units_per_sec,
		});
		runtime.setTransferRatesFromManifest(cartPerfSpecs);
		runtime.biosAssetLayer = engineLayer;
		runtime.assetLayerLookup = buildRuntimeLayerLookup(overlayLayer ? [engineLayer, cartLayer, overlayLayer] : [engineLayer, cartLayer]);
		runtime.cartAssetLayer = cartLayer;
		runtime.overlayAssetLayer = overlayLayer;
		runtime.configureProgramSources({
			engineSources: engineLuaSources,
			cartSources: cartLuaSources,
			engineAssetSource: engineSource,
			cartAssetSource: cartSource,
			engineCanonicalization: engineLayer.index.machine.canonicalization,
			cartCanonicalization: cartLayer.index.machine.canonicalization,
		});
		await applyWorkspaceOverridesToRegistry({
			registry: engineLuaSources,
			storage: $.platform.storage,
			includeServer: true,
			projectRootPath: engineLayer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH,
		});
		await runtime.prepareBootRomStartupState();
		$.view.default_font = new Font();
		await runtime.boot();
		Runtime.startEngineWithDeferredStartupAudioRefresh();
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

	private static startEngineWithDeferredStartupAudioRefresh(): void {
		$.bootstrapStartupAudio();
		$.start();
		if (!$.platform.audio.available) {
			return;
		}
		const firstFrameHandle = $.platform.frames.start(() => {
			firstFrameHandle.stop();
			const audioRefreshHandle = $.platform.frames.start(() => {
				audioRefreshHandle.stop();
				void $.refresh_audio_assets().catch((error: unknown) => {
					const runtime = Runtime.instance;
					runtime.publishStartupHostFault(error);
					console.error('Deferred startup audio refresh failed:', error);
				});
			});
		});
	}

	private static collectAssetEntryIds(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): Set<string> {
		const layerLookup = buildRuntimeLayerLookup(assetLayers);
		const ids = new Set<string>();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const engineAtlas = resolveRuntimeLayerAssetById<RomImgAsset>(layerLookup, engineSource, 'img', engineAtlasId);
		if (!engineAtlas) {
			throw runtimeFault(`engine atlas '${engineAtlasId}' not found for memory sizing.`);
		}
		ids.add(engineAtlasId);
		ids.add(ATLAS_PRIMARY_SLOT_ID);
		ids.add(ATLAS_SECONDARY_SLOT_ID);
		const sources = [engineSource, assetSource];
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
			const entries = sources[sourceIndex].list();
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				if (entry.type !== 'image') {
					continue;
				}
				const asset = resolveRuntimeLayerAssetFromEntry<RomImgAsset>(layerLookup, 'img', entry);
				if (!asset) {
					throw runtimeFault(`image asset '${entry.resid}' not found for memory sizing.`);
				}
				const meta = asset.imgmeta;
				if (!meta) {
					throw runtimeFault(`image asset '${entry.resid}' missing metadata for memory sizing.`);
				}
				if (meta.atlassed) {
					ids.add(entry.resid);
				}
			}
			const audioEntries = sources[sourceIndex].list('audio');
			for (let index = 0; index < audioEntries.length; index += 1) {
				const entry = audioEntries[index];
				if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
					throw runtimeFault(`audio asset '${entry.resid}' missing ROM buffer offsets for memory sizing.`);
				}
				ids.add(entry.resid);
			}
		}

		return ids;
	}

	private static computeAssetTableBytes(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): { bytes: number; entryCount: number; stringBytes: number } {
		const ids = this.collectAssetEntryIds(engineSource, assetSource, assetLayers);
		ids.add(FRAMEBUFFER_TEXTURE_KEY);
		ids.add(FRAMEBUFFER_RENDER_TEXTURE_KEY);
		const encoder = new TextEncoder();
		let stringBytes = 0;
		for (const id of ids) {
			stringBytes += encoder.encode(id).byteLength + 1;
		}
		const entryCount = ids.size;
		const bytes = ASSET_TABLE_HEADER_SIZE + (entryCount * ASSET_TABLE_ENTRY_SIZE) + stringBytes;
		return { bytes, entryCount, stringBytes };
	}

	private static alignUp(value: number, alignment: number): number {
		const mask = alignment - 1;
		return (value + mask) & ~mask;
	}

	private static computeRequiredAssetDataBytes(assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): number {
		const layerLookup = buildRuntimeLayerLookup(assetLayers);
		let requiredBytes = 0;
		const entries = assetSource.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const image = resolveRuntimeLayerAssetFromEntry<RomImgAsset>(layerLookup, 'img', entry);
			if (image.type === 'atlas' || image.imgmeta?.atlassed) {
				continue;
			}
			if (!image.buffer || image.buffer.byteLength === 0) {
				continue;
			}
			requiredBytes += this.alignUp(image.buffer.byteLength, 4);
		}
		const audioEntries = assetSource.list('audio');
		for (let index = 0; index < audioEntries.length; index += 1) {
			const audio = resolveRuntimeLayerAssetFromEntry<RomAsset>(layerLookup, 'audio', audioEntries[index]!);
			if (!audio.buffer || audio.buffer.byteLength === 0) {
				continue;
			}
			requiredBytes += this.alignUp(audio.buffer.byteLength, 2);
		}
		requiredBytes += DEFAULT_ASSET_DATA_HEADROOM_BYTES;
		return this.alignUp(requiredBytes, ASSET_DATA_ALIGNMENT_BYTES);
	}

	private static resolveEngineAtlasSlotBytes(engineSource: RawAssetSource): number {
		const engineAtlas = engineSource.getEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
		if (!engineAtlas || !engineAtlas.imgmeta) {
			throw runtimeFault('engine atlas metadata is missing.');
		}
		const width = Runtime.resolvePositiveSafeInteger(engineAtlas.imgmeta.width, 'engine_atlas.width');
		const height = Runtime.resolvePositiveSafeInteger(engineAtlas.imgmeta.height, 'engine_atlas.height');
		return width * height * 4;
	}

	private static resolveMemoryMapSpecs(params: {
		machine: MachineManifest;
		engineMachine: MachineManifest;
		engineSource: RawAssetSource;
		assetSource: RawAssetSource;
		assetLayers: ReadonlyArray<RuntimeAssetLayer>;
	}): MemoryMapSpecs {
		const machineConfig = params.machine;
		const engineMachine = params.engineMachine;
		const memorySpecs = getMachineMemorySpecs(machineConfig);
		const engineMemorySpecs = getMachineMemorySpecs(engineMachine);
		const stringHandleCount = DEFAULT_STRING_HANDLE_COUNT;
		const stringHeapBytes = DEFAULT_STRING_HEAP_SIZE;
		const atlasSlotBytes = memorySpecs.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE;
		const engineAtlasSlotBytes = engineMemorySpecs.system_atlas_slot_bytes ?? this.resolveEngineAtlasSlotBytes(params.engineSource);
		const renderSize = this.resolveRenderSize(machineConfig);
		const frameBufferWidth = renderSize.width;
		const frameBufferHeight = renderSize.height;
		const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
		if (!Number.isSafeInteger(engineAtlasSlotBytes) || engineAtlasSlotBytes <= 0) {
			throw runtimeFault('system atlas slot bytes must be a positive integer.');
		}
		const stagingBytes = memorySpecs.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
		const assetTableInfo = this.computeAssetTableBytes(params.engineSource, params.assetSource, params.assetLayers);
		const requiredAssetTableBytes = assetTableInfo.bytes;
		const assetTableBytes = requiredAssetTableBytes;
		const requiredAssetDataBytes = this.computeRequiredAssetDataBytes(params.assetSource, params.assetLayers);
		const assetDataBaseOffset = IO_REGION_SIZE
			+ (stringHandleCount * STRING_HANDLE_ENTRY_SIZE)
			+ stringHeapBytes
			+ assetTableBytes;
		const assetDataBasePadding = Runtime.alignUp(assetDataBaseOffset, IO_WORD_SIZE) - assetDataBaseOffset;
		const fixedRamBytes = assetDataBaseOffset
			+ assetDataBasePadding
			+ DEFAULT_GEO_SCRATCH_SIZE
			+ VDP_STREAM_BUFFER_SIZE;
		const requiredRamBytes = fixedRamBytes + requiredAssetDataBytes;
		const ramBytes = memorySpecs.ram_bytes === undefined
			? requiredRamBytes
			: Runtime.resolvePositiveSafeInteger(memorySpecs.ram_bytes, 'machine.specs.ram.ram_bytes');
		if (ramBytes < requiredRamBytes) {
			throw runtimeFault(`machine.specs.ram.ram_bytes (${ramBytes}) must be at least required size ${requiredRamBytes}.`);
		}
		const assetDataBytes = ramBytes - fixedRamBytes;
		const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
		console.info(
			`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
			+ `(io=${IO_REGION_SIZE}, string_handles=${stringHandleCount}, string_heap=${stringHeapBytes}, `
			+ `asset_table=${assetTableBytes} (${assetTableInfo.entryCount} entries, ${assetTableInfo.stringBytes} string bytes), `
			+ `asset_data=${assetDataBytes}, geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
			+ `engine_atlas_slot=${engineAtlasSlotBytes}, atlas_slot=${atlasSlotBytes}x2=${atlasSlotBytes * 2}).`,
		);
		return {
			ram_bytes: ramBytes,
			string_handle_count: stringHandleCount,
			string_heap_bytes: stringHeapBytes,
			asset_table_bytes: assetTableBytes,
			asset_data_bytes: assetDataBytes,
			atlas_slot_bytes: atlasSlotBytes,
			system_atlas_slot_bytes: engineAtlasSlotBytes,
			staging_bytes: stagingBytes,
			framebuffer_bytes: frameBufferBytes,
		};
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
		this.cartLuaSources = params.cartSources;
		this.engineAssetSource = params.engineAssetSource;
		this.cartAssetSource = params.cartAssetSource;
		this.engineCanonicalization = params.engineCanonicalization;
		this.cartCanonicalization = params.cartCanonicalization ?? params.engineCanonicalization;
		this.pendingCartBoot = false;
		this.preparedCartProgram = null;
		this.resetDeferredCartBootPreparation();
		this.setCartBootReadyFlag(false);
	}

	public getHostFaultMessage(): string | null {
		return this.hostFaultMessage;
	}

	public publishStartupHostFault(error: unknown): void {
		const normalized = convertToError(error);
		const message = normalized.message.length > 0 ? normalized.message : String(error);
		this.publishHostFault(
			HOST_FAULT_FLAG_ACTIVE | HOST_FAULT_FLAG_STARTUP_BLOCKING,
			HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
			message,
		);
	}

	private publishHostFault(flags: number, stage: number, message: string): void {
		this.hostFaultMessage = message;
		this.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, flags >>> 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, stage >>> 0);
	}

	private clearHostFaultChannel(): void {
		this.hostFaultMessage = null;
		this.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
	}

	private activateProgramSource(source: ProgramSource): void {
		const luaSources = source === 'engine' ? this.engineLuaSources : this.cartLuaSources;
		const canonicalization = source === 'engine' ? this.engineCanonicalization : this.cartCanonicalization;
		$.set_lua_sources(luaSources);
		this.applyCanonicalization(canonicalization);
		api.cartdata(luaSources.namespace);
	}

	private requestCartBoot(): void {
		this.pendingCartBoot = true;
		this.setCartBootReadyFlag(false);
	}

	private resetDeferredCartBootPreparation(): void {
		if (this.deferredCartBootPreparationHandle !== null) {
			this.deferredCartBootPreparationHandle.stop();
			this.deferredCartBootPreparationHandle = null;
		}
		this.deferredCartBootPreparationScheduled = false;
		this.deferredCartBootPreparationCompleted = false;
	}

	private constructor(options: RuntimeOptions) {
		Runtime._instance = this;
		this.timing = new RuntimeTimingState(options.ufpsScaled);
		const initialVdpWorkUnits = options.vdpWorkUnitsPerSec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC;
		const initialGeoWorkUnits = options.geoWorkUnitsPerSec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC;
		this.cycleBudgetPerFrame = options.cycleBudgetPerFrame;
		this.vdpWorkUnitsPerSec = Runtime.resolveVdpWorkUnitsPerSec(initialVdpWorkUnits);
		this.geoWorkUnitsPerSec = Runtime.resolveGeoWorkUnitsPerSec(initialGeoWorkUnits);
		this.storageService = $.platform.storage;
		this.storage = new RuntimeStorage(this.storageService, $.lua_sources.namespace);
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this.applyCanonicalization(resolvedCanonicalization);
		this.engineLuaSources = $.lua_sources;
		this.engineCanonicalization = resolvedCanonicalization;
		this.cartCanonicalization = resolvedCanonicalization;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.machine = new Machine(
			options.memory,
			createVdpBlitterExecutor($.view.backend),
			Input.instance,
			$.sndmaster,
		);
		this.memory = this.machine.memory;
		this.cpu = this.machine.cpu;
		this.deviceScheduler = this.machine.scheduler;
		this.irqController = this.machine.irqController;
		this.vdp = this.machine.vdp;
		this.audioController = this.machine.audioController;
		this.dmaController = this.machine.dmaController;
		this.imgDecController = this.machine.imgDecController;
		this.geometryController = this.machine.geometryController;
		this.inputController = this.machine.inputController;
		this.resourceUsageDetector = this.machine.resourceUsageDetector;
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		configureLuaHeapUsage({
			getBaseRamUsedBytes: () => this.resourceUsageDetector.getBaseRamUsedBytes(),
			collectTrackedHeapBytes: () => {
				const extraRoots = this.acquireValueScratch();
				try {
					extraRoots.push(this.pairsIterator);
					extraRoots.push(this.ipairsIterator);
					for (const value of this.moduleCache.values()) {
						extraRoots.push(value);
					}
					return this.cpu.collectTrackedHeapBytes(extraRoots);
				}
				finally {
					this.releaseValueScratch(extraRoots);
				}
			},
		});
		this.setCpuHz(options.cpuHz);
		this.setVblankCycles(options.vblankCycles);
		this.randomSeedValue = $.platform.clock.now();

		api = new Api({
			storage: this.storage,
			runtime: this,
		});
		runtimeIde.initializeIdeFeatures(this, options);
	}

	private applyCanonicalization(canonicalization: CanonicalizationType): void {
		this._canonicalization = canonicalization;
		this.canonicalizeIdentifierFn = createIdentifierCanonicalizer(this._canonicalization);
		setLuaTableCaseInsensitiveKeys(this._canonicalization !== 'none');
		runtimeIde.applyCanonicalization(this._canonicalization !== 'none');
	}

	private configureInterpreter(interpreter: LuaInterpreter): void {
		interpreter.requireHandler = (ctx, module) => runtimeLuaPipeline.requireLuaModule(this, ctx, module);
	}

	public createLuaInterpreter(): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge, this._canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.attachDebugger(this.debuggerController);
		interpreter.clearLastFaultEnvironment();
		registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.getReservedLuaIdentifiers());
		return interpreter;
	}

	public createLuaInterpreterForCanonicalization(canonicalization: CanonicalizationType): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge, canonicalization);
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
		this.inputController.sampleArmed = false;
		this.clearHaltUntilIrq();
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
			this.clearHostFaultChannel();
			runtimeIde.clearActiveDebuggerPause(this);
			runtimeIde.clearRuntimeFault(this);
			this.luaInitialized = false;
			runtimeLuaPipeline.invalidateModuleAliases(this);
			this.luaChunkEnvironmentsByPath.clear();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();
			if (this.editor !== null) {
				this.editor.clearRuntimeErrorOverlay();
			}
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset the runtime state
				await $.resetRuntime();
				await $.refresh_audio_assets();
			}
			api.cartdata($.lua_sources.namespace);
			runtimeLuaPipeline.bootActiveProgram(this);
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw runtimeFault(`failed to boot runtime: ${error}`);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private async prepareBootRomStartupState(options?: { resetRuntime?: boolean; refreshAudio?: boolean }): Promise<void> {
		if (options?.resetRuntime) {
			await $.resetRuntime();
		}
		await this.buildAssetMemory({ source: this.engineAssetSource, mode: 'full' });
		this.memory.sealEngineAssets();
		this.activateEngineProgramAssets();
		if (options?.refreshAudio) {
			await $.refresh_audio_assets();
		}
	}

	public async rebootToBootRom(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
		try {
			runtimeIde.clearActiveDebuggerPause(this);
			runtimeIde.clearRuntimeFault(this);
			runtimeIde.deactivateTerminalMode(this);
			runtimeIde.deactivateEditor(this);
			this.luaInitialized = false;
			runtimeLuaPipeline.invalidateModuleAliases(this);
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();
			if (this.editor !== null) {
				this.editor.clearRuntimeErrorOverlay();
			}
			this.pendingCartBoot = false;
			this.preparedCartProgram = null;
			this.resetDeferredCartBootPreparation();
			this.setCartBootReadyFlag(false);
			await applyWorkspaceOverridesToRegistry({
				registry: this.engineLuaSources,
				storage: this.storageService,
				includeServer: true,
				projectRootPath: $.engine_layer.index.projectRootPath || DEFAULT_ENGINE_PROJECT_ROOT_PATH,
			});
			await this.prepareBootRomStartupState({ resetRuntime: true, refreshAudio: true });
			api.cartdata($.lua_sources.namespace);
			runtimeLuaPipeline.bootActiveProgram(this);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	// Frame state is owned by the runtime: it is created per-frame, kept intact for debugger inspection on faults,
	// and only cleared via finalize/abandon during explicit reboot/reset flows.
	public beginFrameState(): FrameState {
		if (this.currentFrameState) {
			throw runtimeFault('attempted to begin a new frame while another frame is active.');
		}
		clearHardwareLighting();
		this.frameDeltaMs = this.timing.frameDurationMs;
		const budget = this.cycleBudgetPerFrame;
		const state: FrameState = {
			haltGame: this.debuggerPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			cycleBudgetRemaining: budget,
			cycleBudgetGranted: budget,
			cycleCarryGranted: 0,
			activeCpuUsedCycles: 0,
		};
		this.vdp.beginFrame();
		this.activeTickCompleted = false;
		this.currentFrameState = state;
		return state;
	}

	public tickUpdate(): boolean {
		if (!this.tickEnabled) {
			return false;
		}
		this.processPendingCartBoot();
		if (runtimeIde.isOverlayActive(this)) {
			if (this.currentFrameState !== null) {
				this.abandonFrameState();
				return true;
			}
			return false;
		}
		const previousState = this.currentFrameState;
		const previousRemaining = previousState?.cycleBudgetRemaining ?? -1;
		const previousPending = this.hasEntryContinuation();
		const previousSequence = this.lastTickSequence;
		if (this.currentFrameState === null) {
			if (!this.machineScheduler.startScheduledFrame(this)) {
				return false;
			}
		} else if (this.currentFrameState.cycleBudgetRemaining <= 0) {
			if (!this.machineScheduler.refillFrameBudget(this, this.currentFrameState)) {
				return false;
			}
		}
		this.runActiveFrameState(this.currentFrameState);
		const nextState = this.currentFrameState;
		if (nextState !== previousState) {
			return true;
		}
		if (nextState !== null && nextState.cycleBudgetRemaining !== previousRemaining) {
			return true;
		}
		if (this.hasEntryContinuation() !== previousPending) {
			return true;
		}
		return this.lastTickSequence !== previousSequence;
	}

	private runActiveFrameState(state: FrameState): void {
		let fault: unknown = null;
		try {
			if (this.isUpdatePhasePending()) {
				this.runUpdatePhase(state);
				this.vdp.flushAssetEdits();
				state.updateExecuted = !this.isUpdatePhasePending();
			}
			this.finalizeUpdateSlice(state);
		} catch (error) {
			fault = error;
			runtimeIde.handleLuaError(this, error);
		} finally {
			if (fault !== null && this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	private finalizeUpdateSlice(frameState: FrameState): void {
		this.currentFrameState = frameState;
		if (this.activeTickCompleted || !this.hasEntryContinuation()) {
			this.abandonFrameState();
		}
	}

	public raiseEngineIrq(mask: number): void {
		const normalized = mask >>> 0;
		if (normalized === 0) {
			throw runtimeFault('engine IRQ mask must be non-zero.');
		}
		const unsupported = normalized & ~Runtime.ENGINE_IRQ_MASK;
		if (unsupported !== 0) {
			throw runtimeFault(`unsupported engine IRQ mask 0x${unsupported.toString(16)}.`);
		}
		this.irqController.raise(normalized);
	}

	private runUpdatePhase(state: FrameState): void {
		if (!this.cartEntryAvailable) {
			return;
		}
		if (!this.luaGate.ready) {
			return;
		}
		if (state.luaFaulted || this.luaRuntimeFailed) {
			state.luaFaulted = true;
			return;
		}
		if (state.haltGame) {
			return;
		}
		try {
			while (true) {
				if (this.cpu.isHaltedUntilIrq() && this.runHaltedUntilIrq(state)) {
					return;
				}
				if (this.clearBackQueuesAfterIrqWake) {
					clearBackQueues();
					this.clearBackQueuesAfterIrqWake = false;
				}
				if (this.pendingCall !== 'entry') {
					return;
				}
				const result = this.runWithBudget(state);
				if (this.cpu.isHaltedUntilIrq()) {
					if (this.runHaltedUntilIrq(state)) {
						return;
					}
					continue;
				}
				if (result === RunResult.Halted) {
					this.pendingCall = null;
				}
				return;
			}
		} catch (error) {
			state.luaFaulted = true;
			this.clearHaltUntilIrq();
			this.pendingCall = null;
			runtimeIde.handleLuaError(this, error);
		}
	}

	private isFrameBoundaryHalt(): boolean {
		return this.cpu.getFrameDepth() === 1 && this.pendingCall === 'entry' && this.cpu.isHaltedUntilIrq();
	}

	private runHaltedUntilIrq(state: FrameState): boolean {
		this.runDueTimers();
		if (!this.cpu.isHaltedUntilIrq()) {
			this.resetHaltIrqWait();
			return false;
		}
		if (this.tryCompleteTickOnPendingVblankIrq(state)) {
			return true;
		}
		if (!this.haltIrqWaitArmed) {
				const pendingFlags = this.irqController.pendingFlags();
			if (pendingFlags !== 0) {
				this.cpu.clearHaltUntilIrq();
				return this.activeTickCompleted;
			}
			this.haltIrqSignalSequence = this.irqController.signalSequence;
			this.haltIrqWaitArmed = true;
		}
		while (true) {
			if (this.irqController.signalSequence !== this.haltIrqSignalSequence) {
				this.cpu.clearHaltUntilIrq();
				this.resetHaltIrqWait();
				return this.activeTickCompleted;
			}
			if (state.cycleBudgetRemaining > 0) {
				const cyclesToTarget = this.deviceScheduler.nextDeadline() - this.deviceScheduler.nowCycles;
				if (cyclesToTarget <= 0) {
					this.runDueTimers();
					continue;
				}
				const idleCycles = cyclesToTarget < state.cycleBudgetRemaining ? cyclesToTarget : state.cycleBudgetRemaining;
				state.cycleBudgetRemaining -= idleCycles;
				this.advanceTime(idleCycles);
				if (this.tryCompleteTickOnPendingVblankIrq(state)) {
					return true;
				}
				continue;
			}
			return true;
		}
	}

	// Clear reference to allow next frame to begin
	public abandonFrameState(): void {
		this.currentFrameState = null;
		this.activeTickCompleted = false;
	}

	public resolveAssetHandle(id: string): number {
		return this.memory.resolveAssetHandle(id);
	}

	public getAssetEntryByHandle(handle: number): AssetEntry {
		return this.memory.getAssetEntryByHandle(handle);
	}

	public getImageMetaByHandle(handle: number): ImgMeta {
		const meta = this.imageMetaByHandle.get(handle);
		if (!meta) {
			throw runtimeFault(`image metadata missing for handle ${handle}.`);
		}
		return meta;
	}

	public getImageAssetByEntry(entry: RomAsset): RomImgAsset {
		return resolveRuntimeLayerAssetFromEntry<RomImgAsset>(this.assetLayerLookup, 'img', entry);
	}

	public getImageAsset(id: string, source: RawAssetSource = $.asset_source): RomImgAsset {
		return resolveRuntimeLayerAssetById<RomImgAsset>(this.assetLayerLookup, source, 'img', id);
	}

	public resolveRomAssetRange(assetId: string, scope: 'cart' | 'sys'): { romBase: number; start: number; end: number } {
		const resolveFromLayer = (layer: RuntimeAssetLayer | null): { found: boolean; deleted: boolean; romBase: number; start: number; end: number } => {
			if (layer === null) {
				return { found: false, deleted: false, romBase: 0, start: 0, end: 0 };
			}
			const entries = layer.index.assets;
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				if (entry.resid !== assetId) {
					continue;
				}
				if (entry.op === 'delete') {
					return { found: true, deleted: true, romBase: 0, start: 0, end: 0 };
				}
				if (entry.start === undefined || entry.end === undefined) {
					throw runtimeFault(`asset '${assetId}' is missing ROM range.`);
				}
				const romBase = layer.id === 'system'
					? SYSTEM_ROM_BASE
					: layer.id === 'overlay'
						? OVERLAY_ROM_BASE
						: CART_ROM_BASE;
				return {
					found: true,
					deleted: false,
					romBase,
					start: entry.start,
					end: entry.end,
				};
			}
			return { found: false, deleted: false, romBase: 0, start: 0, end: 0 };
		};

		if (this.overlayAssetLayer !== null) {
			const overlayResult = resolveFromLayer(this.overlayAssetLayer);
			if (overlayResult.found) {
				if (overlayResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return overlayResult;
			}
		}

		if (this.cartAssetLayer !== null) {
			const cartResult = resolveFromLayer(this.cartAssetLayer);
			if (cartResult.found) {
				if (cartResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return cartResult;
			}
		}

		if (scope === 'sys') {
			const systemResult = resolveFromLayer(this.biosAssetLayer);
			if (systemResult.found) {
				if (systemResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return systemResult;
			}
		}

		throw runtimeFault(`asset '${assetId}' does not exist.`);
	}

	private getAudioAssetByEntry(entry: RomAsset): RomAsset {
		return resolveRuntimeLayerAssetFromEntry<RomAsset>(this.assetLayerLookup, 'audio', entry);
	}

	public getDataAsset(id: string, source: RawAssetSource = $.asset_source): unknown {
		return resolveRuntimeLayerAssetById<unknown>(this.assetLayerLookup, source, 'data', id);
	}

	public listImageAssets(source: RawAssetSource = $.asset_source): RomImgAsset[] {
		const entries = source.list();
		const assets: RomImgAsset[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			assets.push(this.getImageAssetByEntry(entry));
		}
		return assets;
	}

	public buildAudioResourcesForSoundMaster(): id2res {
		const resources: id2res = {};
		const source = $.asset_source;
		if (!source) {
			throw runtimeFault('asset source not configured.');
		}
		const sharedMetadataByPayloadId = new Map<CartridgeLayerId, readonly string[] | null>();
		const entries = source.list('audio');
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
				throw runtimeFault(`audio asset '${entry.resid}' missing ROM buffer offsets.`);
			}
			if (typeof entry.metabuffer_start !== 'number' || typeof entry.metabuffer_end !== 'number') {
				throw runtimeFault(`audio asset '${entry.resid}' missing metadata offsets.`);
			}
			const metaBytes = source.getBytesView({
				...entry,
				start: entry.metabuffer_start,
				end: entry.metabuffer_end,
			});
			const payloadId = entry.payload_id ?? 'cart';
			let sharedPropNames = sharedMetadataByPayloadId.get(payloadId);
			if (sharedPropNames === undefined) {
				const payload = resolveLayerForPayload(this.assetLayerLookup, payloadId).payload;
				const header = parseCartHeader(payload);
				if (header.metadataLength > 0) {
					const metadataSection = payload.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength);
					sharedPropNames = parseRomMetadataSection(metadataSection).propNames;
				} else {
					sharedPropNames = null;
				}
				sharedMetadataByPayloadId.set(payloadId, sharedPropNames);
			}
			const audiometa = (sharedPropNames ? decodeBinaryWithPropTable(metaBytes, sharedPropNames) : decodeBinary(metaBytes)) as AudioMeta;
			resources[entry.resid] = {
				resid: entry.resid,
				type: 'audio',
				start: entry.start,
				end: entry.end,
				audiometa,
				payload_id: entry.payload_id ?? 'cart',
			};
		}
		for (const [handle, meta] of this.audioMetaByHandle.entries()) {
			const entry = this.getAssetEntryByHandle(handle);
			if (entry.type !== 'audio' || entry.baseSize <= 0) {
				continue;
			}
			resources[entry.id] = {
				resid: entry.id,
				type: 'audio',
				start: entry.baseAddr,
				end: entry.baseAddr + entry.baseSize,
				audiometa: meta,
				payload_id: 'cart',
			};
		}
		return resources;
	}

	public getAudioBytesById(id: string): Uint8Array {
		if (this.memory.hasAsset(id)) {
			const entry = this.memory.getAssetEntry(id);
			if (entry.type === 'audio' && entry.baseSize > 0) {
				return this.memory.getAudioBytes(entry);
			}
		}
		const source = $.asset_source;
		if (!source) {
			throw runtimeFault('asset source not configured.');
		}
		const entry = source.getEntry(id);
		if (!entry) {
			throw runtimeFault(`audio asset '${id}' not found in ROM.`);
		}
		if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
			throw runtimeFault(`audio asset '${id}' missing ROM buffer offsets.`);
		}
		return source.getBytesView(entry);
	}

	public setSkyboxImages(ids: SkyboxImageIds): void {
		this.vdp.setSkyboxImages(ids);
	}

	public disableCrtPostprocessingForEditor(): void {
		if (this.editorViewOptionsSnapshot !== null) {
			return;
		}
		this.editorViewOptionsSnapshot = {
			crtPostprocessingEnabled: $.view.crt_postprocessing_enabled,
		};
		$.view.crt_postprocessing_enabled = false;
	}

	public restoreCrtPostprocessingFromEditor(): void {
		const snapshot = this.editorViewOptionsSnapshot;
		if (snapshot === null) {
			return;
		}
		$.view.crt_postprocessing_enabled = snapshot.crtPostprocessingEnabled;
		this.editorViewOptionsSnapshot = null;
	}

	public isEngineProgramActive(): boolean {
		return $.lua_sources === this.engineLuaSources;
	}

	private setCartBootReadyFlag(value: boolean): void {
		this.memory.writeValue(IO_SYS_CART_BOOTREADY, value ? 1 : 0);
	}

	private async prepareCartBoot(): Promise<void> {
		this.setCartBootReadyFlag(false);
		this.preparedCartProgram = null;
		if (!this.cartAssetLayer || !this.cartAssetSource || !this.cartLuaSources) {
			return;
		}
		try {
			if (this.cartLuaSources.can_boot_from_source) {
				this.preparedCartProgram = runtimeLuaPipeline.compileCartLuaProgramForBoot(this);
				this.setCartBootReadyFlag(true);
				console.info('Cart boot payload prepared from Lua sources.');
				return;
			}
			const programEntry = this.cartAssetSource.getEntry(PROGRAM_ASSET_ID);
			this.setCartBootReadyFlag(!!programEntry);
		} catch (error) {
			this.preparedCartProgram = null;
			this.setCartBootReadyFlag(false);
			console.error('Failed to prepare cart boot payload:', error);
			throw error;
		}
	}

	public scheduleDeferredCartBootPreparation(): void {
		if (this.deferredCartBootPreparationCompleted || this.deferredCartBootPreparationScheduled) {
			return;
		}
		if (!this.cartAssetLayer || !this.cartAssetSource || !this.cartLuaSources) {
			return;
		}
		this.deferredCartBootPreparationScheduled = true;
		const handle = $.platform.frames.start(() => {
			handle.stop();
			if (this.deferredCartBootPreparationHandle === handle) {
				this.deferredCartBootPreparationHandle = null;
			}
			this.deferredCartBootPreparationScheduled = false;
			if (this.deferredCartBootPreparationCompleted) {
				return;
			}
			this.deferredCartBootPreparationCompleted = true;
			void this.prepareCartBoot().catch((error: unknown) => {
				console.error('Failed to prepare cart boot:', error);
				this.setCartBootReadyFlag(false);
			});
		});
		this.deferredCartBootPreparationHandle = handle;
	}

	public async buildAssetMemory(params?: { source?: RawAssetSource; mode?: 'full' | 'cart' }): Promise<void> {
		const token = this.assetMemoryGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		// Freeze runtime ticks and presentation while asset handles, VRAM slots, and textures are rebuilt.
		const renderToken = renderGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		const runToken = runGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		try {
			const mode = params?.mode ?? 'full';
			const assetSource = params?.source ?? $.asset_source;
			if (!assetSource) {
				throw runtimeFault('asset source not configured.');
			}
			if (mode === 'cart') {
				this.memory.resetCartAssets();
			} else {
				this.memory.resetAssetMemory();
			}
			await this.vdp.registerImageAssets(assetSource);
			this.registerAudioAssets(assetSource);
			this.rebuildAssetMetaCaches(assetSource);
			this.memory.finalizeAssetTable();
			this.applyAssetHandlesToActiveLayers();
			this.memory.markAllAssetsDirty();
		} finally {
			runGate.end(runToken);
			renderGate.end(renderToken);
			this.assetMemoryGate.end(token);
		}
	}

	private registerAudioAssets(source: RawAssetSource): void {
		registerAudioAssetsFromSource(source, this.memory);
	}

	private rebuildAssetMetaCaches(source: RawAssetSource): void {
		this.imageMetaByHandle.clear();
		this.audioMetaByHandle.clear();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const entries = source.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const asset = this.getImageAssetByEntry(entry);
			if (asset.type === 'atlas' && asset.resid !== engineAtlasId) {
				continue;
			}
			const meta = asset.imgmeta;
			if (!meta) {
				throw runtimeFault(`image asset '${asset.resid}' missing metadata.`);
			}
			const handle = this.resolveAssetHandle(asset.resid);
			this.imageMetaByHandle.set(handle, meta);
		}
		const audioEntries = source.list('audio');
		for (let index = 0; index < audioEntries.length; index += 1) {
			const asset = this.getAudioAssetByEntry(audioEntries[index]!);
			const meta = asset.audiometa;
			if (!meta) {
				throw runtimeFault(`audio asset '${asset.resid}' missing metadata.`);
			}
			const handle = this.resolveAssetHandle(asset.resid);
			this.audioMetaByHandle.set(handle, meta);
		}
	}

	private applyAssetHandlesToLayer(assets: RuntimeAssets): void {
		const maps = [assets.img, assets.audio];
		for (let mapIndex = 0; mapIndex < maps.length; mapIndex += 1) {
			const map = maps[mapIndex];
			for (const entry of Object.values(map)) {
				if (!entry || typeof entry.resid !== 'string') {
					continue;
				}
				if (!this.memory.hasAsset(entry.resid)) {
					continue;
				}
				entry.handle = this.resolveAssetHandle(entry.resid);
				syncLuaAssetField(this, entry, 'handle', entry.handle);
			}
		}
	}

	private applyAssetHandlesToActiveLayers(): void {
		if (this.biosAssetLayer) {
			this.applyAssetHandlesToLayer(this.biosAssetLayer.assets);
		}
		if (this.cartAssetLayer) {
			this.applyAssetHandlesToLayer(this.cartAssetLayer.assets);
		}
		if (this.overlayAssetLayer) {
			this.applyAssetHandlesToLayer(this.overlayAssetLayer.assets);
		}
	}

	private activateEngineProgramAssets(): void {
		$.set_assets(this.biosAssetLayer.assets);
		this.activateProgramSource('engine');
	}

	public activateCartProgramAssets(): void {
		$.set_assets((this.overlayAssetLayer ?? this.cartAssetLayer).assets);
		const perfSpecs = getMachinePerfSpecs($.machine_manifest);
		this.timing.applyUfpsScaled(resolveUfpsScaled(perfSpecs.ufps));
		const cpuHz = Runtime.resolveCpuHz(perfSpecs.cpu_freq_hz);
		this.applyActiveMachineTiming(cpuHz);
		this.setTransferRatesFromManifest(perfSpecs);
	}

	private pollSystemBootRequest(): void {
		if (!this.isEngineProgramActive()) {
			return;
		}
		if (this.memory.readIoU32(IO_SYS_BOOT_CART) === 0) {
			return;
		}
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
		this.machineScheduler.clearQueuedTime();
		this.requestCartBoot();
	}

	private processPendingCartBoot(): void {
		this.pollSystemBootRequest();
		if (!this.pendingCartBoot) {
			return;
		}
		if (!this.luaGate.ready) {
			return;
		}
		if (this.currentFrameState !== null) {
			runtimeLuaPipeline.resetFrameState(this);
		}
		if (this.pendingCall !== null) {
			if (this.currentFrameState === null) {
				runtimeLuaPipeline.resetFrameState(this);
			}
			this.pendingCall = null;
			this.clearHaltUntilIrq();
		}
		this.machineScheduler.clearQueuedTime();
		this.pendingCartBoot = false;
		console.info('Switching to cart program after BIOS boot request.');
		this.activateProgramSource('cart');
		void runtimeLuaPipeline.reloadProgramAndResetWorld(this);
	}

	public dispose(): void {
		this.resetDeferredCartBootPreparation();
		runtimeIde.disposeShortcutHandlers(this);
		this.terminal.deactivate();
		runtimeIde.deactivateEditor(this);
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
		const range = this.cpu.getDebugRange(this.cpu.getDebugState().pc);
		return range ? new LuaRuntimeError(message, range.path, range.start.line, range.start.column) : new LuaRuntimeError(message, (this._luaPath ?? 'lua'), 0, 0);
	}

	public canonicalizeIdentifier(name: string): string {
		return this.canonicalizeIdentifierFn(name);
	}

	public internString(value: string): StringValue {
		return this.cpu.getStringPool().intern(value);
	}

	public canonicalKey(name: string): StringValue {
		return this.internString(this.canonicalizeIdentifier(name));
	}

	public acquireValueScratch(): Value[] {
		const pool = this.valueScratchPool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	public releaseValueScratch(values: Value[]): void {
		values.length = 0;
		if (this.valueScratchPool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.valueScratchPool.push(values);
		}
	}

	public acquireStringScratch(): string[] {
		const pool = this.stringScratchPool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	public releaseStringScratch(values: string[]): void {
		values.length = 0;
		if (this.stringScratchPool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.stringScratchPool.push(values);
		}
	}

	public callLuaFunction(fn: LuaFunctionValue, args: unknown[]): unknown[] {
		// Marshal JS→Lua, call, then marshal Lua→JS with path context for error breadcrumbs.
		const luaArgs = this.acquireValueScratch() as unknown as LuaValue[];
		try {
			for (let index = 0; index < args.length; index += 1) {
				luaArgs.push(this.luaJsBridge.toLua(args[index]));
			}
			const results = fn.call(luaArgs);
			if (isLuaCallSignal(results)) {
				return [];
			}
			const output: unknown[] = [];
			const moduleId = $.lua_sources.path2lua[this._luaPath].source_path;
			const baseCtx = { moduleId, path: [] };
			for (let i = 0; i < results.length; i += 1) {
				output.push(this.luaJsBridge.convertFromLua(results[i], extendMarshalContext(baseCtx, `ret${i}`)));
			}
			return output;
		} finally {
			this.releaseValueScratch(luaArgs as unknown as Value[]);
		}
	}

	public runConsoleChunkToNative(source: string): unknown[] {
		const results = runtimeLuaPipeline.runConsoleChunk(this, source);
		const baseCtx = buildMarshalContext(this);
		const output: unknown[] = [];
		for (let i = 0; i < results.length; i += 1) {
			output.push(toNativeValue(this, results[i], extendMarshalContext(baseCtx, `ret${i}`), new WeakMap()));
		}
		return output;
	}

	public callClosureInto(fn: Closure, args: Value[], out: Value[]): void {
		const depth = this.cpu.getFrameDepth();
		const previousBudget = this.cpu.instructionBudgetRemaining;
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		const previousSink = this.cpu.swapExternalReturnSink(out);
		out.length = 0;
		try {
			this.cpu.callExternal(fn, args);
			this.cpu.runUntilDepth(depth, budgetSentinel);
		} catch (error) {
			this.cpu.unwindToDepth(depth);
			throw error;
		} finally {
			this.cpu.swapExternalReturnSink(previousSink);
			const remaining = this.cpu.instructionBudgetRemaining;
			this.cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		}
	}

	public callClosureIntoWithScheduler(fn: Closure, args: Value[], out: Value[]): void {
		const depth = this.cpu.getFrameDepth();
		const previousBudget = this.cpu.instructionBudgetRemaining;
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		const previousSink = this.cpu.swapExternalReturnSink(out);
		out.length = 0;
		try {
			this.cpu.callExternal(fn, args);
			let remaining = budgetSentinel;
			this.runDueTimers();
			while (this.cpu.getFrameDepth() > depth) {
				let sliceBudget = remaining;
				const nextDeadline = this.deviceScheduler.nextDeadline();
				if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
					const deadlineBudget = nextDeadline - this.deviceScheduler.nowCycles;
					if (deadlineBudget <= 0) {
						this.runDueTimers();
						continue;
					}
					if (deadlineBudget < sliceBudget) {
						sliceBudget = deadlineBudget;
					}
				}
				this.deviceScheduler.beginCpuSlice(sliceBudget);
				const result = this.cpu.runUntilDepth(depth, sliceBudget);
				this.deviceScheduler.endCpuSlice();
				const sliceRemaining = this.cpu.instructionBudgetRemaining;
				const consumed = sliceBudget - sliceRemaining;
				if (consumed > 0) {
					remaining -= consumed;
					this.advanceTime(consumed);
				}
				if (this.cpu.getFrameDepth() <= depth) {
					break;
				}
				if (result === RunResult.Halted) {
					break;
				}
				if (consumed <= 0) {
					this.runDueTimers();
				}
			}
		} catch (error) {
			this.cpu.unwindToDepth(depth);
			throw error;
		} finally {
			this.cpu.swapExternalReturnSink(previousSink);
			const remaining = this.cpu.instructionBudgetRemaining;
			this.cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		}
	}

	public callClosure(fn: Closure, args: Value[]): Value[] {
		this.callClosureInto(fn, args, this.cpu.lastReturnValues);
		return this.cpu.lastReturnValues;
	}

	private invokeClosureHandler(fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs = this.acquireValueScratch();
		const results = this.acquireValueScratch();
		try {
			if (thisArg !== undefined) {
				callArgs.push(toRuntimeValue(this, thisArg));
			}
			for (let index = 0; index < args.length; index += 1) {
				callArgs.push(toRuntimeValue(this, args[index]));
			}
			this.callClosureInto(fn, callArgs, results);
			if (results.length === 0) {
				return undefined;
			}
			const ctx = buildMarshalContext(this);
			return toNativeValue(this, results[0], ctx, new WeakMap());
		} finally {
			this.releaseValueScratch(results);
			this.releaseValueScratch(callArgs);
		}
	}

	private handleClosureHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void {
		const wrappedError = convertToError(error);
		if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
			wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
		}
		runtimeIde.handleLuaError(this, wrappedError);
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
		runtimeIde.handleLuaError(this, wrappedError);
		throw wrappedError; // Rethrow for higher-level handling
	}

}
