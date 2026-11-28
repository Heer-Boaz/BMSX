import { reserveThreadFrameReference } from '../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeLE32 } from '../../machine/ts/common/endian';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { findRomFunctionExtentAtPc, isRomInstructionHead, RomFunctionLane } from '../../machine/ts/machine/cpu/execution_image';
import { valueInteger, type Value } from '../../machine/ts/machine/cpu/value';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE } from '../../machine/ts/machine/memory/mapped_page';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG,
} from '../../machine/ts/spec/blua32/image_format';
import { BASE_BX_BITS, INSTRUCTION_BYTES, MAX_LOW_OPERAND, MAX_OPERAND_BITS, MAX_BX_BITS, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { createTestSystemCpu, linkRawTestSystemBlua32, seedTestRomClosure } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';

function validImage() {
	const text = new Uint8Array(2 * MAPPED_PAGE_BYTE_SIZE);
	const source = { verifiedControlFlow: true, text, functions: [
		{ firstWord: 0, wordCount: 1, maxStack: 2 }, { firstWord: 0, wordCount: 1 },
	] };
	const { textAddress } = linkRawTestSystemBlua32(source).image.header;
	const prefix = (MAPPED_PAGE_BYTE_SIZE - (textAddress & MAPPED_PAGE_BYTE_MASK)) / INSTRUCTION_BYTES - 1;
	for (let word = 0; word < prefix; ++word) writeInstruction(text, word, OpCode.K0, 0, 0, 0);
	writeInstruction(text, prefix - 1, OpCode.EQ, 1, 0, 1);
	writeInstruction(text, prefix, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, prefix + 1, OpCode.KSMI, 0, 0, 17);
	writeInstruction(text, prefix + 2, OpCode.RET, 0, 2, 0);
	writeInstruction(text, prefix + 4, OpCode.K1, 0, 0, 0);
	writeInstruction(text, prefix + 5, OpCode.RET, 0, 2, 0);
	source.functions[0].wordCount = prefix + 3;
	source.functions[1].firstWord = prefix + 4;
	source.functions[1].wordCount = 2;
	const image = linkRawTestSystemBlua32(source);
	assert.equal(image.image.header.textAddress, textAddress);
	return { image, prefix, textAddress };
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`verified function keeps a cross-page WIDE head and skips its whole instruction (${backend})`, () => {
		const { image, prefix, textAddress } = validImage();
		const { cpu } = createTestSystemCpu(image, backend);
		const dir = cpu.rootThread.currentFrame!.executionImage.romFunctions;
		const head = textAddress + prefix * INSTRUCTION_BYTES, body = head + INSTRUCTION_BYTES;
		assert.equal(head & MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SIZE - INSTRUCTION_BYTES);
		assert.equal(dir.mappedCode, false);
		assert.equal(findRomFunctionExtentAtPc(dir, head), 0);
		assert.equal(findRomFunctionExtentAtPc(dir, body), 0);
		assert.equal(findRomFunctionExtentAtPc(dir, body + 2 * INSTRUCTION_BYTES), -1, 'padding belongs to no function');
		assert.equal(findRomFunctionExtentAtPc(dir, body + 3 * INSTRUCTION_BYTES), RomFunctionLane.Count);
		assert.equal(isRomInstructionHead(dir, head), true);
		assert.equal(isRomInstructionHead(dir, head + 2), false);
		assert.equal(isRomInstructionHead(dir, body), false);
		assert.equal(isRomInstructionHead(dir, body + INSTRUCTION_BYTES), true);
		assert.equal(cpu.runUntilDepth(0, 4000), RunResult.Halted);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(0)]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`live closures use the newly published entry and register layout (${backend})`, () => {
		const { image, prefix, textAddress } = validImage();
		const { cpu, memory, executionAddressSpace } = createTestHeapServiceCpu(image, backend);
		reserveThreadFrameReference(cpu, cpu.rootThread, 16);
		const record = image.symbols.functionAddresses[0];
		const closure = seedTestRomClosure(cpu, record);
		const nextEntry = textAddress + (prefix + 4) * INSTRUCTION_BYTES;
		const replacement = image.romBytes.slice();
		writeLE32(replacement, record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, nextEntry);
		writeLE32(replacement, record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, 2 * INSTRUCTION_BYTES);
		writeLE32(replacement, record + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, 1);
		writeLE32(replacement, record + BLUA32_FUNCTION_MAX_STACK_OFFSET, 7);
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setClosure(0, closure);
		frame.top = Math.max(1, frame.top);
		memory.installSystemRom(replacement);
		assert.equal(cpu.captureClosureBinding(closure).codeAddress, textAddress);
		assert.throws(() => cpu.beginCompletionCall(closure), /ROM must be published/);
		const boots = [executionAddressSpace.resolveSystemDomain()];
		cpu.replaceExecutionImages(boots);
		assert.equal(cpu.readFramePc(0), textAddress, 'the host view publication does not relocate a guest register');
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, record, nextEntry);
		cpu.beginCompletionCall(closure);
		assert.equal(cpu.readFramePc(1), nextEntry);
		assert.equal(cpu.activeThread.currentFrame!.stackCapacity, 7);
		assert.equal(cpu.activeThread.currentFrame!.top, 1);
		assert.equal(cpu.runUntilDepth(1, 40), RunResult.Halted);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(1)]);
	});
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`published entry editing rejects WIDE bodies; RFE uses the instruction bus (${backend})`, () => {
		const { image, prefix, textAddress } = validImage();
		const { cpu, memory, executionAddressSpace } = createTestSystemCpu(image, backend);
		const body = textAddress + (prefix + 1) * INSTRUCTION_BYTES;
		const fn = image.symbols.functionAddresses[0];
		assert.throws(() => cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, fn, body), /instruction of its published function/);
		assert.equal(cpu.readFramePc(0), textAddress);

		const replacement = image.romBytes.slice();
		writeInstruction(replacement, textAddress / INSTRUCTION_BYTES + prefix - 1, OpCode.EQ, 0, 0, 1);
		memory.installSystemRom(replacement);
		assert.throws(() => cpu.runUntilDepth(0, 4000), /ROM must be published/);
		assert.equal(cpu.readFramePc(0), textAddress);
		cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
		assert.equal(cpu.runUntilDepth(0, 4000), RunResult.Halted);
		const result: Value[] = [];
		cpu.readCompletionValues(result);
		assert.deepEqual(result, [valueInteger(17)]);

		const irq = image.romBytes.slice();
		writeInstruction(irq, textAddress / INSTRUCTION_BYTES, OpCode.RFE, 0, 0, 0);
		const nmi = createTestSystemCpu({ romBytes: irq }, backend);
		nmi.cpu.requestNonMaskableInterrupt();
		assert.equal(nmi.cpu.enterPendingInterrupt(), true);
		nmi.cpu.writeEpcWord(body);
		const faults = nmi.memory.readBusFaultSequence();
		assert.equal(nmi.cpu.runUntilDepth(0, BASE_CYCLES[OpCode.RFE] + 1), RunResult.Yielded);
		assert.equal(nmi.cpu.readFramePc(0), body + INSTRUCTION_BYTES);
		assert.equal(nmi.cpu.readFrameRegister(0, 0), valueInteger(17), 'the fetch starts at the written word without a WIDE prefix');
		assert.equal(nmi.memory.readBusFaultSequence(), faults);
	});
}

test('published functions reject cross-boundary flow and incomplete width before execution', () => {
	const { image, prefix, textAddress } = validImage();
	const pc = textAddress / INSTRUCTION_BYTES;
	const record = image.symbols.functionAddresses[0], sibling = image.symbols.functionAddresses[1];
	const cases: [string, (rom: Uint8Array) => void, RegExp][] = [
		['capture-closing branch to sibling entry', rom => {
			writeInstruction(rom, pc + prefix + 2, OpCode.JMP, 1, 0, 1);
		}, /branch target is not an instruction/],
		['WIDE capture-closing branch to sibling entry', rom => {
			writeInstruction(rom, pc + prefix, OpCode.WIDE, 1, 0, 0);
			writeInstruction(rom, pc + prefix + 1, OpCode.JMP, 0, 0, 2);
		}, /branch target is not an instruction/],
		['conditional branch to sibling entry', rom => {
			writeInstruction(rom, pc + prefix + 2, OpCode.JMPIF, 0, 0, 1);
		}, /branch target is not an instruction/],
		['branch to WIDE suffix', rom => {
			writeInstruction(rom, pc + prefix - 1, OpCode.JMP, 0, 0, 1);
		}, /branch target is not an instruction/],
		['skip past the function', rom => {
			writeLE32(rom, record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, (prefix + 2) * INSTRUCTION_BYTES);
		}, /comparison skips past the end/],
		['visible fallthrough after HALT', rom => {
			writeInstruction(rom, pc + prefix + 2, OpCode.HALT, 0, 0, 0);
		}, /falls through the end/],
		['WIDE without a body', rom => {
			writeLE32(rom, record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, (prefix + 1) * INSTRUCTION_BYTES);
		}, /incomplete WIDE instruction/],
		['double WIDE', rom => {
			writeInstruction(rom, pc + prefix + 1, OpCode.WIDE, 0, 0, 0);
		}, /incomplete WIDE instruction/],
		['partially overlapping functions', rom => {
			writeLE32(rom, sibling + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, textAddress + (prefix + 1) * INSTRUCTION_BYTES);
		}, /extents overlap/],
		['missing published directory', rom => {
			writeLE32(rom, image.image.address + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, 0);
		}, /has no function directory/],
	];
	for (const [name, damage, error] of cases) {
		const romBytes = image.romBytes.slice();
		damage(romBytes);
		assert.throws(() => createTestSystemCpu({ romBytes }), error, name);
	}
});

test('a WIDE relative branch uses the sign and origin of the two-word form', () => {
	const { image, prefix, textAddress } = validImage();
	const romBytes = image.romBytes.slice(), head = textAddress / INSTRUCTION_BYTES + prefix;
	writeInstruction(romBytes, head, OpCode.WIDE, 0, 63, 0);
	writeInstruction(romBytes, head + 1, OpCode.JMP, 0, 63, 62, 255); // -2 words, back to the prefix.
	assert.doesNotThrow(() => createTestSystemCpu({ romBytes }));
});

test('generated code links bounded windows around a WIDE split in a large published function', () => {
	const text = new Uint8Array(5 * MAPPED_PAGE_BYTE_SIZE);
	const source = { verifiedControlFlow: true, text, functions: [{ firstWord: 0, wordCount: text.length / INSTRUCTION_BYTES }] };
	const { textAddress } = linkRawTestSystemBlua32(source).image.header;
	const windowEnd = (textAddress & ~MAPPED_PAGE_BYTE_MASK) + 4 * MAPPED_PAGE_BYTE_SIZE;
	const prefix = (windowEnd - textAddress) / INSTRUCTION_BYTES - 1;
	for (let i = 0; i < source.functions[0].wordCount; ++i) writeInstruction(text, i, OpCode.RET, 0, 1, 0);
	writeInstruction(text, prefix, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, prefix + 1, OpCode.KSMI, 0, 0, 41);
	for (const [from, to] of [[0, prefix], [prefix + 2, 0]]) {
		const bx = (to - from - 1) & ((1 << BASE_BX_BITS) - 1);
		writeInstruction(text, from, OpCode.JMP, 0,
			(bx >>> MAX_OPERAND_BITS) & MAX_LOW_OPERAND, bx & MAX_LOW_OPERAND, bx >>> MAX_BX_BITS);
	}
	const linked = linkRawTestSystemBlua32(source);
	const { cpu } = createTestSystemCpu(linked, CpuExecutionBackend.JavaScript);
	assert.equal(cpu.runUntilDepth(0, 2_000), RunResult.Yielded);
	assert.equal(cpu.readFrameRegister(0, 0), valueInteger(41));
	const lookup = cpu.rootThread.currentFrame!.executionImage.compiledCodeLookup!;
	const first = lookup.find(textAddress, 0)!.compiledBlocks!.entries[(textAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
	const across = lookup.find(windowEnd - INSTRUCTION_BYTES, 0)!.compiledBlocks!.entries[MAPPED_PAGE_BYTE_SIZE / INSTRUCTION_BYTES - 1];
	assert.ok(first && across);
	assert.notEqual(first.region, across.region);
	assert.ok(lookup.find(windowEnd, 0)!.compiledBlocks!.entries[0] === null, 'the body word is not an entry');
});

test('the same executable extent may be named by multiple record addresses', () => {
	const { image, prefix, textAddress } = validImage();
	const romBytes = image.romBytes.slice(), sibling = image.symbols.functionAddresses[1];
	writeLE32(romBytes, sibling + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, textAddress);
	writeLE32(romBytes, sibling + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, (prefix + 3) * INSTRUCTION_BYTES);
	const { cpu } = createTestSystemCpu({ romBytes });
	const dir = cpu.rootThread.currentFrame!.executionImage.romFunctions;
	assert.deepEqual([...dir.codeOrder], [0]);
	assert.equal(dir.versions[RomFunctionLane.EndPc], textAddress + (prefix + 3) * INSTRUCTION_BYTES);
	assert.equal(dir.versions.length, 2 * RomFunctionLane.Count);
});

test('a plain jump may cross a verified extent only at another declared entry', () => {
	const { image, prefix, textAddress } = validImage();
	const romBytes = image.romBytes.slice(), jumpWord = textAddress / INSTRUCTION_BYTES + prefix + 2;
	writeInstruction(romBytes, jumpWord, OpCode.JMP, 0, 0, 1);
	const fixed = createTestSystemCpu({ romBytes });
	assert.equal(fixed.cpu.runUntilDepth(0, 4000), RunResult.Halted);
	const fixedResult: Value[] = [];
	fixed.cpu.readCompletionValues(fixedResult);
	assert.deepEqual(fixedResult, [valueInteger(1)]);
	writeInstruction(romBytes, jumpWord, OpCode.JMP, 0, 0, 2);
	assert.throws(() => createTestSystemCpu({ romBytes }), /branch target is not an instruction/);
	writeLE32(romBytes, image.image.address + BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG);
	const { cpu } = createTestSystemCpu({ romBytes });
	assert.equal(cpu.rootThread.currentFrame!.executionImage.romFunctions.mappedCode, true);
	assert.equal(cpu.runUntilDepth(0, 4000), RunResult.Halted);
	const result: Value[] = [];
	cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueInteger(0)]);
});
