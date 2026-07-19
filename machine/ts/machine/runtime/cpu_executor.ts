import { RunResult } from '../cpu/cpu';
import { GX_GPU_SERVICE_RUNTIME_EDGE_MASK, GX_GPU_SERVICE_TIMING_PUBLISHED } from '../devices/gx/gpu';
import {
	DEVICE_SERVICE_GPU,
	TIMER_KIND_DEVICE_SERVICE,
} from '../scheduler/device';
import type { FrameState } from './frame/state';
import { Runtime } from './runtime';

const MAX_CPU_SLICE_CYCLES = 0x7fffffff;

export class CpuExecutionState {
	constructor(private readonly runtime: Runtime) {
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
		const runtime = this.runtime;
		let remaining = state.cycleBudgetRemaining;
		let result = RunResult.Yielded;
		const scheduler = runtime.machine.scheduler;
		const cpu = runtime.machine.cpu;
		let tickCompleted = runDueRuntimeTimers(runtime);
		// start repeated-sequence-acceptable -- CPU scheduler loop mirrors external-call scheduling without extracting a callback-heavy helper.
		while (remaining > 0
			&& !tickCompleted
			&& !runtime.machine.gxGpu.backendReadbackBlocksMachine()
			&& !runtime.machine.systemController.cpuHeld()) {
			if (cpu.isMemoryWriteBlocked()) {
				const nextDeadline = scheduler.nextDeadline();
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					tickCompleted = runDueRuntimeTimers(runtime);
					continue;
				}
				// Device-ready edges release blocked MMIO stores. Advance to scheduled
				// hardware events here; never poll readiness or retry the instruction.
				let waitCycles = deadlineBudget < remaining ? deadlineBudget : remaining;
				if (waitCycles > MAX_CPU_SLICE_CYCLES) waitCycles = MAX_CPU_SLICE_CYCLES;
				remaining -= waitCycles;
				state.activeCpuUsedCycles += waitCycles;
				tickCompleted = advanceRuntimeTime(runtime, waitCycles);
				continue;
			}
			let sliceBudget = remaining > MAX_CPU_SLICE_CYCLES ? MAX_CPU_SLICE_CYCLES : remaining;
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					tickCompleted = runDueRuntimeTimers(runtime);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
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
				tickCompleted = advanceRuntimeTime(runtime, consumed);
			}
			if (cpu.isMemoryWriteBlocked()) {
				continue;
			}
			if (cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
				break;
			}
			if (consumed <= 0) {
				throw new Error('CPU yielded without consuming cycles.');
			}
		}
		// end repeated-sequence-acceptable
		state.cycleBudgetRemaining = remaining;
		return result;
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
