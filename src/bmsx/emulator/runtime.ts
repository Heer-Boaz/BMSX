import { $, calcCyclesPerFrameScaled, resolveVblankCycles } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Input } from '../input/input';
import type { InputMap } from '../input/inputtypes';
import type { LuaDefinitionInfo } from '../lua/syntax/lua_ast';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaRuntimeError } from '../lua/luaerrors';
import { LuaHandlerCache } from '../lua/luahandler_cache';
import { LuaInterpreter } from '../lua/luaruntime';
import type { LuaFunctionValue, LuaValue, StackTraceFrame } from '../lua/luavalue';
import {
	convertToError,
	isLuaDebuggerPauseSignal,
	setLuaTableCaseInsensitiveKeys,
	type LuaDebuggerPauseSignal
} from '../lua/luavalue';
import type { StorageService } from '../platform/platform';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { AudioMeta, CartridgeLayerId, ImgMeta, MachineManifest, RomAsset, RomImgAsset, Viewport, CartridgeIndex, RuntimeAssets, id2res } from '../rompack/rompack';
import {
	CanonicalizationType,
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	CART_ROM_HEADER_SIZE,
	ENGINE_ATLAS_INDEX,
	SKYBOX_FACE_DEFAULT_SIZE,
	getMachineMemorySpecs,
	getMachinePerfSpecs,
	generateAtlasName,
} from '../rompack/rompack';
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { buildRuntimeAssetLayer, type RuntimeAssetLayer } from '../rompack/romloader';
import { decodeBinary } from '../serializer/binencoder';
import { tokenKeyFromAsset } from '../rompack/asset_tokens';
import { createIdentifierCanonicalizer } from '../lua/syntax/identifier_canonicalizer';
import { Api } from './api';
import { CPU, Table, type Closure, type Value, type Program, type ProgramMetadata, RunResult, type NativeFunction, type NativeObject } from './cpu';
import { StringPool, StringValue } from './string_pool';
import { StringHandleTable } from './string_memory';
import type { TerminalMode } from './terminal_mode';
import { RenderFacade } from './render_facade';
import { Font, type FontVariant } from './font';
import { beginMeshQueue, beginParticleQueue, beginSpriteQueue, clearBackQueues } from '../render/shared/render_queues';
import { clearHardwareCamera } from '../render/shared/hardware_camera';
import { clearHardwareLighting } from '../render/shared/hardware_lighting';
import type { CartEditor } from './ide/cart_editor';
import { type FaultSnapshot } from './ide/render/render_error_overlay';
import { type CpuFrameSnapshot } from './cpu';
import { type LuaSemanticModel, type FileSemanticData } from './ide/semantic_model';
import { registerApiBuiltins } from './lua_builtins';
import { LuaFunctionRedirectCache } from './lua_handler_registry';
import { LuaJsBridge, buildMarshalContext, extendMarshalContext, toNativeValue, toRuntimeValue } from './lua_js_bridge';
import { RuntimeStorage } from './storage';
import type { RuntimeOptions, LuaBuiltinDescriptor, LuaMemberCompletion } from './types';
import { applyWorkspaceOverridesToCart } from './workspace';
import { buildLuaSources, type LuaSourceRegistry } from './lua_sources';
import * as runtimeIde from './runtime_ide';
import * as runtimeLuaPipeline from './runtime_lua_pipeline';
import { registerAudioAssets as registerAudioAssetsFromSource } from './runtime_assets';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../lua/luadebugger';
import type { ParsedLuaChunk } from './ide/lua/lua_parse';
import { RenderSubmission } from '../render/backend/pipeline_interfaces';
import {
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_RD_MODE,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	IO_VDP_STATUS,
	IO_WRITE_PTR_ADDR,
	IRQ_NEWGAME,
	IRQ_REINIT,
	IRQ_VBLANK,
	VDP_ATLAS_ID_NONE,
	VDP_RD_MODE_RGBA8888,
	VDP_STATUS_VBLANK,
} from './io';
import { HandlerCache } from './handler_cache';
import { Memory, ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE, type AssetEntry } from './memory';
import { DmaController } from './devices/dma_controller';
import { ImgDecController } from './devices/imgdec_controller';
import {
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_ATLAS_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	STRING_HANDLE_COUNT,
	STRING_HANDLE_ENTRY_SIZE,
	configureMemoryMap,
	type MemoryMapSpecs as MemoryMapSpecs,
} from './memory_map';
import { VDP } from './vdp';
import { PROGRAM_ASSET_ID } from './program_asset';

export const BUTTON_ACTIONS: ReadonlyArray<string> = [
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


// Flip back to 'msx' to restore default font in emulator/editor
export const EDITOR_FONT_VARIANT: FontVariant = 'tiny';

const MAX_POOLED_RUNTIME_SCRATCH_ARRAYS = 32;
const ASSET_DATA_ALIGNMENT_BYTES = 0x1000;
const DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1 << 20; // 1 MiB

type FrameState = {
	haltGame: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	tickCompleted: boolean;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
	cpuStatsFrozen: boolean;
	cpuStatsUsedCycles: number;
	cpuStatsGrantedCycles: number;
};

type EditorViewOptionsSnapshot = {
	crtPostprocessingEnabled: boolean;
};

type ProgramSource = 'engine' | 'cart';
type WaitForVblankSignal = { readonly kind: 'wait_vblank' };
type RuntimeAssetCollectionKey = 'img' | 'audio' | 'model' | 'data' | 'audioevents';
type RuntimeLayerLookup = Partial<Record<CartridgeLayerId, RuntimeAssetLayer>>;

export var api: Api; // Initialized in Runtime constructor

class RateBudget {
	private bytesPerSec: bigint = 0n;
	private carry: bigint = 0n;

	public set(bytesPerSec: number): void {
		this.bytesPerSec = BigInt(bytesPerSec);
	}

	public resetCarry(): void {
		this.carry = 0n;
	}

	public calcBytesForCycles(cpuHz: number, cycles: number): number {
		const hz = BigInt(cpuHz);
		const cycleCount = BigInt(cycles);
		const numerator = this.bytesPerSec * cycleCount + this.carry;
		const out = numerator / hz;
		this.carry = numerator % hz;
		const max = 0xFFFF_FFFFn;
		const clamped = out > max ? max : out;
		return Number(clamped);
	}
}

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
		case 'audioevents': return layer.assets.audioevents;
	}
}

function resolveLayerForPayload(lookup: RuntimeLayerLookup, payloadId: CartridgeLayerId): RuntimeAssetLayer {
	const layer = lookup[payloadId];
	if (!layer) {
		throw new Error(`[Runtime] Asset layer '${payloadId}' not configured.`);
	}
	return layer;
}

function resolveRuntimeLayerAssetFromEntry<T>(lookup: RuntimeLayerLookup, kind: RuntimeAssetCollectionKey, entry: RomAsset): T {
	const payloadId = entry.payload_id;
	if (!payloadId) {
		throw new Error(`[Runtime] Asset '${entry.resid}' missing payload_id.`);
	}
	const layer = resolveLayerForPayload(lookup, payloadId);
	const assets = getRuntimeLayerAssets(layer, kind) as Record<string, T>;
	const token = tokenKeyFromAsset(entry);
	const asset = assets[token];
	if (!asset) {
		throw new Error(`[Runtime] ${kind} asset '${entry.resid}' missing from '${payloadId}' layer.`);
	}
	return asset;
}

function resolveRuntimeLayerAssetById<T>(lookup: RuntimeLayerLookup, source: RawAssetSource, kind: RuntimeAssetCollectionKey, id: string): T {
	const entry = source.getEntry(id);
	if (!entry) {
		throw new Error(`[Runtime] ${kind} asset '${id}' not found.`);
	}
	return resolveRuntimeLayerAssetFromEntry<T>(lookup, kind, entry);
}

export class Runtime {
	private static readonly ENGINE_IRQ_MASK = (IRQ_REINIT | IRQ_NEWGAME) >>> 0;
	private static readonly LUA_OVERRIDEABLE_GLOBALS: ReadonlyArray<string> = ['update'];
	private static _instance: Runtime = null;
	/**
	 * Preserved render queue when a fault occurs
	 * This is used to restore the render queue to its previous state
	 * so that the console mode can be drawn on top of it.
	 */
	public preservedRenderQueue: RenderSubmission[] = [];

	public static createInstance(options: RuntimeOptions): Runtime {
		const existing = Runtime._instance;
		if (existing) {
			throw new Error('[Runtime] Instance already exists.');
		}
		return new Runtime(options);
	}

	private static resolvePositiveSafeInteger(value: number | undefined, label: string): number {
		if (value === undefined) {
			throw new Error(`[Runtime] ${label} is required.`);
		}
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`[Runtime] ${label} must be a positive safe integer.`);
		}
		return value;
	}

	private static resolveCpuHz(value: number | undefined): number {
		return Runtime.resolvePositiveSafeInteger(value, 'machine.specs.cpu.cpu_freq_hz');
	}

	private static resolveBytesPerSec(value: number | undefined, label: string): number {
		return Runtime.resolvePositiveSafeInteger(value, label);
	}

	private static resolveUfpsScaled(value: number | undefined): number {
		return Runtime.resolvePositiveSafeInteger(value, 'machine.ufps');
	}

	private static resolveRenderSize(machine: { render_size: { width: number; height: number; } }): Viewport {
		const width = Runtime.resolvePositiveSafeInteger(machine.render_size.width, 'machine.render_size.width');
		const height = Runtime.resolvePositiveSafeInteger(machine.render_size.height, 'machine.render_size.height');
		return { width, height };
	}

	private static applyUfpsScaled(ufps: number): number {
		const ufpsScaled = Runtime.resolveUfpsScaled(ufps);
		$.setUfpsScaled(ufpsScaled);
		return ufpsScaled;
	}

	public setCycleBudgetPerFrame(value: number): void {
		if (value === this.cycleBudgetPerFrame) {
			return;
		}
		this.cycleBudgetPerFrame = value;
		runtimeLuaPipeline.registerGlobal(this, 'sys_max_cycles_per_frame', value);
		this.resetTransferCarry();
		if (this.vblankCycles > 0) {
			if (this.vblankCycles > this.cycleBudgetPerFrame) {
				throw new Error('[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.');
			}
			this.vblankStartCycle = this.cycleBudgetPerFrame - this.vblankCycles;
			this.resetVblankState();
		}
	}

	public getLastTickSequence(): number {
		return this.lastTickSequence;
	}

	public getLastTickBudgetRemaining(): number {
		return this.lastTickBudgetRemaining;
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

	public getTrackedRamUsedBytes(): number {
		const extraRoots = Array.from(this.moduleCache.values());
		if (this.pairsIterator !== null) {
			extraRoots.push(this.pairsIterator);
		}
		if (this.ipairsIterator !== null) {
			extraRoots.push(this.ipairsIterator);
		}
		return IO_REGION_SIZE
			+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
			+ this.stringHandles.usedHeapBytes()
			+ this.memory.getUsedAssetTableBytes()
			+ this.memory.getUsedAssetDataBytes()
			+ this.cpu.getTrackedHeapBytes(extraRoots);
	}

	public getTrackedVramUsedBytes(): number {
		return this.vdp.getTrackedUsedVramBytes();
	}

	public getTrackedVramTotalBytes(): number {
		return this.vdp.getTrackedTotalVramBytes();
	}

	public didLastTickComplete(): boolean {
		return this.lastTickCompleted;
	}

	public hasActiveTick(): boolean {
		return this.currentFrameState !== null;
	}

	public consumeLastTickCompletion(): { sequence: number; remaining: number } | null {
		if (!this.lastTickCompleted) {
			return null;
		}
		if (this.lastTickSequence === this.lastTickConsumedSequence) {
			return null;
		}
		this.lastTickConsumedSequence = this.lastTickSequence;
		return {
			sequence: this.lastTickSequence,
			remaining: this.lastTickBudgetRemaining,
		};
	}

	public grantCycleBudget(baseBudget: number, carryBudget: number): void {
		this.setCycleBudgetPerFrame(baseBudget);
		const totalBudget = baseBudget + carryBudget;
		if (this.currentFrameState !== null) {
			this.currentFrameState.cycleBudgetRemaining += totalBudget;
			this.currentFrameState.cycleBudgetGranted += totalBudget;
			return;
		}
		if (carryBudget !== 0) {
			this.pendingCarryBudget = carryBudget;
		}
	}

	public runWithBudget(state: FrameState): RunResult {
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = performance.now();
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		const budgetBefore = state.cycleBudgetRemaining;
		const result = this.cpu.run(budgetBefore);
		const remaining = this.cpu.instructionBudgetRemaining;
		state.cycleBudgetRemaining = remaining;
		const consumed = budgetBefore - remaining;
		if (consumed > 0) {
			this.advanceHardware(consumed);
		}
		if (debugCycle) {
			if (result === RunResult.Yielded) {
				this.debugCycleYields += 1;
				this.debugCycleYieldsTotal += 1;
			}
			this.debugCycleRemainingAcc += remaining;
			const now = performance.now();
			const elapsedMs = now - this.debugCycleReportAtMs;
			if (elapsedMs >= 1000) {
				const scale = 1000 / elapsedMs;
				const runsPerSec = this.debugCycleRuns * scale;
				const yieldsPerSec = this.debugCycleYields * scale;
				const yieldPct = (this.debugCycleYields / this.debugCycleRuns) * 100;
				const avgRemaining = this.debugCycleRemainingAcc / this.debugCycleRuns;
				console.info(`[BMSX][runtime] runs=${runsPerSec.toFixed(3)} yields=${yieldsPerSec.toFixed(3)} yield%=${yieldPct.toFixed(2)} avgRemaining=${avgRemaining.toFixed(1)} budget=${this.cycleBudgetPerFrame}`);
				this.debugCycleReportAtMs = now;
				this.debugCycleRuns = 0;
				this.debugCycleYields = 0;
				this.debugCycleRemainingAcc = 0;
			}
		}
		return result;
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
	public readonly overlayRenderBackend = new RenderFacade();
	public terminal!: TerminalMode;
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
		this.overlayRenderBackend.setRenderingViewportType(value);
		if (this.editor !== null) {
			this.editor.updateViewport(this.overlayRenderBackend.viewportSize);
		}
	}

	public get overlayResolutionMode() {
		return this._overlayResolutionMode;
	}

	public get overlayViewportSize(): Viewport {
		return this.overlayRenderBackend.viewportSize;
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
	private readonly stringHandles: StringHandleTable;
	private readonly runtimeStringPool: StringPool;
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
		this.resetTransferCarry();
	}
	public applyActiveMachineTiming(cpuHz: number): void {
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled);
		const renderSize = Runtime.resolveRenderSize($.machine_manifest);
		const vblankCycles = resolveVblankCycles(cpuHz, $.ufps_scaled, renderSize.height);
		this.setCpuHz(cpuHz);
		this.setCycleBudgetPerFrame(cycleBudgetPerFrame);
		this.setVblankCycles(vblankCycles);
	}
	public setTransferRatesFromManifest(specs: { imgdec_bytes_per_sec: number; dma_bytes_per_sec_iso: number; dma_bytes_per_sec_bulk: number }): void {
		this.imgDecBytesPerSec = Runtime.resolveBytesPerSec(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
		this.dmaBytesPerSecIso = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
		this.dmaBytesPerSecBulk = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
		this.imgRate.set(this.imgDecBytesPerSec);
		this.dmaIsoRate.set(this.dmaBytesPerSecIso);
		this.dmaBulkRate.set(this.dmaBytesPerSecBulk);
		this.resetTransferCarry();
	}
	private advanceHardware(cycles: number): void {
		if (cycles <= 0) {
			return;
		}
		// Hardware advances in discrete steps; interrupt sources raised in the same step are observed together.
		const imgBudget = this.imgRate.calcBytesForCycles(this._cpuHz, cycles);
		const isoBudget = this.dmaIsoRate.calcBytesForCycles(this._cpuHz, cycles);
		const bulkBudget = this.dmaBulkRate.calcBytesForCycles(this._cpuHz, cycles);
		this.imgDecController.setDecodeBudget(imgBudget);
		this.dmaController.setChannelBudgets({
			iso: isoBudget,
			bulk: bulkBudget,
		});
		this.dmaController.tick();
		this.imgDecController.tick();
		this.advanceVblank(cycles);
	}

	private advanceVblank(cycles: number): void {
		let remaining = cycles;
		while (remaining > 0) {
			const frameRemaining = this.cycleBudgetPerFrame - this.cyclesIntoFrame;
			const step = remaining < frameRemaining ? remaining : frameRemaining;
			const previous = this.cyclesIntoFrame;
			this.cyclesIntoFrame += step;
			if (!this.vblankActive && previous < this.vblankStartCycle && this.cyclesIntoFrame >= this.vblankStartCycle) {
				this.enterVblank();
			}
			remaining -= step;
			if (this.cyclesIntoFrame >= this.cycleBudgetPerFrame) {
				this.cyclesIntoFrame = 0;
				if (this.vblankStartCycle === 0) {
					this.raiseIrqFlags(IRQ_VBLANK);
				} else if (this.vblankActive) {
					// Defer clear until the VBLANK IRQ handler has a chance to observe the status.
					this.vblankPendingClear = true;
				}
			}
		}
	}

	private cyclesUntilNextVblankEdge(): number {
		if (this.vblankStartCycle === 0) {
			return this.cycleBudgetPerFrame - this.cyclesIntoFrame;
		}
		if (!this.vblankActive && this.cyclesIntoFrame < this.vblankStartCycle) {
			return this.vblankStartCycle - this.cyclesIntoFrame;
		}
		return (this.cycleBudgetPerFrame - this.cyclesIntoFrame) + this.vblankStartCycle;
	}

	public setVblankCycles(cycles: number): void {
		if (cycles <= 0) {
			throw new Error('[Runtime] vblank_cycles must be greater than 0.');
		}
		if (cycles > this.cycleBudgetPerFrame) {
			throw new Error('[Runtime] vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankCycles = cycles;
		this.vblankStartCycle = this.cycleBudgetPerFrame - this.vblankCycles;
		this.resetVblankState();
	}

	public resetVblankState(): void {
		this.cyclesIntoFrame = 0;
		this.vblankActive = false;
		this.vblankPendingClear = false;
		this.vblankClearOnIrqEnd = false;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.vdpStatus = 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
		if (this.vblankStartCycle === 0) {
			this.setVblankStatus(true);
		}
	}

	public resetRenderBuffers(): void {
		clearHardwareCamera();
		clearHardwareLighting();
		clearBackQueues();
		beginSpriteQueue();
		beginMeshQueue();
		beginParticleQueue();
	}

	private setVblankStatus(active: boolean): void {
		if (this.vblankActive === active) {
			return;
		}
		this.vblankActive = active;
		if (active) {
			this.vdpStatus |= VDP_STATUS_VBLANK;
		} else {
			this.vdpStatus &= ~VDP_STATUS_VBLANK;
		}
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
	}

	private enterVblank(): void {
		// IRQ flags are level/pending; multiple VBLANK edges while pending coalesce.
		this.vblankSequence += 1;
		this.commitFrameOnVblankEdge();
		this.setVblankStatus(true);
		this.raiseIrqFlags(IRQ_VBLANK);
	}

	public requestWaitForVblank(): void {
		this.processIrqAck();
		this.waitingForVblank = true;
		const resumeOnCurrentEdge =
			this.vblankActive
			&& !this.vblankPendingClear
			&& this.vblankSequence > 0
			&& this.lastCompletedVblankSequence !== this.vblankSequence;
		const nextVblankSequence = this.vblankSequence + 1;
		// Only reuse the current VBLANK edge when this tick has not already completed
		// on that same edge. Otherwise fast carts can "re-wait" the current VBLANK and
		// effectively skip the next frame boundary.
		this.waitForVblankTargetSequence = resumeOnCurrentEdge
			? this.vblankSequence
			: nextVblankSequence;
		if (resumeOnCurrentEdge) {
			const frameState = this.currentFrameState;
			if (frameState === null) {
				throw new Error('[Runtime] wait_vblank resumed without an active frame state.');
			}
			this.reconcileCycleBudgetAfterSignal(frameState);
			this.freezeTickCpuStats(frameState);
			this.completeTickIfPending(frameState, this.vblankSequence);
		}
		throw this.waitForVblankSignal;
	}

	public clearWaitForVblank(): void {
		this.waitingForVblank = false;
		this.waitForVblankTargetSequence = 0;
		this.clearBackQueuesAfterWaitResume = false;
	}

	private isWaitForVblankSignal(error: unknown): error is WaitForVblankSignal {
		return error === this.waitForVblankSignal;
	}

	private commitFrameOnVblankEdge(): void {
		// Flush latest VDP register writes before snapshotting atlas/skybox bindings.
		this.vdp.syncRegisters();
		this.vdp.commitViewSnapshot();
		const frameState = this.currentFrameState;
		if (frameState === null) {
			return;
		}
		if (!this.waitingForVblank) {
			return;
		}
		if (this.waitForVblankTargetSequence !== 0 && this.vblankSequence < this.waitForVblankTargetSequence) {
			return;
		}
		this.completeTickIfPending(frameState, this.vblankSequence);
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) {
			return;
		}
		frameState.tickCompleted = true;
		this.lastTickBudgetGranted = frameState.cycleBudgetGranted;
		if (frameState.cpuStatsFrozen) {
			this.lastTickCpuBudgetGranted = frameState.cpuStatsGrantedCycles;
			this.lastTickCpuUsedCycles = frameState.cpuStatsUsedCycles;
		}
		else {
			this.lastTickCpuBudgetGranted = frameState.cycleBudgetGranted;
			this.lastTickCpuUsedCycles = frameState.cycleBudgetGranted - frameState.cycleBudgetRemaining;
		}
		this.lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
		this.lastTickCompleted = true;
		this.lastTickSequence += 1;
		this.lastCompletedVblankSequence = vblankSequence;
		const debugTickRate = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugTickRate) {
			const cyclesUsed = frameState.cycleBudgetGranted - frameState.cycleBudgetRemaining;
			const yieldsThisFrame = this.debugCycleYieldsTotal - this.debugTickYieldsBefore;
			this.debugFrameCount += 1;
			this.debugFrameCyclesUsedAcc += cyclesUsed;
			this.debugFrameRemainingAcc += frameState.cycleBudgetRemaining;
			this.debugFrameYieldsAcc += yieldsThisFrame;
			this.debugFrameGrantedAcc += frameState.cycleBudgetGranted;
			this.debugFrameCarryAcc += frameState.cycleCarryGranted;
			const now = performance.now();
			const elapsedMs = now - this.debugFrameReportAtMs;
			if (elapsedMs >= 1000) {
				const scale = 1000 / elapsedMs;
				const cyclesPerSec = this.debugFrameCyclesUsedAcc * scale;
				const cyclesPerFrame = this.debugFrameCyclesUsedAcc / this.debugFrameCount;
				const remainingPerFrame = this.debugFrameRemainingAcc / this.debugFrameCount;
				const yieldsPerFrame = this.debugFrameYieldsAcc / this.debugFrameCount;
				const grantedPerFrame = this.debugFrameGrantedAcc / this.debugFrameCount;
				const carryPerFrame = this.debugFrameCarryAcc / this.debugFrameCount;
				console.info(`[BMSX][runtime-frame] cycles/sec=${cyclesPerSec.toFixed(1)} cycles/frame=${cyclesPerFrame.toFixed(1)} remaining/frame=${remainingPerFrame.toFixed(1)} yields/frame=${yieldsPerFrame.toFixed(2)} budget=${this.cycleBudgetPerFrame} granted=${grantedPerFrame.toFixed(1)} carry=${carryPerFrame.toFixed(1)}`);
				this.debugFrameReportAtMs = now;
				this.debugFrameCount = 0;
				this.debugFrameCyclesUsedAcc = 0;
				this.debugFrameRemainingAcc = 0;
				this.debugFrameYieldsAcc = 0;
				this.debugFrameGrantedAcc = 0;
				this.debugFrameCarryAcc = 0;
			}
		}
	}

	public captureVblankState(): { cyclesIntoFrame: number; vblankPendingClear: boolean; vblankClearOnIrqEnd: boolean } {
		return {
			cyclesIntoFrame: this.cyclesIntoFrame,
			vblankPendingClear: this.vblankPendingClear,
			vblankClearOnIrqEnd: this.vblankClearOnIrqEnd,
		};
	}

	public restoreVblankState(state: { cyclesIntoFrame: number; vblankPendingClear: boolean; vblankClearOnIrqEnd: boolean }): void {
		this.cyclesIntoFrame = state.cyclesIntoFrame;
		this.vblankPendingClear = state.vblankPendingClear;
		this.vblankClearOnIrqEnd = state.vblankClearOnIrqEnd;
		const vblankActive = (this.vblankStartCycle === 0)
			|| this.vblankPendingClear
			|| (this.cyclesIntoFrame >= this.vblankStartCycle);
		this.setVblankStatus(vblankActive);
	}
	private resetTransferCarry(): void {
		this.imgRate.resetCarry();
		this.dmaIsoRate.resetCarry();
		this.dmaBulkRate.resetCarry();
	}
	private includeJsStackTraces = false;
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;
	private waitingForVblank = false;
	private waitForVblankTargetSequence = 0;
	private clearBackQueuesAfterWaitResume = false;
	private readonly waitForVblankSignal: WaitForVblankSignal = { kind: 'wait_vblank' };
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	public cycleBudgetPerFrame: number;
	private vblankCycles = 0;
	private vblankStartCycle = 0;
	private cyclesIntoFrame = 0;
	private vblankActive = false;
	private vblankPendingClear = false;
	private vblankClearOnIrqEnd = false;
	private vdpStatus = 0;
	private _cpuHz: number;
	private imgDecBytesPerSec = 0;
	private dmaBytesPerSecIso = 0;
	private dmaBytesPerSecBulk = 0;
	private readonly imgRate = new RateBudget();
	private readonly dmaIsoRate = new RateBudget();
	private readonly dmaBulkRate = new RateBudget();
	public lastTickSequence: number = 0;
	public lastTickBudgetGranted: number = 0;
	public lastTickCpuBudgetGranted: number = 0;
	public lastTickCpuUsedCycles: number = 0;
	public lastTickBudgetRemaining: number = 0;
	public lastTickCompleted: boolean = false;
	private debugCycleReportAtMs: number = 0;
	private debugCycleRuns: number = 0;
	private debugCycleYields: number = 0;
	private debugCycleRemainingAcc: number = 0;
	private debugCycleRunsTotal: number = 0;
	private debugCycleYieldsTotal: number = 0;
	private debugFrameReportAtMs: number = 0;
	private debugFrameCount: number = 0;
	private debugFrameCyclesUsedAcc: number = 0;
	private debugFrameRemainingAcc: number = 0;
	private debugFrameYieldsAcc: number = 0;
	private debugFrameGrantedAcc: number = 0;
	private debugFrameCarryAcc: number = 0;
	private debugTickYieldsBefore: number = 0;
	public pendingLuaWarnings: string[] = [];
	public pendingCarryBudget: number = 0;
	public lastTickConsumedSequence: number = 0;
	public readonly moduleAliases: Map<string, string> = new Map();
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	public readonly luaGenericChunksExecuted: Set<string> = new Set();
	public readonly luaPatternRegexCache: Map<string, RegExp> = new Map();
	private readonly valueScratchPool: Value[][] = [];
	private readonly stringScratchPool: string[][] = [];
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-reload.
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
	private engineAssetLayer: RuntimeAssetLayer = null;
	private assetLayerLookup: RuntimeLayerLookup = {};
	private programAssetLayers: ReadonlyArray<RuntimeAssetLayer> = null;
	private residentAssetLayers: ReadonlyArray<RuntimeAssetLayer> = null;
	public cartAssetLayer: RuntimeAssetLayer = null;
	private overlayAssetLayer: RuntimeAssetLayer = null;
	private readonly imageMetaByHandle = new Map<number, ImgMeta>();
	private readonly audioMetaByHandle = new Map<number, AudioMeta>();
	public readonly vdp: VDP;
	private editorViewOptionsSnapshot: EditorViewOptionsSnapshot = null;
	public readonly dmaController: DmaController;
	public readonly imgDecController: ImgDecController;
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
			Runtime.applyUfpsScaled(enginePerfSpecs.ufps);
			const cpuHz = Runtime.resolveCpuHz(enginePerfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled);
			const engineRenderSize = Runtime.resolveRenderSize(engineLayer.index.machine);
			const vblankCycles = resolveVblankCycles(cpuHz, $.ufps_scaled, engineRenderSize.height);
			const memory = new Memory({
				engineRom: new Uint8Array(engineLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = Runtime.createInstance({
				playerIndex,
				canonicalization: engineLayer.index.machine.canonicalization,
				viewport: engineRenderSize,
				memory,
				cpuHz,
				cycleBudgetPerFrame,
				vblankCycles,
			});
			runtime.setTransferRatesFromManifest(enginePerfSpecs);
			runtime.engineAssetLayer = engineLayer;
			runtime.assetLayerLookup = buildRuntimeLayerLookup([engineLayer]);
			runtime.programAssetLayers = [engineLayer];
			runtime.residentAssetLayers = [engineLayer];
			runtime.configureProgramSources({
				engineSources: engineLuaSources,
				engineAssetSource: engineSource,
				engineCanonicalization: engineLayer.index.machine.canonicalization,
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
		Runtime.applyUfpsScaled(cartPerfSpecs.ufps);
		const cpuHz = Runtime.resolveCpuHz(cartPerfSpecs.cpu_freq_hz);
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled);
		const cartRenderSize = Runtime.resolveRenderSize(cartLayer.index.machine);
		const vblankCycles = resolveVblankCycles(cpuHz, $.ufps_scaled, cartRenderSize.height);
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
			cpuHz,
			cycleBudgetPerFrame,
			vblankCycles,
		});
		runtime.setTransferRatesFromManifest(cartPerfSpecs);
		runtime.engineAssetLayer = engineLayer;
		runtime.assetLayerLookup = buildRuntimeLayerLookup(overlayLayer ? [engineLayer, cartLayer, overlayLayer] : [engineLayer, cartLayer]);
		runtime.programAssetLayers = overlayLayer ? [cartLayer, overlayLayer] : [cartLayer];
		runtime.residentAssetLayers = overlayLayer ? [engineLayer, cartLayer, overlayLayer] : [engineLayer, cartLayer];
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
		await runtime.prepareBootRomStartupState();
		$.view.default_font = new Font();
		await runtime.boot();
		Runtime.startEngineWithDeferredStartupAudioRefresh();
	}

	public static get instance(): Runtime {
		return Runtime._instance!;
	}

	public static hasInstance(): boolean {
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
		const firstFrameHandle = $.platform.frames.start(() => {
			firstFrameHandle.stop();
			const audioRefreshHandle = $.platform.frames.start(() => {
				audioRefreshHandle.stop();
				void $.refresh_audio_assets();
			});
		});
	}

	private static collectAssetEntryIds(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): Set<string> {
		const layerLookup = buildRuntimeLayerLookup(assetLayers);
		const ids = new Set<string>();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const engineAtlas = resolveRuntimeLayerAssetById<RomImgAsset>(layerLookup, engineSource, 'img', engineAtlasId);
		if (!engineAtlas) {
			throw new Error(`[Runtime] Engine atlas '${engineAtlasId}' not found for memory sizing.`);
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
					throw new Error(`[Runtime] Image asset '${entry.resid}' not found for memory sizing.`);
				}
				const meta = asset.imgmeta;
				if (!meta) {
					throw new Error(`[Runtime] Image asset '${entry.resid}' missing metadata for memory sizing.`);
				}
				if (meta.atlassed) {
					ids.add(entry.resid);
				}
			}
			const audioEntries = sources[sourceIndex].list('audio');
			for (let index = 0; index < audioEntries.length; index += 1) {
				const entry = audioEntries[index];
				if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
					throw new Error(`[Runtime] Audio asset '${entry.resid}' missing ROM buffer offsets for memory sizing.`);
				}
				ids.add(entry.resid);
			}
		}

		return ids;
	}

	private static computeAssetTableBytes(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): { bytes: number; entryCount: number; stringBytes: number } {
		const ids = this.collectAssetEntryIds(engineSource, assetSource, assetLayers);
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
			throw new Error('[Runtime] Engine atlas metadata is missing.');
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
		const stringHandleCount = memorySpecs.string_handle_count ?? DEFAULT_STRING_HANDLE_COUNT;
		const stringHeapBytes = memorySpecs.string_heap_bytes ?? DEFAULT_STRING_HEAP_SIZE;
		const atlasSlotBytes = memorySpecs.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE;
		const engineAtlasSlotBytes = engineMemorySpecs.system_atlas_slot_bytes ?? this.resolveEngineAtlasSlotBytes(params.engineSource);
		if (!Number.isSafeInteger(engineAtlasSlotBytes) || engineAtlasSlotBytes <= 0) {
			throw new Error('[Runtime] system atlas slot bytes must be a positive integer.');
		}
		const stagingBytes = memorySpecs.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
		const assetTableInfo = this.computeAssetTableBytes(params.engineSource, params.assetSource, params.assetLayers);
		const requiredAssetTableBytes = assetTableInfo.bytes;
		const assetTableBytes = memorySpecs.asset_table_bytes ?? requiredAssetTableBytes;
		if (memorySpecs.asset_table_bytes !== undefined && assetTableBytes !== requiredAssetTableBytes) {
			throw new Error(`[Runtime] machine.specs.ram.asset_table_bytes (${assetTableBytes}) must match required size ${requiredAssetTableBytes}.`);
		}
		const skyboxFaceBytes = memorySpecs.skybox_face_bytes;
		if (skyboxFaceBytes !== undefined) {
			if (!Number.isSafeInteger(skyboxFaceBytes) || skyboxFaceBytes <= 0) {
				throw new Error(`[Runtime] machine.specs.vram.skybox_face_bytes must be a positive integer (got ${skyboxFaceBytes}).`);
			}
		}
		const skyboxFaceSize = memorySpecs.skybox_face_size ?? SKYBOX_FACE_DEFAULT_SIZE;
		if (skyboxFaceBytes === undefined && skyboxFaceSize <= 0) {
			throw new Error(`[Runtime] Invalid skybox_face_size: ${skyboxFaceSize}.`);
		}
		const requiredAssetDataBytes = this.computeRequiredAssetDataBytes(params.assetSource, params.assetLayers);
		const assetDataBytes = memorySpecs.asset_data_bytes ?? requiredAssetDataBytes;
		if (!Number.isSafeInteger(assetDataBytes) || assetDataBytes < 0) {
			throw new Error(`[Runtime] machine.specs.ram.asset_data_bytes must be a non-negative integer (got ${assetDataBytes}).`);
		}
		if (assetDataBytes < requiredAssetDataBytes) {
			throw new Error(`[Runtime] machine.specs.ram.asset_data_bytes (${assetDataBytes}) must be at least required size ${requiredAssetDataBytes}.`);
		}
		const computedRamBytes = IO_REGION_SIZE
			+ (stringHandleCount * STRING_HANDLE_ENTRY_SIZE)
			+ stringHeapBytes
			+ assetTableBytes
			+ assetDataBytes;
		const ramBytes = memorySpecs.ram_bytes ?? computedRamBytes;
		if (memorySpecs.ram_bytes !== undefined && ramBytes !== computedRamBytes) {
			throw new Error(`[Runtime] machine.specs.ram.ram_bytes (${ramBytes}) must match required size ${computedRamBytes}.`);
		}
		const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
		console.info(
			`[Runtime] memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
			+ `(io=${IO_REGION_SIZE}, string_handles=${stringHandleCount}, string_heap=${stringHeapBytes}, `
			+ `asset_table=${assetTableBytes} (${assetTableInfo.entryCount} entries, ${assetTableInfo.stringBytes} string bytes), `
			+ `asset_data=${assetDataBytes}, vram_staging=${stagingBytes}, `
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
			skybox_face_size: skyboxFaceBytes === undefined ? skyboxFaceSize : memorySpecs.skybox_face_size,
			skybox_face_bytes: skyboxFaceBytes,
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
		this.cycleBudgetPerFrame = options.cycleBudgetPerFrame;
		this.storageService = $.platform.storage;
		this.storage = new RuntimeStorage(this.storageService, $.lua_sources.namespace);
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this.applyCanonicalization(resolvedCanonicalization);
		this.engineLuaSources = $.lua_sources;
		this.engineCanonicalization = resolvedCanonicalization;
		this.cartCanonicalization = resolvedCanonicalization;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.memory = options.memory;
		this.vdp = new VDP(this.memory);
		this.stringHandles = new StringHandleTable(this.memory);
		this.runtimeStringPool = new StringPool(this.stringHandles);
		this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
		this.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
		this.memory.writeValue(IO_IRQ_FLAGS, 0);
		this.memory.writeValue(IO_IRQ_ACK, 0);
		this.memory.writeValue(IO_DMA_SRC, 0);
		this.memory.writeValue(IO_DMA_DST, 0);
		this.memory.writeValue(IO_DMA_LEN, 0);
		this.memory.writeValue(IO_DMA_CTRL, 0);
		this.memory.writeValue(IO_DMA_STATUS, 0);
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
		this.memory.writeValue(IO_IMG_SRC, 0);
		this.memory.writeValue(IO_IMG_LEN, 0);
		this.memory.writeValue(IO_IMG_DST, 0);
		this.memory.writeValue(IO_IMG_CAP, 0);
		this.memory.writeValue(IO_IMG_CTRL, 0);
		this.memory.writeValue(IO_IMG_STATUS, 0);
		this.memory.writeValue(IO_IMG_WRITTEN, 0);
		this.memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, VDP_ATLAS_ID_NONE);
		this.memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, VDP_ATLAS_ID_NONE);
		this.memory.writeValue(IO_VDP_RD_SURFACE, 0);
		this.memory.writeValue(IO_VDP_RD_X, 0);
		this.memory.writeValue(IO_VDP_RD_Y, 0);
		this.memory.writeValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
		this.memory.writeValue(IO_VDP_STATUS, 0);
		this.vdp.initializeRegisters();
		this.setVblankCycles(options.vblankCycles);
		this.dmaController = new DmaController(this.memory, (mask) => this.raiseIrqFlags(mask));
		this.imgDecController = new ImgDecController(this.memory, this.dmaController, (mask) => this.raiseIrqFlags(mask));
		this.vdp.attachImgDecController(this.imgDecController);
		this.cpu = new CPU(this.memory, this.runtimeStringPool);
		this.setCpuHz(options.cpuHz);
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
		const reserved = new Set<string>(this.apiFunctionNames);
		for (let index = 0; index < Runtime.LUA_OVERRIDEABLE_GLOBALS.length; index += 1) {
			reserved.delete(this.canonicalizeIdentifier(Runtime.LUA_OVERRIDEABLE_GLOBALS[index]));
		}
		return reserved;
	}

	public assignInterpreter(interpreter: LuaInterpreter): void {
		this.luaInterpreter = interpreter;
		this.consoleMetadata = null;
		this.pendingCall = null;
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
		this.clearWaitForVblank();
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
			throw new Error('[Runtime]: Failed to boot runtime: ' + error);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	private async prepareBootRomStartupState(options?: { resetRuntime?: boolean; refreshAudio?: boolean }): Promise<void> {
		this.activateEngineProgramAssets();
		if (options?.resetRuntime) {
			await $.resetRuntime();
		}
		await this.buildAssetMemory({ source: this.engineAssetSource, mode: 'full' });
		this.memory.sealEngineAssets();
		if (options?.refreshAudio) {
			await $.refresh_audio_assets();
		}
	}

	public async rebootToBootRom(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
		try {
			runtimeIde.clearActiveDebuggerPause(this);
			runtimeIde.clearRuntimeFault(this);
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
			throw new Error('[Runtime] Attempted to begin a new frame while another frame is active.');
		}
		clearHardwareLighting();
		this.frameDeltaMs = $.deltatime;
		const carryBudget = this.pendingCarryBudget;
		this.pendingCarryBudget = 0;
		const budget = this.cycleBudgetPerFrame + carryBudget;
		const state: FrameState = {
			haltGame: this.debuggerPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			tickCompleted: false,
			cycleBudgetRemaining: budget,
			cycleBudgetGranted: budget,
			cycleCarryGranted: carryBudget,
			cpuStatsFrozen: false,
			cpuStatsUsedCycles: 0,
			cpuStatsGrantedCycles: 0,
		};
		this.vdp.beginFrame();
		this.currentFrameState = state;
		return state;
	}

	public tickUpdate(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingCartBoot();
		if (runtimeIde.isOverlayActive(this)) {
			if (this.currentFrameState !== null) {
				this.abandonFrameState();
			}
			return;
		}
		if (this.currentFrameState !== null) {
			if (this.isUpdatePhasePending()) {
				this.runUpdatePhase(this.currentFrameState);
				this.vdp.flushAssetEdits();
				this.currentFrameState.updateExecuted = !this.isUpdatePhasePending();
			}
			this.finalizeUpdateSlice(this.currentFrameState);
			return;
		}
		this.runCartUpdateTick();
	}

	public tickDraw(): void {
		// Runtime rendering is update-driven; draw phase is intentionally unused.
	}

	private runCartUpdateTick(): void {
		let fault: unknown = null;
		let state: FrameState = null;
		const debugTickRate = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugTickRate) {
			if (this.debugFrameReportAtMs === 0) {
				this.debugFrameReportAtMs = performance.now();
			}
			this.debugTickYieldsBefore = this.debugCycleYieldsTotal;
		}
		try {
			state = this.beginFrameState();
			this.lastTickCompleted = false;
			this.runUpdatePhase(state);
			this.vdp.flushAssetEdits();
			state.updateExecuted = !this.isUpdatePhasePending();
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
		if (frameState.tickCompleted || !this.hasEntryContinuation()) {
			this.abandonFrameState();
		}
	}

	public raiseEngineIrq(mask: number): void {
		const normalized = mask >>> 0;
		if (normalized === 0) {
			throw new Error('[Runtime] Engine IRQ mask must be non-zero.');
		}
		const unsupported = normalized & ~Runtime.ENGINE_IRQ_MASK;
		if (unsupported !== 0) {
			throw new Error(`[Runtime] Unsupported engine IRQ mask: 0x${unsupported.toString(16)}.`);
		}
		this.raiseIrqFlags(normalized);
	}

	private processIrqAck(): void {
		const ack = (this.memory.readValue(IO_IRQ_ACK) as number) >>> 0;
		if (ack === 0) {
			return;
		}
		let flags = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		flags &= ~ack;
		this.memory.writeValue(IO_IRQ_FLAGS, flags >>> 0);
		this.memory.writeValue(IO_IRQ_ACK, 0);
		if ((ack & IRQ_VBLANK) !== 0 && this.vblankPendingClear) {
			this.setVblankStatus(false);
			this.vblankPendingClear = false;
			this.vblankClearOnIrqEnd = false;
		}
	}

	private raiseIrqFlags(mask: number): void {
		const current = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		this.memory.writeValue(IO_IRQ_FLAGS, (current | mask) >>> 0);
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
			if (this.waitingForVblank && this.runWaitForVblank(state)) {
				return;
			}
			if (this.clearBackQueuesAfterWaitResume) {
				clearBackQueues();
				this.clearBackQueuesAfterWaitResume = false;
			}
			this.processIrqAck();
			if (this.pendingCall !== 'entry') {
				return;
			}
			const result = this.runWithBudget(state);
			runtimeLuaPipeline.processIo(this);
			this.processIrqAck();
			if (result === RunResult.Halted) {
				this.pendingCall = null;
			}
		} catch (error) {
			if (this.isWaitForVblankSignal(error)) {
				this.reconcileCycleBudgetAfterSignal(state);
				this.freezeTickCpuStats(state);
				this.processIrqAck();
			} else if (isLuaDebuggerPauseSignal(error)) {
				runtimeIde.onLuaDebuggerPause(this, error);
			} else {
				state.luaFaulted = true;
				this.clearWaitForVblank();
				this.pendingCall = null;
				runtimeIde.handleLuaError(this, error);
			}
		}
	}

	private reconcileCycleBudgetAfterSignal(state: FrameState): void {
		const remaining = this.cpu.instructionBudgetRemaining;
		const consumed = state.cycleBudgetRemaining - remaining;
		if (consumed < 0) {
			throw new Error(`[Runtime] Negative cycle reconciliation (${consumed}).`);
		}
		state.cycleBudgetRemaining = remaining;
		if (consumed > 0) {
			this.advanceHardware(consumed);
		}
	}

	private freezeTickCpuStats(state: FrameState): void {
		if (state.cpuStatsFrozen) {
			return;
		}
		state.cpuStatsFrozen = true;
		state.cpuStatsGrantedCycles = state.cycleBudgetGranted;
		state.cpuStatsUsedCycles = state.cycleBudgetGranted - state.cycleBudgetRemaining;
	}

	private runWaitForVblank(state: FrameState): boolean {
		this.processIrqAck();
		const targetSequence = this.waitForVblankTargetSequence;
		if (targetSequence === 0) {
			this.clearWaitForVblank();
			return false;
		}
		if (this.vblankPendingClear && this.vblankActive && this.vblankSequence < targetSequence) {
			this.setVblankStatus(false);
			this.vblankPendingClear = false;
			this.vblankClearOnIrqEnd = false;
		}
		if (this.vblankSequence < targetSequence) {
			if (state.cycleBudgetRemaining > 0) {
				const cyclesToTarget = this.cyclesUntilNextVblankEdge();
				const idleCycles = cyclesToTarget < state.cycleBudgetRemaining ? cyclesToTarget : state.cycleBudgetRemaining;
				state.cycleBudgetRemaining -= idleCycles;
				this.advanceHardware(idleCycles);
				this.processIrqAck();
			}
			if (this.vblankSequence < targetSequence) {
				return true;
			}
		}
		this.clearWaitForVblank();
		// Clear queues on the next runnable slice after the completed frame was presented.
		this.clearBackQueuesAfterWaitResume = true;
		return state.tickCompleted;
	}

	public drawIde(): void {
		runtimeIde.drawIde(this);
	}

	public drawTerminal(): void {
		runtimeIde.drawTerminal(this);
	}

	// Clear reference to allow next frame to begin
	public abandonFrameState(): void {
		this.currentFrameState = null;
	}

	public resolveAssetHandle(id: string): number {
		return this.memory.resolveAssetHandle(id);
	}

	public getAssetEntryByHandle(handle: number): AssetEntry {
		return this.memory.getAssetEntryByHandle(handle);
	}

	public getAssetEntry(id: string): AssetEntry {
		return this.getAssetEntryByHandle(this.resolveAssetHandle(id));
	}

	public getImageMetaByHandle(handle: number): ImgMeta {
		const meta = this.imageMetaByHandle.get(handle);
		if (!meta) {
			throw new Error(`[Runtime] Image metadata missing for handle ${handle}.`);
		}
		return meta;
	}

	public getImageMeta(id: string): ImgMeta {
		return this.getImageMetaByHandle(this.resolveAssetHandle(id));
	}

	public getResidentAssetLayers(): ReadonlyArray<RuntimeAssetLayer> {
		return this.residentAssetLayers ?? [this.engineAssetLayer];
	}

	public hasAssetLayerLookup(): boolean {
		return this.engineAssetLayer !== null;
	}

	public getImageAssetByEntry(entry: RomAsset): RomImgAsset {
		return resolveRuntimeLayerAssetFromEntry<RomImgAsset>(this.assetLayerLookup, 'img', entry);
	}

	public getImageAsset(id: string, source: RawAssetSource = $.asset_source): RomImgAsset {
		return resolveRuntimeLayerAssetById<RomImgAsset>(this.assetLayerLookup, source, 'img', id);
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

	public getAudioMetaByHandle(handle: number): AudioMeta {
		const meta = this.audioMetaByHandle.get(handle);
		if (!meta) {
			throw new Error(`[Runtime] Audio metadata missing for handle ${handle}.`);
		}
		return meta;
	}

	public getAudioMeta(id: string): AudioMeta {
		return this.getAudioMetaByHandle(this.resolveAssetHandle(id));
	}

	public buildAudioResourcesForSoundMaster(): id2res {
		const resources: id2res = {};
		const source = $.asset_source;
		if (!source) {
			throw new Error('[Runtime] Asset source not configured.');
		}
		const entries = source.list('audio');
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
				throw new Error(`[Runtime] Audio asset '${entry.resid}' missing ROM buffer offsets.`);
			}
			if (typeof entry.metabuffer_start !== 'number' || typeof entry.metabuffer_end !== 'number') {
				throw new Error(`[Runtime] Audio asset '${entry.resid}' missing metadata offsets.`);
			}
			const metaBytes = source.getBytes({
				...entry,
				start: entry.metabuffer_start,
				end: entry.metabuffer_end,
			});
			const audiometa = decodeBinary(metaBytes) as AudioMeta;
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

	public getImagePixels(entry: AssetEntry): Uint8Array {
		if (entry.type !== 'image') {
			throw new Error(`[Runtime] Asset '${entry.id}' is not an image.`);
		}
		return this.memory.getImagePixels(entry);
	}

	public getAudioBytes(entry: AssetEntry): Uint8Array {
		if (entry.type !== 'audio') {
			throw new Error(`[Runtime] Asset '${entry.id}' is not audio.`);
		}
		return this.memory.getAudioBytes(entry);
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
			throw new Error('[Runtime] Asset source not configured.');
		}
		const entry = source.getEntry(id);
		if (!entry) {
			throw new Error(`[Runtime] Audio asset '${id}' not found in ROM.`);
		}
		if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
			throw new Error(`[Runtime] Audio asset '${id}' missing ROM buffer offsets.`);
		}
		return source.getBytesView(entry);
	}

	public setSkyboxImages(ids: SkyboxImageIds): void {
		this.vdp.setSkyboxImages(ids);
	}

	public setVdpDitherType(value: number): void {
		this.vdp.setDitherType(value);
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
				console.info('[Runtime] Cart boot payload prepared from Lua sources.');
				return;
			}
			const programEntry = this.cartAssetSource.getEntry(PROGRAM_ASSET_ID);
			this.setCartBootReadyFlag(!!programEntry);
		} catch (error) {
			this.preparedCartProgram = null;
			this.setCartBootReadyFlag(false);
			console.error('[Runtime] Failed to prepare cart boot payload:', error);
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
				console.error('[Runtime] Failed to prepare cart boot:', error);
				this.setCartBootReadyFlag(false);
			});
		});
		this.deferredCartBootPreparationHandle = handle;
	}

	public async buildAssetMemory(params?: { source?: RawAssetSource; mode?: 'full' | 'cart' }): Promise<void> {
		const token = this.assetMemoryGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		try {
			const mode = params?.mode ?? 'full';
			const assetSource = params?.source ?? $.asset_source;
			if (!assetSource) {
				throw new Error('[Runtime] Asset source not configured.');
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
			this.memory.markAllAssetsDirty();
		} finally {
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
				throw new Error(`[Runtime] Image asset '${asset.resid}' missing metadata.`);
			}
			const handle = this.resolveAssetHandle(asset.resid);
			this.imageMetaByHandle.set(handle, meta);
		}
		const audioEntries = source.list('audio');
		for (let index = 0; index < audioEntries.length; index += 1) {
			const asset = this.getAudioAssetByEntry(audioEntries[index]!);
			const meta = asset.audiometa;
			if (!meta) {
				throw new Error(`[Runtime] Audio asset '${asset.resid}' missing metadata.`);
			}
			const handle = this.resolveAssetHandle(asset.resid);
			this.audioMetaByHandle.set(handle, meta);
		}
	}

	private activateEngineProgramAssets(): void {
		$.set_assets(this.engineAssetLayer.assets);
		this.programAssetLayers = [this.engineAssetLayer];
		this.residentAssetLayers = [this.engineAssetLayer];
		this.activateProgramSource('engine');
	}

	public activateCartProgramAssets(): void {
		$.set_assets((this.overlayAssetLayer ?? this.cartAssetLayer).assets);
		this.programAssetLayers = this.overlayAssetLayer ? [this.cartAssetLayer, this.overlayAssetLayer] : [this.cartAssetLayer];
		this.residentAssetLayers = this.overlayAssetLayer ? [this.engineAssetLayer, this.cartAssetLayer, this.overlayAssetLayer] : [this.engineAssetLayer, this.cartAssetLayer];
		const perfSpecs = getMachinePerfSpecs($.machine_manifest);
		Runtime.applyUfpsScaled(perfSpecs.ufps);
		const cpuHz = Runtime.resolveCpuHz(perfSpecs.cpu_freq_hz);
		this.applyActiveMachineTiming(cpuHz);
		this.setTransferRatesFromManifest(perfSpecs);
	}

	private pollSystemBootRequest(): void {
		if (!this.isEngineProgramActive()) {
			return;
		}
		if (!this.memory.readValue(IO_SYS_BOOT_CART)) {
			return;
		}
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
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
			this.clearWaitForVblank();
		}
		this.pendingCartBoot = false;
		console.info('[Runtime] Switching to cart program after BIOS boot request.');
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
		const luaArgs: LuaValue[] = [];
		for (let index = 0; index < args.length; index += 1) {
			luaArgs.push(this.luaJsBridge.toLua(args[index]));
		}
		const results = fn.call(luaArgs);
		const output: unknown[] = [];
		const moduleId = $.lua_sources.path2lua[this._luaPath].source_path;
		const baseCtx = { moduleId, path: [] };
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaJsBridge.convertFromLua(results[i], extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
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

	public callClosure(fn: Closure, args: Value[]): Value[] {
		const depth = this.cpu.getFrameDepth();
		const previousBudget = this.cpu.instructionBudgetRemaining;
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		try {
			this.cpu.callExternal(fn, args);
			this.cpu.runUntilDepth(depth, budgetSentinel);
		} catch (error) {
			this.cpu.unwindToDepth(depth);
			throw error;
		} finally {
			const remaining = this.cpu.instructionBudgetRemaining;
			this.cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		}
		return this.cpu.lastReturnValues;
	}

	private invokeClosureHandler(fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs: Value[] = [];
		if (thisArg !== undefined) {
			callArgs.push(toRuntimeValue(this, thisArg));
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(toRuntimeValue(this, args[index]));
		}
		const results = this.callClosure(fn, callArgs);
		if (results.length === 0) {
			return undefined;
		}
		const ctx = buildMarshalContext(this);
		return toNativeValue(this, results[0], ctx, new WeakMap());
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
