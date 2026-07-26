import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';

export function callClosureSuspended(runtime: Runtime, fn: Closure, args: ReadonlyArray<Value>): ReadonlyArray<Value> {
	const cpu = runtime.machine.cpu;
	const restoreHalt = cpu.isHaltedUntilIrq();
	if (restoreHalt) {
		cpu.clearHaltUntilIrq();
	}
	try {
		return runtime.callClosure(fn, args);
	} finally {
		if (restoreHalt) {
			cpu.haltUntilIrq();
		}
	}
}
