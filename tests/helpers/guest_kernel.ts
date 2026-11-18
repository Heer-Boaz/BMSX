import assert from 'node:assert/strict';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';

/** Count successful heap reservations, including allocate-then-collect churn. */
export function profileWarmGuestKernel(cpu: CPU, kernel: Closure, iterations: number, budget = 10_000_000) {
	cpu.beginCompletionCall(kernel, [valueInteger(64)]);
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
	const heap = cpu.luaHeap;
	cpu.collectTrackedHeapBytes();
	// Collection can shrink the stack below this kernel's peak. Warm its
	// call depth again before attributing any reservation to steady-state work.
	cpu.beginCompletionCall(kernel, [valueInteger(64)]);
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
	const retainedBefore = heap.usedBytes();
	const stackCapacityBefore = cpu.activeThread.stackRegisters.capacity();
	const reserve = heap.reserve;
	let reservations = 0;
	let reservedBytes = 0;
	heap.reserve = function (bytes, root0, root1, root2, growingStack) {
		reserve.call(heap, bytes, root0, root1, root2, growingStack);
		reservations += 1;
		reservedBytes += bytes;
	};
	let cycles: number;
	try {
		cpu.beginCompletionCall(kernel, [valueInteger(iterations)]);
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
		cycles = budget - cpu.instructionBudgetRemaining;
	} finally {
		heap.reserve = reserve;
	}
	return { iterations, cycles, reservations, reservedBytes, retainedBefore, retainedAfter: heap.usedBytes(),
		stackCapacityBefore, stackCapacityAfter: cpu.activeThread.stackRegisters.capacity() };
}
