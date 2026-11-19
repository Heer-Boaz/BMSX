import { textToByteString } from '../../machine/ts/common/byte_string';
import { hashText } from '../../machine/ts/common/hash';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { BuiltinResults } from '../../machine/ts/machine/cpu/builtin_values';
import { HEAP_STRING_METADATA_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueNil, valueInteger, valueString } from '../../machine/ts/machine/cpu/value';
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

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
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
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const count = memory.readRamRecordWord(metadata + 4);
	const bucket = memory.readRamRecordWord(metadata) + 4 * (hashText(bytes) & (count - 1));
	memory.writeRamRecordWord(mirror + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
	memory.writeRamRecordWord(bucket, mirror);
	assert.equal(pool.find(bytes), mirror);
});

for (const grow of [false, true]) test(`cyclic String links terminate lookup and ${grow ? 'growth' : 'sweep'}`, () => {
	const { cpu } = createTestSystemCpu(portImage, CpuExecutionBackend.Interpreter);
	const memory = cpu.memory, pool = cpu.stringPool, original = 'cycle at an intern bucket head';
	const metadata = cpu.heapAllocator.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	pool.intern('index seed');
	const count = memory.readRamRecordWord(metadata + 4);
	if (grow) {
		for (let i = memory.readRamRecordWord(metadata + 8); i + 1 < count; ++i) pool.intern('bucket filler ' + i);
	}
	const self = pool.intern(original);
	let missing: string;
	for (let i = 0; ; ++i) {
		missing = 'lookup collision ' + i;
		if (((hashText(missing) ^ hashText(original)) & (count - 1)) === 0) break;
	}
	memory.writeRamRecordWord(self + BLUA32_STRING_NEXT_OFFSET, self);
	assert.equal(pool.find(missing), undefined);
	if (grow) {
		const inserted = pool.intern(missing);
		assert.equal(pool.find(missing), inserted);
		assert.equal(memory.readRamRecordWord(metadata + 4), count * 2);
	} else {
		cpu.gc.collect(valueString(self));
		assert.equal(pool.find(original), self);
		assert.equal(memory.readRamRecordWord(self + BLUA32_STRING_NEXT_OFFSET), 0);
		memory.writeRamRecordWord(self + BLUA32_STRING_NEXT_OFFSET, self);
		cpu.gc.collect();
		assert.equal(pool.find(original), undefined);
	}
});
