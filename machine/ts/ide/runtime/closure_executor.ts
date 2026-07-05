import { AcceptedInterruptKind, Closure, RunResult, type Value } from '../../machine/cpu/cpu';
import { advanceRuntimeTime, runDueRuntimeTimers } from '../../machine/runtime/cpu_executor';
import type { Runtime } from '../../machine/runtime/runtime';

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

export function callClosureIntoWithScheduler(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const scheduler = runtime.machine.scheduler;
	const depth = cpu.getFrameDepth();
	const previousBudget = cpu.instructionBudgetRemaining;
	const budgetSentinel = Number.MAX_SAFE_INTEGER;
	const previousSink = cpu.swapExternalReturnSink(out);
	let spentBudget = 0;
	out.length = 0;
	cpu.enterHostExternalCall();
	try {
		cpu.callExternal(fn, args);
		let remaining = budgetSentinel;
		runDueRuntimeTimers(runtime);
		while (cpu.getFrameDepth() > depth) {
			let sliceBudget = remaining;
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
			scheduler.beginCpuSlice(sliceBudget);
			let result = RunResult.Yielded;
			let consumed = 0;
			try {
				result = cpu.runUntilDepth(depth, sliceBudget);
			} finally {
				scheduler.endCpuSlice();
				consumed = sliceBudget - cpu.instructionBudgetRemaining;
				if (consumed > 0) {
					remaining -= consumed;
					spentBudget += consumed;
					advanceRuntimeTime(runtime, consumed);
				}
			}
			if (cpu.getFrameDepth() <= depth) {
				break;
			}
			if (result === RunResult.Halted) {
				const idleCycles = runHaltedClosureUntilInterrupt(runtime);
				remaining -= idleCycles;
				spentBudget += idleCycles;
				if (cpu.isHaltedUntilIrq()) {
					break;
				}
				continue;
			}
			if (consumed <= 0) {
				runDueRuntimeTimers(runtime);
			}
		}
	} catch (error) {
		cpu.unwindToDepth(depth);
		throw error;
	} finally {
		cpu.swapExternalReturnSink(previousSink);
		cpu.instructionBudgetRemaining = previousBudget - spentBudget;
		cpu.leaveHostExternalCall();
	}
}

export function callClosureIntoSuspended(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>, out: Value[]): void {
	const cpu = runtime.machine.cpu;
	const restoreHalt = cpu.isHaltedUntilIrq();
	if (restoreHalt) {
		cpu.clearHaltUntilIrq();
	}
	try {
		runtime.callClosureInto(fn, args, out);
	} finally {
		if (restoreHalt) {
			cpu.haltUntilIrq();
		}
	}
}
