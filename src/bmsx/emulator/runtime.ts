import { $, calcCyclesPerFrameScaled } from '../core/engine_core';
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
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { AudioMeta, ImgMeta, Viewport, CartridgeIndex, RuntimeAssets, id2res } from '../rompack/rompack';
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
import { applyRuntimeAssetLayer, buildRuntimeAssetLayer, type RuntimeAssetLayer } from '../rompack/romloader';
import { decodeBinary, decodeuint8arr } from '../serializer/binencoder';
import { tokenKeyFromAsset, tokenKeyFromId } from '../util/asset_tokens';
import { createIdentifierCanonicalizer } from '../utils/identifier_canonicalizer';
import { parseWavInfo } from '../utils/wav';
import { clamp_fallback } from '../utils/clamp';
import { Api } from './api';
import { CPU, Table, OpCode, type Closure, type Value, type Program, type ProgramMetadata, RunResult, createNativeFunction, createNativeObject, isNativeFunction, isNativeObject, type NativeFunction, type NativeObject } from './cpu';
import { StringPool, StringValue, isStringValue, stringValueToString } from './string_pool';
import { StringHandleTable } from './string_memory';
import { formatNumber } from './number_format';
import { TerminalMode } from './terminal_mode';
import { RenderFacade } from './render_facade';
import { Font, type FontVariant } from './font';
import { createCartEditor, getSourceForChunk, type CartEditor, setExecutionStopHighlight, clearExecutionStopHighlights, } from './ide/cart_editor';
import { TERMINAL_TOGGLE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, EDITOR_TOGGLE_KEY, GAME_PAUSE_KEY } from './ide/constants';
import { clearNativeMemberCompletionCache } from './ide/intellisense';
import { type FaultSnapshot } from './ide/render/render_error_overlay';
import { type LuaSemanticModel, type FileSemanticData } from './ide/semantic_model';
import { setEditorCaseInsensitivity } from './ide/text_renderer';
import type { RuntimeErrorDetails } from './ide/types';
import { ENGINE_LUA_BUILTIN_FUNCTIONS, registerApiBuiltins, seedDefaultLuaBuiltins } from './lua_builtins';
import { seedLuaGlobals } from './lua_globals';
import { LuaFunctionRedirectCache } from './lua_handler_registry';
import { LuaEntrySnapshot, LuaJsBridge } from './lua_js_bridge';
import {
	buildErrorStackString,
	buildLuaFrameRawLabel,
	convertLuaCallFrames,
	parseJsStackFrames,
	sanitizeLuaErrorMessage
} from './runtime_error_util';
import { RuntimeStorage } from './storage';
import type { RuntimeOptions, RuntimeState, LuaBuiltinDescriptor, LuaMemberCompletion, LuaMarshalContext, SymbolEntry, SymbolKind } from './types';
import { getWorkspaceCachedSource } from './workspace_cache';
import { applyWorkspaceOverridesToCart } from './workspace';
import type { LuaSourceRecord, LuaSourceRegistry } from './lua_sources';
import { LuaDebuggerController, type LuaDebuggerSessionMetrics } from '../lua/luadebugger';
import { ide_state } from './ide/ide_state';
import { getBasePipelineSpecOverrideForIdeOrTerminal, ideExtSpec, terminalExtSpec, runtimeExtSpec } from './systems';
import type { ParsedLuaChunk } from './ide/lua_parse';
import { RenderSubmission } from '../render/backend/pipeline_interfaces';
import { Msx1Colors } from '../systems/msx';
import type { RectRenderSubmission } from '../render/shared/render_types';
import { compileLuaChunkToProgram, appendLuaChunkToProgram } from './program_compiler';
import { linkProgramAssets } from './program_linker';
import {
	IO_ARG0_OFFSET,
	IO_BUFFER_BASE,
	IO_COMMAND_STRIDE,
	IO_CMD_PRINT,
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
	IO_WRITE_PTR_ADDR,
	VDP_ATLAS_ID_NONE,
	VDP_RD_MODE_RGBA8888,
} from './io';
import { HandlerCache } from './handler_cache';
import { Memory, ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE, type AssetEntry } from './memory';
import { DmaController } from './devices/dma_controller';
import { ImgDecController } from './devices/imgdec_controller';
import {
	DEFAULT_RAM_SIZE,
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_ATLAS_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	STRING_HANDLE_ENTRY_SIZE,
	configureMemoryMap,
	type MemoryMapSpecs as MemoryMapSpecs,
} from './memory_map';
import { VDP } from './vdp';
import {
	buildModuleAliasMap,
	buildModuleAliasesFromPaths,
	buildModuleProtoMap,
	decodeProgramAsset,
	decodeProgramSymbolsAsset,
	inflateProgram,
	PROGRAM_ASSET_ID,
	PROGRAM_SYMBOLS_ASSET_ID,
	type ProgramAsset,
	type ProgramSymbolsAsset,
} from './program_asset';
import { INSTRUCTION_BYTES, readInstructionWord } from './instruction_format';

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

type FrameState = {
	haltGame: boolean;
	updateExecuted: boolean;
	luaFaulted: boolean;
	deltaSeconds: number;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
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
type ProgramSource = 'engine' | 'cart';

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

export class Runtime {
	private static _instance: Runtime = null;
	private static readonly ENGINE_BUILTIN_PRELUDE_PATH = '__engine_builtin_prelude__';
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
		'easing',
		'string',
		'os',
		'table',
		'coroutine',
		'debug',
		'package',
		'api',
		'peek',
		'poke',
		'sys_boot_cart',
		'sys_cart_bootready',
		'sys_cart_magic_addr',
		'sys_cart_magic',
		'sys_cart_rom_size',
		'sys_ram_size',
		'sys_max_assets',
		'sys_string_handle_count',
		'sys_max_cycles_per_frame',
		'sys_vdp_dither',
		'sys_vdp_primary_atlas_id',
		'sys_vdp_secondary_atlas_id',
		'sys_vdp_atlas_none',
		'sys_vdp_rd_surface',
		'sys_vdp_rd_x',
		'sys_vdp_rd_y',
		'sys_vdp_rd_mode',
		'sys_vdp_rd_status',
		'sys_vdp_rd_data',
		'sys_vdp_rd_mode_rgba8888',
		'sys_vdp_rd_status_ready',
		'sys_vdp_rd_status_overflow',
		'sys_irq_flags',
		'sys_irq_ack',
		'sys_dma_src',
		'sys_dma_dst',
		'sys_dma_len',
		'sys_dma_ctrl',
		'sys_dma_status',
		'sys_dma_written',
		'sys_img_src',
		'sys_img_len',
		'sys_img_dst',
		'sys_img_cap',
		'sys_img_ctrl',
		'sys_img_status',
		'sys_img_written',
		'sys_rom_system_base',
		'sys_rom_cart_base',
		'sys_rom_overlay_base',
		'sys_rom_overlay_size',
		'sys_vram_system_atlas_base',
		'sys_vram_primary_atlas_base',
		'sys_vram_secondary_atlas_base',
		'sys_vram_staging_base',
		'sys_vram_system_atlas_size',
		'sys_vram_primary_atlas_size',
		'sys_vram_secondary_atlas_size',
		'sys_vram_staging_size',
		'irq_dma_done',
		'irq_dma_error',
		'irq_img_done',
		'irq_img_error',
		'dma_ctrl_start',
		'dma_ctrl_strict',
		'dma_status_busy',
		'dma_status_done',
		'dma_status_error',
		'dma_status_clipped',
		'img_ctrl_start',
		'img_status_busy',
		'img_status_done',
		'img_status_error',
		'img_status_clipped',
	]);
	/**
	 * Preserved render queue when a fault occurs
	 * This is used to restore the render queue to its previous state
	 * so that the console mode can be drawn on top of it.
	 */
	private preservedRenderQueue: RenderSubmission[] = [];

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
		this.registerGlobal('sys_max_cycles_per_frame', value);
		this.resetTransferCarry();
	}

	public getLastTickSequence(): number {
		return this.lastTickSequence;
	}

	public getLastTickBudgetRemaining(): number {
		return this.lastTickBudgetRemaining;
	}

	public didLastTickComplete(): boolean {
		return this.lastTickCompleted;
	}

	public hasActiveTick(): boolean {
		return this.currentFrameState !== null || this.drawFrameState !== null;
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
		if (baseBudget !== this.cycleBudgetPerFrame) {
			this.cycleBudgetPerFrame = baseBudget;
			this.registerGlobal('sys_max_cycles_per_frame', baseBudget);
		}
		const totalBudget = baseBudget + carryBudget;
		this.advanceHardware(totalBudget);
		if (this.currentFrameState !== null) {
			this.currentFrameState.cycleBudgetRemaining += totalBudget;
			this.currentFrameState.cycleBudgetGranted += totalBudget;
			return;
		}
		if (this.drawFrameState !== null) {
			this.drawFrameState.cycleBudgetRemaining += totalBudget;
			this.drawFrameState.cycleBudgetGranted += totalBudget;
			return;
		}
		if (carryBudget !== 0) {
			this.pendingCarryBudget = carryBudget;
		}
	}

	private runWithBudget(state: FrameState): RunResult {
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = performance.now();
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		const result = this.cpu.run(state.cycleBudgetRemaining);
		const remaining = this.cpu.instructionBudgetRemaining;
		state.cycleBudgetRemaining = remaining;
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
	private _activeIdeFontVariant: FontVariant = EDITOR_FONT_VARIANT;
	public playerIndex: number;
	public tickEnabled: boolean = true;
	public editor!: CartEditor;
	private readonly overlayRenderBackend = new RenderFacade();
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
	private programInitClosure: Closure = null;
	private programNewGameClosure: Closure = null;
	private programUpdateClosure: Closure = null;
	private programDrawClosure: Closure = null;
	private programIrqClosure: Closure = null;
	private engineUpdateClosure: Closure = null;
	private engineDrawClosure: Closure = null;
	private engineResetClosure: Closure = null;
	private pendingCall: 'entry' | 'update' | 'draw' | 'engine_update' | 'engine_draw' | 'init' | 'new_game_reset' | 'new_game' | 'irq' = null;
	private pendingEntryLifecycle: { runInit: boolean; runNewGame: boolean } = null;
	private pendingLifecycleQueue: Array<'init' | 'new_game_reset' | 'new_game'> = [];
	private pendingProgramReload: { runInit?: boolean } = null;
	public get isDrawPending(): boolean {
		return this.pendingCall === 'entry'
			|| this.pendingCall === 'update'
			|| this.pendingCall === 'engine_update'
			|| this.pendingCall === 'init'
			|| this.pendingCall === 'new_game_reset'
			|| this.pendingCall === 'new_game'
			|| this.pendingCall === 'irq'
			|| this.pendingCall === 'draw'
			|| this.pendingCall === 'engine_draw'
			|| this.pendingLifecycleQueue.length > 0
			|| this.debuggerPaused
			|| this.luaRuntimeFailed
			|| this.faultSnapshot !== null;
	}

	private isUpdatePhasePending(): boolean {
		return this.pendingCall === 'entry'
			|| this.pendingCall === 'update'
			|| this.pendingCall === 'engine_update'
			|| this.pendingCall === 'init'
			|| this.pendingCall === 'new_game_reset'
			|| this.pendingCall === 'new_game'
			|| this.pendingCall === 'irq'
			|| this.pendingLifecycleQueue.length > 0;
	}
	private readonly memory: Memory;
	private readonly cpu: CPU;
	private readonly stringHandles: StringHandleTable;
	private readonly runtimeStringPool: StringPool;
	private programMetadata: ProgramMetadata | null = null;
	private consoleMetadata: ProgramMetadata | null = null;
	private _luaPath: string = null;
	public get currentPath(): string {
		return this._luaPath;
	}
	private luaInitialized = false;
	public get isInitialized(): boolean {
		return this.luaInitialized;
	}
	private luaRuntimeFailed = false;
	public get hasRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	public get cpuHz(): number {
		return this._cpuHz;
	}
	private setCpuHz(value: number): void {
		this._cpuHz = value;
		this.resetTransferCarry();
	}
	private setTransferRatesFromManifest(specs: { imgdec_bytes_per_sec: number; dma_bytes_per_sec_iso: number; dma_bytes_per_sec_bulk: number }): void {
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
	}
	private resetTransferCarry(): void {
		this.imgRate.resetCarry();
		this.dmaIsoRate.resetCarry();
		this.dmaBulkRate.resetCarry();
	}
	private includeJsStackTraces = false;
	private currentFrameState: FrameState = null;
	private drawFrameState: FrameState = null;
	private cycleBudgetPerFrame: number;
	private _cpuHz: number;
	private imgDecBytesPerSec = 0;
	private dmaBytesPerSecIso = 0;
	private dmaBytesPerSecBulk = 0;
	private readonly imgRate = new RateBudget();
	private readonly dmaIsoRate = new RateBudget();
	private readonly dmaBulkRate = new RateBudget();
	private lastTickSequence: number = 0;
	private lastTickBudgetRemaining: number = 0;
	private lastTickCompleted: boolean = false;
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
	private pendingLuaWarnings: string[] = [];
	private pendingCarryBudget: number = 0;
	private lastTickConsumedSequence: number = 0;
	public readonly moduleAliases: Map<string, string> = new Map();
	public readonly luaChunkEnvironmentsByPath: Map<string, LuaEnvironment> = new Map();
	private readonly luaGenericChunksExecuted: Set<string> = new Set();
	private readonly luaPatternRegexCache: Map<string, RegExp> = new Map();
	private readonly valueScratchPool: Value[][] = [];
	private readonly stringScratchPool: string[][] = [];
	public readonly luaFunctionRedirectCache = new LuaFunctionRedirectCache();
	// Wrap Lua closures with stable JS stubs so FSM/input/events can hold onto durable references even across hot-reload.
	private readonly luaHandlerCache = new LuaHandlerCache(
		(fn, thisArg, args) => this.invokeLuaHandler(fn, thisArg, args),
		(error, meta) => this.handleLuaHandlerError(error, meta),
	);
	private readonly closureHandlerCache = new HandlerCache(
		(fn, thisArg, args) => this.invokeClosureHandler(fn, thisArg, args),
		(error, meta) => this.handleClosureHandlerError(error, meta),
	);
	private readonly moduleProtos = new Map<string, number>();
	private readonly moduleCache = new Map<string, Value>();
	private readonly nativeObjectCache = new WeakMap<object, NativeObject>();
	private readonly nativeFunctionCache = new WeakMap<Function, NativeFunction>();
	private readonly nativeMemberCache = new WeakMap<object, Map<string, NativeFunction>>();
	private readonly tableIds = new WeakMap<Table, number>();
	private nextTableId = 1;
	private randomSeedValue = 0;
	public nativeMemberCompletionCache: WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }> = new WeakMap();
	public readonly pathSemanticCache: Map<string, { source: string; model: LuaSemanticModel; definitions: ReadonlyArray<LuaDefinitionInfo>; parsed?: ParsedLuaChunk; lines?: readonly string[]; analysis?: FileSemanticData }> = new Map();

	private readonly luaGate = taskGate.group('console:lua');
	private readonly assetMemoryGate = taskGate.group('asset:ram');
	private handledLuaErrors = new WeakSet<any>();
	private lastLuaCallStack: StackTraceFrame[] = [];
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
	private cartAssetLayer: RuntimeAssetLayer = null;
	private overlayAssetLayer: RuntimeAssetLayer = null;
	private readonly imageMetaByHandle = new Map<number, ImgMeta>();
	private readonly audioMetaByHandle = new Map<number, AudioMeta>();
	private readonly vdp: VDP;
	private readonly dmaController: DmaController;
	private readonly imgDecController: ImgDecController;
	private engineCanonicalization: CanonicalizationType = null;
	private cartCanonicalization: CanonicalizationType = null;
	private preparedCartProgram: {
		program: Program;
		metadata: ProgramMetadata;
		entryProtoIndex: number;
		moduleProtoMap: Map<string, number>;
		moduleAliases: Array<{ alias: string; path: string }>;
		entryPath: string;
		canonicalization: CanonicalizationType;
	} = null;
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
		const engineLuaSources = Runtime.buildLuaSources({
			cartSource: engineSource,
			assetSource: engineSource,
			index: engineLayer.index,
		});

		if (!cartridge) {
			$.set_asset_source(engineSource);
			$.set_inputmap(1, { keyboard: null, gamepad: null, pointer: null }); // Default input mapping for player 1 is required even with no cart to prevent errors

			$.set_lua_sources(engineLuaSources);
			const engineMemorySpecs = Runtime.resolveMemoryMapSpecs({
				manifest: engineLayer.index.manifest,
				engineManifest: engineLayer.index.manifest,
				engineSource,
				assetSource: engineSource,
				assets: engineLayer.assets,
			});
			configureMemoryMap(engineMemorySpecs);
			const enginePerfSpecs = getMachinePerfSpecs(engineLayer.index.manifest.machine);
			Runtime.applyUfpsScaled(enginePerfSpecs.ufps);
			const cpuHz = Runtime.resolveCpuHz(enginePerfSpecs.cpu_freq_hz);
			const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled);
			const memory = new Memory({
				engineRom: new Uint8Array(engineLayer.payload),
				cartRom: new Uint8Array(CART_ROM_HEADER_SIZE),
			});
			const runtime = Runtime.createInstance({
				playerIndex,
				canonicalization: engineLayer.index.manifest.machine.canonicalization,
				viewport: engineLayer.index.manifest.machine.viewport,
				memory,
				cpuHz,
				cycleBudgetPerFrame,
			});
			runtime.setTransferRatesFromManifest(enginePerfSpecs);
			runtime.configureProgramSources({
				engineSources: engineLuaSources,
				engineAssetSource: engineSource,
				engineCanonicalization: engineLayer.index.manifest.machine.canonicalization,
			});
			await runtime.buildAssetMemory({ source: engineSource, assets: $.assets });
			runtime.memory.sealEngineAssets();
			$.view.default_font = new Font();
			await runtime.vdp.uploadAtlasTextures();
			await $.refresh_audio_assets();
			await runtime.boot();
			$.start();
			return;
		}

		const cartLayer = await buildRuntimeAssetLayer({ blob: cartridge, id: 'cart' });
		const overlayBlob = $.workspace_overlay;
		const overlayLayer = overlayBlob ? await buildRuntimeAssetLayer({ blob: overlayBlob, id: 'overlay' }) : null;
		Runtime.applyLayerMetadata(cartLayer);
		if (overlayLayer) {
			Runtime.applyLayerMetadata(overlayLayer);
		}
		const layers = [];
		if (overlayLayer) {
			layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
		}
		layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
		layers.push({ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload });
		const assetSource = new AssetSourceStack(layers);
		$.set_asset_source(assetSource);

		const cartSource = new AssetSourceStack([{ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload }]);
		const cartLuaSources = Runtime.buildLuaSources({
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
		$.set_lua_sources(engineLuaSources);

		const sizingAssets = Runtime.cloneRuntimeAssets(engineLayer.assets);
		applyRuntimeAssetLayer(sizingAssets, cartLayer);
		if (overlayLayer) {
			applyRuntimeAssetLayer(sizingAssets, overlayLayer);
		}
		const memoryLimits = Runtime.resolveMemoryMapSpecs({
			manifest: cartLayer.index.manifest,
			engineManifest: engineLayer.index.manifest,
			engineSource,
			assetSource,
			assets: sizingAssets,
		});
		configureMemoryMap(memoryLimits);
		const cartPerfSpecs = getMachinePerfSpecs(cartLayer.index.manifest.machine);
		Runtime.applyUfpsScaled(cartPerfSpecs.ufps);
		const cpuHz = Runtime.resolveCpuHz(cartPerfSpecs.cpu_freq_hz);
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled);
		const memory = new Memory({
			engineRom: new Uint8Array(engineLayer.payload),
			cartRom: new Uint8Array(cartLayer.payload),
			overlayRom: overlayLayer ? new Uint8Array(overlayLayer.payload) : null,
		});
		const runtime = Runtime.createInstance({
			playerIndex,
			canonicalization: engineLayer.index.manifest.machine.canonicalization,
			viewport: cartLayer.index.manifest.machine.viewport,
			memory,
			cpuHz,
			cycleBudgetPerFrame,
		});
		runtime.setTransferRatesFromManifest(cartPerfSpecs);
		runtime.cartAssetLayer = cartLayer;
		runtime.overlayAssetLayer = overlayLayer;
		runtime.configureProgramSources({
			engineSources: engineLuaSources,
			cartSources: cartLuaSources,
			engineAssetSource: engineSource,
			cartAssetSource: cartSource,
			engineCanonicalization: engineLayer.index.manifest.machine.canonicalization,
			cartCanonicalization: cartLayer.index.manifest.machine.canonicalization,
		});
		await runtime.buildAssetMemory({ source: engineSource, assets: $.assets });
		runtime.memory.sealEngineAssets();
		$.view.default_font = new Font();
		await runtime.vdp.uploadAtlasTextures();
		await $.refresh_audio_assets();
		await runtime.boot();
		void runtime.prepareCartBoot();
		$.start();
	}

	private static buildLuaSources(params: { cartSource: RawAssetSource; assetSource: RawAssetSource; index: CartridgeIndex }): LuaSourceRegistry {
		const { cartSource, assetSource, index } = params;
		const registry: LuaSourceRegistry = {
			path2lua: {},
			entry_path: index.manifest.lua.entry_path,
			namespace: index.manifest.machine.namespace,
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
			const hasProgramAsset = index.assets.some(asset => asset.resid === PROGRAM_ASSET_ID);
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

	public static get instance(): Runtime {
		return Runtime._instance!;
	}

	public static destroy(): void {
		// No defense against multiple calls; let it throw if misused.
		Runtime._instance.dispose();
		Runtime._instance = null;
	}

	private static cloneRuntimeAssets(base: RuntimeAssets): RuntimeAssets {
		return {
			img: { ...base.img },
			audio: { ...base.audio },
			model: { ...base.model },
			data: { ...base.data },
			audioevents: { ...base.audioevents },
			project_root_path: base.project_root_path,
			canonicalization: base.canonicalization,
			manifest: base.manifest,
		};
	}

	private static collectAssetEntryIds(engineSource: RawAssetSource, assetSource: RawAssetSource, assets: RuntimeAssets): Set<string> {
		const ids = new Set<string>();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const engineAtlas = assets.img[tokenKeyFromId(engineAtlasId)];
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
				const asset = assets.img[tokenKeyFromAsset(entry)];
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

	private static computeAssetTableBytes(engineSource: RawAssetSource, assetSource: RawAssetSource, assets: RuntimeAssets): { bytes: number; entryCount: number; stringBytes: number } {
		const ids = this.collectAssetEntryIds(engineSource, assetSource, assets);
		const encoder = new TextEncoder();
		let stringBytes = 0;
		for (const id of ids) {
			stringBytes += encoder.encode(id).byteLength + 1;
		}
		const entryCount = ids.size;
		const bytes = ASSET_TABLE_HEADER_SIZE + (entryCount * ASSET_TABLE_ENTRY_SIZE) + stringBytes;
		return { bytes, entryCount, stringBytes };
	}

	private static resolveMemoryMapSpecs(params: {
		manifest: CartridgeIndex['manifest'];
		engineManifest: CartridgeIndex['manifest'];
		engineSource: RawAssetSource;
		assetSource: RawAssetSource;
		assets: RuntimeAssets;
	}): MemoryMapSpecs {
		const machineConfig = params.manifest.machine;
		const engineMachine = params.engineManifest.machine;
		const memorySpecs = getMachineMemorySpecs(machineConfig);
		const engineMemorySpecs = getMachineMemorySpecs(engineMachine);
		const stringHandleCount = memorySpecs.string_handle_count ?? DEFAULT_STRING_HANDLE_COUNT;
		const stringHeapBytes = memorySpecs.string_heap_bytes ?? DEFAULT_STRING_HEAP_SIZE;
		const atlasSlotBytes = memorySpecs.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE;
		const engineAtlasSlotBytes = engineMemorySpecs.engine_atlas_slot_bytes;
		if (engineAtlasSlotBytes === undefined) {
			throw new Error('[Runtime] machine.specs.vram.engine_atlas_slot_bytes is required in the engine manifest.');
		}
		if (!Number.isSafeInteger(engineAtlasSlotBytes) || engineAtlasSlotBytes <= 0) {
			throw new Error('[Runtime] machine.specs.vram.engine_atlas_slot_bytes must be a positive integer.');
		}
		const stagingBytes = memorySpecs.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
		const assetTableInfo = this.computeAssetTableBytes(params.engineSource, params.assetSource, params.assets);
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
		const defaultAssetDataBytes = DEFAULT_RAM_SIZE
			- (IO_REGION_SIZE + (stringHandleCount * STRING_HANDLE_ENTRY_SIZE) + stringHeapBytes + assetTableBytes);
		const assetDataBytes = memorySpecs.asset_data_bytes ?? defaultAssetDataBytes;
		if (!Number.isSafeInteger(assetDataBytes) || assetDataBytes < 0) {
			throw new Error(`[Runtime] machine.specs.ram.asset_data_bytes must be a non-negative integer (got ${assetDataBytes}).`);
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
			engine_atlas_slot_bytes: engineAtlasSlotBytes,
			staging_bytes: stagingBytes,
			skybox_face_size: skyboxFaceBytes === undefined ? skyboxFaceSize : memorySpecs.skybox_face_size,
			skybox_face_bytes: skyboxFaceBytes,
		};
	}

	private static applyLayerMetadata(layer: RuntimeAssetLayer): void {
		$.assets.project_root_path = layer.assets.project_root_path;
		$.assets.manifest = layer.assets.manifest;
		$.assets.canonicalization = layer.assets.canonicalization;
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

	private constructor(options: RuntimeOptions) {
		Runtime._instance = this;
		this.playerIndex = options.playerIndex;
		this.cycleBudgetPerFrame = options.cycleBudgetPerFrame;
		this.storageService = $.platform.storage;
		this.storage = new RuntimeStorage(this.storageService, $.lua_sources.namespace);
		const resolvedCanonicalization = options.canonicalization ?? 'none';
		this.applyCanonicalization(resolvedCanonicalization);
		this.engineLuaSources = $.lua_sources;
		this.engineCanonicalization = resolvedCanonicalization;
		this.cartCanonicalization = resolvedCanonicalization;
		this.luaJsBridge = new LuaJsBridge(this, this.luaHandlerCache);
		this.terminal = new TerminalMode(this);
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
		this.vdp.initializeRegisters();
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
		this.editor = createCartEditor(options.viewport);
		this.overlayResolutionMode = 'viewport';

		seedDefaultLuaBuiltins();
		this.flushLuaWarnings();
		this.registerRuntimeShortcuts();

		this.setDebuggerBreakpoints(ide_state.breakpoints);
		$.pipeline_ext = runtimeExtSpec; // Activate base runtime pipeline extensions by default (for ticking and drawing)
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
		if (this.lastLuaCallStack.length > 0) {
			const frame = this.lastLuaCallStack[0];
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

	private createLuaInterpreterForCanonicalization(canonicalization: CanonicalizationType): LuaInterpreter {
		const interpreter = new LuaInterpreter(this.luaJsBridge, canonicalization);
		this.configureInterpreter(interpreter);
		interpreter.attachDebugger(this.debuggerController);
		interpreter.clearLastFaultEnvironment();
		registerApiBuiltins(interpreter);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		return interpreter;
	}

	private assignInterpreter(interpreter: LuaInterpreter): void {
		this.luaInterpreter = interpreter;
		this.programInitClosure = null;
		this.programNewGameClosure = null;
		this.programUpdateClosure = null;
		this.programDrawClosure = null;
		this.programIrqClosure = null;
		this.engineResetClosure = null;
		this.consoleMetadata = null;
		this.pendingCall = null;
		this.pendingEntryLifecycle = null;
		this.pendingLifecycleQueue = [];
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
	}

	public get activeIdeFontVariant(): FontVariant {
		return this._activeIdeFontVariant;
	}

	public set activeIdeFontVariant(variant: FontVariant) {
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
			$.pipeline_ext = runtimeExtSpec; // Activate base runtime pipeline extensions
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

	private registerRuntimeShortcuts(): void {
		this.disposeShortcutHandlers();
		const registry = Input.instance.getGlobalShortcutRegistry();
		const disposers: Array<() => void> = [];
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, EDITOR_TOGGLE_KEY, () => this.toggleEditor()));
		disposers.push(registry.registerKeyboardShortcut(this.playerIndex, TERMINAL_TOGGLE_KEY, () => this.toggleTerminalMode()));
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
			ide_state.showWarningBanner(warning, 6.0);
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
			if (this.programMetadata && this.editor.isActive) {
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

	public async boot(): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'new_game' });
		try {
			this.clearActiveDebuggerPause();
			this.clearRuntimeFault();
			this.luaInitialized = false;
			this.invalidateModuleAliases();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();
			this.editor.clearRuntimeErrorOverlay();
			if (this.hasCompletedInitialBoot) { // Subsequent boot: reset to fresh world
				await $.reset_to_fresh_world();
				await this.vdp.uploadAtlasTextures();
				await $.refresh_audio_assets();
			}
			api.cartdata($.lua_sources.namespace);
			this.bootActiveProgram();
			this.hasCompletedInitialBoot = true;
		}
		catch (error) {
			throw new Error('[Runtime]: Failed to boot runtime: ' + error);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	// Frame state is owned by the runtime: it is created per-frame, kept intact for debugger inspection on faults,
	// and only cleared via finalize/abandon during explicit reboot/reset flows.
	private beginFrameState(): FrameState {
		if (this.currentFrameState || this.drawFrameState) {
			throw new Error('[Runtime] Attempted to begin a new frame while another frame is active.');
		}
		const deltaSeconds = $.deltatime_seconds; // Align with fixed-step update cadence to avoid over-counting when substepping
		const carryBudget = this.pendingCarryBudget;
		this.pendingCarryBudget = 0;
		const budget = this.cycleBudgetPerFrame + carryBudget;
		const state: FrameState = {
			haltGame: this.debuggerPaused,
			updateExecuted: false,
			luaFaulted: this.luaRuntimeFailed,
			deltaSeconds,
			cycleBudgetRemaining: budget,
			cycleBudgetGranted: budget,
			cycleCarryGranted: carryBudget,
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
		this.processPendingProgramReload();
		if (this.isOverlayActive()) {
			return;
		}
		if (this.currentFrameState !== null) {
			return;
		}
		if (this.drawFrameState !== null) {
			this.currentFrameState = this.drawFrameState;
			try {
				if (this.isUpdatePhasePending()) {
					this.runUpdatePhase(this.currentFrameState);
					this.vdp.flushAssetEdits();
				}
			} finally {
				this.drawFrameState = this.currentFrameState;
				this.abandonFrameState();
			}
			return;
		}
		this.runCartUpdateTick();
	}

	public tickDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (this.isOverlayActive()) {
			return;
		}
		if (!this.drawFrameState) {
			return;
		}
		this.currentFrameState = this.drawFrameState;
		try {
			this.vdp.commitViewSnapshot();
			this.drawGameFrame();
			const frameState = this.currentFrameState;
			if (this.pendingCall === null) {
				this.lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
				this.lastTickCompleted = true;
				this.lastTickSequence += 1;
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
				this.drawFrameState = null;
				this.abandonFrameState();
				return;
			}
			this.drawFrameState = frameState;
			this.abandonFrameState();
		} catch (error) {
			this.pendingCall = null;
			this.pendingLifecycleQueue.length = 0;
			this.pendingEntryLifecycle = null;
			this.drawFrameState = null;
			throw error;
		}
	}

	public tickTerminalMode(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingProgramReload();
		if (this.currentFrameState !== null || this.drawFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.terminal.update(state.deltaSeconds);
		this.vdp.flushAssetEdits();
		this.drawFrameState = state;
		this.abandonFrameState();
	}

	public tickTerminalModeDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (!this.drawFrameState) {
			return;
		}
		this.currentFrameState = this.drawFrameState;
		try {
			this.drawTerminal();
		} finally {
			this.drawFrameState = null;
			this.abandonFrameState();
		}
	}

	public tickIDE(): void {
		if (!this.tickEnabled) {
			return;
		}
		this.processPendingProgramReload();
		if (this.currentFrameState !== null || this.drawFrameState !== null) {
			return;
		}
		const state = this.beginFrameState();
		this.editor.update(state.deltaSeconds);
		this.vdp.flushAssetEdits();
		this.drawFrameState = state;
		this.abandonFrameState();
	}

	public tickIDEDraw(): void {
		if (!this.tickEnabled) {
			return;
		}
		if (!this.drawFrameState) {
			return;
		}
		this.currentFrameState = this.drawFrameState;
		try {
			this.drawIde();
		} finally {
			this.drawFrameState = null;
			this.abandonFrameState();
		}
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
			this.lastTickBudgetRemaining = 0;
			this.runUpdatePhase(state);
			this.vdp.flushAssetEdits();
		} catch (error) {
			fault = error;
			this.handleLuaError(error);
		} finally {
			if (fault === null) {
				this.drawFrameState = state;
			}
			if (this.currentFrameState !== null) {
				this.abandonFrameState();
			}
		}
	}

	private raiseIrqFlags(mask: number): void {
		const current = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		this.memory.writeValue(IO_IRQ_FLAGS, (current | mask) >>> 0);
	}

	private dispatchIrqFlags(state: FrameState): boolean {
		const ack = (this.memory.readValue(IO_IRQ_ACK) as number) >>> 0;
		let flags = (this.memory.readValue(IO_IRQ_FLAGS) as number) >>> 0;
		if (ack !== 0) {
			flags &= ~ack;
			this.memory.writeValue(IO_IRQ_FLAGS, flags);
			this.memory.writeValue(IO_IRQ_ACK, 0);
		}
		if (flags === 0) {
			return false;
		}
		this.cpu.call(this.programIrqClosure, [flags], 0);
		this.pendingCall = 'irq';
		const result = this.runWithBudget(state);
		this.processIo();
		if (result === RunResult.Halted) {
			this.pendingCall = null;
		}
		return this.pendingCall === 'irq';
	}

	private runUpdatePhase(state: FrameState): void {
		if (state.updateExecuted) {
			return;
		}
		if (!this.cartEntryAvailable) {
			state.updateExecuted = true;
			return;
		}
		if (!this.luaGate.ready) {
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
			if (this.pendingCall === 'entry') {
				const result = this.runWithBudget(state);
				this.processIo();
				if (result === RunResult.Halted) {
					this.pendingCall = null;
					this.bindLifecycleHandlers();
					const lifecycle = this.pendingEntryLifecycle;
					this.pendingEntryLifecycle = null;
					if (lifecycle) {
						this.queueLifecycleHandlers(lifecycle);
					}
				}
				state.updateExecuted = true;
				return;
			}
			if (this.pendingCall === 'irq') {
				const result = this.runWithBudget(state);
				this.processIo();
				if (result === RunResult.Halted) {
					this.pendingCall = null;
				}
				state.updateExecuted = true;
				return;
			}
			if (this.runLifecyclePhase(state)) {
				state.updateExecuted = true;
				return;
			}
			if (!this.pendingCall) {
				if (this.dispatchIrqFlags(state)) {
					state.updateExecuted = true;
					return;
				}
			}
			let shouldRunEngineUpdate = this.programUpdateClosure === null;
			if (this.pendingCall === 'engine_update') {
				const result = this.runWithBudget(state);
				this.processIo();
				if (result === RunResult.Halted) {
					this.pendingCall = null;
				}
				state.updateExecuted = true;
				return;
			}
			if (this.pendingCall && this.pendingCall !== 'update') {
				state.updateExecuted = true;
				return;
			}
			if (this.programUpdateClosure !== null) {
				if (!this.pendingCall) {
					this.cpu.call(this.programUpdateClosure, [state.deltaSeconds], 0);
					this.pendingCall = 'update';
				}
				const result = this.runWithBudget(state);
				this.processIo();
				if (result === RunResult.Halted) {
					this.pendingCall = null;
					shouldRunEngineUpdate = true;
				}
			}
			if (shouldRunEngineUpdate) {
				const deltaMs = state.deltaSeconds * 1000;
				this.cpu.call(this.engineUpdateClosure, [deltaMs], 0);
				this.pendingCall = 'engine_update';
				const result = this.runWithBudget(state);
				this.processIo();
				if (result === RunResult.Halted) {
					this.pendingCall = null;
				}
			}
		} catch (error) {
			if (isLuaDebuggerPauseSignal(error)) {
				this.onLuaDebuggerPause(error);
			} else {
				state.luaFaulted = true;
				this.pendingCall = null;
				this.pendingLifecycleQueue.length = 0;
				this.handleLuaError(error);
			}
		} finally {
			state.updateExecuted = !this.isUpdatePhasePending();
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
				api.abandonFrameCapture();
				this.drawBlueScreen();
				this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
				return;
			}
			if (this.luaGate.ready) {
				if (this.pendingCall === 'update'
					|| this.pendingCall === 'engine_update'
					|| this.pendingCall === 'entry'
					|| this.pendingCall === 'init'
					|| this.pendingCall === 'new_game_reset'
					|| this.pendingCall === 'new_game'
					|| this.pendingCall === 'irq'
					|| this.pendingLifecycleQueue.length > 0
					|| this.debuggerPaused
					|| this.luaRuntimeFailed
					|| this.faultSnapshot) {
					this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
				}
				else {
					try {
						const frameState = this.currentFrameState;
						if (!api.isFrameCaptureActive()) {
							api.beginFrameCapture();
						}
						if (this.pendingCall === 'engine_draw') {
							const result = this.runWithBudget(frameState);
							this.processIo();
							if (result === RunResult.Halted) {
								this.pendingCall = null;
							}
							if (!this.pendingCall) {
								api.commitFrameCapture();
								this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
							} else {
								this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
							}
							return;
						}
						let shouldRunEngineDraw = this.programDrawClosure === null;
						if (this.programDrawClosure !== null) {
							if (!this.pendingCall) {
								this.cpu.call(this.programDrawClosure, [], 0);
								this.pendingCall = 'draw';
							}
							const result = this.runWithBudget(frameState);
							this.processIo();
							if (result === RunResult.Halted) {
								this.pendingCall = null;
								shouldRunEngineDraw = true;
							}
						}
						if (shouldRunEngineDraw) {
							this.cpu.call(this.engineDrawClosure, [], 0);
							this.pendingCall = 'engine_draw';
							const result = this.runWithBudget(frameState);
							this.processIo();
							if (result === RunResult.Halted) {
								this.pendingCall = null;
							}
						}
						if (!this.pendingCall) {
							api.commitFrameCapture();
							this.preservedRenderQueue = this.overlayRenderBackend.captureCurrentFrameRenderQueue();
						} else {
							this.overlayRenderBackend.playbackRenderQueue(this.preservedRenderQueue);
						}
					} catch (error) {
						api.abandonFrameCapture();
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

	private isEngineProgramActive(): boolean {
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
		if (this.cartAssetSource.list('lua').length > 0) {
			this.preparedCartProgram = this.compileCartLuaProgramForBoot();
			this.setCartBootReadyFlag(true);
			return;
		}
		const programEntry = this.cartAssetSource.getEntry(PROGRAM_ASSET_ID);
		this.setCartBootReadyFlag(!!programEntry);
	}

	private async buildAssetMemory(params?: { source?: RawAssetSource; assets?: RuntimeAssets; mode?: 'full' | 'cart' }): Promise<void> {
		const token = this.assetMemoryGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		try {
			const mode = params?.mode ?? 'full';
			const assetSource = params?.source ?? $.asset_source;
			const assets = params?.assets ?? $.assets;
			if (!assetSource) {
				throw new Error('[Runtime] Asset source not configured.');
			}
			if (mode === 'cart') {
				this.memory.resetCartAssets();
			} else {
				this.memory.resetAssetMemory();
			}
			await this.vdp.registerImageAssets(assetSource, assets);
			this.registerAudioAssets(assetSource);
			this.rebuildAssetMetaCaches(assets);
			this.memory.finalizeAssetTable();
			this.memory.markAllAssetsDirty();
		} finally {
			this.assetMemoryGate.end(token);
		}
	}

	private registerAudioAssets(source: RawAssetSource): void {
		const entries = source.list('audio');
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (this.memory.hasAsset(entry.resid)) {
				continue;
			}
			if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
				throw new Error(`[Runtime] Audio asset '${entry.resid}' missing ROM buffer offsets.`);
			}
			const buffer = source.getBytesView(entry);
			const info = parseWavInfo(buffer);
			this.memory.registerAudioMeta({
				id: entry.resid,
				sampleRate: info.sampleRate,
				channels: info.channels,
				bitsPerSample: info.bitsPerSample,
				frames: info.frames,
				dataOffset: info.dataOffset,
				dataSize: info.dataLength,
			});
		}
	}

	private rebuildAssetMetaCaches(assets: RuntimeAssets): void {
		this.imageMetaByHandle.clear();
		this.audioMetaByHandle.clear();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const imgAssets = Object.values(assets.img);
		for (let index = 0; index < imgAssets.length; index += 1) {
			const asset = imgAssets[index]!;
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
		const audioAssets = Object.values(assets.audio);
		for (let index = 0; index < audioAssets.length; index += 1) {
			const asset = audioAssets[index]!;
			const meta = asset.audiometa;
			if (!meta) {
				throw new Error(`[Runtime] Audio asset '${asset.resid}' missing metadata.`);
			}
			const handle = this.resolveAssetHandle(asset.resid);
			this.audioMetaByHandle.set(handle, meta);
		}
	}

	private applyCartAssetLayers(): void {
		applyRuntimeAssetLayer($.assets, this.cartAssetLayer);
		if (this.overlayAssetLayer) {
			applyRuntimeAssetLayer($.assets, this.overlayAssetLayer);
		}
		const perfSpecs = getMachinePerfSpecs($.assets.manifest.machine);
		Runtime.applyUfpsScaled(perfSpecs.ufps);
		const cpuHz = Runtime.resolveCpuHz(perfSpecs.cpu_freq_hz);
		this.setCpuHz(cpuHz);
		this.setCycleBudgetPerFrame(calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled));
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
		if (this.currentFrameState || this.drawFrameState || this.pendingCall || this.pendingLifecycleQueue.length > 0) {
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
		if (this.currentFrameState || this.drawFrameState || this.pendingCall || this.pendingLifecycleQueue.length > 0) {
			return;
		}
		const options = this.pendingProgramReload;
		this.pendingProgramReload = null;
		this.reloadLuaProgramState({ runInit: options.runInit });
	}

	public dispose(): void {
		this.disposeShortcutHandlers();
		this.terminal.deactivate();
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

	public captureCurrentState(): RuntimeState {
		const storage = this.storage.dump();
		const stateSnapshot = this.captureRuntimeState();
		const atlasSlots = this.vdp.getAtlasSlotMapping();
		const skyboxFaceIds = this.vdp.getSkyboxFaceIds();
		const vdpDitherType = this.vdp.getDitherType();
		const state: RuntimeState = {
			luaRuntimeFailed: this.luaRuntimeFailed,
			luaPath: this._luaPath,
			storage,
			atlasSlots,
			skyboxFaceIds,
			vdpDitherType,
		};
		if (stateSnapshot) {
			if (stateSnapshot.globals) {
				state.luaGlobals = stateSnapshot.globals;
			}
			if (stateSnapshot.locals) {
				state.luaLocals = stateSnapshot.locals;
			}
			if (stateSnapshot.randomSeed !== undefined) {
				state.luaRandomSeed = stateSnapshot.randomSeed;
			}
			if (stateSnapshot.programCounter !== undefined) {
				state.luaProgramCounter = stateSnapshot.programCounter;
			}
		}
		return state;
	}

	public async applyState(state: RuntimeState) {
		if (!state) await this.resetRuntimeToFreshState();
		else this.restoreFromStateSnapshot(state);
	}

	private async resetRuntimeToFreshState() {
		const asset = $.lua_sources.path2lua[$.lua_sources.entry_path];
		this._luaPath = asset.source_path;
		this.luaInitialized = false;
		const mode = this.cartAssetLayer ? 'cart' : 'full';
		const preserveTextures = mode === 'cart';
		await this.buildAssetMemory({ mode });
		if (mode === 'full') {
			this.memory.sealEngineAssets();
		}
		await this.vdp.uploadAtlasTextures({ includeSystemAtlas: !preserveTextures });
		await $.refresh_audio_assets();
		await this.boot();
	}

	/**
	 * Restore from a snapshot captured via the `state` getter. This is a soft-resume that only restores Lua
	 * global/local state and storage; it does not reset the world or engine state.
	 * It is only used when the user hits "Resume" after a runtime error or debugger pause.
	 */
	private restoreFromStateSnapshot(snapshot: RuntimeState): void {
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

		api.cartdata($.lua_sources.namespace);
		if (snapshot.storage !== undefined) {
			this.storage.restore(snapshot.storage);
		}
		if (this.editor) {
			this.editor.clearRuntimeErrorOverlay();
		}

		this.luaRuntimeFailed = false;
		this.applyAssetMemorySnapshot(snapshot);
		// const shouldRunInit = snapshot.luaRuntimeFailed !== true;
		this.reinitializeLuaProgramFromSnapshot(snapshot, { runInit: false, hotReload: false });

		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private applyAssetMemorySnapshot(snapshot: RuntimeState): void {
		if (snapshot.assetMemory) {
			this.memory.restoreAssetMemory(snapshot.assetMemory);
			this.memory.rehydrateAssetEntriesFromTable();
		}
		if (snapshot.atlasSlots) {
			this.vdp.restoreAtlasSlotMapping(snapshot.atlasSlots);
		}
		if (snapshot.skyboxFaceIds !== undefined) {
			if (snapshot.skyboxFaceIds === null) {
				this.vdp.clearSkybox();
			} else {
				this.vdp.setSkyboxImages(snapshot.skyboxFaceIds);
			}
		}
		if (snapshot.vdpDitherType !== undefined) {
			this.vdp.setDitherType(snapshot.vdpDitherType);
		}
		this.vdp.flushAssetEdits();
	}

	public async resumeFromSnapshot(state: RuntimeState): Promise<void> {
		this.clearActiveDebuggerPause();
		if (!state) {
			this.luaRuntimeFailed = false;
			throw new Error('[Runtime] Cannot resume from invalid state snapshot.');
		}
		const snapshot: RuntimeState = { ...state, luaRuntimeFailed: false };
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
		this.applyAssetMemorySnapshot(snapshot);
		this.resumeLuaProgramState(snapshot);
		this.luaInitialized = true;
	}

	private hotReloadProgramEntry(params: { path: string; source: string; preserveEngineModules?: boolean }): void {
		const preserveRuntimeFailure = this.luaRuntimeFailed || (this.pauseCoordinator.hasSuspension() && this.pauseCoordinator.getPendingException() !== null);
		const binding = params.path;
		const baseMetadata = this.programMetadata;
		if (!baseMetadata) {
			throw new Error('[Runtime] Hot reload requires program symbols.');
		}
		const interpreter = this.luaInterpreter;
		interpreter.clearLastFaultEnvironment();
		const chunk = interpreter.compileChunk(params.source, binding);
		const { modules, modulePaths } = this.buildModuleChunks(binding);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, {
			baseProgram: this.cpu.getProgram(),
			baseMetadata,
			canonicalization: this._canonicalization,
		});
		this.moduleProtos.clear();
		for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
			this.moduleProtos.set(modulePath, protoIndex);
		}
		this.moduleAliases.clear();
		for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
			this.moduleAliases.set(entry.alias, entry.path);
		}
		if (params.preserveEngineModules) {
			this.clearCartModuleCacheForHotReload();
		} else {
			this.moduleCache.clear();
		}
		this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);
		const prelude = this.runEngineBuiltinPrelude(program, metadata);
		const finalizedMetadata = prelude.metadata;
		this.beginEntryExecution(entryProtoIndex);
		this.luaRuntimeFailed = preserveRuntimeFailure;
		this._luaPath = binding;
		this.programMetadata = finalizedMetadata;
		this.luaInitialized = true;
		clearNativeMemberCompletionCache();
		this.clearEditorErrorOverlaysIfNoFault();
	}

	private clearCartModuleCacheForHotReload(): void {
		for (const path of Array.from(this.moduleCache.keys())) {
			if (!this.engineLuaSources.path2lua[path]) {
				this.moduleCache.delete(path);
			}
		}
	}

	private bindLifecycleHandlers(): void {
		const globals = this.cpu.globals;
		this.programNewGameClosure = globals.get(this.canonicalKey('new_game')) as Closure;
		this.programInitClosure = globals.get(this.canonicalKey('init')) as Closure;
		this.programUpdateClosure = globals.get(this.canonicalKey('update')) as Closure;
		this.programDrawClosure = globals.get(this.canonicalKey('draw')) as Closure;
		this.programIrqClosure = globals.get(this.canonicalKey('irq')) as Closure;
		const engineModule = this.requireModule('engine') as Table;
		this.engineUpdateClosure = engineModule.get(this.canonicalKey('update')) as Closure;
		this.engineDrawClosure = engineModule.get(this.canonicalKey('draw')) as Closure;
		this.engineResetClosure = engineModule.get(this.canonicalKey('reset')) as Closure;
	}

	private beginEntryExecution(entryProtoIndex: number): void {
		this.resetFrameState();
		this.cpu.start(entryProtoIndex);
		this.pendingCall = 'entry';
		this.pendingLifecycleQueue = [];
		this.pendingEntryLifecycle = null;
	}

	private queueLifecycleHandlers(options: { runInit: boolean; runNewGame: boolean }): void {
		this.pendingLifecycleQueue = [];
		this.pendingEntryLifecycle = null;
		if (this.pendingCall === 'entry') {
			this.pendingEntryLifecycle = options;
			return;
		}
		if (options.runInit) {
			if (!this.programInitClosure) {
				throw new Error(`Runtime lifecycle handler 'init' is not defined.`);
			}
			this.pendingLifecycleQueue.push('init');
		}
		if (options.runNewGame) {
			if (!this.engineResetClosure) {
				throw new Error(`Runtime lifecycle handler 'engine.reset' is not defined.`);
			}
			if (!this.programNewGameClosure) {
				throw new Error(`Runtime lifecycle handler 'new_game' is not defined.`);
			}
			this.pendingLifecycleQueue.push('new_game_reset', 'new_game');
		}
		if (!this.pendingCall) {
			this.startNextLifecycleCall();
		}
	}

	private startNextLifecycleCall(): void {
		if (this.pendingCall) {
			return;
		}
		const next = this.pendingLifecycleQueue.shift();
		if (!next) {
			return;
		}
		if (next === 'init') {
			this.cpu.call(this.programInitClosure, [], 0);
			this.pendingCall = 'init';
			return;
		}
		if (next === 'new_game_reset') {
			this.cpu.call(this.engineResetClosure, [], 0);
			this.pendingCall = 'new_game_reset';
			return;
		}
		this.cpu.call(this.programNewGameClosure, [], 0);
		this.pendingCall = 'new_game';
	}

	private runLifecyclePhase(state: FrameState): boolean {
		const lifecyclePending = this.pendingCall === 'init'
			|| this.pendingCall === 'new_game_reset'
			|| this.pendingCall === 'new_game';
		if (!lifecyclePending && this.pendingLifecycleQueue.length === 0) {
			return false;
		}
		if (!lifecyclePending && this.pendingCall) {
			return false;
		}
		let ranLifecycle = false;
		while (true) {
			if (!this.pendingCall) {
				this.startNextLifecycleCall();
				if (!this.pendingCall) {
					break;
				}
			}
			ranLifecycle = true;
			const result = this.runWithBudget(state);
			this.processIo();
			if (result !== RunResult.Halted) {
				break;
			}
			this.pendingCall = null;
		}
		return ranLifecycle;
	}

	public reloadLuaProgramState(options: { runInit?: boolean; }): void {
		const runInit = options.runInit !== false;
		let binding = $.lua_sources.path2lua[$.lua_sources.entry_path] as LuaSourceRecord;
		if (!binding) {
			// This can happen if there is no Lua entry point defined in the cart. For example, when there is no cart loaded and the player still tried to write code and run it.
			// Luckily, this is not a fatal error as the description will point towards `res/bios/bootrom.lua`
			// binding =  { source_path: $.luaSources.entry_path, resid: $.luaSources.entry_path, type: 'lua', src: '', normalized_source_path: $.luaSources.entry_path, update_timestamp: $.platform.clock.dateNow(), base_src: '' };
			console.info(`[Runtime] No Lua entry point defined; cannot reload program. Please save the entry point and try again.`);
			return;
		}
		this._luaPath = binding.source_path;
		if (!this.luaInterpreter) {
			if (!this.bootLuaProgram()) {
				console.info(`[Runtime] Lua boot failed.`);
				return;
			}
		}
		else {
			this.hotReloadProgramEntry({ source: getSourceForChunk(binding.source_path), path: binding.source_path });
			if (runInit) {
				this.queueLifecycleHandlers({ runInit: true, runNewGame: true });
			}
		}
		this.luaInitialized = true;
	}

	private resumeLuaProgramState(snapshot: RuntimeState): void {
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
		this.queueLifecycleHandlers({ runInit: true, runNewGame: false });
		this.restoreRuntimeState(snapshot);
		if (savedRuntimeFailed) {
			this.luaRuntimeFailed = true;
		}
	}

	private reinitializeLuaProgramFromSnapshot(snapshot: RuntimeState, options: { runInit: boolean; hotReload: boolean }): void {
		const binding = $.lua_sources.path2lua[$.lua_sources.entry_path];
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
		const paths = Object.keys($.lua_sources.path2lua);
		for (let index = 0; index < paths.length; index += 1) {
			const moduleId = paths[index];
			if (resumeModuleId && moduleId === resumeModuleId) {
				continue;
			}
			this.refreshLuaHandlersForChunk(moduleId);
		}
	}

	private initializeLuaInterpreterFromSnapshot(params: { source: string; path: string; snapshot: RuntimeState; runInit: boolean; hotReload: boolean }): void {
		const snapshot = params.snapshot;
		const savedRuntimeFailed = snapshot.luaRuntimeFailed === true;
		const binding = $.lua_sources.path2lua[params.path];
		if (params.hotReload) {
			this.hotReloadProgramEntry({ source: params.source, path: binding.source_path, preserveEngineModules: !this.isEngineProgramActive() });
			if (params.runInit && !savedRuntimeFailed) {
				this.queueLifecycleHandlers({ runInit: true, runNewGame: true });
			}
			this.restoreRuntimeState(snapshot);
			if (savedRuntimeFailed) {
				this.luaRuntimeFailed = true;
			}
			return;
		}

		// Path not used right now, but might be useful for loading game state later
		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreter();
		this.assignInterpreter(interpreter);

		this.resetRuntimeState();
		const chunk = interpreter.compileChunk(params.source, binding.source_path);
		const { modules, modulePaths } = this.buildModuleChunks(binding.source_path);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(chunk, modules, { canonicalization: this._canonicalization });
		this.moduleProtos.clear();
		for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
			this.moduleProtos.set(modulePath, protoIndex);
		}
		this.moduleAliases.clear();
		for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
			this.moduleAliases.set(entry.alias, entry.path);
		}
		this.moduleCache.clear();
		this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);
		const prelude = this.runEngineBuiltinPrelude(program, metadata);
		this.programMetadata = prelude.metadata;
		this.beginEntryExecution(entryProtoIndex);
		this.luaInitialized = true;

		if (params.runInit && !savedRuntimeFailed) {
			this.queueLifecycleHandlers({ runInit: true, runNewGame: false });
		}
		this.restoreRuntimeState(snapshot);
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

	private captureRuntimeState(): { globals?: LuaEntrySnapshot; locals?: LuaEntrySnapshot; randomSeed?: number; programCounter?: number } {
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
				console.warn(`[Runtime] Skipped Lua snapshot entry '${name}':`, error);
			}
		}
		return count > 0 ? { root: snapshotRoot, objects: ctx.objects } : null;
	}

	private shouldSkipLuaSnapshotEntry(name: string, value: LuaValue): boolean {
		if (!name || this.apiFunctionNames.has(name)) {
			return true;
		}
		if (Runtime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
			return true;
		}
		if (isLuaFunctionValue(value)) {
			return true;
		}
		return false;
	}

	private restoreRuntimeState(snapshot: RuntimeState): void {
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
			if (!name || this.apiFunctionNames.has(name) || Runtime.LUA_SNAPSHOT_EXCLUDED_GLOBALS.has(name)) {
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
					console.warn(`[Runtime] Failed to restore Lua global '${name}':`, error);
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
					console.warn(`[Runtime] Failed to restore Lua local '${name}':`, error);
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

	private resetRuntimeState(): void {
		this.resetFrameState();
		this.pendingCall = null;
		this.pendingEntryLifecycle = null;
		this.pendingLifecycleQueue = [];
		this.pendingCartBoot = false;
		this.resetHardwareState();
		this.programInitClosure = null;
		this.programNewGameClosure = null;
		this.programUpdateClosure = null;
		this.programDrawClosure = null;
		this.programIrqClosure = null;
		this.engineResetClosure = null;
		this.cpu.globals.clear();
		this.moduleCache.clear();
		this.moduleProtos.clear();
		this.seedGlobals();
	}

	private resetFrameState(): void {
		this.currentFrameState = null;
		this.drawFrameState = null;
		this.pendingCarryBudget = 0;
		this.lastTickCompleted = false;
		this.lastTickBudgetRemaining = 0;
		this.lastTickSequence = 0;
		this.lastTickConsumedSequence = 0;
	}

	private resetHardwareState(): void {
		this.memory.writeValue(IO_IRQ_FLAGS, 0);
		this.memory.writeValue(IO_IRQ_ACK, 0);
		this.dmaController.reset();
		this.imgDecController.reset();
	}

	private registerGlobal(name: string, value: Value): void {
		const key = this.canonicalKey(name);
		this.cpu.globals.set(key, value);
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
		const chunk = interpreter.compileChunk(source, Runtime.ENGINE_BUILTIN_PRELUDE_PATH);
		interpreter.setReservedIdentifiers(this.apiFunctionNames);
		const compiled = appendLuaChunkToProgram(program, metadata, chunk, { canonicalization: this._canonicalization });
		this.cpu.setProgram(compiled.program, compiled.metadata);
		this.programMetadata = compiled.metadata;
		this.callClosure({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
		this.processIo();
		return { program: compiled.program, metadata: compiled.metadata };
	}

	private applyEngineBuiltinGlobals(): void {
		const engine = this.requireModule('engine') as Table;
		for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
			const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
			const member = engine.get(this.canonicalKey(name)) as Closure;
			this.registerGlobal(name, member);
		}
	}

	private seedGlobals(): void {
		seedLuaGlobals({
			api,
			registerGlobal: (name, value) => this.registerGlobal(name, value),
			internString: (value) => this.internString(value),
			requireString: (value) => this.requireString(value),
			valueToString: (value) => this.valueToString(value),
			valueToStringValue: (value) => this.valueToStringValue(value),
			formatValue: (value) => this.formatValue(value),
			formatLuaString: (template, args, startIndex) => this.formatLuaString(template, args, startIndex),
			createApiRuntimeError: (message) => this.createApiRuntimeError(message),
			buildLuaStackFrames: () => this.buildLuaStackFrames(),
			callClosure: (callee, args) => this.callClosure(callee, args),
			nextRandom: () => this.nextRandom(),
			setRandomSeed: (seed) => {
				this.randomSeedValue = seed;
			},
			cpu: this.cpu,
			memory: this.memory,
			terminal: this.terminal,
			cycleBudgetPerFrame: this.cycleBudgetPerFrame,
			luaPatternRegexCache: this.luaPatternRegexCache,
			acquireValueScratch: () => this.acquireValueScratch(),
			releaseValueScratch: (values) => this.releaseValueScratch(values),
			acquireStringScratch: () => this.acquireStringScratch(),
			releaseStringScratch: (values) => this.releaseStringScratch(values),
			buildMarshalContext: () => this.buildMarshalContext(),
			extendMarshalContext: (ctx, segment) => this.extendMarshalContext(ctx, segment),
			describeMarshalSegment: (key) => this.describeMarshalSegment(key),
			getOrAssignTableId: (table) => this.getOrAssignTableId(table),
			toNativeValue: (value, ctx, visited) => this.toNativeValue(value, ctx, visited),
			toRuntimeValue: (value) => this.toRuntimeValue(value),
			getOrCreateNativeObject: (value) => this.getOrCreateNativeObject(value),
			getOrCreateAssetsNativeObject: () => this.getOrCreateAssetsNativeObject(),
			nextNativeEntry: (target, key) => this.nextNativeEntry(target, key),
			requireModule: (name) => this.requireModule(name),
			wrapNativeResult: (result, out) => this.wrapNativeResult(result, out),
		});
	}

	private nextRandom(): number {
		this.randomSeedValue = (this.randomSeedValue * 1664525 + 1013904223) % 4294967296;
		return this.randomSeedValue / 4294967296;
	}

	private valueToString(value: Value): string {
		if (value === null) {
			return 'nil';
		}
		if (typeof value === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) {
				return Number.isNaN(value) ? 'nan' : (value < 0 ? '-inf' : 'inf');
			}
			// Parity with C++ runtime string output (Lua tostring semantics).
			// Slower than V8's native formatting; avoid tight-loop conversions.
			return formatNumber(value);
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

	private describeSymbolValue(value: Value): { kind: SymbolKind; valueType: string } {
		if (value === null) {
			return { kind: 'constant', valueType: 'nil' };
		}
		if (typeof value === 'boolean') {
			return { kind: 'constant', valueType: 'boolean' };
		}
		if (typeof value === 'number') {
			return { kind: 'constant', valueType: 'number' };
		}
		if (isStringValue(value)) {
			return { kind: 'constant', valueType: 'string' };
		}
		if (value instanceof Table) {
			return { kind: 'table', valueType: 'table' };
		}
		if (isNativeFunction(value)) {
			return { kind: 'function', valueType: 'native_function' };
		}
		if (isNativeObject(value)) {
			return { kind: 'table', valueType: 'native_object' };
		}
		return { kind: 'function', valueType: 'function' };
	}

	public listSymbols(): SymbolEntry[] {
		const entries = this.cpu.globals.entriesArray();
		const symbols: SymbolEntry[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const key = entry[0];
			if (!isStringValue(key)) {
				continue;
			}
			const name = stringValueToString(key);
			const classification = this.describeSymbolValue(entry[1]);
			symbols.push({
				name,
				kind: classification.kind,
				valueType: classification.valueType,
				origin: 'global',
			});
		}
		return symbols;
	}

	private requireString(value: Value): string {
		return stringValueToString(value as StringValue);
	}

	public formatValue(value: Value): string {
		return this.valueToString(value);
	}

	private formatLuaString(template: string, args: ReadonlyArray<Value>, argStart: number): string {
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
					let text = value === null ? 'nil' : this.valueToString(value);
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
					const raw = value === null ? 'nil' : this.valueToString(value);
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

	private processIo(): void {
		const memory = this.memory;
		this.vdp.syncRegisters();
		const count = memory.readValue(IO_WRITE_PTR_ADDR) as number;
		if (!count) {
			return;
		}
		const base = IO_BUFFER_BASE;
		for (let index = 0; index < count; index += 1) {
			const cmdBase = base + index * IO_COMMAND_STRIDE;
			const cmd = memory.readValue(cmdBase) as number;
			switch (cmd) {
				case IO_CMD_PRINT: {
					const arg = memory.readValue(cmdBase + IO_ARG0_OFFSET);
					const text = this.formatValue(arg);
					this.terminal.appendStdout(text);
					break;
				}
				default:
					throw new Error(`Unknown IO command: ${cmd}.`);
			}
		}
		memory.writeValue(IO_WRITE_PTR_ADDR, 0);
	}

	private logDebugState(): void {
		if (!this.cpu.hasFrames()) {
			return;
		}
		const debug = this.cpu.getDebugState();
		const instr = debug.instr;
		const program = this.cpu.getProgram();
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		const wordIndex = debug.pc / INSTRUCTION_BYTES;
		if (wordIndex > 0) {
			const previous = readInstructionWord(program.code, wordIndex - 1);
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
		console.info(`[Runtime] debug: pc=${debug.pc} op=${op} a=${a} b=${b} c=${c} ra=${this.formatValue(ra)} rb=${this.formatValue(rb)} rc=${this.formatValue(rc)}`);
	}

	private buildLuaStackFrames(): StackTraceFrame[] {
		const callStack = this.cpu.getCallStack();
		const frames: StackTraceFrame[] = [];
		for (let index = callStack.length - 1; index >= 0; index -= 1) {
			const entry = callStack[index];
			const range = this.cpu.getDebugRange(entry.pc);
			const source = range ? range.path : this._luaPath;
			const line = range ? range.start.line : null;
			const column = range ? range.start.column : null;
			const functionName = this.resolveLuaFunctionName(entry.protoIndex);
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

	private resolveLuaFunctionName(protoIndex: number): string {
		if (!this.programMetadata) {
			return `proto:${protoIndex}`;
		}
		const protoId = this.programMetadata.protoIds[protoIndex];
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
			throw new Error('[Runtime] Program asset source not configured.');
		}
		return source;
	}

	private hasLuaAssets(): boolean {
		const source = this.resolveProgramAssetSource();
		return source.list('lua').length > 0;
	}

	private shouldBootLuaProgramFromSources(): boolean {
		return this.hasLuaAssets();
	}

	private resolveProgramAssetSourceFor(source: ProgramSource): RawAssetSource {
		if (source === 'engine') {
			if (!this.engineAssetSource) {
				throw new Error('[Runtime] Engine asset source is not configured.');
			}
			return this.engineAssetSource;
		}
		if (!this.cartAssetSource) {
			throw new Error('[Runtime] Cart asset source is not configured.');
		}
		return this.cartAssetSource;
	}

	private loadProgramAssetsForSource(source: ProgramSource): { program: ProgramAsset; symbols: ProgramSymbolsAsset | null } {
		const assetSource = this.resolveProgramAssetSourceFor(source);
		const programEntry = assetSource.getEntry(PROGRAM_ASSET_ID);
		if (!programEntry) {
			throw new Error('[Runtime] Program asset not found.');
		}
		const program = decodeProgramAsset(assetSource.getBytes(programEntry));
		const symbolsEntry = assetSource.getEntry(PROGRAM_SYMBOLS_ASSET_ID);
		const symbols = symbolsEntry ? decodeProgramSymbolsAsset(assetSource.getBytes(symbolsEntry)) : null;
		return { program, symbols };
	}

	private loadProgramAssets(): { program: ProgramAsset; symbols: ProgramSymbolsAsset | null } {
		const source = this.isEngineProgramActive() ? 'engine' : 'cart';
		return this.loadProgramAssetsForSource(source);
	}

	private buildModuleChunks(entryPath: string, registries?: LuaSourceRegistry[]): { modules: Array<{ path: string; chunk: LuaChunk }>; modulePaths: string[] } {
		const entryAsset = this.resolveLuaSourceRecord(entryPath);
		const entryKey = entryAsset ? (entryAsset.normalized_source_path ?? entryAsset.source_path ?? entryPath) : entryPath;
		const modules: Array<{ path: string; chunk: LuaChunk }> = [];
		const modulePaths: string[] = [];
		const seen = new Set<string>();
		const resolvedRegistries = registries ?? this.resolveModuleRegistries();
		for (const registry of resolvedRegistries) {
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

	private buildModuleChunksForInterpreter(
		entryPath: string,
		interpreter: LuaInterpreter,
		registries?: LuaSourceRegistry[],
	): { modules: Array<{ path: string; chunk: LuaChunk }>; modulePaths: string[] } {
		const entryAsset = this.resolveLuaSourceRecord(entryPath);
		const entryKey = entryAsset ? (entryAsset.normalized_source_path ?? entryAsset.source_path ?? entryPath) : entryPath;
		const modules: Array<{ path: string; chunk: LuaChunk }> = [];
		const modulePaths: string[] = [];
		const seen = new Set<string>();
		const resolvedRegistries = registries ?? this.resolveModuleRegistries();
		for (const registry of resolvedRegistries) {
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
				const chunk = interpreter.compileChunk(source, asset.source_path);
				modules.push({ path: key, chunk });
			}
		}
		return { modules, modulePaths };
	}

	private compileCartLuaProgramForBoot(): {
		program: Program;
		metadata: ProgramMetadata;
		entryProtoIndex: number;
		moduleProtoMap: Map<string, number>;
		moduleAliases: Array<{ alias: string; path: string }>;
		entryPath: string;
		canonicalization: CanonicalizationType;
	} {
		const entryAsset = this.cartLuaSources.path2lua[this.cartLuaSources.entry_path];
		if (!entryAsset) {
			throw new Error('[Runtime] Cannot prepare cart boot: entry Lua source is missing.');
		}
		const entryPath = entryAsset.source_path;
		const entrySource = this.resourceSourceForChunk(entryPath);
		const interpreter = this.createLuaInterpreterForCanonicalization(this.cartCanonicalization);
		const entryChunk = interpreter.compileChunk(entrySource, entryPath);
		const { modules, modulePaths } = this.buildModuleChunksForInterpreter(entryPath, interpreter, [this.cartLuaSources, this.engineLuaSources]);
		const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, { canonicalization: this.cartCanonicalization });
		return {
			program,
			metadata,
			entryProtoIndex,
			moduleProtoMap,
			moduleAliases: buildModuleAliasesFromPaths(modulePaths),
			entryPath,
			canonicalization: this.cartCanonicalization,
		};
	}

	private bootProgramAsset(options?: { preserveState?: boolean; runInit?: boolean }): boolean {
		const { program, symbols } = this.loadProgramAssets();
		const engineActive = this.isEngineProgramActive();
		const engineAssets = engineActive ? null : this.loadProgramAssetsForSource('engine');
		const linked = engineAssets ? linkProgramAssets(engineAssets.program, engineAssets.symbols, program, symbols) : null;
		const programAsset = linked ? linked.programAsset : program;
		const metadata = linked ? linked.metadata : (symbols ? symbols.metadata : null);
		this.cartEntryAvailable = true;
		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreter();
		this.assignInterpreter(interpreter);

		this._luaPath = $.lua_sources.entry_path;
		if (!options?.preserveState) {
			this.resetRuntimeState();
		}

		const protoMap = buildModuleProtoMap(programAsset.moduleProtos);
		this.moduleProtos.clear();
		for (const [path, protoIndex] of protoMap.entries()) {
			this.moduleProtos.set(path, protoIndex);
		}
		const aliasMap = buildModuleAliasMap(programAsset.moduleAliases);
		this.moduleAliases.clear();
		for (const [alias, path] of aliasMap.entries()) {
			this.moduleAliases.set(alias, path);
		}
		this.moduleCache.clear();
		this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);

		const inflated = inflateProgram(programAsset.program);
		try {
			this.cpu.setProgram(inflated, metadata);
			this.programMetadata = metadata;
			this.applyEngineBuiltinGlobals();
			this.processIo();

			this.beginEntryExecution(programAsset.entryProtoIndex);
			this.luaInitialized = true;

			if (options?.runInit === false) {
				return true;
			}
			this.queueLifecycleHandlers({ runInit: true, runNewGame: true });
			return true;
		} catch (error) {
			console.info(`[Runtime] Program-asset boot failed.`);
			this.logDebugState();
			throw error;
		}
	}

	private bootPreparedCartProgram(options?: { preserveState?: boolean; runInit?: boolean }): boolean {
		const prepared = this.preparedCartProgram;
		this.cartEntryAvailable = true;
		this.resetLuaInteroperabilityState();
		const interpreter = this.createLuaInterpreterForCanonicalization(prepared.canonicalization);
		this.assignInterpreter(interpreter);

		this._luaPath = prepared.entryPath;
		if (!options?.preserveState) {
			this.resetRuntimeState();
		}

		this.moduleProtos.clear();
		for (const [modulePath, protoIndex] of prepared.moduleProtoMap.entries()) {
			this.moduleProtos.set(modulePath, protoIndex);
		}
		this.moduleAliases.clear();
		for (const entry of prepared.moduleAliases) {
			this.moduleAliases.set(entry.alias, entry.path);
		}
		this.moduleCache.clear();
		this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);
		const prelude = this.runEngineBuiltinPrelude(prepared.program, prepared.metadata);
		this.programMetadata = prelude.metadata;
		this.beginEntryExecution(prepared.entryProtoIndex);
		this.luaInitialized = true;

		if (options?.runInit === false) {
			return true;
		}
		this.queueLifecycleHandlers({ runInit: true, runNewGame: true });
		return true;
	}

	private bootActiveProgram(options?: { preserveState?: boolean; runInit?: boolean }): boolean {
		const ok = this.shouldBootLuaProgramFromSources()
			? this.bootLuaProgram({ preserveState: options?.preserveState })
			: this.bootProgramAsset(options);
		if (!this.programMetadata && this.editor.isActive) {
			this.deactivateEditor();
		}
		return ok;
	}

	private bootLuaProgram(options?: { preserveState?: boolean; sourceOverride?: { path: string; source: string } }): boolean {
		const entryAsset = $.lua_sources.path2lua[$.lua_sources.entry_path];
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
			throw new Error('[Runtime] Cannot boot Lua program: entry asset has no path name.');
		}

		this._luaPath = path;
		if (!options?.preserveState) {
			this.resetRuntimeState();
		}

		try {
			const entryPath = options?.sourceOverride?.path ?? path;
			const entrySource = options?.sourceOverride?.source ?? this.resourceSourceForChunk(entryPath);
			const entryChunk = interpreter.compileChunk(entrySource, entryPath);
			const { modules, modulePaths } = this.buildModuleChunks(entryPath);
			const { program, metadata, entryProtoIndex, moduleProtoMap } = compileLuaChunkToProgram(entryChunk, modules, { canonicalization: this._canonicalization });
			this.moduleProtos.clear();
			for (const [modulePath, protoIndex] of moduleProtoMap.entries()) {
				this.moduleProtos.set(modulePath, protoIndex);
			}
			this.moduleAliases.clear();
			for (const entry of buildModuleAliasesFromPaths(modulePaths)) {
				this.moduleAliases.set(entry.alias, entry.path);
			}
			this.moduleCache.clear();
			this.memory.writeValue(IO_WRITE_PTR_ADDR, 0);
			const prelude = this.runEngineBuiltinPrelude(program, metadata);
			this.programMetadata = prelude.metadata;
			this.beginEntryExecution(entryProtoIndex);
			this.luaInitialized = true;
		}
		catch (error) {
			console.info(`[Runtime] Lua boot '${path}' failed.`);
			this.logDebugState();
			this.handleLuaError(error);
			return false;
		}

		this.queueLifecycleHandlers({ runInit: true, runNewGame: true });
		return true;
	}

	public async reloadProgramAndResetWorld(options?: { runInit?: boolean; }): Promise<void> {
		const gateToken = this.luaGate.begin({ blocking: true, tag: 'reload_and_reset' });
		try {
			const preservingSuspension = this.pauseCoordinator.hasSuspension();
			if (!preservingSuspension) {
				this.pauseCoordinator.clearSuspension();
				this.setDebuggerPaused(false);
				this.clearRuntimeFault();
			}
			this.luaInitialized = false;

			// Full reboot starts from a clean Lua path environment cache to avoid merging
			// stale per-path tables (from previously loaded modules) into the fresh program.
			this.luaChunkEnvironmentsByPath.clear();
			this.luaGenericChunksExecuted.clear();

			// Reload the active program source and reset the world
			this.applyCartAssetLayers();
			const mode = this.cartAssetLayer ? 'cart' : 'full';
			await this.buildAssetMemory({ mode });
			if (mode === 'full') {
				this.memory.sealEngineAssets();
			}
			const preserveTextures = mode === 'cart';
			await $.reset_to_fresh_world({ preserve_textures: preserveTextures });
			await this.vdp.uploadAtlasTextures({ includeSystemAtlas: !preserveTextures });
			await $.refresh_audio_assets();
			try {
				this.resetRuntimeState();
				if (this.shouldBootLuaProgramFromSources()) {
					if (this.preparedCartProgram) {
						this.bootPreparedCartProgram({ runInit: options?.runInit !== false });
						this.preparedCartProgram = null;
					} else {
						this.reloadLuaProgramState({ runInit: options?.runInit !== false });
					}
				} else {
					this.bootProgramAsset({ preserveState: true, runInit: options?.runInit });
					if (!this.programMetadata && this.editor.isActive) {
						this.deactivateEditor();
					}
				}
			} catch (error) {
				this.handleLuaError(error);
			}
			const manifest = this.cartAssetLayer
				? this.cartAssetLayer.index.manifest
				: $.engine_layer.index.manifest;
			const perfSpecs = getMachinePerfSpecs(manifest.machine);
			Runtime.applyUfpsScaled(perfSpecs.ufps);
			const cpuHz = Runtime.resolveCpuHz(perfSpecs.cpu_freq_hz);
			this.setCpuHz(cpuHz);
			this.setCycleBudgetPerFrame(calcCyclesPerFrameScaled(cpuHz, $.ufps_scaled));
			this.setTransferRatesFromManifest(perfSpecs);
		}
		finally {
			this.luaGate.end(gateToken);
		}
	}

	public handleLuaError(whatever: unknown): void {
		const error = convertToError(whatever);
		// Pause signal has its own handler
		if (isLuaDebuggerPauseSignal(error)) {
			console.info('[Runtime] Lua debugger pause signal received: ', error);
			this.onLuaDebuggerPause(error);
			return;
		}

		// Avoid handling the same Error object repeatedly
		if (this.handledLuaErrors.has(error)) {
			return;
		}
		this.logDebugState();
		this.lastLuaCallStack = this.buildLuaStackFrames();

		// Extract message and location info
		const message = sanitizeLuaErrorMessage(extractErrorMessage(error));
		const { line, column, path } = this.extractErrorLocation(error);

		const innermostFrame = this.lastLuaCallStack.length > 0 ? this.lastLuaCallStack[0] : null;
		const resolvedPath = innermostFrame ? innermostFrame.source : (path ?? this._luaPath);
		const resolvedLine = innermostFrame ? innermostFrame.line : line;
		const resolvedColumn = innermostFrame ? innermostFrame.column : column;
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
		} else if (this.lastLuaCallStack.length > 0) {
			luaFrames = this.lastLuaCallStack.slice();
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
		const projectRootPath = this.isEngineProgramActive()
			? $.engine_layer.index.projectRootPath
			: $.assets.project_root_path;
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

	private internString(value: string): StringValue {
		return this.cpu.getStringPool().intern(value);
	}

	private canonicalKey(name: string): StringValue {
		return this.internString(this.canonicalizeIdentifier(name));
	}

	private valueToStringValue(value: Value): StringValue {
		return this.internString(this.valueToString(value));
	}

	private acquireValueScratch(): Value[] {
		const pool = this.valueScratchPool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	private releaseValueScratch(values: Value[]): void {
		values.length = 0;
		if (this.valueScratchPool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.valueScratchPool.push(values);
		}
	}

	private acquireStringScratch(): string[] {
		const pool = this.stringScratchPool;
		if (pool.length > 0) {
			const scratch = pool.pop()!;
			scratch.length = 0;
			return scratch;
		}
		return [];
	}

	private releaseStringScratch(values: string[]): void {
		values.length = 0;
		if (this.stringScratchPool.length < MAX_POOLED_RUNTIME_SCRATCH_ARRAYS) {
			this.stringScratchPool.push(values);
		}
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

	public runConsoleChunk(source: string): Value[] {
		const chunk = this.luaInterpreter.compileChunk(source, 'console');
		const currentProgram = this.cpu.getProgram();
		const baseMetadata = this.programMetadata ?? this.consoleMetadata ?? this.buildConsoleMetadata(currentProgram);
		const compiled = appendLuaChunkToProgram(currentProgram, baseMetadata, chunk, { canonicalization: this._canonicalization });
		this.cpu.setProgram(compiled.program, compiled.metadata);
		if (this.programMetadata) {
			this.programMetadata = compiled.metadata;
		} else {
			this.consoleMetadata = compiled.metadata;
		}
		const results = this.callClosure({ protoIndex: compiled.entryProtoIndex, upvalues: [] }, []);
		this.processIo();
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
		const moduleId = $.lua_sources.path2lua[this._luaPath].source_path;
		const baseCtx = { moduleId, path: [] };
		for (let i = 0; i < results.length; i += 1) {
			output.push(this.luaJsBridge.convertFromLua(results[i], this.extendMarshalContext(baseCtx, `ret${i}`)));
		}
		return output;
	}

	private callClosure(fn: Closure, args: Value[]): Value[] {
		const depth = this.cpu.getFrameDepth();
		const previousBudget = this.cpu.instructionBudgetRemaining;
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		try {
			this.cpu.callExternal(fn, args);
			this.cpu.runUntilDepth(depth, budgetSentinel);
		} finally {
			const remaining = this.cpu.instructionBudgetRemaining;
			this.cpu.instructionBudgetRemaining = previousBudget - (budgetSentinel - remaining);
		}
		return this.cpu.lastReturnValues;
	}

	private invokeClosureHandler(fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown {
		const callArgs: Value[] = [];
		if (thisArg !== undefined) {
			callArgs.push(this.toRuntimeValue(thisArg));
		}
		for (let index = 0; index < args.length; index += 1) {
			callArgs.push(this.toRuntimeValue(args[index]));
		}
		const results = this.callClosure(fn, callArgs);
		if (results.length === 0) {
			return undefined;
		}
		const ctx = this.buildMarshalContext();
		return this.toNativeValue(results[0], ctx, new WeakMap());
	}

	private handleClosureHandlerError(error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void {
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

	private buildMarshalContext(): LuaMarshalContext {
		let moduleId = 'runtime';
		if (this._luaPath) {
			const binding = $.lua_sources.path2lua[this._luaPath];
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
		return this.internString(key);
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
		return [key, this.toRuntimeValue(value)];
	}

	private getOrAssignTableId(table: Table): number {
		const existing = this.tableIds.get(table);
		if (existing !== undefined) {
			return existing;
		}
		const id = this.nextTableId;
		this.tableIds.set(table, id);
		this.nextTableId += 1;
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
				return this.toRuntimeValue(rawValue);
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
				const ctx = this.buildMarshalContext();
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
				return this.toRuntimeValue(rawValue);
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
				const ctx = this.buildMarshalContext();
				map[prop] = this.toNativeValue(entryValue, ctx, new WeakMap());
			},
		});
		this.nativeObjectCache.set(map, wrapper);
		return wrapper;
	}

	private toRuntimeValue(value: unknown): Value {
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value === 'boolean' || typeof value === 'number') {
			return value;
		}
		if (typeof value === 'string') {
			return this.internString(value);
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
				table.set(this.internString(prop), this.toRuntimeValue(entry));
			}
			return table;
		}
		if (value instanceof Map) {
			const table = new Table(0, 0);
			for (const [key, entry] of value.entries()) {
				table.set(this.toRuntimeValue(key), this.toRuntimeValue(entry));
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
			return this.tableToNative(value, context, visited);
		}
		if (isNativeObject(value)) {
			return value.raw;
		}
		if (isNativeFunction(value)) {
			return (...args: unknown[]) => {
				const callArgs: Value[] = [];
				for (let index = 0; index < args.length; index += 1) {
					callArgs.push(this.toRuntimeValue(args[index]));
				}
				const results: Value[] = [];
				value.invoke(callArgs, results);
				if (results.length === 0) {
					return undefined;
				}
				return this.toNativeValue(results[0], context, new WeakMap());
			};
		}
		const handler = this.closureHandlerCache.getOrCreate(value as Closure, {
			moduleId: context.moduleId,
			path: context.path,
		});
		return handler;
	}

	private tableToNative(table: Table, context: LuaMarshalContext, visited: WeakMap<Table, unknown>): unknown {
		const cached = visited.get(table);
		if (cached !== undefined) {
			return cached;
		}
		const tableId = this.getOrAssignTableId(table);
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
			objectResult[this.stringifyKey(entry.key)] = this.toNativeValue(entry.value, nextContext, visited);
		}
		for (let index = 0; index < otherEntries.length; index += 1) {
			const entry = otherEntries[index];
			const segment = this.describeMarshalSegment(entry.key);
			const nextContext = segment ? this.extendMarshalContext(tableContext, segment) : tableContext;
			objectResult[this.stringifyKey(entry.key)] = this.toNativeValue(entry.value, nextContext, visited);
		}
		return objectResult;
	}

	private stringifyKey(key: Value): string {
		if (isStringValue(key)) {
			return stringValueToString(key);
		}
		return String(key);
	}

	private wrapNativeResult(result: unknown, out: Value[]): void {
		if (Array.isArray(result)) {
			for (let index = 0; index < result.length; index += 1) {
				out.push(this.toRuntimeValue(result[index]));
			}
			return;
		}
		if (result === undefined) {
			return;
		}
		out.push(this.toRuntimeValue(result));
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
					return rawValue === undefined ? null : this.toRuntimeValue(rawValue);
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
				return this.toRuntimeValue(rawValue);
			},
			set: (key, entryValue) => {
				if (isArray && typeof key === 'number' && Number.isInteger(key) && key >= 1) {
					const index = key - 1;
					const ctx = this.buildMarshalContext();
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
				const ctx = this.buildMarshalContext();
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
			const ctx = this.buildMarshalContext();
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
			const ctx = this.buildMarshalContext();
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

	public invalidateModuleAliases(): void {
		this.moduleAliases.clear();
		this.pathSemanticCache.clear();
	}

	private requireModule(moduleName: string): Value {
		const path = this.moduleAliases.get(moduleName);
		if (!path) {
			throw this.createApiRuntimeError(`require('${moduleName}') failed: module not found.`);
		}
		const cached = this.moduleCache.get(path);
		if (cached !== undefined) {
			return cached;
		}
		const protoIndex = this.moduleProtos.get(path);
		if (protoIndex === undefined) {
			throw this.createApiRuntimeError(`require('${moduleName}') failed: module not compiled.`);
		}
		this.moduleCache.set(path, true);
		const results = this.callClosure({ protoIndex, upvalues: [] }, []);
		const value = results.length > 0 ? results[0] : null;
		const cachedValue = value === null ? true : value;
		this.moduleCache.set(path, cachedValue);
		return cachedValue;
	}

	private requireLuaModule(interpreter: LuaInterpreter, moduleName: string): LuaValue {
		const canonicalName = this.canonicalizeIdentifierFn(moduleName);
		const path = this.moduleAliases.get(moduleName) ?? this.moduleAliases.get(canonicalName);
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
		return $.lua_sources.path2lua[path]
			?? this.cartLuaSources?.path2lua[path]
			?? this.engineLuaSources?.path2lua[path]
			?? null;
	}

	private resolveModuleRegistries(): LuaSourceRegistry[] {
		if (this.cartLuaSources && $.lua_sources === this.cartLuaSources) {
			return [this.cartLuaSources, this.engineLuaSources];
		}
		return [$.lua_sources];
	}
}
