import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueBool, valueInteger, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { CPU_CAUSE_CODE_SYSCALL } from '../../machine/ts/spec/blua32/cop0';
import { GcDiagnosticField, GC_DIAGNOSTIC_OFFSET } from '../../machine/ts/machine/cpu/gc_heap';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../helpers/managed_system';

function boot(source: string, opt: 0 | 3) {
	const linked = linkManagedTestSystem(`halt_until_irq\n${source}`, opt);
	const runtime = new Runtime({
		systemRomBytes: writeTestBlua32Rom(linked),
		cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC,
	}, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu } = runtime.machine;
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	assert.equal(cpu.heapAllocator.occupiedBytes(), 0);
	runGuestToHalt(cpu, 1_000_000);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	cpu.clearHaltUntilIrq();
	return runtime.machine;
}

for (const opt of [0, 3] as const) {
	test(`firmware installs the String index by ordinary RAM stores and resumes between them (O${opt})`, () => {
		const source = `
local ids<const> = require('kernel/heap_control_ids')
blua32.svc_value(ids.string_index, { field = 27 })
local receiver<const> = 'receiver'
return receiver.field`;
		const { cpu, memory } = boot(source, opt);
		const head = cpu.heapAllocator.managementOffset() + GC_DIAGNOSTIC_OFFSET;
		const tag = () => memory.readRamRecordWord(head + GcDiagnosticField.StringIndexTag);
		const word = () => memory.readRamRecordWord(head + GcDiagnosticField.StringIndexWord);
		assert.equal(tag(), ValueTag.Nil);
		for (let grant = 0; grant < 30_000 && tag() === ValueTag.Nil; ++grant) {
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		}
		assert.equal(tag(), ValueTag.Table);
		assert.equal(word(), 0, 'the second RAM store has not executed yet');
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
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
local ids<const> = require('kernel/heap_control_ids')
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
blua32.svc_value(ids.string_index, { field = 27 })
return protect(function() blua32.svc_value(ids.string_index, 0) end)`;
	const { cpu, memory } = boot(source, 3);
	const head = cpu.heapAllocator.managementOffset() + GC_DIAGNOSTIC_OFFSET;
	const word = () => memory.readRamRecordWord(head + GcDiagnosticField.StringIndexWord);
	for (let grant = 0; grant < 30_000 && word() === 0; ++grant) {
		assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
	}
	const previous = word();
	assert.notEqual(previous, 0);
	runGuestToHalt(cpu, 30_000);
	const values = materializeCpuCompletionValues(cpu);
	assert.equal(values[0], valueBool(false));
	assert.equal(valueTag(values[1]), ValueTag.String);
	assert.equal(cpu.stringPool.bytes(valuePayload(values[1])), 'Invalid argument.');
	assert.equal(memory.readRamRecordWord(head + GcDiagnosticField.StringIndexTag), ValueTag.Table);
	assert.equal(word(), previous);
});
