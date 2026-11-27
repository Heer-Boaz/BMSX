import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueInteger } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { HeapServiceRemarkHeadField, HEAP_SERVICE_REMARK_HEAD_OFFSET } from '../../machine/ts/spec/bmsx/heap_service';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../helpers/managed_system';

function boot(source: string, opt: 0 | 3) {
	const linked = linkManagedTestSystem(source, opt);
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
	const startup = linked.symbols.metadata.functionIds.indexOf('module:main/startup');
	assert.notEqual(startup, -1);
	const entry = linked.symbols.functionAddresses[startup];
	let budget = 1_000_000;
	for (let slice = 0; slice < 32 && cpu.readFrameFunctionAddress(0) !== entry && budget > 0; ++slice) {
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Yielded);
		budget = cpu.instructionBudgetRemaining;
	}
	assert.equal(cpu.readFrameFunctionAddress(0), entry);
	return runtime.machine;
}

for (const opt of [0, 3] as const) {
	test(`firmware installs the String index by ordinary RAM stores and resumes between them (O${opt})`, () => {
		const source = `
local index<const> = require('kernel/string_index')
index.install({ field = 27 })
local receiver<const> = 'receiver'
return receiver.field`;
		const { cpu, memory } = boot(source, opt);
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
	const { cpu, memory } = boot(source, 3);
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
