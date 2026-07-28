import { RunResult } from '../cpu/cpu';
import { GX_GPU_SERVICE_RUNTIME_EDGE_MASK, GX_GPU_SERVICE_TIMING_PUBLISHED } from '../devices/gx/gpu';
import {
	DEVICE_SERVICE_GPU,
	TIMER_KIND_DEVICE_SERVICE,
} from '../scheduler/device';
import {
	InstructionStepResult,
	type FrameState,
} from './frame/state';
import { Runtime } from './runtime';

export const MAX_CPU_SLICE_CYCLES = 0x7fffffff;

const enum CpuSliceResult {
	Blocked,
	Advanced,
	InstructionYielded,
	InstructionHalted,
	Halted,
}

export class CpuExecutionState {
	private sliceCycleBudgetRemaining = 0;
	private instructionRunActive = false;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.sliceCycleBudgetRemaining = 0;
		this.instructionRunActive = false;
	}

	public runStoppedCpu(state: FrameState): boolean {
		const runtime = this.runtime;
		const machine = runtime.machine;
		const cpu = machine.cpu;
		const gxGpu = machine.gxGpu;
		let cycleBudgetRemaining = state.cycleBudgetRemaining;
		let tickCompleted = runDueRuntimeTimers(runtime);
		if (gxGpu.backendReadbackBlocksMachine()) {
			return tickCompleted;
		}
		if (!cpu.isHaltedUntilIrq() && !machine.systemController.cpuHeld()) {
			return tickCompleted;
		}
		const scheduler = machine.scheduler;
		while (true) {
			if (!machine.systemController.cpuHeld() && cpu.enterPendingInterrupt()) {
				return tickCompleted;
			}
			if (!cpu.isHaltedUntilIrq() && !machine.systemController.cpuHeld()) {
				return tickCompleted;
			}
			if (tickCompleted) {
				return true;
			}
			if (cycleBudgetRemaining > 0) {
				const nextDeadline = scheduler.nextDeadline();
				if (nextDeadline === Number.MAX_SAFE_INTEGER) {
					// Parked with no interrupt scheduled to wake the CPU: yield without
					// burning the CPU instruction budget. A parked CPU executes nothing,
					// so it must not draw down the per-frame budget; the host resumes on
					// a later tick once an interrupt is scheduled.
					return tickCompleted;
				}
				const cyclesToTarget = nextDeadline - scheduler.nowCycles;
				if (cyclesToTarget <= 0) {
					tickCompleted = runDueRuntimeTimers(runtime);
					if (gxGpu.backendReadbackBlocksMachine()) {
						return tickCompleted;
					}
					continue;
				}
				let idleCycles = cyclesToTarget < cycleBudgetRemaining ? cyclesToTarget : cycleBudgetRemaining;
				if (idleCycles > MAX_CPU_SLICE_CYCLES) idleCycles = MAX_CPU_SLICE_CYCLES;
				cycleBudgetRemaining -= idleCycles;
				state.cycleBudgetRemaining = cycleBudgetRemaining;
				tickCompleted = advanceRuntimeTime(runtime, idleCycles);
				if (gxGpu.backendReadbackBlocksMachine()) {
					return tickCompleted;
				}
				continue;
			}
			return true;
		}
	}

	public runWithBudget(state: FrameState): RunResult {
		let result = RunResult.Yielded;
		const cpu = this.runtime.machine.cpu;
		this.instructionRunActive = false;
		this.sliceCycleBudgetRemaining = state.cycleBudgetRemaining;
		let running = true;
		while (running) {
			switch (this.runSlice(state, MAX_CPU_SLICE_CYCLES)) {
				case CpuSliceResult.Advanced:
					continue;
				case CpuSliceResult.InstructionYielded:
					result = RunResult.Yielded;
					continue;
				case CpuSliceResult.InstructionHalted:
					result = RunResult.Halted;
					if (cpu.isMemoryWriteBlocked()) {
						continue;
					}
					running = false;
					continue;
				case CpuSliceResult.Halted:
					result = RunResult.Halted;
					running = false;
					continue;
				case CpuSliceResult.Blocked:
					running = false;
					continue;
			}
		}
		state.cycleBudgetRemaining = this.sliceCycleBudgetRemaining;
		return result;
	}

	public runInstruction(state: FrameState): InstructionStepResult {
		if (!this.instructionRunActive) {
			this.sliceCycleBudgetRemaining = state.cycleBudgetRemaining;
			this.instructionRunActive = true;
		}
		const result = this.runSlice(state, 1);
		const runtime = this.runtime;
		const cpu = runtime.machine.cpu;
		const runCompleted = result === CpuSliceResult.Advanced
			|| result === CpuSliceResult.Blocked
			|| result === CpuSliceResult.Halted
			|| (result === CpuSliceResult.InstructionHalted && !cpu.isMemoryWriteBlocked())
			|| this.sliceCycleBudgetRemaining <= 0
			|| runtime.vblank.tickCompleted
			|| runtime.machine.gxGpu.backendReadbackBlocksMachine()
			|| runtime.machine.systemController.cpuHeld()
			|| cpu.isHaltedUntilIrq();
		if (runCompleted) {
			state.cycleBudgetRemaining = this.sliceCycleBudgetRemaining;
			this.instructionRunActive = false;
		}
		switch (result) {
			case CpuSliceResult.Advanced:
				return InstructionStepResult.Advanced;
			case CpuSliceResult.InstructionYielded:
			case CpuSliceResult.InstructionHalted:
				return InstructionStepResult.Executed;
			case CpuSliceResult.Blocked:
			case CpuSliceResult.Halted:
				return InstructionStepResult.Blocked;
		}
	}

	private runSlice(state: FrameState, maximumCpuCycles: number): CpuSliceResult {
		const runtime = this.runtime;
		let remaining = this.sliceCycleBudgetRemaining;
		const scheduler = runtime.machine.scheduler;
		const cpu = runtime.machine.cpu;
		let advanced = scheduler.hasDueTimer();
		let tickCompleted = runDueRuntimeTimers(runtime);
		while (remaining > 0
			&& !tickCompleted
			&& !runtime.machine.gxGpu.backendReadbackBlocksMachine()
			&& !runtime.machine.systemController.cpuHeld()) {
			if (cpu.isMemoryWriteBlocked()) {
				const nextDeadline = scheduler.nextDeadline();
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					advanced = scheduler.hasDueTimer() || advanced;
					tickCompleted = runDueRuntimeTimers(runtime);
					continue;
				}
				// Device-ready edges release blocked MMIO stores. Advance to scheduled
				// hardware events here; never poll readiness or retry the instruction.
				let waitCycles = deadlineBudget < remaining ? deadlineBudget : remaining;
				if (waitCycles > MAX_CPU_SLICE_CYCLES) waitCycles = MAX_CPU_SLICE_CYCLES;
				remaining -= waitCycles;
				state.activeCpuUsedCycles += waitCycles;
				advanced = true;
				tickCompleted = advanceRuntimeTime(runtime, waitCycles);
				continue;
			}
			let sliceBudget = remaining > maximumCpuCycles ? maximumCpuCycles : remaining;
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					advanced = scheduler.hasDueTimer() || advanced;
					tickCompleted = runDueRuntimeTimers(runtime);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			let result: RunResult;
			scheduler.beginCpuSlice(sliceBudget);
			try {
				result = cpu.runUntilDepth(0, sliceBudget);
			} finally {
				scheduler.endCpuSlice();
			}
			const consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (consumed > 0) {
				remaining -= consumed;
				state.activeCpuUsedCycles += consumed;
				advanced = true;
				tickCompleted = advanceRuntimeTime(runtime, consumed);
			}
			if (cpu.isMemoryWriteBlocked()) {
				if (consumed > 0) {
					this.sliceCycleBudgetRemaining = remaining;
					return result === RunResult.Halted
						? CpuSliceResult.InstructionHalted
						: CpuSliceResult.InstructionYielded;
				}
				continue;
			}
			if (consumed > 0) {
				this.sliceCycleBudgetRemaining = remaining;
				return result === RunResult.Halted
					? CpuSliceResult.InstructionHalted
					: CpuSliceResult.InstructionYielded;
			}
			if (cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
				this.sliceCycleBudgetRemaining = remaining;
				return advanced ? CpuSliceResult.Advanced : CpuSliceResult.Halted;
			}
			throw new Error('CPU yielded without consuming cycles.');
		}
		this.sliceCycleBudgetRemaining = remaining;
		return advanced ? CpuSliceResult.Advanced : CpuSliceResult.Blocked;
	}
}

export function advanceRuntimeTime(runtime: Runtime, cycles: number): boolean {
	runtime.machine.advanceDevices(cycles);
	return runDueRuntimeTimers(runtime);
}

export function runDueRuntimeTimers(runtime: Runtime): boolean {
	const scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const event = scheduler.popDueTimer();
		dispatchRuntimeTimer(runtime, event >> 8, event & 0xff);
	}
	return runtime.vblank.tickCompleted;
}

function dispatchRuntimeTimer(runtime: Runtime, kind: number, payload: number): void {
	switch (kind) {
		case TIMER_KIND_DEVICE_SERVICE: {
			const serviceResult = runtime.machine.runDeviceService(payload);
			if (payload === DEVICE_SERVICE_GPU) {
				if ((serviceResult & GX_GPU_SERVICE_TIMING_PUBLISHED) !== 0) {
					runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
				}
				runtime.vblank.handleGpuRuntimeEdge(serviceResult & GX_GPU_SERVICE_RUNTIME_EDGE_MASK);
			}
			return;
		}
		default:
			throw new Error(`unknown timer kind ${kind}.`);
	}
}
