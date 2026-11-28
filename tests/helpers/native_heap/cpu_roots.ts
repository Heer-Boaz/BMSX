import { type CPU, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { isRamStringId } from '../../../machine/ts/machine/cpu/string_pool';
import { IMAGE_RAM_STRING_END_OFFSET } from '../firmware_heap_layout';
import { valueFromTag, type Value } from '../../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_EXPLICIT_ERROR, LUA_FAULT_REASON_INDEX_NAN } from '../../../machine/ts/spec/blua32/cop0';
import { executionImageBindingOffset, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, type ExecutionDomainId } from '../../../machine/ts/spec/blua32/execution_domain';
import { GcHeap, GcDiagnosticField, GcRootBank, GC_WORK_WORD_CYCLES } from './gc_heap';
import { nativeHeapReference } from './reference';

export function chargeCollectionWork(cpu: CPU, work: number): void {
	if (nativeHeapReference(cpu).runKind !== CpuRunKind.Idle) cpu['charge'](GC_WORK_WORD_CYCLES * work);
}

export function assistAllocation(cpu: CPU, root0: Value, root1: Value, root2: Value, growingThread: number, words: number,
	sourceCycles = cpu.instructionBudgetRemaining): number {
	const reference = nativeHeapReference(cpu);
	if (reference.runKind !== CpuRunKind.Idle) {
		if (sourceCycles < GC_WORK_WORD_CYCLES) return 0;
		words = Math.min(words, Math.trunc(sourceCycles / GC_WORK_WORD_CYCLES));
	}
	const work = reference.gc.step(root0, root1, root2, growingThread, false, words);
	chargeCollectionWork(cpu, work);
	return work;
}

export function markRootHead(cpu: CPU, heap: GcHeap): void {
	heap.markString(heap.diagnosticWord(GcDiagnosticField.Mode));
	heap.markString(heap.diagnosticWord(GcDiagnosticField.Index));
	heap.markString(heap.diagnosticWord(GcDiagnosticField.NewIndex));
	heap.markString(heap.diagnosticWord(GcDiagnosticField.Length));
	heap.markString(heap.diagnosticWord(GcDiagnosticField.Error));
	const faults = heap.diagnosticWord(GcDiagnosticField.FaultIds);
	for (let reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
		if (reason !== LUA_FAULT_REASON_EXPLICIT_ERROR) heap.markString(cpu.memory.readRamRecordWord(faults + reason * 4));
	heap.markValue(valueFromTag(heap.diagnosticWord(GcDiagnosticField.StringIndexTag), heap.diagnosticWord(GcDiagnosticField.StringIndexWord)));
	if (cpu['stringComparison'].remaining !== 0) { heap.markString(cpu['stringComparison'].left); heap.markString(cpu['stringComparison'].right); }

}

export function rootBankSlots(cpu: CPU, bank: GcRootBank): number {
	if (bank === GcRootBank.SystemGlobals) return cpu['systemGlobalBank'].count;
	if (bank === GcRootBank.Globals) return cpu['globalBank'].count;
	if (bank === GcRootBank.Completion) return cpu['completionValueCount'];
	const binding = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), (bank - GcRootBank.Cart0Constants) as ExecutionDomainId);
	return cpu.memory.readRamRecordWord(binding + IMAGE_RAM_STRING_END_OFFSET);
}

export function markRootBank(cpu: CPU, heap: GcHeap, bank: GcRootBank, first: number, end: number): void {
	if (bank < GcRootBank.SystemConstants) {
		const names = bank === GcRootBank.SystemGlobals ? cpu['systemGlobalBank'] : cpu['globalBank'];
		const slots = names.slots;
		for (let slot = first; slot < end; ++slot) {
			heap.markString(names.name(slot)); heap.markSlot(slots, slot);
		}
		return;
	}
	for (let slot = first; slot < end; ++slot) heap.markSlot(cpu['completionValueSlots'], slot);
}

export function markLiteralRootBatch(cpu: CPU, heap: GcHeap, bank: GcRootBank, first: number, end: number, amount: number) {
	const binding = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), (bank - GcRootBank.Cart0Constants) as ExecutionDomainId);
	const literals = cpu.memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	let next = first, marked = 0;
	while (next < end && marked < amount) {
		const id = cpu.memory.readRamRecordWord(literals + 4 * next++);
		if (isRamStringId(id)) {
			heap.markString(id);
			++marked;
		}
	}
	return { next, marked };
}

export function markRootThreads(cpu: CPU, heap: GcHeap): void {
	heap.markThread(cpu.rootThread.address); heap.markThread(cpu.activeThread.address); heap.markThread(cpu['completionThread']);
	heap.markThread(cpu['haltedUntilIrqThread']);
}
