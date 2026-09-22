import type { Closure } from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest, coroutineVectors } from '../helpers/coroutine';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadStatus, type Thread } from '../../machine/ts/machine/cpu/thread';
import type { Table } from '../../machine/ts/machine/cpu/table';

for (const optLevel of [0, 3] as const) {
	for (const [name, body] of Object.entries(coroutineVectors)) {
		test(`coroutine ${name}, O${optLevel}, bounded real CPU grants`, () => {
			const { cpu } = createTestSystemCpu(compileCoroutineTest(body, optLevel));
			cpu.installBootPrimitives();
			if (name === 'halted_tooling_call') {
				assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
				assert.equal(cpu.isHaltedUntilIrq(), true);
				const depth = cpu.getFrameDepth();
				cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('probe')) as Closure);
				for (let grant = 0; grant < 10000; grant++) {
					const status = cpu.runUntilDepth(depth, 17, cpu.rootThread);
					const snapshot = cpu.captureRuntimeState();
					cpu.restoreRuntimeState(snapshot);
					assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'HALT owner survives suspended tooling call');
					if (status !== RunResult.Yielded) break;
				}
				assert.equal(cpu.activeThread, cpu.rootThread);
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(cpu.getGlobalByKey(cpu.stringPool.intern('entered')), true);
				assert.equal(cpu.isHaltedUntilIrq(), true, 'returning from tooling preserves the root HALT');
				cpu.clearHaltUntilIrq();
			}
			let result = RunResult.Yielded;
			let interrupted = false;
			for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant += 1) {
				if (name === 'interrupted' && !interrupted && cpu.activeThread !== cpu.rootThread
					&& cpu.getGlobalByKey(cpu.stringPool.intern('interrupt_ready')) === true) {
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
				assert.equal(cpu.activeThread.frames.some(frame => frame.isExceptionFrame) && name !== 'interrupted', false, `unexpected machine fault in ${name}`);
			}
			assert.equal(result, RunResult.Halted);
			assert.equal(cpu.getFrameDepth(), 0);
			const values = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [true]);
			assert.equal(cpu.activeThread.status, ThreadStatus.Running);
			if (name === 'protected_and_failed') {
				const failed = cpu.getGlobalByKey(cpu.stringPool.intern('failed_thread')) as Thread;
				assert.equal(failed.status, ThreadStatus.Failed);
				assert.ok(failed.frames.length > 0, 'failed coroutine keeps its authored frames');
			}
			cpu.collectTrackedHeapBytes();
			if (name === 'collection') {
				const weak = cpu.getGlobalByKey(cpu.stringPool.intern('weak_threads')) as Table;
				assert.equal(weak.get(1), null, 'unreachable thread is collected after its last stack roots return');
			}
		});
	}
}
