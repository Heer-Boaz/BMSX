import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { COMPILED_BLOCK_THRESHOLD, CompiledBlockExit, CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueInteger, valueNil, valuePayload, valueString, valueTable, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu, compileHeapServiceSystem } from '../helpers/heap_service_system';
import { runGuestToHalt } from '../helpers/cpu_execution';

test('compiled captured-function binding publishes the live moved reference to BIOS collection', () => {
	const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local function factory(input)
	local live = input
	input = nil
	return function() return live end
end
return factory
`, 0));
	const { cpu } = createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript);
	runGuestToHalt(cpu, 100_000);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.equal(values.length, 1);
	const factory = valuePayload(values[0]), start = cpu.captureClosureBinding(factory).codeAddress;
	// Keep the already issued factory bound while repeatedly warming its
	// ordinary SVC exit and retiring the verified firmware.
	setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.intern('factory'), values[0]);
	for (let i = 0; i < COMPILED_BLOCK_THRESHOLD + 2; ++i) {
		cpu.beginCompletionCall(factory, [valueInteger(i)]);
		runGuestToHalt(cpu, 100_000);
	}
	nativeHeapReference(cpu).gc.collect(); // the next collector work must come from this allocation
	const payload = nativeHeapReference(cpu).stringPool.intern('payload'), kept = nativeHeapReference(cpu).stringPool.intern('retained');
	const table = createReferenceTable(cpu, 1024, 1);
	nativeHeapReference(cpu).gc.tables.setStringKey(table, payload, valueString(kept));
	cpu.beginCompletionCall(factory, [valueTable(table)]);
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(nativeHeapReference(cpu).luaHeap.usedBytes());
	const caller = cpu.rootThread.currentFrame!;
	assert.equal(cpu.runUntilDepth(0, 4096, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	assert.ok(cpu.fixedInterruptActive(), 'the compiled caller entered the architectural System vector');
	const block = caller.decodedPage!.compiledBlocks!.entries[(start & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES]!;
	assert.equal(block.terminal.exit, CompiledBlockExit.SupervisorCall);
	assert.equal(caller.registers.get(0), valueNil(), 'the source register no longer holds the Table');
	const before = nativeHeapReference(cpu).gc.white();
	runGuestToHalt(cpu, 100_000);
	assert.ok(nativeHeapReference(cpu).gc.active() || nativeHeapReference(cpu).gc.white() !== before, 'BIOS admitted collector work during the allocation');
	cpu.readCompletionValues(values);
	const capture = valuePayload(values[0]);
	nativeHeapReference(cpu).gc.collect(values[0]);
	assert.equal(cpu.readClosureUpvalue(capture, 0), valueTable(table));
	assert.equal(cpu.tables.getStringKey(table, payload), valueString(kept));
});
