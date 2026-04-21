import { $ } from '../../core/engine';
import { RunResult } from '../cpu/cpu';
import {
	TIMER_KIND_DEVICE_SERVICE,
	TIMER_KIND_VBLANK_BEGIN,
	TIMER_KIND_VBLANK_END,
} from '../scheduler/device';
import { runtimeFault } from '../../ide/runtime/lua_pipeline';
import type { FrameState, Runtime } from './runtime';

export class CpuExecutionState {
	private debugCycleReportAtMs = 0;
	private debugCycleRuns = 0;
	private debugCycleYields = 0;
	private debugCycleRemainingAcc = 0;
	private debugCycleRunsTotal = 0;
	public debugCycleYieldsTotal = 0;

	public runWithBudget(runtime: Runtime, state: FrameState): RunResult {
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = $.platform.clock.now();
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		let remaining = state.cycleBudgetRemaining;
		let result = RunResult.Yielded;
		runDueRuntimeTimers(runtime);
		while (remaining > 0) {
			let sliceBudget = remaining;
			const nextDeadline = runtime.machine.scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - runtime.machine.scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			runtime.machine.scheduler.beginCpuSlice(sliceBudget);
			result = runtime.machine.cpu.run(sliceBudget);
			runtime.machine.scheduler.endCpuSlice();
			const sliceRemaining = runtime.machine.cpu.instructionBudgetRemaining;
			const consumed = sliceBudget - sliceRemaining;
			if (consumed > 0) {
				remaining -= consumed;
				state.activeCpuUsedCycles += consumed;
				advanceRuntimeTime(runtime, consumed);
			}
			if (runtime.machine.cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
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
	while (runtime.machine.scheduler.hasDueTimer()) {
		const event = runtime.machine.scheduler.popDueTimer();
		dispatchRuntimeTimer(runtime, event >> 8, event & 0xff);
	}
}

function dispatchRuntimeTimer(runtime: Runtime, kind: number, payload: number): void {
	switch (kind) {
		case TIMER_KIND_VBLANK_BEGIN:
			runtime.vblank.handleBeginTimer(runtime);
			return;
		case TIMER_KIND_VBLANK_END:
			runtime.vblank.handleEndTimer(runtime);
			return;
		case TIMER_KIND_DEVICE_SERVICE:
			runtime.machine.runDeviceService(payload);
			return;
		default:
			throw runtimeFault(`unknown timer kind ${kind}.`);
	}
}
