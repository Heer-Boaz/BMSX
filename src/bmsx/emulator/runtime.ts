import { $, renderGate, runGate } from '../core/engine_core';
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
	isLuaCallSignal,
	setLuaTableCaseInsensitiveKeys,
	type LuaDebuggerPauseSignal
} from '../lua/luavalue';
import type { StorageService } from '../platform/platform';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { AudioMeta, CartridgeLayerId, ImgMeta, MachineManifest, RomAsset, RomImgAsset, Viewport, RuntimeAssets, id2res } from '../rompack/rompack';
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
} from '../rompack/rompack';
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { buildRuntimeAssetLayer, parseCartHeader, type RuntimeAssetLayer } from '../rompack/romloader';
import { parseRomMetadataSection } from '../rompack/rom_metadata';
import { decodeBinary, decodeBinaryWithPropTable } from '../serializer/binencoder';
import { createIdentifierCanonicalizer } from '../lua/syntax/identifier_canonicalizer';
import { Api } from './firmware_api';
import { CPU, Table, type Closure, type Value, type Program, type ProgramMetadata, RunResult, type NativeFunction, type NativeObject } from './cpu';
import { StringPool, StringValue } from './string_pool';
import { StringHandleTable } from './string_memory';
import type { TerminalMode } from './terminal/ui/terminal_mode';
import { OverlayRenderer } from './overlay_renderer';
import { Font, type FontVariant } from '../render/shared/bmsx_font';
import {
	beginMeshQueue,
	beginParticleQueue,
	clearBackQueues,
} from '../render/shared/render_queues';
import { clearHardwareCamera } from '../render/shared/hardware_camera';
import { clearHardwareLighting } from '../render/shared/hardware_lighting';
import type { CartEditor } from '../ide/cart_editor';
import { type FaultSnapshot } from '../ide/render/render_error_overlay';
import { type CpuFrameSnapshot } from './cpu';
import { type LuaSemanticModel, type FileSemanticData } from '../ide/contrib/intellisense/semantic_model';
import { registerApiBuiltins } from './lua_builtins';
import { LuaFunctionRedirectCache } from './lua_handler_registry';
import { LuaJsBridge, buildMarshalContext, extendMarshalContext, syncLuaAssetField, toNativeValue, toRuntimeValue } from './lua_js_bridge';
import { RuntimeStorage } from './storage';
import type { RuntimeOptions, LuaBuiltinDescriptor, LuaMemberCompletion } from './types';
import { applyWorkspaceOverridesToCart, applyWorkspaceOverridesToRegistry, DEFAULT_ENGINE_PROJECT_ROOT_PATH } from './workspace';
import { buildLuaSources, type LuaSourceRegistry } from './lua_sources';
import * as runtimeIde from './runtime_ide';
import * as runtimeLuaPipeline from './runtime_lua_pipeline';
import { registerAudioAssets as registerAudioAssetsFromSource } from './runtime_assets';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../lua/luadebugger';
import type { ParsedLuaChunk } from '../ide/language/lua/lua_parse';
import { ResourceUsageDetector } from './resource_usage_detector';
import { configureLuaHeapUsage } from './lua_heap_usage';
import { RuntimeFrameLoopState } from './runtime_frame_loop';
import { RuntimeMachineSchedulerState } from './runtime_machine_scheduler';
import { RuntimeScreenState } from './runtime_screen';
import { RuntimeTimingState, calcCyclesPerFrameScaled, resolveUfpsScaled, resolveVblankCycles } from './runtime_timing';
import {
	DMA_CTRL_START,
	DMA_STATUS_BUSY,
	DMA_STATUS_DONE,
	DMA_STATUS_REJECTED,
	DMA_STATUS_ERROR,
	GEO_CTRL_ABORT,
	GEO_CTRL_START,
	HOST_FAULT_FLAG_ACTIVE,
	HOST_FAULT_FLAG_STARTUP_BLOCKING,
	HOST_FAULT_STAGE_NONE,
	HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
	IO_GEO_SRC0,
	IO_GEO_SRC1,
	IO_GEO_SRC2,
	IO_GEO_STATUS,
	IO_GEO_STRIDE0,
	IO_GEO_STRIDE1,
	IO_GEO_STRIDE2,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IMG_CTRL_START,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IO_PAYLOAD_ALLOC_ADDR,
	IO_PAYLOAD_DATA_ADDR,
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_CMD,
	IO_VDP_CMD_ARG0,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_RD_MODE,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	IO_VDP_STATUS,
	IRQ_NEWGAME,
	IRQ_REINIT,
	IRQ_VBLANK,
	VDP_ATLAS_ID_NONE,
	VDP_FIFO_CTRL_SEAL,
	VDP_RD_MODE_RGBA8888,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
} from './io';
import { HandlerCache } from './handler_cache';
import { Memory, ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE, type AssetEntry, type IoWriteHandler } from './memory';
import { DmaController } from './devices/dma_controller';
import { GeometryController } from './devices/geometry_controller';
import { ImgDecController } from './devices/imgdec_controller';
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
	VDP_STREAM_CAPACITY_WORDS,
	VDP_STREAM_PACKET_HEADER_WORDS,
	VDP_STREAM_PAYLOAD_CAPACITY_WORDS,
	configureMemoryMap,
	type MemoryMapSpecs as MemoryMapSpecs,
} from './memory_map';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, VDP } from './vdp';
import { PROGRAM_ASSET_ID } from './program_asset';
import { createVdpBlitterExecutor } from '../render/vdp/vdp_blitter';
import { getVdpPacketSchema } from './vdp_packet_schema';

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

function runtimeFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function vdpFault(message: string): Error {
	return new Error(`VDP fault: ${message}`);
}

function vdpStreamFault(message: string): Error {
	return new Error(`VDP stream fault: ${message}`);
}


// Flip back to 'msx' to restore default font in emulator/editor
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

const TIMER_KIND_VBLANK_BEGIN = 1;
const TIMER_KIND_VBLANK_END = 2;
const TIMER_KIND_DEVICE_SERVICE = 3;
const DEVICE_SERVICE_GEO = 1;
const DEVICE_SERVICE_DMA = 2;
const DEVICE_SERVICE_IMG = 3;
const DEVICE_SERVICE_VDP = 4;
const DEVICE_SERVICE_KIND_COUNT = DEVICE_SERVICE_VDP + 1;

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
	private static readonly LUA_OVERRIDEABLE_GLOBALS: ReadonlyArray<string> = ['update'];
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
		this.refreshDeviceTimings(this.currentSchedulerNowCycles());
		if (this.vblankCycles > 0) {
			if (this.vblankCycles > this.cycleBudgetPerFrame) {
				throw runtimeFault('vblank_cycles must be less than or equal to cycles_per_frame.');
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

	public getActiveCpuCyclesGranted(): number {
		return this.getLastTickBudgetGranted();
	}

	public getVdpWorkUnitsPerSec(): number {
		return this.vdpWorkUnitsPerSec;
	}

	public resetVdpIngressState(): void {
		this.vdpFifoWordByteCount = 0;
		this.vdpFifoStreamWordCount = 0;
	}

	private hasOpenDirectVdpFifoIngress(): boolean {
		return this.vdpFifoWordByteCount !== 0 || this.vdpFifoStreamWordCount !== 0;
	}

	private hasBlockedVdpSubmitPath(): boolean {
		return this.hasOpenDirectVdpFifoIngress() || this.dmaController.hasPendingVdpSubmit() || !this.vdp.canAcceptSubmittedFrame();
	}

	private pushVdpFifoWord(word: number): void {
		if (this.vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
			throw vdpStreamFault(`stream overflow (${this.vdpFifoStreamWordCount + 1} > ${VDP_STREAM_CAPACITY_WORDS}).`);
		}
		this.vdpFifoStreamWords[this.vdpFifoStreamWordCount] = word >>> 0;
		this.vdpFifoStreamWordCount += 1;
	}

	public writeVdpFifoBytes(bytes: Uint8Array): void {
		for (let index = 0; index < bytes.byteLength; index += 1) {
			this.vdpFifoWordScratch[this.vdpFifoWordByteCount] = bytes[index]!;
			this.vdpFifoWordByteCount += 1;
			if (this.vdpFifoWordByteCount !== 4) {
				continue;
			}
			const word = (
				this.vdpFifoWordScratch[0]
				| (this.vdpFifoWordScratch[1] << 8)
				| (this.vdpFifoWordScratch[2] << 16)
				| (this.vdpFifoWordScratch[3] << 24)
			) >>> 0;
			this.vdpFifoWordByteCount = 0;
			this.pushVdpFifoWord(word);
		}
	}

	private consumeSealedVdpStream(baseAddr: number, byteLength: number): void {
		if ((byteLength & 3) !== 0) {
			throw vdpStreamFault('sealed stream length must be word-aligned.');
		}
		if (byteLength > VDP_STREAM_BUFFER_SIZE) {
			throw vdpStreamFault(`sealed stream overflow (${byteLength} > ${VDP_STREAM_BUFFER_SIZE}).`);
		}
		let cursor = baseAddr;
		const end = baseAddr + byteLength;
		this.vdp.beginSubmittedFrame();
		try {
			while (cursor < end) {
				if (cursor + VDP_STREAM_PACKET_HEADER_WORDS * 4 > end) {
					throw vdpStreamFault('stream ended mid-packet header.');
				}
				const cmd = this.memory.readU32(cursor) >>> 0;
				const argWords = this.memory.readU32(cursor + 4) >>> 0;
				const payloadWords = this.memory.readU32(cursor + 8) >>> 0;
				if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
					throw vdpStreamFault(`submit payload overflow (${payloadWords} > ${VDP_STREAM_PAYLOAD_CAPACITY_WORDS}).`);
				}
				const packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
				const packetByteCount = packetWordCount * 4;
				if (cursor + packetByteCount > end) {
					throw vdpStreamFault('stream ended mid-packet payload.');
				}
				this.vdp.syncRegisters();
				runtimeLuaPipeline.processVdpCommand(this, {
					cmd,
					argWords,
					argsBase: cursor + VDP_STREAM_PACKET_HEADER_WORDS * 4,
					payloadBase: cursor + (VDP_STREAM_PACKET_HEADER_WORDS + argWords) * 4,
					payloadWords,
				});
				cursor += packetByteCount;
			}
			this.vdp.sealSubmittedFrame();
		} catch (error) {
			this.vdp.cancelSubmittedFrame();
			throw error;
		}
		this.refreshVdpSubmitBusyStatus();
	}

	private consumeSealedVdpWordStream(wordCount: number): void {
		let cursor = 0;
		this.vdp.beginSubmittedFrame();
		try {
			while (cursor < wordCount) {
				if (cursor + VDP_STREAM_PACKET_HEADER_WORDS > wordCount) {
					throw vdpStreamFault('stream ended mid-packet header.');
				}
				const cmd = this.vdpFifoStreamWords[cursor] >>> 0;
				const argWords = this.vdpFifoStreamWords[cursor + 1] >>> 0;
				const payloadWords = this.vdpFifoStreamWords[cursor + 2] >>> 0;
				if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
					throw vdpStreamFault(`submit payload overflow (${payloadWords} > ${VDP_STREAM_PAYLOAD_CAPACITY_WORDS}).`);
				}
				const packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
				if (cursor + packetWordCount > wordCount) {
					throw vdpStreamFault('stream ended mid-packet payload.');
				}
				this.vdp.syncRegisters();
				runtimeLuaPipeline.processVdpBufferedCommand(this, {
					cmd,
					argWords,
					argsWordOffset: cursor + VDP_STREAM_PACKET_HEADER_WORDS,
					payloadWordOffset: cursor + VDP_STREAM_PACKET_HEADER_WORDS + argWords,
					payloadWords,
					words: this.vdpFifoStreamWords,
				});
				cursor += packetWordCount;
			}
			this.vdp.sealSubmittedFrame();
		} catch (error) {
			this.vdp.cancelSubmittedFrame();
			throw error;
		}
		this.refreshVdpSubmitBusyStatus();
	}

	public sealVdpFifoTransfer(): void {
		if (this.vdpFifoWordByteCount !== 0) {
			throw vdpStreamFault('FIFO transfer ended on a partial word.');
		}
		if (this.vdpFifoStreamWordCount === 0) {
			return;
		}
		this.consumeSealedVdpWordStream(this.vdpFifoStreamWordCount);
		this.resetVdpIngressState();
	}

	public sealVdpDmaTransfer(src: number, byteLength: number): void {
		this.consumeSealedVdpStream(src, byteLength);
	}

	private consumeDirectVdpCommand(cmd: number): void {
		const schema = getVdpPacketSchema(cmd);
		this.vdp.beginSubmittedFrame();
		try {
			this.vdp.syncRegisters();
			runtimeLuaPipeline.processVdpCommand(this, {
				cmd,
				argWords: schema.argWords,
				argsBase: IO_VDP_CMD_ARG0,
				payloadBase: 0,
				payloadWords: 0,
			});
			this.vdp.sealSubmittedFrame();
		} catch (error) {
			this.vdp.cancelSubmittedFrame();
			throw error;
		}
		this.refreshVdpSubmitBusyStatus();
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

	public didLastTickComplete(): boolean {
		return this.lastTickCompleted;
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
			const nextDeadline = this.nextTimerDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - this.schedulerNowCycles;
				if (deadlineBudget <= 0) {
					this.runDueTimers();
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			this.schedulerSliceActive = true;
			this.activeSliceBaseCycle = this.schedulerNowCycles;
			this.activeSliceBudgetCycles = sliceBudget;
			this.activeSliceTargetCycle = this.schedulerNowCycles + sliceBudget;
			result = this.cpu.run(sliceBudget);
			this.schedulerSliceActive = false;
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
		this.dmaController.setTiming(this._cpuHz, this.dmaBytesPerSecIso, this.dmaBytesPerSecBulk, nowCycles);
		this.imgDecController.setTiming(this._cpuHz, this.imgDecBytesPerSec, nowCycles);
		this.geometryController.setTiming(this._cpuHz, this.geoWorkUnitsPerSec, nowCycles);
		this.vdp.setTiming(this._cpuHz, this.vdpWorkUnitsPerSec, nowCycles);
	}

	private advanceTime(cycles: number): void {
		if (cycles <= 0) {
			return;
		}
		const nextNow = this.schedulerNowCycles + cycles;
		this.dmaController.accrueCycles(cycles, nextNow);
		this.imgDecController.accrueCycles(cycles, nextNow);
		this.geometryController.accrueCycles(cycles, nextNow);
		this.vdp.accrueCycles(cycles, nextNow);
		this.schedulerNowCycles = nextNow;
		this.runDueTimers();
		this.refreshVdpSubmitBusyStatus();
	}

	private currentSchedulerNowCycles(): number {
		if (!this.schedulerSliceActive) {
			return this.schedulerNowCycles;
		}
		const consumed = this.activeSliceBudgetCycles - this.cpu.instructionBudgetRemaining;
		return this.activeSliceBaseCycle + consumed;
	}

	private getCyclesIntoFrame(): number {
		return this.schedulerNowCycles - this.frameStartCycle;
	}

	private resetSchedulerState(): void {
		this.clearTimerHeap();
		this.schedulerNowCycles = 0;
		this.frameStartCycle = 0;
		this.schedulerSliceActive = false;
		this.activeSliceBaseCycle = 0;
		this.activeSliceBudgetCycles = 0;
		this.activeSliceTargetCycle = 0;
		this.vblankEnterTimerGeneration = 0;
		this.vblankEndTimerGeneration = 0;
		this.deviceServiceTimerGeneration.fill(0);
	}

	private clearTimerHeap(): void {
		this.timerCount = 0;
		this.timerDeadlines.length = 0;
		this.timerKinds.length = 0;
		this.timerPayloads.length = 0;
		this.timerGenerations.length = 0;
	}

	private nextTimerGeneration(value: number): number {
		const next = (value + 1) >>> 0;
		return next === 0 ? 1 : next;
	}

	private pushTimer(deadline: number, kind: number, payload: number, generation: number): void {
		let index = this.timerCount;
		this.timerCount += 1;
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.timerDeadlines[parent]! <= deadline) {
				break;
			}
			this.timerDeadlines[index] = this.timerDeadlines[parent]!;
			this.timerKinds[index] = this.timerKinds[parent]!;
			this.timerPayloads[index] = this.timerPayloads[parent]!;
			this.timerGenerations[index] = this.timerGenerations[parent]!;
			index = parent;
		}
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
	}

	private removeTopTimer(): void {
		const lastIndex = this.timerCount - 1;
		if (lastIndex < 0) {
			return;
		}
		const deadline = this.timerDeadlines[lastIndex]!;
		const kind = this.timerKinds[lastIndex]!;
		const payload = this.timerPayloads[lastIndex]!;
		const generation = this.timerGenerations[lastIndex]!;
		this.timerCount = lastIndex;
		this.timerDeadlines.length = lastIndex;
		this.timerKinds.length = lastIndex;
		this.timerPayloads.length = lastIndex;
		this.timerGenerations.length = lastIndex;
		if (lastIndex === 0) {
			return;
		}
		let index = 0;
		const half = lastIndex >> 1;
		while (index < half) {
			let child = (index << 1) + 1;
			if (child + 1 < lastIndex && this.timerDeadlines[child + 1]! < this.timerDeadlines[child]!) {
				child += 1;
			}
			if (this.timerDeadlines[child]! >= deadline) {
				break;
			}
			this.timerDeadlines[index] = this.timerDeadlines[child]!;
			this.timerKinds[index] = this.timerKinds[child]!;
			this.timerPayloads[index] = this.timerPayloads[child]!;
			this.timerGenerations[index] = this.timerGenerations[child]!;
			index = child;
		}
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
	}

	private isTimerCurrent(kind: number, payload: number, generation: number): boolean {
		switch (kind) {
			case TIMER_KIND_VBLANK_BEGIN:
				return generation === this.vblankEnterTimerGeneration;
			case TIMER_KIND_VBLANK_END:
				return generation === this.vblankEndTimerGeneration;
			case TIMER_KIND_DEVICE_SERVICE:
				return generation === this.deviceServiceTimerGeneration[payload];
			default:
				throw runtimeFault(`unknown timer kind ${kind}.`);
		}
	}

	private discardStaleTopTimers(): void {
		while (this.timerCount > 0) {
			const kind = this.timerKinds[0]!;
			const payload = this.timerPayloads[0]!;
			const generation = this.timerGenerations[0]!;
			if (this.isTimerCurrent(kind, payload, generation)) {
				return;
			}
			this.removeTopTimer();
		}
	}

	private nextTimerDeadline(): number {
		this.discardStaleTopTimers();
		if (this.timerCount === 0) {
			return Number.MAX_SAFE_INTEGER;
		}
		return this.timerDeadlines[0]!;
	}

	private runDueTimers(): void {
		this.discardStaleTopTimers();
		while (this.timerCount > 0 && this.timerDeadlines[0]! <= this.schedulerNowCycles) {
			const kind = this.timerKinds[0]!;
			const payload = this.timerPayloads[0]!;
			this.removeTopTimer();
			this.dispatchTimer(kind, payload);
			this.discardStaleTopTimers();
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

	private scheduleVblankBeginTimer(deadlineCycles: number): void {
		const generation = this.nextTimerGeneration(this.vblankEnterTimerGeneration);
		this.vblankEnterTimerGeneration = generation;
		this.pushTimer(deadlineCycles, TIMER_KIND_VBLANK_BEGIN, 0, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	private scheduleVblankEndTimer(deadlineCycles: number): void {
		const generation = this.nextTimerGeneration(this.vblankEndTimerGeneration);
		this.vblankEndTimerGeneration = generation;
		this.pushTimer(deadlineCycles, TIMER_KIND_VBLANK_END, 0, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	private scheduleCurrentFrameTimers(): void {
		this.scheduleVblankEndTimer(this.frameStartCycle + this.cycleBudgetPerFrame);
		if (this.vblankStartCycle > 0 && this.getCyclesIntoFrame() < this.vblankStartCycle) {
			this.scheduleVblankBeginTimer(this.frameStartCycle + this.vblankStartCycle);
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
		this.frameStartCycle = this.schedulerNowCycles;
		this.scheduleCurrentFrameTimers();
		if (this.vblankStartCycle === 0) {
			this.enterVblank();
		}
	}

	private scheduleDeviceService(deviceKind: number, deadlineCycles: number): void {
		const generation = this.nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
		this.deviceServiceTimerGeneration[deviceKind] = generation;
		this.pushTimer(deadlineCycles, TIMER_KIND_DEVICE_SERVICE, deviceKind, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	private cancelDeviceService(deviceKind: number): void {
		this.deviceServiceTimerGeneration[deviceKind] = this.nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
	}

	private requestYieldForEarlierDeadline(deadlineCycles: number): void {
		if (!this.schedulerSliceActive) {
			return;
		}
		if (deadlineCycles > this.activeSliceTargetCycle) {
			return;
		}
		this.cpu.requestYield();
	}

	private runDeviceService(deviceKind: number): void {
		const nowCycles = this.schedulerNowCycles;
		switch (deviceKind) {
			case DEVICE_SERVICE_GEO:
				this.geometryController.onService(nowCycles);
				return;
			case DEVICE_SERVICE_DMA:
				this.dmaController.onService(nowCycles);
				this.refreshVdpSubmitBusyStatus();
				return;
			case DEVICE_SERVICE_IMG:
				this.imgDecController.onService(nowCycles);
				return;
			case DEVICE_SERVICE_VDP:
				this.vdp.onService(nowCycles);
				this.refreshVdpSubmitBusyStatus();
				return;
			default:
				throw runtimeFault(`unknown device service kind ${deviceKind}.`);
		}
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
		this.refreshDeviceTimings(this.currentSchedulerNowCycles());
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
		this.vdp.setTiming(this._cpuHz, this.vdpWorkUnitsPerSec, this.currentSchedulerNowCycles());
	}

	public setGeoWorkUnitsPerSec(value: number): void {
		this.geoWorkUnitsPerSec = Runtime.resolveGeoWorkUnitsPerSec(value);
		this.geometryController.setTiming(this._cpuHz, this.geoWorkUnitsPerSec, this.currentSchedulerNowCycles());
	}

	public setTransferRatesFromManifest(specs: { imgdec_bytes_per_sec: number; dma_bytes_per_sec_iso: number; dma_bytes_per_sec_bulk: number; work_units_per_sec: number; geo_work_units_per_sec: number; }): void {
		this.imgDecBytesPerSec = Runtime.resolveBytesPerSec(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
		this.dmaBytesPerSecIso = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
		this.dmaBytesPerSecBulk = Runtime.resolveBytesPerSec(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
		this.setVdpWorkUnitsPerSec(specs.work_units_per_sec);
		this.setGeoWorkUnitsPerSec(specs.geo_work_units_per_sec);
		this.refreshDeviceTimings(this.currentSchedulerNowCycles());
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
		this.irqSignalSequence = 0;
		this.resetHaltIrqWait();
		this.vdpStatus = 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
		if (this.vblankStartCycle === 0) {
			this.setVblankStatus(true);
		}
		this.scheduleCurrentFrameTimers();
		this.refreshDeviceTimings(this.schedulerNowCycles);
	}

	public resetRenderBuffers(): void {
		clearHardwareCamera();
		clearHardwareLighting();
		clearBackQueues();
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

	private setVdpSubmitBusyStatus(active: boolean): void {
		const mask = VDP_STATUS_SUBMIT_BUSY;
		const nextStatus = active ? (this.vdpStatus | mask) : (this.vdpStatus & ~mask);
		if (nextStatus === this.vdpStatus) {
			return;
		}
		this.vdpStatus = nextStatus >>> 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
	}

	private refreshVdpSubmitBusyStatus(): void {
		this.setVdpSubmitBusyStatus(this.hasBlockedVdpSubmitPath());
	}

	private setVdpSubmitRejectedStatus(active: boolean): void {
		const mask = VDP_STATUS_SUBMIT_REJECTED;
		const nextStatus = active ? (this.vdpStatus | mask) : (this.vdpStatus & ~mask);
		if (nextStatus === this.vdpStatus) {
			return;
		}
		this.vdpStatus = nextStatus >>> 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
	}

	// Sticky reject latch: set when a VDP submit attempt is rejected because the submit path
	// is busy, and cleared only when a later VDP submit attempt is accepted. Stream building
	// in RAM does not affect it.
	private noteRejectedVdpSubmitAttempt(): void {
		this.setVdpSubmitRejectedStatus(true);
		this.refreshVdpSubmitBusyStatus();
	}

	private noteAcceptedVdpSubmitAttempt(): void {
		this.setVdpSubmitRejectedStatus(false);
		this.refreshVdpSubmitBusyStatus();
	}

	private syncVdpSubmitAttemptStatusFromDma(dst: number): void {
		if (dst !== IO_VDP_FIFO) {
			return;
		}
		const dmaStatus = (this.memory.readValue(IO_DMA_STATUS) as number) >>> 0;
		if ((dmaStatus & DMA_STATUS_REJECTED) !== 0) {
			this.noteRejectedVdpSubmitAttempt();
			return;
		}
		if ((dmaStatus & DMA_STATUS_ERROR) !== 0) {
			return;
		}
		if ((dmaStatus & (DMA_STATUS_BUSY | DMA_STATUS_DONE)) !== 0) {
			this.noteAcceptedVdpSubmitAttempt();
		}
	}

	private enterVblank(): void {
		// IRQ flags are level/pending; multiple VBLANK edges while pending coalesce.
		this.vblankSequence += 1;
		this.commitFrameOnVblankEdge();
		this.setVblankStatus(true);
		this.signalIrq(IRQ_VBLANK);
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

	private tryCompleteTickOnActiveVblank(state: FrameState): boolean {
		if (!this.isFrameBoundaryHalt()) {
			return false;
		}
		if (!this.vblankActive || this.vblankSequence === 0) {
			return false;
		}
		const pendingFlags = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
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
		this.refreshVdpSubmitBusyStatus();
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) {
			return;
		}
		this.activeTickCompleted = true;
		this.machineScheduler.enqueueTickCompletion(this, frameState);
		this.lastCompletedVblankSequence = vblankSequence;
	}

	public captureVblankState(): { cyclesIntoFrame: number } {
		return {
			cyclesIntoFrame: this.getCyclesIntoFrame(),
		};
	}

	public restoreVblankState(state: { cyclesIntoFrame: number }): void {
		this.clearHaltUntilIrq();
		this.machineScheduler.reset(this);
		this.frameLoop.reset();
		this.screen.reset();
		this.resetSchedulerState();
		this.schedulerNowCycles = state.cyclesIntoFrame;
		this.frameStartCycle = 0;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		this.irqSignalSequence = 0;
		const vblankActive = (this.vblankStartCycle === 0)
			|| (this.getCyclesIntoFrame() >= this.vblankStartCycle);
		this.setVblankStatus(vblankActive);
		this.scheduleCurrentFrameTimers();
		this.refreshDeviceTimings(this.schedulerNowCycles);
	}
	private includeJsStackTraces = false;
	public realtimeCompileOptLevel: 0 | 1 | 2 | 3 = 3;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;
	private clearBackQueuesAfterIrqWake = false;
	private handlingIrqAckWrite = false;
	private handlingVdpCommandWrite = false;
	private readonly vdpFifoWordScratch = new Uint8Array(4);
	private vdpFifoWordByteCount = 0;
	private readonly vdpFifoStreamWords = new Uint32Array(VDP_STREAM_CAPACITY_WORDS);
	private vdpFifoStreamWordCount = 0;
	private irqSignalSequence = 0;
	private haltIrqSignalSequence = 0;
	private haltIrqWaitArmed = false;
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	public cycleBudgetPerFrame: number;
	private vblankCycles = 0;
	private vblankStartCycle = 0;
	private vblankActive = false;
	private vdpStatus = 0;
	private vdpWorkUnitsPerSec = 0;
	private geoWorkUnitsPerSec = 0;
	private _cpuHz: number;
	private imgDecBytesPerSec = 0;
	private dmaBytesPerSecIso = 0;
	private dmaBytesPerSecBulk = 0;
	private schedulerNowCycles = 0;
	private frameStartCycle = 0;
	private schedulerSliceActive = false;
	private activeSliceBaseCycle = 0;
	private activeSliceBudgetCycles = 0;
	private activeSliceTargetCycle = 0;
	private readonly timerDeadlines: number[] = [];
	private readonly timerKinds: number[] = [];
	private readonly timerPayloads: number[] = [];
	private readonly timerGenerations: number[] = [];
	private timerCount = 0;
	private vblankEnterTimerGeneration = 0;
	private vblankEndTimerGeneration = 0;
	private readonly deviceServiceTimerGeneration = new Uint32Array(DEVICE_SERVICE_KIND_COUNT);
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
	private readonly resourceUsageDetector: ResourceUsageDetector;
	private editorViewOptionsSnapshot: EditorViewOptionsSnapshot = null;
	public readonly dmaController: DmaController;
	public readonly geometryController: GeometryController;
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
		this.memory = options.memory;
		this.vdp = new VDP(
			this.memory,
			createVdpBlitterExecutor($.view.backend),
			() => this.currentSchedulerNowCycles(),
			(deadlineCycles) => this.scheduleDeviceService(DEVICE_SERVICE_VDP, deadlineCycles),
			() => this.cancelDeviceService(DEVICE_SERVICE_VDP),
		);
		this.stringHandles = new StringHandleTable(this.memory);
		this.runtimeStringPool = new StringPool(this.stringHandles);
		this.resetVdpIngressState();
		this.memory.writeValue(IO_SYS_BOOT_CART, 0);
		this.memory.writeValue(IO_SYS_CART_BOOTREADY, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		this.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
		this.memory.writeValue(IO_IRQ_FLAGS, 0);
		this.memory.writeValue(IO_IRQ_ACK, 0);
		this.memory.writeValue(IO_DMA_SRC, 0);
		this.memory.writeValue(IO_DMA_DST, 0);
		this.memory.writeValue(IO_DMA_LEN, 0);
		this.memory.writeValue(IO_DMA_CTRL, 0);
		this.memory.writeValue(IO_DMA_STATUS, 0);
		this.memory.writeValue(IO_DMA_WRITTEN, 0);
		this.memory.writeValue(IO_GEO_SRC0, 0);
		this.memory.writeValue(IO_GEO_SRC1, 0);
		this.memory.writeValue(IO_GEO_SRC2, 0);
		this.memory.writeValue(IO_GEO_DST0, 0);
		this.memory.writeValue(IO_GEO_DST1, 0);
		this.memory.writeValue(IO_GEO_COUNT, 0);
		this.memory.writeValue(IO_GEO_CMD, 0);
		this.memory.writeValue(IO_GEO_CTRL, 0);
		this.memory.writeValue(IO_GEO_STATUS, 0);
		this.memory.writeValue(IO_GEO_PARAM0, 0);
		this.memory.writeValue(IO_GEO_PARAM1, 0);
		this.memory.writeValue(IO_GEO_STRIDE0, 0);
		this.memory.writeValue(IO_GEO_STRIDE1, 0);
		this.memory.writeValue(IO_GEO_STRIDE2, 0);
		this.memory.writeValue(IO_GEO_PROCESSED, 0);
		this.memory.writeValue(IO_GEO_FAULT, 0);
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
		this.memory.setIoWriteHandler(this as IoWriteHandler);
		this.dmaController = new DmaController(
			this.memory,
			(mask) => this.signalIrq(mask),
			(src, byteLength) => this.sealVdpDmaTransfer(src, byteLength),
			() => this.currentSchedulerNowCycles(),
			(deadlineCycles) => this.scheduleDeviceService(DEVICE_SERVICE_DMA, deadlineCycles),
			() => this.cancelDeviceService(DEVICE_SERVICE_DMA),
		);
		this.imgDecController = new ImgDecController(
			this.memory,
			this.dmaController,
			(mask) => this.signalIrq(mask),
			() => this.currentSchedulerNowCycles(),
			(deadlineCycles) => this.scheduleDeviceService(DEVICE_SERVICE_IMG, deadlineCycles),
			() => this.cancelDeviceService(DEVICE_SERVICE_IMG),
		);
		this.geometryController = new GeometryController(
			this.memory,
			(mask) => this.signalIrq(mask),
			(deadlineCycles) => this.scheduleDeviceService(DEVICE_SERVICE_GEO, deadlineCycles),
			() => this.cancelDeviceService(DEVICE_SERVICE_GEO),
		);
		this.cpu = new CPU(this.memory, this.runtimeStringPool);
		this.resourceUsageDetector = new ResourceUsageDetector(
			this.memory,
			this.stringHandles,
			this.vdp,
		);
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
	public beginFrameState(advanceInputFrame: boolean = false): FrameState {
		if (this.currentFrameState) {
			throw runtimeFault('attempted to begin a new frame while another frame is active.');
		}
		clearHardwareLighting();
		this.frameDeltaMs = this.timing.frameDurationMs;
		if (advanceInputFrame) {
			Input.instance.beginFrame();
		}
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
		this.signalIrq(normalized);
	}

	private acknowledgeIrq(mask: number): void {
		const ack = mask >>> 0;
		if (ack === 0) {
			this.handlingIrqAckWrite = true;
			try {
				this.memory.writeValue(IO_IRQ_ACK, 0);
			} finally {
				this.handlingIrqAckWrite = false;
			}
			return;
		}
		let flags = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		flags &= ~ack;
		this.memory.writeValue(IO_IRQ_FLAGS, flags >>> 0);
		this.handlingIrqAckWrite = true;
		try {
			this.memory.writeValue(IO_IRQ_ACK, 0);
		} finally {
			this.handlingIrqAckWrite = false;
		}
	}

	private signalIrq(mask: number): void {
		const current = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		const next = (current | mask) >>> 0;
		this.memory.writeValue(IO_IRQ_FLAGS, next);
		if (next !== current) {
			this.irqSignalSequence += 1;
		}
	}

	public onIoWrite(addr: number, value: Value): void {
		if ((this.handlingVdpCommandWrite || this.handlingIrqAckWrite) || typeof value !== 'number') {
			return;
		}
		if (addr === IO_IRQ_ACK) {
			this.acknowledgeIrq(value >>> 0);
			return;
		}
		if (addr === IO_DMA_CTRL) {
			if ((value & DMA_CTRL_START) !== 0) {
				const dst = (this.memory.readValue(IO_DMA_DST) as number) >>> 0;
				if (dst === IO_VDP_FIFO && this.hasBlockedVdpSubmitPath()) {
					this.memory.writeValue(IO_DMA_CTRL, (value >>> 0) & ~DMA_CTRL_START);
					this.memory.writeValue(IO_DMA_WRITTEN, 0);
					this.memory.writeValue(IO_DMA_STATUS, DMA_STATUS_REJECTED);
					this.noteRejectedVdpSubmitAttempt();
					return;
				}
				this.dmaController.tryStartIo();
				this.syncVdpSubmitAttemptStatusFromDma(dst);
			}
			return;
		}
		if (addr === IO_IMG_CTRL) {
			if ((value & IMG_CTRL_START) !== 0) {
				this.imgDecController.onCtrlWrite(this.currentSchedulerNowCycles());
			}
			return;
		}
		if (addr === IO_GEO_CTRL) {
			if ((value & (GEO_CTRL_START | GEO_CTRL_ABORT)) !== 0) {
				this.geometryController.onCtrlWrite(this.currentSchedulerNowCycles());
			}
			return;
		}
		if (addr === IO_VDP_FIFO) {
			if (this.dmaController.hasPendingVdpSubmit() || (!this.hasOpenDirectVdpFifoIngress() && !this.vdp.canAcceptSubmittedFrame())) {
				this.noteRejectedVdpSubmitAttempt();
				return;
			}
			this.noteAcceptedVdpSubmitAttempt();
			this.pushVdpFifoWord(value >>> 0);
			return;
		}
		if (addr === IO_VDP_FIFO_CTRL) {
			if ((value & VDP_FIFO_CTRL_SEAL) === 0) {
				return;
			}
			if (this.dmaController.hasPendingVdpSubmit()) {
				this.noteRejectedVdpSubmitAttempt();
				return;
			}
			this.sealVdpFifoTransfer();
			this.refreshVdpSubmitBusyStatus();
			return;
		}
		if (addr === IO_PAYLOAD_ALLOC_ADDR || addr === IO_PAYLOAD_DATA_ADDR) {
			throw vdpFault('payload staging I/O is obsolete. Write payload words directly into the claimed VDP stream packet in RAM.');
		}
		if (addr === IO_VDP_CMD) {
			if (value === 0) {
				return;
			}
			if (this.hasBlockedVdpSubmitPath()) {
				this.noteRejectedVdpSubmitAttempt();
				return;
			}
			this.noteAcceptedVdpSubmitAttempt();
			this.handlingVdpCommandWrite = true;
			try {
				this.consumeDirectVdpCommand(value >>> 0);
			} finally {
				this.handlingVdpCommandWrite = false;
			}
			return;
		}
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
		if (this.tryCompleteTickOnActiveVblank(state)) {
			return true;
		}
		if (!this.haltIrqWaitArmed) {
			const pendingFlags = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
			if (pendingFlags !== 0) {
				this.cpu.clearHaltUntilIrq();
				return this.activeTickCompleted;
			}
			this.haltIrqSignalSequence = this.irqSignalSequence;
			this.haltIrqWaitArmed = true;
		}
		while (true) {
			if (this.irqSignalSequence !== this.haltIrqSignalSequence) {
				this.cpu.clearHaltUntilIrq();
				this.resetHaltIrqWait();
				return this.activeTickCompleted;
			}
			if (state.cycleBudgetRemaining > 0) {
				const cyclesToTarget = this.nextTimerDeadline() - this.schedulerNowCycles;
				if (cyclesToTarget <= 0) {
					this.runDueTimers();
					continue;
				}
				const idleCycles = cyclesToTarget < state.cycleBudgetRemaining ? cyclesToTarget : state.cycleBudgetRemaining;
				state.cycleBudgetRemaining -= idleCycles;
				this.advanceTime(idleCycles);
				if (this.tryCompleteTickOnActiveVblank(state)) {
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

	public getImagePixels(entry: AssetEntry): Uint8Array {
		if (entry.type !== 'image') {
			throw runtimeFault(`asset '${entry.id}' is not an image.`);
		}
		return this.memory.getImagePixels(entry);
	}

	public getAudioBytes(entry: AssetEntry): Uint8Array {
		if (entry.type !== 'audio') {
			throw runtimeFault(`asset '${entry.id}' is not audio.`);
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
		if (!this.memory.readValue(IO_SYS_BOOT_CART)) {
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
				const nextDeadline = this.nextTimerDeadline();
				if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
					const deadlineBudget = nextDeadline - this.schedulerNowCycles;
					if (deadlineBudget <= 0) {
						this.runDueTimers();
						continue;
					}
					if (deadlineBudget < sliceBudget) {
						sliceBudget = deadlineBudget;
					}
				}
				this.schedulerSliceActive = true;
				this.activeSliceBaseCycle = this.schedulerNowCycles;
				this.activeSliceBudgetCycles = sliceBudget;
				this.activeSliceTargetCycle = this.schedulerNowCycles + sliceBudget;
				const result = this.cpu.runUntilDepth(depth, sliceBudget);
				this.schedulerSliceActive = false;
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
