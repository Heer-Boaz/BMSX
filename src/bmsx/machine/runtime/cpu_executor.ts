import { AcceptedInterruptKind, RunResult } from '../cpu/cpu';
import {
	TIMER_KIND_DEVICE_SERVICE,
	TIMER_KIND_VBLANK_BEGIN,
	TIMER_KIND_VBLANK_END,
} from '../scheduler/device';
import { FrameState, Runtime } from './runtime';

export class CpuExecutionState {
	private debugCycleReportAtMs = 0;
	private debugCycleRuns = 0;
	private debugCycleYields = 0;
	private debugCycleRemainingAcc = 0;
	private debugCycleRunsTotal = 0;
	public debugCycleYieldsTotal = 0;

	constructor(private readonly runtime: Runtime) {
	}

	public clearHaltUntilIrq(): void {
		this.runtime.machine.cpu.clearHaltUntilIrq();
	}

	public runHaltedUntilIrq(state: FrameState): boolean {
		const runtime = this.runtime;
		const cpu = runtime.machine.cpu;
		let cycleBudgetRemaining = state.cycleBudgetRemaining;
		runDueRuntimeTimers(runtime);
		if (!cpu.isHaltedUntilIrq()) {
			return runtime.vblank.tickCompleted;
		}
		const irqController = runtime.machine.irqController;
		const scheduler = runtime.machine.scheduler;
		while (true) {
			if (cpu.acceptPendingInterrupt(irqController) !== AcceptedInterruptKind.None) {
				return runtime.vblank.tickCompleted;
			}
			if (runtime.vblank.tickCompleted) {
				return true;
			}
			if (cycleBudgetRemaining > 0) {
				const cyclesToTarget = scheduler.nextDeadline() - scheduler.nowCycles;
				if (cyclesToTarget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				const idleCycles = cyclesToTarget < cycleBudgetRemaining ? cyclesToTarget : cycleBudgetRemaining;
				cycleBudgetRemaining -= idleCycles;
				state.cycleBudgetRemaining = cycleBudgetRemaining;
				advanceRuntimeTime(runtime, idleCycles);
				continue;
			}
			return true;
		}
	}

	public runWithBudget(state: FrameState): RunResult {
		const runtime = this.runtime;
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = runtime.frameLoop.currentTimeMs;
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		let remaining = state.cycleBudgetRemaining;
		let result = RunResult.Yielded;
		const scheduler = runtime.machine.scheduler;
		const cpu = runtime.machine.cpu;
		runDueRuntimeTimers(runtime);
		if (runtime.vblank.tickCompleted) {
			state.cycleBudgetRemaining = remaining;
			return result;
		}
		// start repeated-sequence-acceptable -- CPU scheduler loop mirrors external-call scheduling without extracting a callback-heavy helper.
		while (remaining > 0) {
			let sliceBudget = remaining;
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					runDueRuntimeTimers(runtime);
					if (runtime.vblank.tickCompleted) {
						break;
					}
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
				advanceRuntimeTime(runtime, consumed);
			}
			if (runtime.vblank.tickCompleted) {
				break;
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
		if (debugCycle) {
			if (result === RunResult.Yielded) {
				this.debugCycleYields += 1;
				this.debugCycleYieldsTotal += 1;
			}
			this.debugCycleRemainingAcc += remaining;
			const now = runtime.frameLoop.currentTimeMs;
			const elapsedMs = now - this.debugCycleReportAtMs;
			if (elapsedMs >= 1000) {
				const scale = 1000 / elapsedMs;
				const runsPerSec = this.debugCycleRuns * scale;
				const yieldsPerSec = this.debugCycleYields * scale;
				const yieldPct = (this.debugCycleYields / this.debugCycleRuns) * 100;
				const avgRemaining = this.debugCycleRemainingAcc / this.debugCycleRuns;
				console.info(`runs=${runsPerSec.toFixed(3)} yields=${yieldsPerSec.toFixed(3)} yield%=${yieldPct.toFixed(2)} avgRemaining=${avgRemaining.toFixed(1)} budget=${runtime.timing.cycleBudgetPerFrame}`);
				this.debugCycleReportAtMs = now;
				this.debugCycleRuns = 0;
				this.debugCycleYields = 0;
				this.debugCycleRemainingAcc = 0;
			}
		}
		return result;
	}

}

export function advanceRuntimeTime(runtime: Runtime, cycles: number): void {
	runtime.machine.advanceDevices(cycles);
	runDueRuntimeTimers(runtime);
}

export function runDueRuntimeTimers(runtime: Runtime): void {
	const scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const event = scheduler.popDueTimer();
		dispatchRuntimeTimer(runtime, event >> 8, event & 0xff);
	}
}

function dispatchRuntimeTimer(runtime: Runtime, kind: number, payload: number): void {
	switch (kind) {
		case TIMER_KIND_VBLANK_BEGIN:
			runtime.vblank.handleBeginTimer();
			return;
		case TIMER_KIND_VBLANK_END:
			runtime.vblank.handleEndTimer();
			return;
		case TIMER_KIND_DEVICE_SERVICE:
			runtime.machine.runDeviceService(payload);
			return;
		default:
			throw new Error(`unknown timer kind ${kind}.`);
	}
}
