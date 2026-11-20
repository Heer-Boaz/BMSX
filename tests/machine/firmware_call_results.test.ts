import assert from 'node:assert/strict';
import test from 'node:test';
import { asClosure, valueBool, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { createCartlibCaseRom } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';

// A ceiling for the small test-ROM boot or guest call, not an execution target.
const firmwareCycleLimit = 500_000;

const cases: { source: string; values: Value[] }[] = [
	{ source: 'return', values: [] },
	{ source: '', values: [] },
	{ source: 'return nil', values: [valueNil()] },
	{ source: 'local uninitialized; return uninitialized', values: [valueNil()] },
	{ source: 'return tuple()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return 1, nil, tuple()', values: [valueInteger(1), valueNil(), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return tuple(), 0', values: [valueInteger(7), valueInteger(0)] },
	{ source: 'return (tuple())', values: [valueInteger(7)] },
	{ source: 'return 1, ((tuple()))', values: [valueInteger(1), valueInteger(7)] },
	{ source: 'return (tuple)()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return (function() return tuple end)()()', values: [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return spread(1, tuple())', values: [valueInteger(1), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return spread(tuple(), 2)', values: [valueInteger(7), valueInteger(2)] },
	{ source: 'return spread(1, (tuple()))', values: [valueInteger(1), valueInteger(7)] },
	{ source: 'return receiver:spread(1, tuple())', values: [valueInteger(40), valueInteger(1), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return true and tuple()', values: [valueInteger(7)] },
	{ source: 'local x = tuple(); x = tuple(); return x, tuple()', values: [valueInteger(7), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'return select(2, 7)', values: [] },
	{ source: 'return 1, select(2, 7)', values: [valueInteger(1)] },
	{ source: 'return spread(1, select(2, 7))', values: [valueInteger(1)] },
	{ source: 'return (select(2, 7))', values: [valueNil()] },
	{ source: 'return pcall(tuple)', values: [valueBool(true), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()] },
	{ source: 'local t = table.pack(mark(1), spread(mark(2), mark(3))); return trace, t.n, t[1], t[2], t[3], t[4]', values: [valueInteger(123), valueInteger(4), valueInteger(1), valueInteger(2), valueInteger(3), valueInteger(-3)] },
	{ source: 'return 999, wide()', values: [valueInteger(999), ...Array.from({ length: 260 }, (_, index) => valueInteger(index))] },
];

const callResultRom = createCartlibCaseRom(`
tuple = function(...) return 7, nil, false, 9, nil end
spread = function(...) return ... end
receiver = { value = 40, spread = function(self, ...) return self.value, ... end }
trace = 0
mark = function(value, ...) trace = trace * 10 + value; return value, -value end
wide = function(...) return ${Array.from({ length: 260 }, (_, index) => index).join(',')} end
`, { optLevel: 3 });

for (const { source, values } of cases) {
	const index = callResultRom.add(`return pcall(assert(load(${JSON.stringify(source)})))`);
	test(`firmware O3 call results: ${source}`, () => {
		const cpu = callResultRom.run(index, firmwareCycleLimit);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), ...values]);
	});
}

const generatedCall = callResultRom.add(`
local f<const> = lua_compiler.syntax_factory
local source<const> = f.chunk(f.block({ f.return_statement({
 f.number_literal(42),
 f.call_expression(f.identifier('spread'), { f.call_expression(f.identifier('tuple'), {}) }),
}) }))
return pcall(lua_compiler.compile_syntax(source, '=tuple-syntax'))
`);
test('firmware O3: generated call syntax retains open results', () => {
	const cpu = callResultRom.run(generatedCall, firmwareCycleLimit);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueInteger(42), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
});

const retainedForward = callResultRom.add(`
local factory<const> = assert(load('return function(count) for i = 1, count do spread(tuple()) end; return spread(tuple()) end'))
advance = factory()
`);
test('firmware O3: retained tuple forwarding allocates no guest wrappers', () => {
	const cpu = callResultRom.run(retainedForward, firmwareCycleLimit);
	// The warmed probe collects the guest heap between calls.
	const closure = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('advance')!), cpu.gc);
	const globals = cpu.globalSlotCount;
	const profile = profileWarmGuestKernel(cpu, closure, 8, firmwareCycleLimit);
	assert.equal(profile.reservations, 0, 'forwarding an open tuple must not reserve guest heap storage');
	assert.equal(cpu.globalSlotCount, globals);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
});
