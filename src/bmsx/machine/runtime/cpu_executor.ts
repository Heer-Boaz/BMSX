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

	public runWithBudget(runtime: Runtime, state: FrameState, cycleBudgetRemaining: number): RunResult {
		const debugCycle = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugCycle) {
			if (this.debugCycleReportAtMs === 0) {
				this.debugCycleReportAtMs = $.platform.clock.now();
			}
			this.debugCycleRuns += 1;
			this.debugCycleRunsTotal += 1;
		}
		let remaining = cycleBudgetRemaining;
		let result = RunResult.Yielded;
		const scheduler = runtime.machine.scheduler;
		const cpu = runtime.machine.cpu;
		while (remaining > 0) {
			runDueRuntimeTimers(runtime);
			let sliceBudget = remaining;
			const nextDeadline = scheduler.nextDeadline();
			if (nextDeadline !== Number.MAX_SAFE_INTEGER) {
				const deadlineBudget = nextDeadline - scheduler.nowCycles;
				if (deadlineBudget <= 0) {
					continue;
				}
				if (deadlineBudget < sliceBudget) {
					sliceBudget = deadlineBudget;
				}
			}
			scheduler.beginCpuSlice(sliceBudget);
			result = cpu.run(sliceBudget);
			scheduler.endCpuSlice();
			const consumed = sliceBudget - cpu.instructionBudgetRemaining;
			if (consumed > 0) {
				remaining -= consumed;
				state.activeCpuUsedCycles += consumed;
				advanceRuntimeTime(runtime, consumed);
			}
			if (cpu.isHaltedUntilIrq() || result === RunResult.Halted) {
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
				console.info(`runs=${(this.debugCycleRuns * scale).toFixed(3)} yields=${(this.debugCycleYields * scale).toFixed(3)} yield%= ${((this.debugCycleYields / this.debugCycleRuns) * 100).toFixed(2)} avgRemaining=${(this.debugCycleRemainingAcc / this.debugCycleRuns).toFixed(1)} budget=${runtime.timing.cycleBudgetPerFrame}`);
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
	if (cycles <= 0) {
		return;
	}
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
