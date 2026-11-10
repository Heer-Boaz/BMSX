import assert from 'node:assert/strict';
import { CPU, type RunResult } from '../../machine/ts/machine/cpu/cpu';

/** Compare execution at the generated segment boundary, without restoring state
 * or changing either backend's accounting. The reference executes the same work,
 * including any complete instruction charges beyond the requested host deadline. */
export function runCpuParity(generated: CPU, reference: CPU, grant: number, depth = 0): RunResult {
	const result = generated.runUntilDepth(depth, grant);
	const consumed = grant - generated.instructionBudgetRemaining;
	const referenceGrant = Math.max(grant, consumed);
	assert.equal(reference.runUntilDepth(depth, referenceGrant), result, 'execution outcome at the same guest-cycle boundary');
	assert.equal(referenceGrant - reference.instructionBudgetRemaining, consumed, 'every executed guest cycle is charged');
	return result;
}
