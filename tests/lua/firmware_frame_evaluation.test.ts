import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileFrameEvaluationTest, frameEvaluationCases } from '../helpers/frame_evaluation';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) for (const [name, body] of Object.entries(frameEvaluationCases)) {
	test(`firmware frame evaluation O${optLevel}: ${name}`, () => {
		const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(body, optLevel));
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
		if (name === 'coroutine') {
			assert.equal(cpu.isHaltedUntilIrq(), true, 'a live frame scope is suspended in the coroutine');
			const saved = cpu.captureRuntimeState();
			cpu.restoreRuntimeState(saved);
			assert.deepEqual(cpu.captureRuntimeState(), saved);
			cpu.clearHaltUntilIrq();
			assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
		}
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1, 'no unhandled guest fault');
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
	});
}

for (const optLevel of [0, 3] as const) test(`retained frame accesses O${optLevel} allocate nothing after compilation`, () => {
	const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(`
local exercise = function(value, ...)
 local scope<const> = frame_bindings.open(frame_count(running_thread()) - 1, {
  value = { index = 0, upvalue = false, available = true, is_const = false },
 })
 advance = assert(load('for i = 1, 10000 do value = value + 1 end; return value', '=frame-loop', 't', nil, scope))
 halt_until_irq
 assert(value == 20000)
 scope.close()
 return true
end
return exercise(0)
`, optLevel));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const depth = cpu.getFrameDepth(), name = cpu.stringPool.find('advance')!;
	cpu.beginCompletionCall(cpu.getGlobalByKey(name) as Closure);
	assert.equal(cpu.runUntilDepth(depth, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [10000]);
	const heap = cpu.collectTrackedHeapBytes(), globals = cpu.globalSlotCount;
	const strings = cpu.stringPool.captureState(), saved = cpu.captureRuntimeState();
	for (let iteration = 0; iteration < 2; iteration++) {
		cpu.stringPool.restoreState(strings); cpu.restoreRuntimeState(saved);
		cpu.beginCompletionCall(cpu.getGlobalByKey(name) as Closure);
		assert.equal(cpu.runUntilDepth(depth, 30_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [20000]);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.luaHeap.usedBytes(), heap, 'no transient guest allocation before explicit collection');
		assert.equal(cpu.collectTrackedHeapBytes(), heap);
		assert.equal(cpu.globalSlotCount, globals);
		assert.equal(cpu.isHaltedUntilIrq(), true);
	}
	cpu.clearHaltUntilIrq();
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
});

for (const optLevel of [0, 3] as const) test(`packed names O${optLevel}: completion-call injection retains the selected PC and activation`, () => {
	const image = compileFrameEvaluationTest(`
function named_completion_probe(index)
 local names, label = frame_bindings.resolve(index, 0)
 assert(names ~= nil and label == 'park' and names.value.available)
 local ok, result = repl.evaluate('value = value + 1; return value', '=completion-frame', 'frame', index, names)
 assert(ok and result == 43)
 return true
end
local park = function(value, ...)
 halt_until_irq
 return value == 43
end
return park(42)
`, optLevel);
	const { cpu } = createTestSystemCpu(image);
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
	cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find('named_completion_probe')!) as Closure, [depth - 1]);
	assert.equal(cpu.runUntilDepth(depth, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc, 'lookup/evaluation did not advance the selected activation');
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
});

for (const optLevel of [0, 3] as const) test(`packed names O${optLevel}: a ROM without diagnostics reports missing coverage`, () => {
	const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(`
local names, message = frame_bindings.resolve(frame_count(running_thread()) - 1, 0)
assert(names == nil and message == 'Frame symbols are unavailable.')
return true
`, optLevel, false));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true]);
});
