import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, valueBool, valueInteger, valueNil, valueTable, ValueTag, valuePayload } from '../../machine/ts/machine/cpu/value';
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
					if (key !== valueNil()) {
						const table = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('checkpoint_table')!));
						assert.equal(cpu.gc.tables.get(table, key), valueNil());
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
			assert.deepEqual(values, [valueBool(true)]);
			if (name === 'checkpoint_after_delete') assert.equal(deletedContinuationObserved, true);
			if (name === 'delete_reinsert_churn') {
				const kernel = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('churn_kernel')!), cpu.gc);
				const table = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('churn_values')!));
				assert.equal(cpu.gc.tables.storedSlotCount(table), 32);
				const profile = profileWarmGuestKernel(cpu, kernel, 128);
				assert.equal(profile.reservations, 0);
				assert.equal(profile.reservedBytes, 0);
				assert.equal(profile.retainedAfter, profile.retainedBefore);
				t.diagnostic(JSON.stringify({ optLevel, ...profile }));
			}
		});
	}
}

test('a physical object address remains a deleted-key continuation', () => {
	const { cpu } = createTestSystemCpu(compileTableIterationTest('return true', 0));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const key = cpu.createTable();
	const table = cpu.createTable(0, 64);
	const keyValue = valueTable(key);
	cpu.gc.tables.set(table, keyValue, valueInteger(9));
	for (let index = 1; index <= 8; index++) cpu.gc.tables.setStringKey(table, cpu.stringPool.intern(`other_${index}`), valueInteger(index));
	const continuation = new ValueSlots(2);
	cpu.gc.tables.next(table, keyValue, continuation, 0);
	assert.notEqual(continuation.getTag(0), ValueTag.Nil);
	const expected = continuation.get(0);
	cpu.gc.tables.set(table, keyValue, valueNil());
	cpu.gc.tables.next(table, keyValue, continuation, 0);
	assert.notEqual(continuation.getTag(0), ValueTag.Nil);
	assert.equal(continuation.get(0), expected);
});
