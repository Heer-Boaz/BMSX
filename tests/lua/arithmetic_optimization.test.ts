import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

test('O3 algebraic operations preserve O0 numeric conversion and IEEE-754 results', () => {
	const source = `
return function(x)
    return x + 0, 0 + x, x - 0, 0 - x, x * 1, 1 * x, x / 1, x ^ 1
end`;
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const machines = ([0, 3] as const).map(optLevel => {
			const image = linkTestSystemBlua32(compileLuaSource(source, 'arithmetic-identity.lua', optLevel));
			const { cpu } = createTestSystemCpu(image, backend);
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			return { cpu, closure: materializeCpuCompletionValues(cpu)[0] as Closure };
		});
		for (const input of [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE,
			Number.MAX_VALUE, Infinity, -Infinity, NaN, null, false, true] as Value[]) {
			const outputs = machines.map(({ cpu, closure }) => {
				runCompletionClosure(cpu, closure, [input]);
				return materializeCpuCompletionValues(cpu);
			});
			for (let i = 0; i < outputs[0].length; i += 1) {
				assert.ok(Object.is(outputs[0][i], outputs[1][i]), `${backend}, input ${String(input)}, operation ${i}: O0=${String(outputs[0][i])}, O3=${String(outputs[1][i])}`);
			}
			if (Object.is(input, -0)) {
				assert.ok(Object.is(outputs[1][0], 0));
				assert.ok(Object.is(outputs[1][1], 0));
				assert.ok(Object.is(outputs[1][2], -0));
			}
		}
	}
});
