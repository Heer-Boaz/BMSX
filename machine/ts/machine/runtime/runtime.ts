import {
	AcceptedInterruptKind,
	EMPTY_CALL_ARGS,
	RunResult,
	StringValue,
	type Closure,
	type Value,
} from '../cpu/cpu';
import type { Blua32MediaSymbols } from '../cpu/blua32_symbols';
import { CPU_STATUS_SYSTEM_ENTRY } from '../cpu/cop0';
import { seedLuaGlobals } from '../firmware/globals';
import type { RuntimeOptions } from './options';
import { addTrackedLuaHeapBytes, configureLuaHeapUsage, getTrackedLuaHeapBytes, resetTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
import { FrameLoopState } from './frame/loop';
import { FrameSchedulerState } from '../scheduler/frame';
import { DEVICE_SERVICE_GPU } from '../scheduler/device';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { advanceRuntimeTime, CpuExecutionState, runDueRuntimeTimers } from './cpu_executor';
import { HostFaultState } from './host_fault';
import { LuaScratchState } from './lua_scratch';
import { refreshDeviceTimings } from './timing/config';
import { HZ_SCALE } from './timing/constants';
import type { GxGpuPcrtcTiming } from '../devices/gx/gpu_pcrtc';
import { GX_GPU_VRAM_BYTE_COUNT } from '../devices/gx/vram_address';
import { IO_GX_GPU_GP1, IO_SYS_CYCLES_PER_FRAME, IO_SYS_FRAME_MS, IO_SYS_TIME_MS } from '../bus/io';
import { Machine } from '../machine';
import type { RuntimeInputSource } from './input';
import {
	BASE_RAM_USED_SIZE,
	RAM_SIZE,
} from '../memory/map';


function runHaltedClosureUntilInterrupt(runtime: Runtime): number {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	let consumed = 0;
	let advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (cpu.peekPendingInterrupt() !== AcceptedInterruptKind.None) {
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
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public readonly luaScratch = new LuaScratchState();
	public readonly hostFault: HostFaultState;
	public readonly machine: Machine;

	public resetHardwareState(): void {
		this.machine.scheduler.reset();
		this.machine.resetDevices();
		this.vblank.reset();
		refreshDeviceTimings(this, this.machine.scheduler.nowCycles);
		this.machine.runDeviceService(DEVICE_SERVICE_GPU);
		this.applyPublishedGxGpuPcrtcTiming(this.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	}

	public resetForSystemBoot(): void {
		this.frameLoop.resetFrameState();
		this.luaRuntimeFailed = false;
		this.luaInitialized = false;
		this.pendingCall = null;
		this.hostFault.clear();
		this.machine.cpu.clearExecutionEnvironment();
		this.machine.memory.clearIoSlots();
		this.machine.initializeSystemIo();
		this.resetHardwareState();
		resetTrackedLuaHeapBytes();
		addTrackedLuaHeapBytes(this.machine.cpu.globals.getTrackedHeapBytes());
	}

	public boot(symbols: Blua32MediaSymbols): void {
		this.machine.cpu.mountExecutableMedia(symbols);
		seedLuaGlobals(this);
		this.startSystemFirmware();
	}

	public rebootSystem(): void {
		this.resetForSystemBoot();
		this.machine.cpu.remountExecutableMedia();
		seedLuaGlobals(this);
		this.startSystemFirmware();
	}

	private startSystemFirmware(): void {
		this.machine.cpu.start(
			this.machine.cpu.systemStartupFunctionAddress(),
			EMPTY_CALL_ARGS,
			CPU_STATUS_SYSTEM_ENTRY,
		);
		this.pendingCall = 'entry';
		this.luaInitialized = true;
	}


	// start repeated-sequence-acceptable -- External closure calls keep frame/budget restore code direct instead of routing through callback plumbing.
	public callClosureInto(fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
		const cpu = this.machine.cpu;
		if (this.machine.scheduler.isCpuSliceActive() || cpu.isHostExternalCallActive()) {
			throw new Error('External Lua closure execution requires a suspended CPU.');
		}
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
			options.pcrtcRunning,
			options.ufpsScaled,
			options.cpuHz,
			options.cycleBudgetPerFrame,
			options.totalHalfLines,
			options.activeDisplayHalfLines,
			options.geoWorkUnitsPerSec,
		);
		this.machine = new Machine(
			options.memory,
			input,
		);
		this.machine.memory.clearIoSlots();
		this.machine.memory.mapIoRead(IO_SYS_TIME_MS, this, Runtime.onTimeMsReadThunk);
		this.machine.memory.mapIoRead(IO_SYS_FRAME_MS, this, Runtime.onFrameMsReadThunk);
		this.machine.memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, Runtime.onCyclesPerFrameReadThunk);
		this.machine.memory.mapIoWrite(IO_GX_GPU_GP1, this, Runtime.onGxGpuGp1WriteThunk);
		this.machine.initializeSystemIo();
		this.machine.resetDevices();
		refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.machine.runDeviceService(DEVICE_SERVICE_GPU);
		this.applyPublishedGxGpuPcrtcTiming(this.machine.gxGpu.readDeviceOutput().pcrtcTiming);
		configureLuaHeapUsage(this, Runtime.getBaseRamUsedBytesThunk, Runtime.collectTrackedHeapBytesThunk);
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

	public baseRamUsedBytes(): number {
		return BASE_RAM_USED_SIZE;
	}

	private static getBaseRamUsedBytesThunk(context: Runtime): number {
		void context;
		return BASE_RAM_USED_SIZE;
	}

	private static collectTrackedHeapBytesThunk(context: Runtime): number {
		return context.machine.cpu.collectTrackedHeapBytes();
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

	public applyPublishedGxGpuPcrtcTiming(pcrtcTiming: GxGpuPcrtcTiming): void {
		const timing = this.timing;
		if (timing.pcrtcRevision === pcrtcTiming.revision
			&& timing.pcrtcRunning === pcrtcTiming.running
			&& timing.ufpsScaled === pcrtcTiming.refreshUfpsScaled
			&& timing.cycleBudgetPerFrame === pcrtcTiming.nextVblankCycleBudget
			&& timing.totalHalfLines === pcrtcTiming.totalHalfLines
			&& timing.activeDisplayHalfLines === pcrtcTiming.activeDisplayHalfLines) {
			return;
		}
		timing.pcrtcRevision = pcrtcTiming.revision;
		timing.pcrtcRunning = pcrtcTiming.running;
		timing.totalHalfLines = pcrtcTiming.totalHalfLines;
		timing.activeDisplayHalfLines = pcrtcTiming.activeDisplayHalfLines;
		if (!pcrtcTiming.running) {
			timing.ufpsScaled = 0;
			timing.ufps = 0;
			timing.frameDurationMs = 0;
			timing.cycleBudgetPerFrame = 0;
			this.input.setRuntimeInputFrameDurationMs(0);
			return;
		}
		timing.cycleBudgetPerFrame = pcrtcTiming.nextVblankCycleBudget;
		this.applyUfpsScaled(pcrtcTiming.refreshUfpsScaled);
	}

	// disable-next-line single_line_method_pattern -- runtime string interning is the public CPU string-pool boundary.
	public internString(name: string): StringValue {
		return StringValue.get(this.machine.cpu.stringPool.intern(name));
	}

	public setGlobal(name: string, value: Value): void {
		this.machine.cpu.setGlobalByKey(this.internString(name), value);
	}


}
