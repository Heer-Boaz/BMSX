import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { HeapServiceRemarkHeadField, HEAP_SERVICE_REMARK_HEAD_OFFSET } from '../../machine/ts/spec/bmsx/heap_service';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

for (const opt of [0, 3] as const) {
	test(`firmware installs the String index by ordinary RAM stores and resumes between them (O${opt})`, () => {
		const source = `
local index<const> = require('kernel/string_index')
index.install({ field = 27 })
local receiver<const> = 'receiver'
return receiver.field`;
		const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, opt));
		const { cpu, memory } = createTestSystemCpu(linked);
		const head = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
		const tag = () => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.StringIndexTag);
		const word = () => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.StringIndexWord);
		assert.equal(tag(), ValueTag.Nil);
		for (let grant = 0; grant < 30_000 && tag() === ValueTag.Nil; ++grant) {
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		}
		assert.equal(tag(), ValueTag.Table);
		assert.equal(word(), 0, 'the second RAM store has not executed yet');
		assert.ok(cpu.heapServiceActive());
		const checkpoint = captureCpuCheckpoint(cpu);
		runGuestToHalt(cpu, 30_000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(27)]);
		const address = word();
		assert.notEqual(address, 0);
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.equal(word(), 0);
		runGuestToHalt(cpu, 30_000);
		assert.equal(word(), address);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(27)]);
	});
}

test('a rejected String index install leaves the previous binding intact', () => {
	const source = `
function exception()
	halt_until_irq
end
local index<const> = require('kernel/string_index')
index.install({ field = 27 })
index.install(0)`;
	const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, 3));
	const { cpu, memory } = createTestSystemCpu(linked);
	const head = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	const word = () => memory.readRamRecordWord(head + HeapServiceRemarkHeadField.StringIndexWord);
	for (let grant = 0; grant < 30_000 && word() === 0; ++grant) {
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	}
	const previous = word();
	assert.notEqual(previous, 0);
	assert.equal(runCpuWithinBudget(cpu, 30_000), RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	assert.equal(memory.readRamRecordWord(head + HeapServiceRemarkHeadField.StringIndexTag), ValueTag.Table);
	assert.equal(word(), previous);
});
