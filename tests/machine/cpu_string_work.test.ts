import { nativeHeapReference } from '../helpers/native_heap/reference';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { textToByteString } from '../../machine/ts/common/byte_string';
import { hashText } from '../../machine/ts/common/hash';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_MASK } from '../../machine/ts/machine/memory/mapped_page';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND,
} from '../../machine/ts/spec/blua32/image_format';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { internStringSliceReference } from '../helpers/string_slice_reference';

for (const backend of [CpuExecutionBackend.Interpreter]) {
	for (const op of [OpCode.LT, OpCode.LE, OpCode.EQ]) {
		test(`String comparisons use byte lengths on cold and compiled execution (${backend}, op=${op})`, () => {
			const text = new Uint8Array(4 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, op, 0, 1, 2);
			for (let i = 1; i < 4; ++i) writeInstruction(text, i, OpCode.JMP, 0, 63, 63, 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 8 }] });
			const { cpu } = createTestHeapServiceCpu(image, backend);
			for (let repeat = 0; repeat < 24; ++repeat) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const frame = cpu.rootThread.currentFrame!;
				// Unequal and equal operands prove that a lexicographic early-out
				// does not determine the comparison cycle debit.
				const right = textToByteString('a😀雪\0');
				const left = repeat % 3 === 2 ? right : textToByteString(repeat % 3 === 1 ? 'a😀雪' : 'z😀雪');
				frame.registers.setString(1, nativeHeapReference(cpu).stringPool.intern(left));
				frame.registers.setString(2, nativeHeapReference(cpu).stringPool.intern(right));
				cpu.runUntilDepth(0, 1);
				const cycles = BASE_CYCLES[op] + (op === OpCode.EQ ? 0 : Math.min(left.length, right.length));
				assert.equal(cpu.instructionBudgetRemaining, 1 - cycles);
				const matched = op === OpCode.LT ? left < right : op === OpCode.LE ? left <= right : left === right;
				assert.equal(frame.pc, image.image.functions[0].codeAddress + (matched ? 2 : 1) * INSTRUCTION_BYTES);
			}
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks, 'the warm cases actually compile');
		});
	}

}

test('BIOS string.sub normalizes inclusive byte bounds without decoding the input', () => {
	const { cpu } = createCartlibProgramHarness(`
bss raw: u8[300]
raw[254] = 255
raw[255] = 0
raw[256] = 128
raw[257] = 195
local s<const> = string.from_bytes(raw, 300)
local span<const> = string.char(255,0,128,195)
assert(string.sub(s,255,258) == span)
assert(string.sub(s,-46,-43) == span)
assert(string.sub(s,255.75,258.9) == span)
assert(string.sub(s,256,256) == string.char(0))
assert(string.sub(s,0,1000) == s and string.sub(s,nil) == s)
assert(string.sub(s,258,255) == '' and string.sub(s,1,0) == '')
`, { optLevel: 3 });
	runGuestToHalt(cpu, 10_000_000);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	assert.equal(cpu.getFrameDepth(), 0);
});

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	for (const op of [OpCode.LT, OpCode.LE]) test(`String order retires across grants and restores its byte position (${backend}, ${op})`, () => {
		const code = new Uint8Array(4 * INSTRUCTION_BYTES);
		writeInstruction(code, 0, op, 0, 1, 2);
		for (let i = 1; i < 4; ++i) writeInstruction(code, i, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text: code, functions: [{ firstWord: 0, wordCount: 4, maxStack: 4 }] });
		const { cpu, memory } = createTestHeapServiceCpu(image, backend);
		const pc = image.image.functions[0].codeAddress;
		const a = nativeHeapReference(cpu).stringPool.intern('x'.repeat(513)), b = nativeHeapReference(cpu).stringPool.intern('x'.repeat(512) + 'y');
		const frame = cpu.rootThread.currentFrame!;
		frame.registers.setString(1, a); frame.registers.setString(2, op === OpCode.LE ? a : b); frame.top = 3;
		for (let i = 0; i < 24; ++i) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			cpu.runUntilDepth(0, BASE_CYCLES[op] + 513);
		}
		if (backend === CpuExecutionBackend.JavaScript) assert.ok(frame.decodedPage!.compiledBlocks!.entries[(pc & MAPPED_PAGE_BYTE_MASK) >>> 2]);
		cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
		cpu.runUntilDepth(0, BASE_CYCLES[op] + 7);
		const anchor = cpu.captureRuntimeState(), ram = memory.captureSaveState();
		assert.equal(anchor.stringComparison.offset, 7);
		assert.equal(anchor.stringComparison.remaining, 506);
		for (const step of [1, 129]) {
			memory.restoreSaveState(ram); cpu.restoreRuntimeState(anchor);
			memory.writeRamRecordByte(a + BLUA32_STRING_RECORD_HEADER_SIZE, 122);
			cpu.requestNonMaskableInterrupt(); assert.equal(cpu.enterPendingInterrupt(), false);
			for (let remaining = 506; remaining;) {
				const grant = Math.min(remaining, step);
				cpu.runUntilDepth(0, grant); remaining -= grant;
				assert.equal(cpu.instructionBudgetRemaining, 0);
				assert.equal(cpu.activeThread.currentFrame!.pc, pc + (remaining ? 4 : 8));
			}
		}
	});
}

const portCode = new Uint8Array(INSTRUCTION_BYTES);
writeInstruction(portCode, 0, OpCode.HALT, 0, 0, 0);
const portImage = linkRawTestSystemBlua32({ text: portCode, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] });

test('RAM String reads and intern probes wrap at the physical seam', () => {
	const { cpu } = createTestHeapServiceCpu(portImage, CpuExecutionBackend.Interpreter);
	const memory = cpu.memory, pool = nativeHeapReference(cpu).stringPool;
	const bytes = 'wrapRAM!\x00\xf7xyz';
	const straight = pool.intern(bytes), after = pool.intern('wrapRAM!\x00\xf8xyz');
	const mirror = RAM_BASE + 2 * MAIN_RAM_SIZE - 24;
	memory.writeRamRecordWord(mirror, BLUA32_STRING_RECORD_KIND);
	memory.writeRamRecordWord(mirror + BLUA32_STRING_LENGTH_OFFSET, 0xffc0000d);
	memory.writeRamRecordWord(mirror + BLUA32_STRING_HASH_OFFSET, hashText(bytes));
	for (let i = 0; i < bytes.length; ++i) memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + i, bytes.charCodeAt(i));
	assert.equal(pool.byteLength(mirror), 13);
	assert.equal(pool.bytes(mirror), bytes);
	assert.equal(pool.byteAt(mirror, 8), 0);
	assert.equal(pool.byteAt(mirror, 9), 0xf7);
	assert.equal(pool.compareBytes(mirror, after, 6, 3), 0);
	assert.equal(pool.compareBytes(mirror, after, 10, 3), 0);
	assert.equal(pool.compareBytes(mirror, straight, 0, 13), 0);
	assert.ok(pool.compareBytes(mirror, after, 6, 4) < 0);
	for (const start of [6, 9]) {
		const slice = internStringSliceReference(pool, mirror, start, 4), expected = bytes.slice(start, start + 4);
		assert.equal(pool.bytes(slice), expected);
		assert.equal(pool.find(expected), slice, 'ordinary interning and slicing hash the same bytes');
		assert.equal(internStringSliceReference(pool, mirror, start, 4), slice, 'slice lookup compares the same physical span');
	}
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const count = memory.readRamRecordWord(metadata + 4);
	const bucket = memory.readRamRecordWord(metadata) + 4 * (hashText(bytes) & (count - 1));
	memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
	memory.writeRamRecordWord(bucket, mirror);
	assert.equal(pool.find(bytes), mirror);
	const second = mirror - 4;
	for (let i = 0; i < 18; ++i) memory.writeRamRecordByte(second + BLUA32_STRING_RECORD_HEADER_SIZE + i, 0x80);
	memory.writeRamRecordByte(mirror + BLUA32_STRING_RECORD_HEADER_SIZE + 13, 0xff);
	assert.equal(pool.compareBytes(mirror, second, 1, 12), 0);
	assert.ok(pool.compareBytes(mirror, second, 1, 13) > 0);
});
