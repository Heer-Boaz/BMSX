import { UPVALUE_RECORD_KIND } from '../../machine/ts/machine/cpu/upvalue';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { CPU, type RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';

/** Both routes receive the same grant, including when the final atomic
 * instruction's complete charge crosses that deadline. */
export function runCpuParity(generated: CPU, reference: CPU, grant: number, depth = 0): RunResult {
	const result = generated.runUntilDepth(depth, grant);
	const consumed = grant - generated.instructionBudgetRemaining;
	assert.equal(reference.runUntilDepth(depth, grant), result, 'execution outcome with the same guest-cycle grant');
	assert.equal(grant - reference.instructionBudgetRemaining, consumed, 'every executed guest cycle is charged');
	return result;
}

/** Generated regions store and read registers through the `s` and `p` aliases. */
type GeneratedRegisterBank = ValueSlots & { s: ValueSlots['setEncoded']; p: ValueSlots['getPayload'] };

/** Observe every register store, whether host code or a generated region makes it. */
export function observeRegisterStores(registers: ValueSlots, observe: (index: number) => void): void {
	const bank = registers as GeneratedRegisterBank, store = bank.setEncoded.bind(bank);
	bank.setEncoded = bank.s = (index, tag, word) => { observe(index); store(index, tag, word); };
}

/** Observe every register payload read, whether host code or a generated region makes it. */
export function observeRegisterPayloadReads(registers: ValueSlots, observe: (index: number) => void): void {
	const bank = registers as GeneratedRegisterBank, read = bank.getPayload.bind(bank);
	bank.getPayload = bank.p = index => { observe(index); return read(index); };
}

// A restored CPU can dereference records and interned strings immediately.
// Rewind fixtures must restore RAM before binding the processor latches.
export function captureCpuCheckpoint(cpu: CPU) {
	return { cpu: cpu.captureRuntimeState(), memory: cpu.memory.captureSaveState() };
}

export function restoreCpuCheckpoint(cpu: CPU, checkpoint: ReturnType<typeof captureCpuCheckpoint>): void {
	cpu.memory.restoreSaveState(checkpoint.memory);
	cpu.restoreRuntimeState(checkpoint.cpu);
}


export function allocatedObjectRecords(cpu: CPU): number[] {
	const records: number[] = [];
	cpu.heapAllocator.visitObjectRecords(cpu.memory, (memory, address) => {
		switch (memory.readRamRecordByte(address)) {
			case ValueTag.Table: case ValueTag.Closure: case UPVALUE_RECORD_KIND: case THREAD_RECORD_KIND:
				records.push(address);
				break;
		}
		return 1;
	});
	return records;
}
