import assert from 'node:assert/strict';
import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Memory } from '../../machine/ts/machine/memory/memory';
import { GlobalBankField } from '../../machine/ts/spec/blua32/execution_domain';
import type { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { HEAP_SERVICE_FRAME_OFFSET } from '../../machine/ts/spec/bmsx/heap_service';

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
export function runCpuWithinBudget(cpu: CPU, budget: number, depth = 0, profile?: { functionAddress: number; fullGcCycles: number }): RunResult {
	let outcome = RunResult.Yielded;
	const memory = cpu.memory;
	const functionLane = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
	// An admitted firmware body can yield at a zero-work phase boundary.
	// Preserve the submitted aggregate grant; cap fixture pulses independently.
	for (let slices = 0; slices < 16384 && outcome === RunResult.Yielded && budget > 0; ++slices) {
		const fullGcGrant = profile !== undefined && cpu.heapServiceActive() && memory.readRamRecordWord(functionLane) === profile.functionAddress;
		outcome = cpu.runUntilDepth(depth, budget);
		if (fullGcGrant) profile.fullGcCycles += budget - cpu.instructionBudgetRemaining;
		budget = cpu.instructionBudgetRemaining;
	}
	return outcome;
}

/** Run to the requested depth and require a clean halt. A guest error also ends in
 * Halted, so the Lua fault reason has to stay clear as well. */
export function runGuestToHalt(cpu: CPU, budget: number, depth = 0): void {
	assert.equal(runCpuWithinBudget(cpu, budget, depth), RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0, 'the guest halted without a Lua fault');
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
