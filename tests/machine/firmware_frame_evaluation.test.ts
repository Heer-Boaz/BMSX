import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { collectReferenceHeapBytes } from '../helpers/cpu_heap_reference';
import { logicalThreadBytes } from '../helpers/guest_kernel';
import assert from 'node:assert/strict';
import test from 'node:test';
import { valueBool, valueInteger } from '../../machine/ts/machine/cpu/value';
import { valueToString } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) test(`retained frame accesses O${optLevel} allocate nothing after compilation`, () => {
	const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(`
local exercise = function(value, ...)
 local index<const> = frame_count(running_thread()) - 1
 local scope<const> = frame_bindings.open(index, {
  value = { index = 0, upvalue = false, available = true, is_const = false },
 }, index)
 advance = assert(load('for i = 1, 10000 do value = value + 1 end; return value', '=frame-loop', 't', nil, scope))
 halt_until_irq
 assert(value == 20000)
 scope.close()
 return true
end
return exercise(0)
`, optLevel));
	runGuestToHalt(cpu, 30_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const depth = cpu.getFrameDepth(), name = nativeHeapReference(cpu).stringPool.find('advance')!;
	cpu.beginCompletionCall(asClosure(readStockGlobalValue(cpu.memory, name), nativeHeapReference(cpu).gc));
	runGuestToHalt(cpu, 30_000_000, depth);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(10000)]);
	const heap = collectReferenceHeapBytes(cpu), globals = cpu.globalSlotCount;
	const ram = cpu.memory.captureSaveState(), saved = cpu.captureRuntimeState();
	for (let iteration = 0; iteration < 2; iteration++) {
		cpu.memory.restoreSaveState(ram); cpu.restoreRuntimeState(saved);
		cpu.beginCompletionCall(asClosure(readStockGlobalValue(cpu.memory, name), nativeHeapReference(cpu).gc));
		runGuestToHalt(cpu, 30_000_000, depth);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(20000)]);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), heap, 'no transient guest allocation before explicit collection');
		const stackBytes = logicalThreadBytes(cpu, cpu.activeThread.address);
		const collected = collectReferenceHeapBytes(cpu);
		const releasedStackBytes = stackBytes - logicalThreadBytes(cpu, cpu.activeThread.address);
		assert.equal(collected, heap - releasedStackBytes,
			'collection only releases retired compiler stack capacity');
		assert.equal(cpu.globalSlotCount, globals);
		assert.equal(cpu.isHaltedUntilIrq(), true);
	}
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueBool(true)]);
});

for (const optLevel of [3] as const) test(`packed names O${optLevel}: completion-call injection retains the selected PC and activation`, () => {
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
	runGuestToHalt(cpu, 30_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
	cpu.beginCompletionCall(asClosure(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('named_completion_probe')!), nativeHeapReference(cpu).gc), [valueInteger(depth - 1)]);
	runGuestToHalt(cpu, 30_000_000, depth);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc, 'lookup/evaluation did not advance the selected activation');
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueBool(true)]);
});

for (const optLevel of [3] as const) test(`packed names O${optLevel}: a ROM without diagnostics reports missing coverage`, () => {
	const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(`
local index<const> = frame_count(running_thread()) - 1
local names, message = frame_bindings.resolve(index, 0)
assert(names == nil and message == 'Frame symbols are unavailable.')
local choices, message = frame_bindings.list(index)
assert(choices == nil and message == 'Frame symbols are unavailable.')
local ok, message = repl.evaluate_frame('unexpected_global_write = 1', '=no-symbols', index, 0)
assert(not ok and message == 'Frame symbols are unavailable.' and getglobal('unexpected_global_write') == nil)
return true
`, optLevel, false));
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueBool(true)]);
});

for (const optLevel of [3] as const) test(`packed names O${optLevel}: enumerate active depths and evaluate a discovered stopped scope`, () => {
	const { cpu } = createTestSystemCpu(compileFrameEvaluationTest(`
function discover_stopped_scope(index)
 return pcall(function()
 local choices<const>, message<const> = frame_bindings.list(index)
 assert(choices ~= nil, message)
 local depth
 for at = 1, #choices, 2 do
  if choices[at + 1] == 'inspect' then depth = choices[at] end
 end
 assert(depth ~= nil, 'discover the active source scope')
 local ok<const>, result<const> = repl.evaluate_frame('return offset', '=discovered-scope', index, depth)
 assert(ok and result == 42, 'frame result: ' .. tostring(result))
 return true
 end)
end
local exercise = function(value, ...)
 local inspect<const> = function(offset)
  halt_until_irq
  return offset + 1
 end
 return inspect(value)
end
return exercise(42)
`, optLevel));
	runGuestToHalt(cpu, 30_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
	cpu.beginCompletionCall(asClosure(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('discover_stopped_scope')!), nativeHeapReference(cpu).gc), [valueInteger(depth - 1)]);
	runGuestToHalt(cpu, 30_000_000, depth);
	const values = materializeCpuCompletionValues(cpu);
	assert.deepEqual(values, [valueBool(true), valueBool(true)], values.map(value => valueToString(value, cpu.stringPool)).join('\t'));
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(cpu.readFramePc(depth - 1), pc);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 30_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueInteger(43)]);
});
