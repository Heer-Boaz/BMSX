import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool } from '../../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, captureRuntimeCheckpointState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';

export function exerciseNestedHistory(runtime: Runtime): void {
	const { cpu, memory } = runtime.machine;
	const root = cpu.rootThread.address, marker = nativeHeapReference(cpu).stringPool.find('nested_progress')!;
	const history = new RamHistory(); history.start(memory);
	const initialPages = history.capture(memory, null);
	const observe = () => {
		const depth = cpu.getFrameDepth();
		return { active: cpu.activeThread.address, depth, pc: depth === 0 ? 0 : cpu.readFramePc(depth - 1),
			progress: cpu.getGlobalByKey(marker) };
	};

	const threads = new Set<number>();
	let result = RunResult.Yielded, grants = 0;
	const step = () => {
		// Keep one grant size for initial, restored, and replayed execution.
		// This fixture performs sixteen complete firmware GC epochs.
		const status = cpu.runUntilDepth(0, 257);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.ok(++grants < 40000, 'the nested fixture must finish within its cycle grants');
		return status;
	};
	while (result === RunResult.Yielded && threads.size < 3) {
		result = step();
		if (cpu.activeThread.address !== root && !cpu.fixedInterruptActive() && cpu.getFrameDepth() !== 0)
			threads.add(cpu.activeThread.address);
	}
	assert.equal(result, RunResult.Yielded);
	assert.equal(threads.size, 3, 'all three coroutine records execute before the first restore');
	assert.notEqual(cpu.activeThread.address, root);
	const middle = observe(), midState = captureRuntimeCheckpointState(runtime), midPages = history.capture(memory, initialPages);

	const finish = () => {
		while (result === RunResult.Yielded) result = step();
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.activeThread.address, root);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.deepEqual(runtime.readCompletionValues(), [valueBool(true)]);
	};
	finish();
	const remaining = cpu.instructionBudgetRemaining;
	const final = observe(), finalState = captureRuntimeCheckpointState(runtime), finalPages = history.capture(memory, midPages);

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin.HistorySeek);
	assert.deepEqual(observe(), middle, 'rewind reinstates the active child bank');
	history.restore(memory, midPages, finalPages);
	applyRuntimeCheckpointState(runtime, finalState, RuntimeRestoreOrigin.HistorySeek);
	assert.deepEqual(observe(), final, 'forward restore reinstates root completion');

	history.restore(memory, finalPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin.HistorySeek);
	do { result = step(); } while (result === RunResult.Yielded && cpu.getGlobalByKey(marker) === middle.progress);
	assert.equal(result, RunResult.Yielded, 'an uncaptured prefix writes the guest marker while the child runs');
	history.restore(memory, midPages, midPages);
	applyRuntimeCheckpointState(runtime, midState, RuntimeRestoreOrigin.HistorySeek);
	assert.deepEqual(observe(), middle, 'same-map rewind restores the uncaptured guest write');
	result = RunResult.Yielded;
	finish();
	assert.deepEqual(observe(), final, 'the replayed suffix reaches the same return boundary');
	assert.equal(cpu.instructionBudgetRemaining, remaining);
}
