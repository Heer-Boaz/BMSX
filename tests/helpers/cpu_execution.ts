import assert from 'node:assert/strict';
import { CPU, type RunResult } from '../../machine/ts/machine/cpu/cpu';

/** Both routes receive the same grant, including when the final atomic
 * instruction's complete charge crosses that deadline. */
export function runCpuParity(generated: CPU, reference: CPU, grant: number, depth = 0): RunResult {
	const result = generated.runUntilDepth(depth, grant);
	const consumed = grant - generated.instructionBudgetRemaining;
	assert.equal(reference.runUntilDepth(depth, grant), result, 'execution outcome with the same guest-cycle grant');
	assert.equal(grant - reference.instructionBudgetRemaining, consumed, 'every executed guest cycle is charged');
	return result;
}

// A restored CPU can dereference records and interned strings immediately.
// Rewind fixtures must restore those owners before restoring the register graph.
export function captureCpuCheckpoint(cpu: CPU) {
	return { cpu: cpu.captureRuntimeState(), memory: cpu.memory.captureSaveState(), strings: cpu.stringPool.captureState() };
}

export function restoreCpuCheckpoint(cpu: CPU, checkpoint: ReturnType<typeof captureCpuCheckpoint>): void {
	cpu.memory.restoreSaveState(checkpoint.memory);
	cpu.stringPool.restoreState(checkpoint.strings);
	cpu.restoreRuntimeState(checkpoint.cpu);
}
