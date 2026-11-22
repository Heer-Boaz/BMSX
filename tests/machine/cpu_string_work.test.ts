import { textToByteString } from '../../machine/ts/common/byte_string';
import { hashText } from '../../machine/ts/common/hash';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { BuiltinResults } from '../../machine/ts/machine/cpu/builtin_values';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueBool, valueFloat, valueNil, valueInteger } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND,
} from '../../machine/ts/spec/blua32/image_format';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

for (const backend of [CpuExecutionBackend.Interpreter]) {
	for (const op of [OpCode.CONCAT, OpCode.CONCATN, OpCode.LT, OpCode.LE, OpCode.EQ]) {
		test(`text work uses byte lengths on cold and compiled execution (${backend}, op=${op})`, () => {
			const text = new Uint8Array(4 * INSTRUCTION_BYTES);
			writeInstruction(text, 0, op, 0, 1, 2);
			for (let i = 1; i < 4; ++i) writeInstruction(text, i, OpCode.JMP, 0, 63, 63, 255);
			const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 4, maxStack: 8 }] });
			const { cpu } = createTestSystemCpu(image, backend);
			for (let repeat = 0; repeat < 24; ++repeat) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const frame = cpu.rootThread.currentFrame!;
				// Alternating unequal/equal interned operands also proves that intern
				// hits and comparison early-outs do not determine the cycle debit.
				const right = textToByteString('a😀雪\0');
				const left = repeat % 3 === 2 ? right : textToByteString(repeat % 3 === 1 ? 'a😀雪' : 'z😀雪');
				frame.registers.setString(1, cpu.stringPool.intern(left));
				frame.registers.setString(2, cpu.stringPool.intern(right));
				cpu.runUntilDepth(0, 1);
				const length = left.length + right.length;
				const cycles = BASE_CYCLES[op] + (op === OpCode.CONCAT ? length : op === OpCode.CONCATN ? 2 + length : op === OpCode.EQ ? 0 : Math.min(left.length, right.length));
				assert.equal(cpu.instructionBudgetRemaining, 1 - cycles);
				if (op === OpCode.CONCAT || op === OpCode.CONCATN) assert.equal(cpu.stringPool.bytes(frame.registers.getStringId(0)), left + right);
				else {
					const matched = op === OpCode.LT ? left < right : op === OpCode.LE ? left <= right : left === right;
					assert.equal(frame.pc, image.image.functions[0].codeAddress + (matched ? 2 : 1) * INSTRUCTION_BYTES);
				}
			}
			if (backend === CpuExecutionBackend.JavaScript) assert.ok(cpu.rootThread.currentFrame!.decodedPage!.compiledBlocks, 'the warm cases actually compile');
		});
	}

	test(`select clips INT_MIN and materializes only demanded results (${backend})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 34, 2);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 40 }] });
		const { cpu } = createTestSystemCpu(image, backend);
		const originalPush = BuiltinResults.prototype.push;
		let produced = 0;
		BuiltinResults.prototype.push = function (...args: Parameters<typeof originalPush>) { produced += 1; return originalPush.apply(this, args); };
		try {
			for (const selector of [-2147483648, 0, -32, -1, 1, 32, 33]) {
				cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], image.image.functions[0].codeAddress);
				const r = cpu.rootThread.currentFrame!.registers;
				r.setBuiltinFunction(0, BuiltinFunctionId.Select);
				r.setInteger(1, selector);
				for (let i = 1; i <= 32; ++i) r.setInteger(i + 1, i);
				produced = 0; cpu.runUntilDepth(0, 1);
				assert.equal(r.get(0), selector === 33 ? valueNil() : valueInteger(selector === -1 || selector === 32 ? 32 : 1));
				assert.equal(produced, selector === 33 ? 0 : 1, 'fixed one-result consumers must not copy the unused suffix');
			}
		} finally { BuiltinResults.prototype.push = originalPush; }
	});

	for (const wanted of [0, 1, 2, 6]) test(`select preserves open, discarded and padded ranges (${backend}, C=${wanted})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 5, wanted);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!, r = frame.registers;
		r.setBuiltinFunction(0, BuiltinFunctionId.Select);
		r.setInteger(1, -2147483648);
		for (let i = 0; i < 3; ++i) r.setInteger(i + 2, i + 10);
		cpu.runUntilDepth(0, 1);
		const count = wanted === 0 ? 3 : wanted - 1;
		assert.equal(frame.top, count);
		assert.deepEqual(Array.from({ length: count }, (_, i) => r.get(i)), [valueInteger(10), valueInteger(11), valueInteger(12), valueNil(), valueNil()].slice(0, count));
	});

	for (const selector of ['#', 'invalid']) test(`discarded select still validates its selector (${backend}, ${selector})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 2, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), frame = cpu.rootThread.currentFrame!;
		frame.registers.setBuiltinFunction(0, BuiltinFunctionId.Select);
		frame.registers.setString(1, cpu.stringPool.intern(selector));
		cpu.runUntilDepth(0, 1);
		if (selector === '#') assert.equal(frame.top, 0);
		else assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
	});

	for (const invalid of [false, true]) test(`string.char charges supplied byte arguments even when results are ignored (${backend}, invalid=${invalid})`, () => {
		const text = new Uint8Array(2 * INSTRUCTION_BYTES);
		writeInstruction(text, 0, OpCode.CALL, 0, 4, 1);
		writeInstruction(text, 1, OpCode.JMP, 0, 63, 63, 255);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 2, maxStack: 8 }] });
		const { cpu } = createTestSystemCpu(image, backend), r = cpu.rootThread.currentFrame!.registers;
		r.setBuiltinFunction(0, BuiltinFunctionId.StringChar);
		r.setInteger(1, invalid ? -1 : 65); r.setInteger(2, 0); r.setInteger(3, 0xff);
		cpu.runUntilDepth(0, 1);
		if (invalid) assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.CALL] - 2 - 3, 'CALL base + builtin 2 + three supplied byte arguments');
	});
}

for (const wide of [false, true]) {
	test(`StringSlice charges the inclusive raw byte span and resumes at the next instruction (WIDE=${wide})`, () => {
		const base = wide ? 256 : 0, callWord = wide ? 1 : 0;
		const text = new Uint8Array((callWord + 2) * INSTRUCTION_BYTES);
		if (wide) writeInstruction(text, 0, OpCode.WIDE, 1, 0, 0);
		writeInstruction(text, callWord, OpCode.CALL, 0, 4, 2);
		writeInstruction(text, callWord + 1, OpCode.HALT, 0, 0, 0);
		const functions = [{ firstWord: 0, wordCount: callWord + 2, maxStack: base + 5 }];
		const image = linkRawTestSystemBlua32({ text, functions });
		const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
		const pc = image.image.functions[0].codeAddress;
		const input = 'x'.repeat(254) + 'A\x00\xf7B' + 'x'.repeat(42);
		const inputId = cpu.stringPool.intern(input);
		for (const [first, last, expected] of [
			[valueInteger(255), valueInteger(258), 'A\x00\xf7B'],
			[valueFloat(255), valueFloat(258), 'A\x00\xf7B'],
			[valueInteger(256), valueInteger(256), '\x00'],
			[valueInteger(1), valueInteger(300), input],
		] as const) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, image.symbols.functionAddresses[0], pc);
			const f = cpu.rootThread.currentFrame!;
			f.registers.setBuiltinFunction(base, BuiltinFunctionId.StringSlice);
			f.registers.setString(base + 1, inputId);
			f.registers.set(base + 2, first);
			f.registers.set(base + 3, last);
			f.top = base + 4;
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
			assert.equal(cpu.instructionBudgetRemaining, 1 - BASE_CYCLES[OpCode.CALL] - 2 - expected.length - 1,
				'CALL, tier two, inclusive byte count and one placed result');
			assert.equal(f.pc, pc + (callWord + 1) * INSTRUCTION_BYTES);
			assert.equal(f.top, base + 1);
			assert.equal(cpu.stringPool.bytes(f.registers.getStringId(base)), expected);
		}
	});

	test(`StringSlice admits endpoints even when its result is discarded (WIDE=${wide})`, () => {
		const base = wide ? 256 : 0, callWord = wide ? 1 : 0;
		const text = new Uint8Array((callWord + 2) * INSTRUCTION_BYTES);
		if (wide) writeInstruction(text, 0, OpCode.WIDE, 1, 0, 0);
		writeInstruction(text, callWord, OpCode.CALL, 0, 4, 1);
		writeInstruction(text, callWord + 1, OpCode.HALT, 0, 0, 0);
		const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: callWord + 2, maxStack: base + 5 }] });
		for (const [first, last] of [
			[valueInteger(0), valueInteger(2)],
			[valueInteger(2), valueInteger(1)],
			[valueInteger(1), valueInteger(3)],
			[valueFloat(1.5), valueInteger(2)],
			[valueInteger(1), valueBool(true)],
		]) {
			const { cpu } = createTestSystemCpu(image, CpuExecutionBackend.Interpreter);
			const f = cpu.rootThread.currentFrame!;
			f.registers.setBuiltinFunction(base, BuiltinFunctionId.StringSlice);
			f.registers.setString(base + 1, cpu.stringPool.intern('ab'));
			f.registers.set(base + 2, first);
			f.registers.set(base + 3, last);
			f.top = base + 4;
			cpu.runUntilDepth(0, 1);
			assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
	});
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
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	assert.equal(cpu.captureRuntimeState().hardHalted, false);
	assert.equal(cpu.getFrameDepth(), 0);
});

const portCode = new Uint8Array(INSTRUCTION_BYTES);
writeInstruction(portCode, 0, OpCode.HALT, 0, 0, 0);
const portImage = linkRawTestSystemBlua32({ text: portCode, functions: [{ firstWord: 0, wordCount: 1, maxStack: 4 }] });

test('RAM String reads and intern probes wrap at the physical seam', () => {
	const { cpu } = createTestSystemCpu(portImage, CpuExecutionBackend.Interpreter);
	const memory = cpu.memory, pool = cpu.stringPool;
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
	assert.equal(pool.compare(mirror, straight), 0);
	assert.ok(pool.compare(mirror, after) < 0);
	for (const start of [6, 9]) {
		const slice = pool.internSlice(mirror, start, 4), expected = bytes.slice(start, start + 4);
		assert.equal(pool.bytes(slice), expected);
		assert.equal(pool.find(expected), slice, 'ordinary interning and slicing hash the same bytes');
		assert.equal(pool.internSlice(mirror, start, 4), slice, 'slice lookup compares the same physical span');
	}
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const count = memory.readRamRecordWord(metadata + 4);
	const bucket = memory.readRamRecordWord(metadata) + 4 * (hashText(bytes) & (count - 1));
	memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
	memory.writeRamRecordWord(bucket, mirror);
	assert.equal(pool.find(bytes), mirror);
});
