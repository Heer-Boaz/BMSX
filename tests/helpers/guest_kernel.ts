import assert from 'node:assert/strict';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';

/** Count successful heap reservations, including allocate-then-collect churn. */
export function profileWarmGuestKernel(cpu: CPU, kernel: Closure, iterations: number) {
	cpu.beginCompletionCall(kernel, [64]);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const heap = cpu.luaHeap;
	const retainedBefore = cpu.collectTrackedHeapBytes();
	const reserve = heap.reserve;
	let reservations = 0;
	let reservedBytes = 0;
	heap.reserve = function (bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2) {
		reserve.call(heap, bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2);
		reservations += 1;
		reservedBytes += bytes;
	};
	let cycles: number;
	try {
		cpu.beginCompletionCall(kernel, [iterations]);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		cycles = 10_000_000 - cpu.instructionBudgetRemaining;
	} finally {
		heap.reserve = reserve;
	}
	return { iterations, cycles, reservations, reservedBytes, retainedBefore, retainedAfter: heap.usedBytes() };
}
