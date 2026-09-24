import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) test(`firmware load binds ordinary globals, not caller-image ordinals, at O${optLevel}`, () => {
	const { cpu } = createCartlibProgramHarness(`
return pcall(function()
local loader<const> = load
score = 7
shared = { value = 12, method = function(self, n) return self.value + n end }
local chunk<const> = assert(loader([=[
	score = score + 2
	local score = score * 3
	shared.value = shared.value + score
	return score, shared.value, shared:method(2), absent, false
]=]))
local a, b, c, d, e = chunk()
assert(a == 27 and b == 39 and c == 41 and d == nil and e == false)
assert(score == 9 and shared.value == 39)
-- Neither public access-function mutation nor changing the caller's image
-- changes the boot primitives captured by the compiler.
local get<const>, set<const> = getglobal, setglobal
getglobal = false
setglobal = false
local changed<const> = assert(loader('score = score + 3; return score'))
assert(changed() == 12 and score == 12)
getglobal = get
setglobal = set
local closure<const> = assert(loader([=[
	local offset = 1
	return function(n)
		offset = offset + n
		score = score + offset
		return score
	end
]=]))()
assert(closure(2) == 15)
score = 100
assert(closure(3) == 106)
local env = { score = 40, shared = shared }
local isolated<const> = assert(loader('score = score + 2; return score, shared', nil, 't', env))
local isolated_score, object = isolated()
assert(isolated_score == 42 and env.score == 42 and score == 106 and object == shared)
local tuple<const> = assert(loader('return score, nil, false, score + 1'))
local first, second, third, fourth = tuple()
assert(first == 106 and second == nil and third == false and fourth == 107)
local loop<const> = assert(loader([=[
	local i = 0
	while i < 3 do score = score + 1; i = i + 1 end
	for j = 1, 3 do score = score + j end
	return score
]=]))
assert(loop() == 115)
local failure<const> = assert(loader('score = 116; error("retained")'))
local ok, message = pcall(failure)
assert(not ok and message == 'retained' and score == 116)
local nested<const> = assert(loader('return load("return score + 1")()'))
assert(nested() == 117)
local unset<const> = assert(loader('fresh = false; fresh = nil; return fresh'))
assert(unset() == nil and get('fresh') == nil)
-- Loading does not reserve or snapshot globals. A declaration introduced later
-- must be visible to an already compiled RAM closure.
local later<const> = assert(loader('return introduced_later'))
set('introduced_later', 19)
assert(later() == 19)
local banks<const> = assert(loader('irq = 25; return irq, __bmsx_getglobal'))
local ordinary_irq, ordinary_primitive = banks()
assert(ordinary_irq == 25 and ordinary_primitive == nil and get('irq') == 25)
return score, shared.value, closure(0)
end)
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, 116, 39, 122]);
});

test('generated syntax retains lexical symbol identity and shares global lowering', () => {
	const { cpu } = createCartlibProgramHarness(`
return pcall(function()
local f<const> = lua_compiler.syntax_factory
score = 17
local source<const> = f.chunk(f.block({ f.return_statement({ f.identifier('score') }) }))
assert(lua_compiler.compile_syntax(source, '=global-syntax')() == 17)
local symbol<const> = f.generated_symbol('score')
local missing<const> = f.chunk(f.block({ f.return_statement({ f.reference(symbol) }) }))
local ok, message = pcall(lua_compiler.compile_syntax, missing, '=missing-lexical')
assert(not ok and string.find(message, 'unknown local or function parameter') ~= nil)
return true
end)
`);
	assert.equal(cpu.runUntilDepth(0, 2_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
});

test('retained RAM global access survives collection and restore without per-access guest allocation', () => {
	const { cpu } = createCartlibProgramHarness(`
score = 0
advance = assert(load('for i = 1, 10000 do score = score + 1 end; return score'))
`);
	assert.equal(cpu.runUntilDepth(0, 2_000_000), RunResult.Halted);
	const name = cpu.stringPool.find('advance')!, score = cpu.stringPool.find('score')!;
	const heap = cpu.collectTrackedHeapBytes(), globals = cpu.globalSlotCount;
	const strings = cpu.stringPool.captureState(), saved = cpu.captureRuntimeState();
	for (let index = 0; index < 2; index++) {
		runCompletionClosure(cpu, cpu.getGlobalByKey(name) as Closure, []);
		assert.equal(cpu.getGlobalByKey(score), 10000);
		assert.equal(cpu.globalSlotCount, globals);
		assert.equal(cpu.luaHeap.usedBytes(), heap, 'no transient guest allocation between explicit collections');
		assert.equal(cpu.collectTrackedHeapBytes(), heap);
		cpu.stringPool.restoreState(strings); cpu.restoreRuntimeState(saved);
		assert.equal(cpu.getGlobalByKey(score), 0);
	}
});
