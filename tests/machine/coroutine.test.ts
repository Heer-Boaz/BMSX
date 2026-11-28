import { asThread } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { THREAD_RECORD_KIND, ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest, coroutineVectors } from '../helpers/coroutine';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';
import { runCpuWithinBudget } from '../helpers/cpu_execution';

test('a failed thread retains its physical error word, tag and authored frames', () => {
	const { cpu } = createTestSystemCpu(compileCoroutineTest(coroutineVectors.protected_and_failed, 3));
	assert.equal(runCpuWithinBudget(cpu, 1_000_000), RunResult.Halted);
	assert.equal(cpu.getFrameDepth(), 0);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_EXPLICIT_ERROR);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	const value = cpu.getGlobalByKey(cpu.stringPool.find('failed_thread')!);
	const failed = asThread(value, nativeHeapReference(cpu).gc);
	assert.equal(valuePayload(value), failed);
	assert.equal(cpu.memory.readRamRecordByte(failed + ThreadField.Header), THREAD_RECORD_KIND);
	assert.equal(cpu.memory.readRamRecordWord(failed + ThreadField.Status), ThreadStatus.Failed);
	assert.equal(cpu.memory.readRamRecordWord(failed + ThreadField.ErrorWord), valuePayload(cpu.readThreadError(failed)));
	assert.equal(cpu.memory.readRamRecordWord(failed + ThreadField.ErrorKind), valueTag(cpu.readThreadError(failed)));
	assert.equal(cpu.readThreadStatus(failed), ThreadStatus.Failed);
	assert.ok(cpu.readThreadFrameDepth(failed) > 0);
});

test('a dead coroutine is collected after its last stack roots return', () => {
	const { cpu } = createTestSystemCpu(compileCoroutineTest(coroutineVectors.collection, 3));
	runGuestToHalt(cpu, 1_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	nativeHeapReference(cpu).gc.collect();
	const weak = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('weak_threads')!));
	assert.equal(cpu.tables.getInteger(weak, 1), valueNil());
});

for (const optimize of [0, 3] as const) test(`coroutine transfers place exact fixed, discarded and open results without heap growth (O${optimize})`, () => {
	const { cpu } = createTestSystemCpu(compileCoroutineTest(`
local count_results = function(...) return blua32.argument_count(), ... end
local worker = coroutine.create(function()
  coroutine.yield(13, nil, 15)
  local received = count_results(coroutine.yield())
  coroutine.yield(31, 32, 33)
  local empty = count_results(coroutine.yield(4, nil))
  return received, empty, false, nil
end)
coroutine.resume(worker)
halt_until_irq
local fixed, padding_a, padding_b = coroutine.resume(worker, 41, nil, 43)
local clipped, only = coroutine.resume(worker, nil, nil)
local yielded, yield_ok, four, trailing = count_results(coroutine.resume(worker))
local returned, return_ok, received, empty, flag, last = count_results(coroutine.resume(worker))
return fixed, padding_a, padding_b, clipped, only, yielded, yield_ok, four, trailing, returned, return_ok, received, empty, flag, last
`, optimize));
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const physical = cpu.heapAllocator.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
	cpu.clearHaltUntilIrq();
	let result = RunResult.Yielded;
	for (let slice = 0; slice < 8192 && result === RunResult.Yielded; ++slice) {
		result = cpu.runUntilDepth(0, 1);
		assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
		assert.equal(cpu.luaHeap.usedBytes(), logical);
	}
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	assert.equal(cpu.isHaltedUntilIrq(), false);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [
		valueBool(true), valueNil(), valueNil(), valueBool(true), valueInteger(31),
		valueInteger(3), valueBool(true), valueInteger(4), valueNil(),
		valueInteger(5), valueBool(true), valueInteger(2), valueInteger(0), valueBool(false), valueNil(),
	]);
});
