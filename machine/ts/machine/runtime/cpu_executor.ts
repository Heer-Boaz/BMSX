import { CpuRunKind, RunResult } from '../cpu/cpu';
import { GX_GPU_SERVICE_RUNTIME_EDGE_MASK, GX_GPU_SERVICE_TIMING_PUBLISHED } from '../devices/gx/gpu';
import { DEVICE_SERVICE_GPU } from '../scheduler/device';
import {
	InstructionStepResult,
	type FrameState,
} from './frame/state';
import type { Runtime } from './runtime';

export const MAX_CPU_SLICE_CYCLES = 0x7fffffff;

export const enum CpuExecutionResult {
	Halted,
	Yielded,
	ExecutionStopped,
}

export const enum CpuSuspendedRunResult {
	Completed,
	Yielded,
	Halted,
	ExecutionStopped,
}

const enum ClockRun { Devices, RetiredCpu, RetainedCpu }

const enum CpuSliceResult {
	Blocked,
	Advanced,
	InstructionYielded,
	InstructionHalted,
	ParkedAllocation,
	ExecutionStopped,
	Halted,
}

export class CpuExecutionState {
	constructor(private readonly runtime: Runtime) {
	}

	public runStoppedCpu(state: FrameState): boolean {
		const runtime = this.runtime;
		const machine = runtime.machine;
		const cpu = machine.cpu;
		const service = cpu.heapServiceActive();
		if (!service && cpu.allocationParked()) return false;
		const gxGpu = machine.gxGpu;
		let tickCompleted = runDueRuntimeTimers(runtime);
		if (gxGpu.backendServiceBlocksMachine()) {
			return tickCompleted;
		}
		if ((service || !cpu.isHaltedUntilIrq()) && !machine.systemController.cpuHeld() && !machine.dmaController.cpuBusHeld()) {
			return tickCompleted;
		}
		const scheduler = machine.scheduler;
		while (true) {
			if (!service && !machine.systemController.cpuHeld() && !machine.dmaController.cpuBusHeld() && cpu.enterPendingInterrupt()) {
				return tickCompleted;
			}
			if ((service || !cpu.isHaltedUntilIrq()) && !machine.systemController.cpuHeld() && !machine.dmaController.cpuBusHeld()) {
				return tickCompleted;
			}
			if (tickCompleted) {
				return true;
			}
			if (state.cycleBudgetRemaining > 0) {
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
					if (gxGpu.backendServiceBlocksMachine()) {
						return tickCompleted;
					}
					continue;
				}
				let idleCycles = cyclesToTarget < state.cycleBudgetRemaining ? cyclesToTarget : state.cycleBudgetRemaining;
				if (idleCycles > MAX_CPU_SLICE_CYCLES) idleCycles = MAX_CPU_SLICE_CYCLES;
				state.cycleBudgetRemaining -= idleCycles;
				tickCompleted = advanceRuntimeTime(runtime, idleCycles);
				if (gxGpu.backendServiceBlocksMachine()) {
					return tickCompleted;
				}
				continue;
			}
			return true;
		}
	}

	public runWithBudget(state: FrameState): CpuExecutionResult {
		let result = CpuExecutionResult.Yielded;
		const { machine: { cpu }, vblank } = this.runtime;
		let running = true;
		while (running && !vblank.tickCompleted && (cpu.heapServiceActive()
			|| (cpu.allocationParked() ? cpu.allocationReady() : !cpu.gc.stoppedFinalMarkPending() && !vblank.hasDeferredPressure()))) {
			switch (this.runSlice(state, MAX_CPU_SLICE_CYCLES)) {
				case CpuSliceResult.Advanced:
					continue;
				case CpuSliceResult.InstructionYielded:
					result = CpuExecutionResult.Yielded;
					continue;
				case CpuSliceResult.InstructionHalted:
					result = CpuExecutionResult.Halted;
					if (cpu.isMemoryWriteBlocked()) {
						continue;
					}
					running = false;
					continue;
				case CpuSliceResult.ExecutionStopped:
					result = CpuExecutionResult.ExecutionStopped;
					running = false;
					continue;
				case CpuSliceResult.Halted:
					result = CpuExecutionResult.Halted;
					running = false;
					continue;
				case CpuSliceResult.ParkedAllocation:
				case CpuSliceResult.Blocked:
					running = false;
					continue;
			}
		}
		return result;
	}

	public runInstruction(state: FrameState): InstructionStepResult {
		const cpu = this.runtime.machine.cpu;
		const result = this.runSlice(state, !cpu.heapServiceActive() && cpu.gc.fullEpochs() ? MAX_CPU_SLICE_CYCLES : 1);
		switch (result) {
			case CpuSliceResult.Advanced:
				return InstructionStepResult.Advanced;
			case CpuSliceResult.InstructionYielded:
			case CpuSliceResult.InstructionHalted:
				return InstructionStepResult.Executed;
			case CpuSliceResult.ExecutionStopped:
				return InstructionStepResult.ExecutionStopped;
			case CpuSliceResult.ParkedAllocation:
			case CpuSliceResult.Blocked:
			case CpuSliceResult.Halted:
				return InstructionStepResult.Blocked;
		}
	}

	public runSuspendedUntilDepth(targetDepth: number, cycleBudget = MAX_CPU_SLICE_CYCLES, targetThread: number = this.runtime.machine.cpu.activeThread.address): CpuSuspendedRunResult {
		const runtime = this.runtime;
		const machine = runtime.machine;
		const cpu = machine.cpu;
		const scheduler = machine.scheduler;
		if (!cpu.heapServiceActive() && (cpu.allocationParked() || runtime.vblank.hasDeferredPressure())) return CpuSuspendedRunResult.Halted;
		// Scheduled work still owes physical edges to the frame owner.
		if (scheduler.acceptedCpuCycles !== 0) return CpuSuspendedRunResult.Yielded;
		const endCycle = scheduler.nowCycles + cycleBudget;
		if (!cpu.heapServiceActive() && cpu.gc.stoppedFinalMarkPending()) cpu.gc.finishFinalMark();
		runDueRuntimeTimers(runtime);
		while (cpu.readThreadFrameDepth(targetThread) > targetDepth) {
			if (scheduler.nowCycles >= endCycle) return CpuSuspendedRunResult.Yielded;
			if (machine.gxGpu.backendServiceBlocksMachine()
				|| machine.systemController.cpuHeld()) {
				return CpuSuspendedRunResult.Halted;
			}
			if ((!cpu.heapServiceActive() && cpu.isMemoryWriteBlocked()) || machine.dmaController.cpuBusHeld()) {
				const nextDeadline = scheduler.nextDeadline();
				if (nextDeadline === Number.MAX_SAFE_INTEGER) {
					return CpuSuspendedRunResult.Halted;
				}
				const waitBudget = Math.min(nextDeadline, endCycle) - scheduler.nowCycles;
				if (waitBudget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				const waitCycles = waitBudget < MAX_CPU_SLICE_CYCLES
					? waitBudget
					: MAX_CPU_SLICE_CYCLES;
				advanceRuntimeTime(runtime, waitCycles);
				continue;
			}
			let sliceBudget = Math.min(MAX_CPU_SLICE_CYCLES, endCycle - scheduler.nowCycles);
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			const result = scheduler.runCpuSlice(targetDepth, sliceBudget, targetThread);
			const consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (consumed > 0) {
				advanceRuntimeTime(runtime, consumed);
				if (machine.systemController.cpuHeld()) {
					return CpuSuspendedRunResult.Halted;
				}
			}
			if (!cpu.heapServiceActive() && cpu.gc.stoppedFinalMarkPending()) cpu.gc.finishFinalMark();
			if (cpu.readThreadFrameDepth(targetThread) <= targetDepth) {
				return CpuSuspendedRunResult.Completed;
			}
			if (!cpu.heapServiceActive() && (cpu.allocationParked() || runtime.vblank.hasDeferredPressure())) return CpuSuspendedRunResult.Halted;
			if (result === RunResult.ExecutionStopped) {
				return CpuSuspendedRunResult.ExecutionStopped;
			}
			if (cpu.isMemoryWriteBlocked()) {
				continue;
			}
			if (result === RunResult.Halted) {
				if (!cpu.isHaltedUntilIrq()) {
					return CpuSuspendedRunResult.Halted;
				}
				let advancedDeadline = false;
				while (cpu.isHaltedUntilIrq()) {
					if (scheduler.nowCycles >= endCycle) return CpuSuspendedRunResult.Yielded;
					if (machine.gxGpu.backendServiceBlocksMachine()) {
						return CpuSuspendedRunResult.Halted;
					}
					const cpuHeld = machine.systemController.cpuHeld() || machine.dmaController.cpuBusHeld();
					if (!cpuHeld && cpu.enterPendingInterrupt()) {
						break;
					}
					if (!cpuHeld && advancedDeadline) {
						return CpuSuspendedRunResult.Halted;
					}
					const haltedDeadline = scheduler.nextDeadline();
					if (haltedDeadline === Number.MAX_SAFE_INTEGER) {
						return CpuSuspendedRunResult.Halted;
					}
					const cyclesToDeadline = Math.min(haltedDeadline, endCycle) - scheduler.nowCycles;
					if (cyclesToDeadline <= 0) {
						if (runDueRuntimeTimers(runtime)) {
							return CpuSuspendedRunResult.Halted;
						}
						continue;
					}
					const idleCycles = cyclesToDeadline < MAX_CPU_SLICE_CYCLES
						? cyclesToDeadline
						: MAX_CPU_SLICE_CYCLES;
					advanceRuntimeTime(runtime, idleCycles);
					advancedDeadline = idleCycles === cyclesToDeadline;
				}
				continue;
			}
			if (consumed <= 0) {
				runDueRuntimeTimers(runtime);
			}
		}
		return CpuSuspendedRunResult.Completed;
	}

	private runSlice(
		state: FrameState,
		maximumCpuCycles: number,
	): CpuSliceResult {
		const runtime = this.runtime;
		const scheduler = runtime.machine.scheduler;
		const cpu = runtime.machine.cpu;
		const service = cpu.heapServiceActive();
		if (service && cpu.allocationParked() && state.deferredAllocationCycles !== 0) {
			// Charge the issuing instruction's accepted prefix before its
			// first timed recovery grant, not again when it retries.
			const deferred = state.deferredAllocationCycles;
			state.deferredAllocationCycles = 0;
			settleRetiredCpuGrant(runtime, state, deferred);
			return CpuSliceResult.Advanced;
		}
		if (!service && cpu.allocationParked()) {
			if (!cpu.allocationReady()) return CpuSliceResult.ParkedAllocation;
			const deferred = state.deferredAllocationCycles;
			cpu.instructionBudgetRemaining = 0;
			scheduler.beginCpuSlice(deferred);
			try {
				cpu.resumeAllocation();
			} finally {
				scheduler.endCpuSlice();
			}
			const consumed = deferred - cpu.instructionBudgetRemaining;
			if (cpu.allocationParked()) {
				state.deferredAllocationCycles = consumed;
				return CpuSliceResult.ParkedAllocation;
			}
			state.deferredAllocationCycles = 0;
			settleRetiredCpuGrant(runtime, state, consumed);
			return cpu.getFrameDepth() !== 0 ? CpuSliceResult.InstructionYielded : CpuSliceResult.InstructionHalted;
		}
		let advanced = scheduler.hasDueTimer();
		let tickCompleted = runDueRuntimeTimers(runtime);
		while (state.cycleBudgetRemaining > 0
			&& !tickCompleted
			&& !runtime.machine.gxGpu.backendServiceBlocksMachine()
			&& !runtime.machine.systemController.cpuHeld()) {
			if ((!service && cpu.isMemoryWriteBlocked()) || runtime.machine.dmaController.cpuBusHeld()) {
				const nextDeadline = scheduler.nextDeadline();
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					advanced = scheduler.hasDueTimer() || advanced;
					tickCompleted = runDueRuntimeTimers(runtime);
					continue;
				}
				// Device-ready edges release blocked MMIO stores. Advance to scheduled
				// hardware events here; never poll readiness or retry the instruction.
				let waitCycles = deadlineBudget < state.cycleBudgetRemaining ? deadlineBudget : state.cycleBudgetRemaining;
				if (waitCycles > MAX_CPU_SLICE_CYCLES) waitCycles = MAX_CPU_SLICE_CYCLES;
				state.cycleBudgetRemaining -= waitCycles;
				state.activeCpuUsedCycles += waitCycles;
				advanced = true;
				tickCompleted = advanceRuntimeTime(runtime, waitCycles);
				continue;
			}
			let sliceBudget = state.cycleBudgetRemaining > maximumCpuCycles ? maximumCpuCycles : state.cycleBudgetRemaining;
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
			const result = scheduler.runCpuSlice(0, sliceBudget, undefined, CpuRunKind.Scheduled);
			const consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (result === RunResult.ParkedAllocation) {
				state.deferredAllocationCycles = consumed;
				return CpuSliceResult.ParkedAllocation;
			}
			if (consumed > 0) {
				// Device timers publish this frame's remainder at the VBlank edge.
				advanced = true;
				if (consumed > sliceBudget) {
					tickCompleted = settleRetiredCpuGrant(runtime, state, consumed);
				} else {
					state.cycleBudgetRemaining -= consumed;
					state.activeCpuUsedCycles += consumed;
					tickCompleted = advanceRuntimeTime(runtime, consumed);
				}
			}
			if (result === RunResult.CollectionProgress) return CpuSliceResult.Advanced;
			if (result === RunResult.ExecutionStopped) {
				return CpuSliceResult.ExecutionStopped;
			}
			if (service && consumed === 0) return advanced ? CpuSliceResult.Advanced : CpuSliceResult.Blocked;
			if (cpu.isMemoryWriteBlocked()) {
				if (consumed > 0) {
					return result === RunResult.Halted
						? CpuSliceResult.InstructionHalted
						: CpuSliceResult.InstructionYielded;
				}
				continue;
			}
			if (consumed > 0) {
				return result === RunResult.Halted
					? CpuSliceResult.InstructionHalted
					: CpuSliceResult.InstructionYielded;
			}
			if (cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
				return advanced ? CpuSliceResult.Advanced : CpuSliceResult.Halted;
			}
			throw new Error('CPU yielded without consuming cycles.');
		}
		return advanced ? CpuSliceResult.Advanced : CpuSliceResult.Blocked;
	}
}

function settleRetiredCpuGrant(runtime: Runtime, state: FrameState, cycles: number): boolean {
	const scheduler = runtime.machine.scheduler;
	state.cycleBudgetRemaining -= cycles;
	state.activeCpuUsedCycles += cycles;
	scheduler.acceptedCpuCycles = cycles;
	return settleTime(runtime, scheduler.nowCycles + cycles, ClockRun.RetiredCpu);
}

function settleTime(runtime: Runtime, targetCycle: number, run: ClockRun): boolean {
	const scheduler = runtime.machine.scheduler;
	let tickCompleted = runDueRuntimeTimers(runtime);
	// Device edges retire in absolute clock order, regardless of how much
	// time an instruction accepted before the next device deadline.
	while (scheduler.nowCycles < targetCycle) {
		if (run === ClockRun.RetainedCpu && runtime.machine.gxGpu.backendServiceBlocksMachine()) break;
		if (run !== ClockRun.Devices && tickCompleted) {
			// At VBlank the beam publishes the exact spacing to its next
			// VBlank. The CPU cannot write beam timing during settlement.
			const interval = runtime.timing.cycleBudgetPerFrame;
			if (interval > 0 && targetCycle - scheduler.nowCycles >= interval) break;
		}
		scheduler.advanceTo(Math.min(scheduler.nextDeadline(), targetCycle));
		tickCompleted = runDueRuntimeTimers(runtime);
	}
	return tickCompleted;
}

export function advanceRuntimeTime(runtime: Runtime, cycles: number): boolean {
	return settleTime(runtime, runtime.machine.scheduler.nowCycles + cycles, ClockRun.Devices);
}

export function settleAcceptedCpuTime(runtime: Runtime): boolean {
	const scheduler = runtime.machine.scheduler;
	return settleTime(runtime, scheduler.nowCycles + scheduler.acceptedCpuCycles, ClockRun.RetainedCpu);
}

export function runDueRuntimeTimers(runtime: Runtime): boolean {
	const scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const deviceKind = scheduler.popDueTimer();
		const serviceResult = runtime.machine.runDeviceService(deviceKind);
		if (deviceKind === DEVICE_SERVICE_GPU) {
			if ((serviceResult & GX_GPU_SERVICE_TIMING_PUBLISHED) !== 0) {
				runtime.applyPublishedGxGpuPcrtcTiming(runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming);
			}
			runtime.vblank.handleGpuRuntimeEdge(serviceResult & GX_GPU_SERVICE_RUNTIME_EDGE_MASK);
		}
	}
	return runtime.vblank.tickCompleted;
}
