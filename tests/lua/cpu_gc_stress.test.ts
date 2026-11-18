import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool, type Value } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { gcStressVectors, installAllocationStress } from '../helpers/gc_stress';

for (const optLevel of [0, 3] as const) {
	for (const [name, body] of Object.entries(gcStressVectors)) {
		const image = compileCoroutineTest(body, optLevel);
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			for (const restore of [false, true]) test(`allocation GC stress: ${name}, O${optLevel}, ${backend}, restore=${restore}`, () => {
				const { cpu } = createTestSystemCpu(image, backend);
				cpu.installBootPrimitives();
				const counter = installAllocationStress(cpu);
				let result = RunResult.Yielded;
				for (let call = 0; call < 50_000 && result === RunResult.Yielded; ++call) {
					result = cpu.runUntilDepth(0, call % 3 === 0 ? 1 : call % 3 === 1 ? 17 : 2048);
					assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `${name}: unexpected guest fault`);
					if (restore && call % 23 === 0) {
						const strings = cpu.stringPool.captureState();
						const state = cpu.captureRuntimeState();
						cpu.stringPool.restoreState(strings);
						cpu.restoreRuntimeState(state);
						assert.deepEqual(cpu.captureRuntimeState(), state);
					}
				}
				assert.equal(result, RunResult.Halted);
				const results: Value[] = [];
				cpu.readCompletionValues(results);
				assert.deepEqual(results, [valueBool(true)]);
				assert.ok(counter.allocations > 32, 'stress exercised repeated real allocation/collection boundaries');
			});
		}
	}
}
