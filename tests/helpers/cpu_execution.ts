import assert from 'node:assert/strict';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Memory } from '../../machine/ts/machine/memory/memory';
import { GlobalBankField } from '../../machine/ts/spec/blua32/execution_domain';
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

/** Run one aggregate test grant even when firmware pauses between instructions. */
export function runCpuWithinBudget(cpu: CPU, budget: number, depth = 0): RunResult {
	let outcome = RunResult.Yielded;
	// An admitted firmware body can yield at a zero-work phase boundary.
	// Preserve the submitted aggregate grant; cap fixture pulses independently.
	for (let slices = 0; slices < 32768 && outcome === RunResult.Yielded && budget > 0; ++slices) {
		outcome = cpu.runUntilDepth(depth, budget);
		budget = cpu.instructionBudgetRemaining;
	}
	return outcome;
}

/** A handled Trap leaves its reason latched. A clean halt is a return or
 * ordinary IRQ wait, not a hard halt or a newly retained exception. */
export function runGuestToHalt(cpu: CPU, budget: number, depth = 0): void {
	const existingException = cpu.readExceptionReturnFrameDepth();
	assert.equal(runCpuWithinBudget(cpu, budget, depth), RunResult.Halted);
	assert.equal(cpu.captureRuntimeState().hardHalted, false, 'the guest did not hard-halt');
	const exception = cpu.readExceptionReturnFrameDepth();
	assert.ok(exception === -1 || (exception === existingException && exception < depth), 'no new exception is active');
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


export function readNamespaceBank(memory: Memory, descriptor: number) {
	return {
		base: memory.readRamRecordWord(descriptor + GlobalBankField.Base),
		capacity: memory.readRamRecordWord(descriptor + GlobalBankField.Capacity),
		count: memory.readRamRecordWord(descriptor + GlobalBankField.Count),
	};
}

export function allocatedObjectRecords(cpu: CPU): number[] {
	const records: number[] = [];
	cpu.gc.visitObjectRecords(records, (records, address) => { records.push(address); });
	return records;
}
