import assert from 'node:assert/strict';
import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { closureRecordBytes } from '../../machine/ts/machine/cpu/closure';
import { UPVALUE_HEAP_BYTES } from '../../machine/ts/machine/cpu/upvalue';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';

/** Count successful heap reservations, including allocate-then-collect churn. */
export function profileWarmGuestKernel(cpu: CPU, kernel: number, iterations: number, budget = 10_000_000) {
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
	const allocateRecord = heap.allocateRecord, allocateClosureRecord = heap.allocateClosureRecord, allocateStack = heap.allocateStack;
	let reservations = 0;
	let reservedBytes = 0;
	heap.allocateRecord = function (bytes, owned, backingBytes, backingField, root0, root1, root2) {
		const address = allocateRecord.call(heap, bytes, owned, backingBytes, backingField, root0, root1, root2);
		reservations += backingBytes === 0 ? 1 : 2;
		reservedBytes += heapAllocationBytes(bytes) + (backingBytes === 0 ? 0 : heapAllocationBytes(backingBytes));
		return address;
	};
	heap.allocateClosureRecord = function (captures, latched, addresses, count = 0) {
		const address = allocateClosureRecord.call(heap, captures, latched, addresses, count);
		reservations += 1 + count;
		reservedBytes += heapAllocationBytes(closureRecordBytes(captures, latched)) + count * UPVALUE_HEAP_BYTES;
		return address;
	};
	heap.allocateStack = function (bytes, thread, root) {
		const address = allocateStack.call(heap, bytes, thread, root);
		reservations += 1;
		reservedBytes += heapAllocationBytes(bytes);
		return address;
	};
	let cycles: number;
	try {
		cpu.beginCompletionCall(kernel, [valueInteger(iterations)]);
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
		cycles = budget - cpu.instructionBudgetRemaining;
	} finally {
		heap.allocateRecord = allocateRecord; heap.allocateClosureRecord = allocateClosureRecord; heap.allocateStack = allocateStack;
	}
	return { iterations, cycles, reservations, reservedBytes, retainedBefore, retainedAfter: heap.usedBytes(),
		stackCapacityBefore, stackCapacityAfter: cpu.activeThread.stackRegisters.capacity() };
}
