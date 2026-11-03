import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { createTestSystemCpu } from '../helpers/blua32';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { compileTableIterationTest, tableIterationVectors } from '../helpers/table_iteration';

for (const optLevel of [0, 3] as const) {
	for (const [name, body] of Object.entries(tableIterationVectors)) {
		test(`Table iteration ${name} survives deletion and physical snapshots (O${optLevel})`, t => {
			const { cpu } = createTestSystemCpu(compileTableIterationTest(body, optLevel));
			cpu.installBootPrimitives();
			let result = RunResult.Yielded;
			let deletedContinuationObserved = false;
			for (let grant = 0; grant < 10000 && result === RunResult.Yielded; grant++) {
				result = cpu.runUntilDepth(0, 17);
				assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `guest assertion failed in ${name}`);
				if (name === 'checkpoint_after_delete') {
					const key = cpu.getGlobalByKey(cpu.stringPool.find('checkpoint_key')!);
					if (key !== null) {
						const table = cpu.getGlobalByKey(cpu.stringPool.find('checkpoint_table')!) as Table;
						assert.equal(table.get(key), null);
						deletedContinuationObserved = true;
					}
				}
				const snapshot = cpu.captureRuntimeState();
				cpu.restoreRuntimeState(snapshot);
				assert.deepEqual(cpu.captureRuntimeState(), snapshot, 'physical table continuations survive restore');
			}
			assert.equal(result, RunResult.Halted);
			const values = [];
			cpu.readCompletionValues(values);
			assert.deepEqual(values, [true]);
			if (name === 'checkpoint_after_delete') assert.equal(deletedContinuationObserved, true);
			if (name === 'delete_reinsert_churn') {
				const kernel = cpu.getGlobalByKey(cpu.stringPool.find('churn_kernel')!) as Closure;
				const keys = cpu.getGlobalByKey(cpu.stringPool.find('churn_keys')!) as Table;
				const table = cpu.getGlobalByKey(cpu.stringPool.find('churn_values')!) as Table;
				assert.equal(table.storedSlotCount, 32);
				const bucket = (keys.get(1) as Table).hashId & 31;
				for (let index = 2; index <= 32; index++) assert.equal((keys.get(index) as Table).hashId & 31, bucket);
				const profile = profileWarmGuestKernel(cpu, kernel, 128);
				assert.equal(profile.reservations, 0);
				assert.equal(profile.reservedBytes, 0);
				assert.equal(profile.retainedAfter, profile.retainedBefore);
				t.diagnostic(JSON.stringify({ optLevel, ...profile }));
			}
		});
	}
}

test('zero-valued object identity remains a deleted-key continuation', () => {
	const { cpu } = createTestSystemCpu(compileTableIterationTest('return true', 0));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const state = cpu.captureRuntimeState();
	state.nextObjectHashId = 0;
	cpu.restoreRuntimeState(state);
	const key = cpu.createTable();
	assert.equal(key.hashId, 0);
	const table = cpu.createTable(0, 64);
	table.set(key, 9);
	for (let index = 1; index <= 8; index++) table.setStringKey(cpu.stringPool.intern(`other_${index}`), index);
	const continuation = new ValueSlots(2);
	assert.equal(table.next(ValueTag.Table, NaN, key, continuation, 0), true);
	const expected = continuation.get(0);
	table.set(key, null);
	assert.equal(table.next(ValueTag.Table, NaN, key, continuation, 0), true);
	assert.equal(continuation.get(0), expected);
});
