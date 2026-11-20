import assert from 'node:assert/strict';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

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

export function runSystemCaseRom(rom: Uint8Array, onSuspend: (runtime: Runtime) => void, cpuExecutionBackend?: CpuExecutionBackend): number {
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const cpu = runtime.machine.cpu;
	let suspensions = 0;
	for (let grant = 0; grant < 32; grant++) {
		const result = cpu.runUntilDepth(0, 1_000_000);
		assert.equal(cpu.readLuaFaultReasonWord(), 0, 'the guest suite must not fault');
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
		if (result === RunResult.Yielded) continue;
		assert.equal(result, RunResult.Halted);
		if (!cpu.isHaltedUntilIrq()) {
			assert.deepEqual(runtime.readCompletionValues(), [valueBool(true), valueBool(true)]);
			return suspensions;
		}
		onSuspend(runtime);
		suspensions++;
		cpu.clearHaltUntilIrq();
	}
	assert.fail('the guest suite did not complete within its cycle grants');
}
