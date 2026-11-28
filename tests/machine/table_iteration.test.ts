import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueInteger, valueNil, valueTable, ValueTag, valuePayload } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { createTestSystemCpu } from '../helpers/blua32';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { compileTableIterationTest, tableIterationVectors } from '../helpers/table_iteration';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

test('steady-state table deletion and reinsertion do not reserve guest heap', t => {
	const { cpu } = createTestSystemCpu(compileTableIterationTest(tableIterationVectors.delete_reinsert_churn, 3));
	runGuestToHalt(cpu, 10_000_000);
	const kernel = asClosure(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('churn_kernel')!), nativeHeapReference(cpu).gc);
	const table = valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('churn_values')!));
	assert.equal(cpu.tables.storedSlotCount(table), 32);
	const profile = profileWarmGuestKernel(cpu, kernel, 128);
	assert.equal(profile.reservations, 0);
	assert.equal(profile.reservedBytes, 0);
	assert.equal(profile.retainedAfter, profile.retainedBefore);
	t.diagnostic(JSON.stringify(profile));
});

test('a physical object address remains a deleted-key continuation', () => {
	const { cpu } = createTestSystemCpu(compileTableIterationTest('return true', 0));
	runGuestToHalt(cpu, 100000);
	const key = createReferenceTable(cpu);
	const table = createReferenceTable(cpu, 0, 64);
	const keyValue = valueTable(key);
	nativeHeapReference(cpu).gc.tables.set(table, keyValue, valueInteger(9));
	for (let index = 1; index <= 8; index++) nativeHeapReference(cpu).gc.tables.setStringKey(table, nativeHeapReference(cpu).stringPool.intern(`other_${index}`), valueInteger(index));
	const continuation = new ValueSlots(2);
	cpu.tables.next(table, keyValue, continuation, 0);
	assert.notEqual(continuation.getTag(0), ValueTag.Nil);
	const expected = continuation.get(0);
	nativeHeapReference(cpu).gc.tables.set(table, keyValue, valueNil());
	cpu.tables.next(table, keyValue, continuation, 0);
	assert.notEqual(continuation.getTag(0), ValueTag.Nil);
	assert.equal(continuation.get(0), expected);
});
