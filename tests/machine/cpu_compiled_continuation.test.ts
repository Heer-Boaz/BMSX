import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend, CompiledBlockExit } from '../../machine/ts/machine/cpu/compiled_block';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import { RAM_CODE_FIXTURE_BYTES, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

test('same-frame integer table read continuations survive cross-page target replacement', () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] }, RAM_CODE_FIXTURE_BYTES);
	const machines = [createTestHeapServiceCpu(image, CpuExecutionBackend.JavaScript), createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter)];
	const [generated, scalar] = machines;
	const sourcePc = DYNAMIC_RAM_BASE + MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES;
	const targetPc = sourcePc + INSTRUCTION_BYTES;
	const code = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.GETI, 2, 0, 1);
	writeInstruction(code, 1, OpCode.KSMI, 1, 0, 7);
	writeInstruction(code, 2, OpCode.JMP, 0, 63, 61, 255);
	for (const { cpu, memory } of machines) {
		memory.writeBytes(sourcePc, code);
		cpu.rootThread.frameAtDepth(0).registers.setTable(0, createReferenceTable(cpu));
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], sourcePc);
		cpu.runUntilDepth(0, 4096);
	}
	assert.deepEqual(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
	const owner = generated.cpu.rootThread.frameAtDepth(0).executionImage;
	const lookup = owner.compiledCodeLookup!;
	const sourcePage = lookup.find(sourcePc, 0)!;
	const sourceWord = (sourcePc & (MAPPED_PAGE_BYTE_SIZE - 1)) / INSTRUCTION_BYTES;
	const source = sourcePage.compiledBlocks!.entries[sourceWord]!;
	const successor = lookup.find(targetPc, 0)!.compiledBlocks!.entries[0]!;
	const exit = source.exits.find(exit => exit.exit === CompiledBlockExit.ReadInteger)!;
	assert.equal(exit.linkedBlock, successor);
	let lookups = 0;
	const find = lookup.find.bind(lookup);
	lookup.find = (pc, bank) => { ++lookups; return find(pc, bank); };
	for (const grant of [128, 1, 2, 3, 4, 5, 6, 7]) {
		assert.equal(generated.cpu.runUntilDepth(0, grant), scalar.cpu.runUntilDepth(0, grant));
		assert.equal(generated.cpu.instructionBudgetRemaining, scalar.cpu.instructionBudgetRemaining);
		assert.deepEqual(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
	}
	assert.equal(lookups, 0, 'warm same-frame helpers do not repeat page/entry lookup');
	writeInstruction(code, 1, OpCode.KSMI, 1, 0, 13);
	for (const { memory } of machines) memory.writeBytes(targetPc, code.subarray(INSTRUCTION_BYTES, 2 * INSTRUCTION_BYTES));
	assert.equal(sourcePage.compiledBlocks!.entries[sourceWord], source, 'unmodified helper source remains compiled');
	assert.equal(exit.linkedBlock, null, 'target retirement withdraws its incoming helper continuation');
	for (const { cpu } of machines) cpu.runUntilDepth(0, 4096);
	assert.deepEqual(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
	assert.notEqual(exit.linkedBlock, successor);
	assert.equal(exit.linkedBlock, lookup.find(targetPc, 0)!.compiledBlocks!.entries[0]);
	assert.equal(generated.cpu.readFrameRegister(0, 1), valueInteger(13));
	const saved = generated.cpu.captureRuntimeState();
	generated.cpu.restoreRuntimeState(saved);
	scalar.cpu.restoreRuntimeState(scalar.cpu.captureRuntimeState());
	assert.equal(exit.linkedBlock, null, 'restore withdraws links owned by the old execution image');
	for (const grant of [1, 2, 3, 19, 512]) {
		assert.equal(generated.cpu.runUntilDepth(0, grant), scalar.cpu.runUntilDepth(0, grant));
		assert.equal(generated.cpu.instructionBudgetRemaining, scalar.cpu.instructionBudgetRemaining);
		assert.deepEqual(generated.cpu.captureRuntimeState(), scalar.cpu.captureRuntimeState());
	}
});
