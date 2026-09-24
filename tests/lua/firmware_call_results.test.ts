import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

const cases: { source: string; values: (number | boolean | null)[] }[] = [
	{ source: 'return tuple()', values: [7, null, false, 9, null] },
	{ source: 'return 1, nil, tuple()', values: [1, null, 7, null, false, 9, null] },
	{ source: 'return tuple(), 0', values: [7, 0] },
	{ source: 'return (tuple())', values: [7] },
	{ source: 'return 1, ((tuple()))', values: [1, 7] },
	{ source: 'return (tuple)()', values: [7, null, false, 9, null] },
	{ source: 'return (function() return tuple end)()()', values: [7, null, false, 9, null] },
	{ source: 'return spread(1, tuple())', values: [1, 7, null, false, 9, null] },
	{ source: 'return spread(tuple(), 2)', values: [7, 2] },
	{ source: 'return spread(1, (tuple()))', values: [1, 7] },
	{ source: 'return receiver:spread(1, tuple())', values: [40, 1, 7, null, false, 9, null] },
	{ source: 'return true and tuple()', values: [7] },
	{ source: 'local x = tuple(); x = tuple(); return x, tuple()', values: [7, 7, null, false, 9, null] },
	{ source: 'return select(2, 7)', values: [] },
	{ source: 'return 1, select(2, 7)', values: [1] },
	{ source: 'return spread(1, select(2, 7))', values: [1] },
	{ source: 'return (select(2, 7))', values: [null] },
	{ source: 'return pcall(tuple)', values: [true, 7, null, false, 9, null] },
	{ source: 'local t = table.pack(mark(1), spread(mark(2), mark(3))); return trace, t.n, t[1], t[2], t[3], t[4]', values: [123, 4, 1, 2, 3, -3] },
	{ source: 'return 999, wide()', values: [999, ...Array.from({ length: 260 }, (_, index) => index)] },
];

for (const optLevel of [0, 3] as const) for (const { source, values } of cases) {
	test(`firmware O${optLevel} call results: ${source}`, () => {
		const { cpu } = createCartlibProgramHarness(`
tuple = function(...) return 7, nil, false, 9, nil end
spread = function(...) return ... end
receiver = { value = 40, spread = function(self, ...) return self.value, ... end }
trace = 0
mark = function(value, ...) trace = trace * 10 + value; return value, -value end
wide = function(...) return ${Array.from({ length: 260 }, (_, index) => index).join(',')} end
return pcall(assert(load(${JSON.stringify(source)})))
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, ...values]);
	});
}

for (const optLevel of [0, 3] as const) test(`firmware O${optLevel}: generated call syntax retains open results`, () => {
	const { cpu } = createCartlibProgramHarness(`
tuple = function(...) return 7, nil, false, 9, nil end
spread = function(...) return ... end
local f<const> = lua_compiler.syntax_factory
local source<const> = f.chunk(f.block({ f.return_statement({
 f.number_literal(42),
 f.call_expression(f.identifier('spread'), { f.call_expression(f.identifier('tuple'), {}) }),
}) }))
return pcall(lua_compiler.compile_syntax(source, '=tuple-syntax'))
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, 42, 7, null, false, 9, null]);
});

for (const optLevel of [0, 3] as const) test(`firmware O${optLevel}: retained tuple forwarding allocates no guest wrappers`, () => {
	const { cpu } = createCartlibProgramHarness(`
tuple = function(...) return 7, nil, false, 9, nil end
forward = function(...) return ... end
advance = assert(load('for i = 1, 1000 do forward(tuple()) end; return forward(tuple())'))
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	const closure = cpu.getGlobalByKey(cpu.stringPool.find('advance')!) as Closure;
	runCompletionClosure(cpu, closure, []);
	const heap = cpu.collectTrackedHeapBytes(), globals = cpu.globalSlotCount;
	for (let iteration = 0; iteration < 2; iteration++) {
		runCompletionClosure(cpu, closure, []);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [7, null, false, 9, null]);
		assert.equal(cpu.luaHeap.usedBytes(), heap, 'no transient guest allocation before collection');
		assert.equal(cpu.collectTrackedHeapBytes(), heap);
		assert.equal(cpu.globalSlotCount, globals);
	}
});
