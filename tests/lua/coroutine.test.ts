import { asClosure, asThread, asTable, valueBool, valueNil, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest, coroutineVectors } from '../helpers/coroutine';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { THREAD_RECORD_KIND, ThreadField, ThreadStatus } from '../../machine/ts/machine/cpu/thread';

for (const optLevel of [0, 3] as const) {
	for (const [name, body] of Object.entries(coroutineVectors)) {
		test(`coroutine ${name}, O${optLevel}, bounded real CPU grants`, () => {
			const { cpu } = createTestSystemCpu(compileCoroutineTest(body, optLevel));
			cpu.installBootPrimitives();
			if (name === 'halted_tooling_call') {
				assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
				assert.equal(cpu.isHaltedUntilIrq(), true);
				const depth = cpu.getFrameDepth();
				cpu.beginCompletionCall(asClosure(cpu.getGlobalByKey(cpu.stringPool.intern('probe')), cpu.gc));
				for (let grant = 0; grant < 10000; grant++) {
					const status = cpu.runUntilDepth(depth, 17, cpu.rootThread);
					const snapshot = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(snapshot);
					assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'HALT owner survives suspended tooling call');
					if (status !== RunResult.Yielded) break;
				}
				assert.equal(cpu.activeThread, cpu.rootThread);
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('entered')), valueBool(true));
				assert.equal(cpu.isHaltedUntilIrq(), true, 'returning from tooling preserves the root HALT');
				cpu.clearHaltUntilIrq();
			}
			let result = RunResult.Yielded;
			let interrupted = false;
			for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant += 1) {
				if (name === 'interrupted' && !interrupted && cpu.activeThread !== cpu.rootThread
					&& cpu.getGlobalByKey(cpu.stringPool.intern('interrupt_ready')) === valueBool(true)) {
					cpu.requestNonMaskableInterrupt();
					assert.equal(cpu.enterPendingInterrupt(), true);
					const snapshot = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(snapshot);
					assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'NMI on the active coroutine is retained');
					interrupted = true;
				}
				result = cpu.runUntilDepth(0, 17);
				const state = cpu.captureRuntimeState();
				cpu.restoreRuntimeState(state);
				assert.deepEqual(cpu.captureRuntimeState(), state, 'thread snapshot round trip');
				assert.equal((cpu.readExceptionReturnFrameDepth() >= 0) && name !== 'interrupted', false, `unexpected machine fault in ${name}`);
			}
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.getFrameDepth(), 0);
			const values = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [valueBool(true)]);
			assert.equal(cpu.activeThread.status, ThreadStatus.Running);
			if (name === 'protected_and_failed') {
				const value = cpu.getGlobalByKey(cpu.stringPool.intern('failed_thread'));
				const failed = asThread(value, cpu.gc);
				assert.equal(valuePayload(value), failed.address);
				assert.equal(cpu.memory.readRamRecordWord(failed.address + ThreadField.Header), THREAD_RECORD_KIND);
				assert.equal(cpu.memory.readRamRecordWord(failed.address + ThreadField.Status), ThreadStatus.Failed);
				assert.equal(cpu.memory.readRamRecordWord(failed.address + ThreadField.ErrorWord), valuePayload(failed.error));
				assert.equal(cpu.memory.readRamRecordWord(failed.address + ThreadField.ErrorKind), valueTag(failed.error));
				assert.equal(failed.status, ThreadStatus.Failed);
				assert.ok(failed.frameDepth > 0, 'failed coroutine keeps its authored frames');
			}
			cpu.collectTrackedHeapBytes();
			if (name === 'collection') {
				const weak = asTable(cpu.getGlobalByKey(cpu.stringPool.intern('weak_threads')), cpu.gc);
				assert.equal(weak.records.getInteger(weak.address, 1), valueNil(), 'unreachable thread is collected after its last stack roots return');
			}
		});
	}
}
