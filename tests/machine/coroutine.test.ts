import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asThread, valueBool, valueNil, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { THREAD_RECORD_KIND, ThreadStatus } from '../../machine/ts/machine/cpu/thread';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest, coroutineVectors } from '../helpers/coroutine';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

test('a failed thread retains its physical error word, tag and authored frames', () => {
	const { cpu } = createTestSystemCpu(compileCoroutineTest(coroutineVectors.protected_and_failed, 3));
	cpu.installBootPrimitives();
	runGuestToHalt(cpu, 100_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	const value = cpu.getGlobalByKey(cpu.stringPool.find('failed_thread')!);
	const failed = asThread(value, cpu.gc);
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
	cpu.installBootPrimitives();
	runGuestToHalt(cpu, 100_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true)]);
	cpu.collectTrackedHeapBytes();
	const weak = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('weak_threads')!));
	assert.equal(cpu.gc.tables.getInteger(weak, 1), valueNil());
});
