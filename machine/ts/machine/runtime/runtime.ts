import { AcceptedInterruptKind, EMPTY_CALL_ARGS, RunResult, StringValue, type Closure, type Value, type Program, type ProgramMetadata, type ProgramRuntimeSymbols } from '../cpu/cpu';
import { clearLuaBootPrimitives, seedLuaGlobals } from '../firmware/globals';
import type { RuntimeOptions } from './options';
import { addTrackedLuaHeapBytes, configureLuaHeapUsage, getTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
import { FrameLoopState } from './frame/loop';
import { FrameSchedulerState } from '../scheduler/frame';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { advanceRuntimeTime, CpuExecutionState, runDueRuntimeTimers } from './cpu_executor';
import { HostFaultState } from './host_fault';
import { LuaScratchState } from '../program/scratch';
import type { ProgramImage, ProgramVectorTable } from '../program/loader';
import { inflateExecutableProgramImage, type LinkedBootProgramImage } from '../program/linker';
import { getPsxGpuDisplayModeTimingForWord } from '../model_registry';
import { refreshDeviceTimings } from './timing/config';
import { HZ_SCALE } from './timing/constants';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, gxGpuVerticalVisibleLines } from '../devices/gx/gpu_display';
import { GX_GPU_VRAM_BYTE_COUNT } from '../devices/gx/gpu_command_buffer';
import { IO_GX_GPU_GP1, IO_SYS_CYCLES_PER_FRAME, IO_SYS_FRAME_MS, IO_SYS_PRINT_CHAR, IO_SYS_PRINT_FLUSH, IO_SYS_TIME_MS } from '../bus/io';
import { Machine } from '../machine';
import type { RuntimeInputSource } from './input';
import {
	BASE_RAM_USED_SIZE,
	PROGRAM_STATIC_RAM_BASE,
	RAM_SIZE,
} from '../memory/map';


function runHaltedClosureUntilInterrupt(runtime: Runtime): number {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	let consumed = 0;
	let advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.peekPendingInterrupt(runtime.machine.irqController) !== AcceptedInterruptKind.None) {
			cpu.clearHaltUntilIrq();
			return consumed;
		}
		if (advancedDeadline) {
			return consumed;
		}
		const nextDeadline = scheduler.nextDeadline();
		if (nextDeadline === Number.MAX_SAFE_INTEGER) {
			return consumed;
		}
		const idleCycles = nextDeadline - scheduler.nowCycles;
		if (idleCycles <= 0) {
			if (runDueRuntimeTimers(runtime)) {
				return consumed;
			}
			continue;
		}
		advanceRuntimeTime(runtime, idleCycles);
		consumed += idleCycles;
		advancedDeadline = true;
	}
	return consumed;
}

export const EMPTY_STATIC_MODULE_PATHS: ReadonlyArray<string> = [];

export class Runtime {
	public readonly timing: TimingState;
	public cpuUsageCyclesUsed(): number {
		return this.frameLoop.frameActive ? this.frameLoop.frameState.activeCpuUsedCycles : this.frameScheduler.lastTickCpuUsedCycles;
	}

	public cpuUsageCyclesGranted(): number {
		return this.frameLoop.frameActive
			? this.frameLoop.frameState.cycleBudgetGranted
			: (this.frameScheduler.lastTickSequence === 0 ? this.timing.cycleBudgetPerFrame : this.frameScheduler.lastTickCpuBudgetGranted);
	}

	public pendingCall: 'entry' | null = null;
	public get isDrawPending(): boolean {
		return this.pendingCall === 'entry'
			|| this.luaRuntimeFailed;
	}

	public programMetadata: ProgramMetadata | null = null;
	public programRuntimeSymbols!: ProgramRuntimeSymbols;
	public luaInitialized = false;
	public get isInitialized(): boolean {
		return this.luaInitialized;
	}
	public luaRuntimeFailed = false;
	public get hasRuntimeFailed(): boolean {
		return this.luaRuntimeFailed;
	}
	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
	public cartProgramStarted = false;
	public programVectors: ProgramVectorTable | null = null;
	public cartVectors!: ProgramVectorTable;
	public programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public programBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public cartDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public cartBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
	public cartStaticModulePaths: ReadonlyArray<string> = [];
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public readonly luaOutputLines: string[] = [];
	private luaOutputLineBuffer = '';
	public readonly luaScratch = new LuaScratchState();
	public readonly moduleCache = new Map<string, Value>();
	public cartEntryAvailable = false;
	public readonly hostFault: HostFaultState;
	public readonly machine: Machine;

	private setLinkedCartProgram(vectors: ProgramVectorTable, programDataBaseAddress: number, programBssBaseAddress: number, cartDataBaseAddress: number, cartBssBaseAddress: number, staticModulePaths: ReadonlyArray<string>): void {
		this.cartVectors = vectors;
		this.programDataBaseAddress = programDataBaseAddress;
		this.programBssBaseAddress = programBssBaseAddress;
		this.cartDataBaseAddress = cartDataBaseAddress;
		this.cartBssBaseAddress = cartBssBaseAddress;
		this.cartStaticModulePaths = staticModulePaths;
		this.cartEntryAvailable = true;
	}

	public clearLinkedCartProgram(dataByteLength: number): void {
		this.cartEntryAvailable = false;
		this.cartDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
		this.cartBssBaseAddress = PROGRAM_STATIC_RAM_BASE;
		this.programDataBaseAddress = PROGRAM_STATIC_RAM_BASE;
		this.programBssBaseAddress = PROGRAM_STATIC_RAM_BASE + dataByteLength;
		this.cartStaticModulePaths = EMPTY_STATIC_MODULE_PATHS;
	}

	public resetHardwareState(): void {
		this.luaOutputLineBuffer = '';
		this.machine.resetDevices();
		this.vblank.reset();
	}

	public resetRuntimeForProgramReload(): void {
		this.frameLoop.resetFrameState();
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
		this.pendingCall = null;
		this.programVectors = null;
		this.clearLinkedCartProgram(0);
		this.luaOutputLineBuffer = '';
		this.hostFault.clear();
		this.moduleCache.clear();
		this.machine.cpu.clearGlobalSlots();
		this.machine.cpu.globals.clear();
		this.machine.memory.clearIoSlots();
		this.machine.initializeSystemIo();
		this.resetHardwareState();
		resetTrackedLuaHeapBytes();
		addTrackedLuaHeapBytes(this.machine.cpu.globals.getTrackedHeapBytes());
	}

	public boot(
		image: ProgramImage,
		metadata: ProgramMetadata | null,
		vectors: ProgramVectorTable,
		dataBaseAddress: number,
		bssBaseAddress: number,
		systemStaticModulePaths: ReadonlyArray<string>,
		cartStaticModulePaths: ReadonlyArray<string>,
	): void {
		this.programDataBaseAddress = dataBaseAddress;
		this.programBssBaseAddress = bssBaseAddress;
		const program = inflateExecutableProgramImage(image, dataBaseAddress, bssBaseAddress);
		seedLuaGlobals(this);
		this.machine.cpu.setProgram(program, image.link.symbols, metadata);
		this.programRuntimeSymbols = image.link.symbols;
		this.programMetadata = metadata;
		this.startLoadedProgram(vectors, systemStaticModulePaths, cartStaticModulePaths);
	}

	public bootLinkedProgramImage(linked: LinkedBootProgramImage): void {
		this.setLinkedCartProgram(linked.cartVectors, linked.dataBaseAddress, linked.bssBaseAddress, linked.cartDataBaseAddress, linked.cartBssBaseAddress, linked.cartStaticModulePaths);
		this.boot(
			linked.programImage,
			linked.metadata,
			linked.vectors,
			linked.dataBaseAddress,
			linked.bssBaseAddress,
			linked.systemStaticModulePaths,
			this.cartProgramStarted ? linked.cartStaticModulePaths : EMPTY_STATIC_MODULE_PATHS,
		);
	}

	public enterSystemFirmware(): void {
		this.cartProgramStarted = false;
	}

	public enterCartProgram(): void {
		this.cartProgramStarted = true;
	}

	public startCartProgram(): void {
		this.programDataBaseAddress = this.cartDataBaseAddress;
		this.programBssBaseAddress = this.cartBssBaseAddress;
		this.enterCartProgram();
		this.startLoadedProgram(this.cartVectors, EMPTY_STATIC_MODULE_PATHS, this.cartStaticModulePaths);
	}

	public startLoadedProgram(vectors: ProgramVectorTable, systemStaticModulePaths: ReadonlyArray<string>, cartStaticModulePaths: ReadonlyArray<string>): void {
		this.programVectors = vectors;
		this.runSectionInitializer(vectors.sectionInitProtoIndex);
		this.runStaticModuleInitializers(systemStaticModulePaths);
		clearLuaBootPrimitives(this);
		this.runStaticModuleInitializers(cartStaticModulePaths);
		this.machine.cpu.syncGlobalSlotsToTable();
		this.machine.cpu.start(vectors.resetProtoIndex);
		this.pendingCall = 'entry';
		this.luaInitialized = true;
	}


	// start repeated-sequence-acceptable -- External closure calls keep frame/budget restore code direct instead of routing through callback plumbing.
	public callClosureInto(fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
		const cpu = this.machine.cpu;
		const depth = cpu.getFrameDepth();
		const previousBudget = cpu.instructionBudgetRemaining;
		const budgetSentinel = Number.MAX_SAFE_INTEGER;
		const previousSink = cpu.swapExternalReturnSink(out);
		let spentBudget = 0;
		let activeBudget = 0;
		out.length = 0;
		cpu.enterHostExternalCall();
		try {
			cpu.callExternal(fn, args);
			while (cpu.getFrameDepth() > depth) {
				activeBudget = budgetSentinel;
				const result = cpu.runUntilDepth(depth, budgetSentinel);
				spentBudget += activeBudget - cpu.instructionBudgetRemaining;
				activeBudget = 0;
				if (cpu.getFrameDepth() > depth && result === RunResult.Halted) {
					spentBudget += runHaltedClosureUntilInterrupt(this);
					if (cpu.isHaltedUntilIrq()) {
						break;
					}
				}
			}
		} catch (error) {
			cpu.unwindToDepth(depth);
			throw error;
		} finally {
			if (activeBudget > 0) {
				spentBudget += activeBudget - cpu.instructionBudgetRemaining;
			}
			cpu.swapExternalReturnSink(previousSink);
			cpu.instructionBudgetRemaining = previousBudget - spentBudget;
			cpu.leaveHostExternalCall();
		}
	}
	// end repeated-sequence-acceptable

	private runSectionInitializer(protoIndex: number): void {
		const results = this.luaScratch.values.acquire();
		try {
			this.callClosureInto(this.machine.cpu.rootClosure(protoIndex), EMPTY_CALL_ARGS, results);
		} finally {
			this.luaScratch.values.release(results);
		}
	}

	private runStaticModuleInitializers(paths: ReadonlyArray<string>): void {
		for (let index = 0; index < paths.length; index += 1) {
			this.runStaticModuleInitializer(paths[index]);
		}
	}

	private runStaticModuleInitializer(path: string): void {
		if (this.moduleCache.has(path)) {
			return;
		}
		const program = this.machine.cpu.program as Program;
		const protoIndex = program.moduleProtoMap.get(path);
		if (protoIndex === undefined) {
			throw new Error(`static module init failed: module '${path}' is not compiled.`);
		}
		this.moduleCache.set(path, true);
		const results = this.luaScratch.values.acquire();
		try {
			this.callClosureInto(this.machine.cpu.rootClosure(protoIndex), EMPTY_CALL_ARGS, results);
		} catch (error) {
			this.moduleCache.delete(path);
			throw error;
		} finally {
			this.luaScratch.values.release(results);
		}
		this.moduleCache.delete(path);
	}

	public constructor(
		options: RuntimeOptions,
		private readonly input: RuntimeInputSource,
	) {
		this.frameScheduler = new FrameSchedulerState(this);
		this.frameLoop = new FrameLoopState(this);
		this.vblank = new VblankState(this);
		this.cpuExecution = new CpuExecutionState(this);
		this.hostFault = new HostFaultState(this);
		this.timing = new TimingState(
			options.ufpsScaled,
			options.cpuHz,
			options.cycleBudgetPerFrame,
			options.psxGpuDisplayModeWord,
			GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
			getPsxGpuDisplayModeTimingForWord(options.psxGpuDisplayModeWord).totalScanlines,
			options.dmaWordsPerSec,
			options.geoWorkUnitsPerSec,
		);
		this.input.setRuntimeInputFrameDurationMs(this.timing.frameDurationMs);
		this.machine = new Machine(
			options.memory,
			input,
		);
		this.machine.memory.clearIoSlots();
		this.machine.memory.mapIoRead(IO_SYS_TIME_MS, this, Runtime.onTimeMsReadThunk);
		this.machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, Runtime.onFrameMsReadThunk);
		this.machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, Runtime.onCyclesPerFrameReadThunk);
		this.machine.memory.mapIoWrite(IO_GX_GPU_GP1, this, Runtime.onGxGpuGp1WriteThunk);
		this.machine.memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, Runtime.onLuaOutputCodepointWriteThunk);
		this.machine.memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, Runtime.onLuaOutputFlushWriteThunk);
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		this.machine.gxGpu.writeDisplayModeWord(this.timing.gpuDisplayModeWord);
		configureLuaHeapUsage(this, Runtime.getBaseRamUsedBytesThunk, Runtime.collectTrackedHeapBytesThunk);
		refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.vblank.setVblankCycles(options.vblankCycles);
	}

	public machineTimeMs(): number {
		return (this.machine.scheduler.currentNowCycles() * 1000 / this.timing.cpuHz) >>> 0;
	}

	public machineElapsedMs(): number {
		return this.machine.scheduler.currentNowCycles() * 1000 / this.timing.cpuHz;
	}

	private static onTimeMsReadThunk(context: Runtime, addr: number): Value {
		void addr;
		return context.machineTimeMs();
	}

	private static onFrameMsReadThunk(context: Runtime, addr: number): Value {
		void addr;
		return context.timing.frameDurationMs;
	}

	private static onCyclesPerFrameReadThunk(context: Runtime, addr: number): Value {
		void addr;
		return context.timing.cycleBudgetPerFrame;
	}

	private static onGxGpuGp1WriteThunk(context: Runtime, addr: number, value: Value): void {
		void addr;
		context.machine.gxGpu.writeGp1(value as number);
	}

	private static onLuaOutputCodepointWriteThunk(context: Runtime, addr: number, value: Value): void {
		void addr;
		context.writeLuaOutputCodepoint((value as number) >>> 0);
	}

	private static onLuaOutputFlushWriteThunk(context: Runtime): void {
		context.luaOutputLines.push(context.luaOutputLineBuffer);
		context.luaOutputLineBuffer = '';
	}

	private writeLuaOutputCodepoint(codepoint: number): void {
		this.luaOutputLineBuffer += String.fromCodePoint(codepoint);
	}

	public baseRamUsedBytes(): number {
		return BASE_RAM_USED_SIZE;
	}

	private static getBaseRamUsedBytesThunk(context: Runtime): number {
		void context;
		return BASE_RAM_USED_SIZE;
	}

	private static collectTrackedHeapBytesThunk(context: Runtime): number {
		const extraRoots = context.luaScratch.values.acquire();
		try {
			for (const value of context.moduleCache.values()) {
				extraRoots.push(value);
			}
			return context.machine.cpu.collectTrackedHeapBytes(extraRoots);
		}
		finally {
			context.luaScratch.values.release(extraRoots);
		}
	}

	public ramUsedBytes(): number {
		return this.baseRamUsedBytes() + getTrackedLuaHeapBytes();
	}

	public ramTotalBytes(): number {
		return RAM_SIZE;
	}

	public vramUsedBytes(): number {
		return GX_GPU_VRAM_BYTE_COUNT;
	}

	public vramTotalBytes(): number {
		return GX_GPU_VRAM_BYTE_COUNT;
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		const timing = this.timing;
		timing.ufpsScaled = ufpsScaled;
		timing.ufps = ufpsScaled / HZ_SCALE;
		timing.frameDurationMs = 1000 / timing.ufps;
		this.input.setRuntimeInputFrameDurationMs(timing.frameDurationMs);
	}

	public applyPublishedPsxGpuDisplayTiming(displayModeWord: number, verticalDisplayRangeWord: number): void {
		const timing = this.timing;
		if (timing.gpuDisplayModeWord === displayModeWord
			&& timing.gpuVerticalDisplayRangeWord === verticalDisplayRangeWord) {
			return;
		}
		const displayModeTiming = getPsxGpuDisplayModeTimingForWord(displayModeWord);
		const refreshUfpsScaled = displayModeTiming.refreshUfpsScaled;
		const cycleBudgetPerFrame = calcCyclesPerFrameScaled(timing.cpuHz, refreshUfpsScaled);
		const activeDisplayLines = gxGpuVerticalVisibleLines(verticalDisplayRangeWord, displayModeWord);
		timing.gpuDisplayModeWord = displayModeWord;
		timing.gpuVerticalDisplayRangeWord = verticalDisplayRangeWord;
		timing.totalScanlines = displayModeTiming.totalScanlines;
		timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
		this.applyUfpsScaled(refreshUfpsScaled);
		this.vblank.setNextFrameTiming(
			cycleBudgetPerFrame,
			resolveVblankCycles(timing.cpuHz, refreshUfpsScaled, displayModeTiming.totalScanlines, activeDisplayLines),
		);
	}

	// disable-next-line single_line_method_pattern -- runtime string interning is the public CPU string-pool boundary.
	public internString(name: string): StringValue {
		return StringValue.get(this.machine.cpu.stringPool.intern(name));
	}

	public setGlobal(name: string, value: Value): void {
		this.machine.cpu.setGlobalByKey(this.internString(name), value);
	}


}
