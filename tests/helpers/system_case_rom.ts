import assert from 'node:assert/strict';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { runCpuWithinBudget } from './cpu_execution';

/** Lexical isolation and a guest assertion per case, without a new boot. */
export function systemCaseSource(cases: readonly [name: string, body: string][]): string {
	return cases.map(([name, body]) => `do
 local ok<const>, passed<const> = pcall(function()
${body}
 end)
 assert(ok, passed)
 assert(passed == true, ${JSON.stringify(name)})
end`).join('\n') + '\nreturn true, true';
}

export function runSystemCaseRom(rom: Uint8Array, onSuspend: (runtime: Runtime) => void, cpuExecutionBackend?: CpuExecutionBackend, maxGrants = 32): number {
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const cpu = runtime.machine.cpu;
	let suspensions = 0;
	for (let grant = 0; grant < maxGrants; grant++) {
		const result = runCpuWithinBudget(cpu, 1_000_000);
		if (result === RunResult.Yielded) continue;
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false, 'the guest suite must not hard-halt');
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1, 'no exception remains active at the stopping point');
		if (!cpu.isHaltedUntilIrq()) {
			assert.equal(cpu.getFrameDepth(), 0);
			assert.deepEqual(runtime.readCompletionValues(), [valueBool(true), valueBool(true)]);
			return suspensions;
		}
		onSuspend(runtime);
		suspensions++;
		cpu.clearHaltUntilIrq();
	}
	assert.fail('the guest suite did not complete within its cycle grants');
}
