import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';

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
