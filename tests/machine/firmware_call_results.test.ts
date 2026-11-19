import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asClosure, valueBool, valueInteger, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

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

for (const optLevel of [3] as const) test(`firmware O${optLevel}: grouped modf makes format c emit one codepoint`, () => {
	const modules = ['base', 'number/parse', 'number/decimal', 'number/format', 'table', 'math', 'math/trig', 'math/trig/reduce', 'string/base', 'string/mapped', 'string/format'].map(path => ({
		path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
	}));
	modules.push({ path: 'format_char_assert', source: readFileSync('tests/carts/bios_format_manual/format_char_assert.lua', 'utf8') });
	modules.push({ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' });
	const entrySource = `require('base')
math = require('math')
string = require('string/base')
string.format = require('string/format').format
require('format_char_assert').tests.format_char_call_results()
return true
`;
	const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'format_char'),
		modules.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) })),
		{ entrySource, optLevel, programDomain: 'system' });
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
	cpu.installBootPrimitives();
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
});

for (const optLevel of [3] as const) for (const { source, values } of cases) {
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
		runGuestToHalt(cpu, 30_000_000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), ...values]);
	});
}

for (const optLevel of [3] as const) test(`firmware O${optLevel}: generated call syntax retains open results`, () => {
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
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueInteger(42), valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
});

for (const optLevel of [3] as const) test(`firmware O${optLevel}: retained tuple forwarding allocates no guest wrappers`, () => {
	const { cpu } = createCartlibProgramHarness(`
tuple = function(...) return 7, nil, false, 9, nil end
forward = function(...) return ... end
advance = assert(load('for i = 1, 1000 do forward(tuple()) end; return forward(tuple())'))
`, { optLevel });
	runGuestToHalt(cpu, 30_000_000);
	const closure = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('advance')!), cpu.gc);
	runCompletionClosure(cpu, closure, []);
	let heap = cpu.collectTrackedHeapBytes();
	const globals = cpu.globalSlotCount;
	for (let iteration = 0; iteration < 2; iteration++) {
		runCompletionClosure(cpu, closure, []);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7), valueNil(), valueBool(false), valueInteger(9), valueNil()]);
		assert.equal(cpu.luaHeap.usedBytes(), heap, 'no transient guest allocation before collection');
		const stackBytes = heapAllocationBytes(cpu.activeThread.backingByteLength());
		const collected = cpu.collectTrackedHeapBytes();
		assert.equal(collected, heap - (stackBytes - heapAllocationBytes(cpu.activeThread.backingByteLength())));
		heap = collected;
		assert.equal(cpu.globalSlotCount, globals);
	}
});
