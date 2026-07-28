import { RunResult } from '../cpu/cpu';
import type { Closure } from '../cpu/closure';
import { EMPTY_CALL_ARGS, StringValue, type Value } from '../cpu/value';
import { seedLuaGlobals } from '../firmware/globals';
import type { RuntimeOptions } from './options';
import { FrameLoopState } from './frame/loop';
import { FrameSchedulerState } from '../scheduler/frame';
import { DEVICE_SERVICE_GPU } from '../scheduler/device';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { advanceRuntimeTime, CpuExecutionState, MAX_CPU_SLICE_CYCLES, runDueRuntimeTimers } from './cpu_executor';
import { LuaScratchState } from './lua_scratch';
import { refreshDeviceTimings } from './timing/config';
import { HZ_SCALE } from './timing/constants';
import type { GxGpuPcrtcTiming } from '../devices/gx/gpu_pcrtc';
import { GX_GPU_VRAM_BYTE_COUNT } from '../../spec/gx/vram';
import { Machine } from '../machine';
import type { RuntimeInputSource } from './input';
import { BASE_RAM_USED_SIZE } from '../../spec/bmsx/memory_map';
import { RAM_SIZE } from '../memory/map';


function runHaltedClosureUntilInterrupt(runtime: Runtime): void {
	const machine = runtime.machine;
	const cpu = machine.cpu;
	const scheduler = machine.scheduler;
	let advancedDeadline = false;
	while (cpu.isHaltedUntilIrq()) {
		if (machine.gxGpu.backendReadbackBlocksMachine()) {
			return;
		}
		const cpuHeld = machine.systemController.cpuHeld();
		if (!cpuHeld && cpu.enterPendingInterrupt()) {
			return;
		}
		if (!cpuHeld && advancedDeadline) {
			return;
		}
		const nextDeadline = scheduler.nextDeadline();
		if (nextDeadline === Number.MAX_SAFE_INTEGER) {
			return;
		}
		const cyclesToDeadline = nextDeadline - scheduler.nowCycles;
		if (cyclesToDeadline <= 0) {
			if (runDueRuntimeTimers(runtime)) {
				return;
			}
			continue;
		}
		const idleCycles = cyclesToDeadline < MAX_CPU_SLICE_CYCLES
			? cyclesToDeadline
			: MAX_CPU_SLICE_CYCLES;
		advanceRuntimeTime(runtime, idleCycles);
		advancedDeadline = idleCycles === cyclesToDeadline;
	}
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
		return this.pendingCall === 'entry';
	}

	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public readonly luaScratch = new LuaScratchState();
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
		this.cpuExecution.reset();
		this.frameLoop.resetFrameState();
		this.pendingCall = null;
		this.machine.cpu.clearExecutionEnvironment();
		this.machine.memory.clearIoSlots();
		this.resetHardwareState();
	}

	public boot(): void {
		this.machine.cpu.reset();
		seedLuaGlobals(this);
		this.finishSystemBoot();
	}

	public rebootSystem(): void {
		this.resetForSystemBoot();
		this.machine.cpu.reset();
		seedLuaGlobals(this);
		this.finishSystemBoot();
	}

	private finishSystemBoot(): void {
		this.pendingCall = 'entry';
	}

	// start repeated-sequence-acceptable -- External closure calls keep frame/budget restore code direct instead of routing through callback plumbing.
	/** The borrowed result view is invalidated by subsequent CPU execution, call entry, reset, or state restore. */
	public callClosure(fn: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): ReadonlyArray<Value> {
		const machine = this.machine;
		const cpu = machine.cpu;
		const scheduler = machine.scheduler;
		if (scheduler.isCpuSliceActive()) {
			throw new Error('External Lua closure execution requires a suspended CPU.');
		}
		const depth = cpu.getFrameDepth();
		const previousBudget = cpu.instructionBudgetRemaining;
		try {
			cpu.beginCompletionCall(fn, args);
			runDueRuntimeTimers(this);
			while (cpu.getFrameDepth() > depth) {
				if (machine.gxGpu.backendReadbackBlocksMachine()) {
					break;
				}
				if (machine.systemController.cpuHeld()) {
					const nextDeadline = scheduler.nextDeadline();
					if (nextDeadline === Number.MAX_SAFE_INTEGER) {
						break;
					}
					let waitCycles = nextDeadline - scheduler.nowCycles;
					if (waitCycles <= 0) {
						runDueRuntimeTimers(this);
						continue;
					}
					if (waitCycles > MAX_CPU_SLICE_CYCLES) {
						waitCycles = MAX_CPU_SLICE_CYCLES;
					}
					advanceRuntimeTime(this, waitCycles);
					continue;
				}
				if (cpu.isMemoryWriteBlocked()) {
					const nextDeadline = scheduler.nextDeadline();
					let waitCycles = nextDeadline - scheduler.nowCycles;
					if (waitCycles <= 0) {
						runDueRuntimeTimers(this);
						continue;
					}
					if (waitCycles > MAX_CPU_SLICE_CYCLES) {
						waitCycles = MAX_CPU_SLICE_CYCLES;
					}
					// External closures obey the same hardware wait contract as the
					// frame executor: only the scheduled device edge releases the store.
					advanceRuntimeTime(this, waitCycles);
					continue;
				}
				let sliceBudget = MAX_CPU_SLICE_CYCLES;
				const nextDeadline = scheduler.nextDeadline();
				if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
					const deadlineBudget = nextDeadline - scheduler.nowCycles;
					if (deadlineBudget <= 0) {
						runDueRuntimeTimers(this);
						continue;
					}
					if (deadlineBudget < sliceBudget) {
						sliceBudget = deadlineBudget;
					}
				}
				scheduler.beginCpuSlice(sliceBudget);
				let result = RunResult.Yielded;
				let consumed = 0;
				try {
					result = cpu.runUntilDepth(depth, sliceBudget);
				} finally {
					scheduler.endCpuSlice();
					consumed = sliceBudget - cpu.instructionBudgetRemaining;
					if (consumed > 0) {
						advanceRuntimeTime(this, consumed);
					}
				}
				if (cpu.getFrameDepth() <= depth) {
					break;
				}
				if (cpu.isMemoryWriteBlocked()) {
					continue;
				}
				if (result === RunResult.Halted) {
					if (!cpu.isHaltedUntilIrq()) {
						break;
					}
					runHaltedClosureUntilInterrupt(this);
					if (cpu.isHaltedUntilIrq()) {
						break;
					}
					continue;
				}
				if (consumed <= 0) {
					runDueRuntimeTimers(this);
				}
			}
			return cpu.completionValues;
		} finally {
			cpu.instructionBudgetRemaining = previousBudget;
		}
	}

	public completionCallPending(): boolean {
		return this.machine.cpu.completionCallPending();
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
		this.machine.resetDevices();
		refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.machine.runDeviceService(DEVICE_SERVICE_GPU);
		this.applyPublishedGxGpuPcrtcTiming(this.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	}

	public baseRamUsedBytes(): number {
		return BASE_RAM_USED_SIZE;
	}

	public ramUsedBytes(): number {
		return this.baseRamUsedBytes() + this.machine.cpu.luaHeap.usedBytes();
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
		timing.ufpsScaled = pcrtcTiming.refreshUfpsScaled;
		timing.ufps = pcrtcTiming.refreshUfpsScaled / HZ_SCALE;
		timing.frameDurationMs = pcrtcTiming.frameDurationMs;
		this.input.setRuntimeInputFrameDurationMs(pcrtcTiming.frameDurationMs);
	}

	// disable-next-line single_line_method_pattern -- runtime string interning is the public CPU string-pool boundary.
	public internString(name: string): StringValue {
		return StringValue.get(this.machine.cpu.stringPool.intern(name));
	}

	public setGlobal(name: string, value: Value): void {
		this.machine.cpu.setGlobalByKey(this.internString(name), value);
	}


}
