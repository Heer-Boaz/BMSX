import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Value } from '../../machine/ts/machine/cpu/value';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram, type CompiledSystemProgram } from '../../toolchain/ts/lua/compiler';
import {
	createTestSystemCpu,
	disassembleTestBlua32Functions,
	linkRawTestSystemBlua32,
	linkTestSystemBlua32,
} from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runCompiledLua, runCompletionClosure } from './cpu_test_harness';

const TEST_RAM_BASE = RAM_BASE + 0x20000;

for (const optLevel of [0, 3] as const) {
	test(`typed pointer scaling combines only exact binary64 powers of two at O${optLevel}`, () => {
		const source = `
local pointer<const>: *u16 = 0
return function(index)
    return &pointer[index * 2], &pointer[2 * index], &pointer[index * 3], &pointer[index * 0.5]
end, function(index)
    return 0 + (index * 2) * 2, 0 + (2 * index) * 2, 0 + (index * 3) * 2, 0 + (index * 0.5) * 2
end`;
		const compiled = compileLuaSource(source, 'pointer-scale.lua', optLevel);
		const image = linkTestSystemBlua32(compiled);
		const code = disassembleTestBlua32Functions(image, image.symbols.functionAddresses);
		// Each power-of-two index has one MUL; the non-power-of-two factor
		// retains both operations because that transformation is not assumed.
		assert.equal((code.match(/\bMUL\b/g) ?? []).length, 14);
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const { cpu } = createTestSystemCpu(image, backend);
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			const [closure, reference] = materializeCpuCompletionValues(cpu) as Closure[];
			for (const index of [0, -0, 0.5, -0.5, Number.MIN_VALUE, -Number.MIN_VALUE,
				2 ** -1022, 2 ** 31, 2 ** 32 - 1, 2 ** 53, Number.MAX_VALUE,
				Infinity, -Infinity, NaN, null, false] as Value[]) {
				runCompletionClosure(cpu, closure, [index]);
				const actual = materializeCpuCompletionValues(cpu);
				runCompletionClosure(cpu, reference, [index]);
				const expected = materializeCpuCompletionValues(cpu);
				const number = index === null || index === false ? NaN : index as number;
				const ieeeExpected = [0 + (number * 2) * 2, 0 + (2 * number) * 2, 0 + (number * 3) * 2, 0 + (number * 0.5) * 2];
				for (let i = 0; i < expected.length; ++i) {
					assert.ok(Object.is(actual[i], expected[i]), `${backend}: ${String(index)} at ${i}: ${String(actual[i])} != ${String(expected[i])}`);
					assert.ok(Object.is(actual[i], ieeeExpected[i]), `${backend}: IEEE result at ${i} for ${String(index)}`);
				}
			}
		}
	});

	test(`typed pointer scaling evaluates the dynamic index exactly once at O${optLevel}`, () => {
		const source = `
local pointer<const>: *u16 = 0
local count = 0
local function value()
    count = count + 1
    return count
end
local first = &pointer[value() * 2]
local second = &pointer[2 * value()]
return first, second, count`;
		const image = linkTestSystemBlua32(compileLuaSource(source, 'pointer-effects.lua', optLevel));
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const { cpu } = createTestSystemCpu(image, backend);
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			assert.deepEqual(materializeCpuCompletionValues(cpu), [4, 8, 2]);
		}
	});

	test(`typed pointer scaling preserves wrapped word addresses at O${optLevel}`, () => {
		const source = `
local pointer<const>: *u16 = ${TEST_RAM_BASE}
return function(index)
    pointer[index * 2] = 4660
    return pointer[index * 2]
end`;
		const image = linkTestSystemBlua32(compileLuaSource(source, 'pointer-wrap.lua', optLevel));
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const { cpu, memory } = createTestSystemCpu(image, backend);
			assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
			const closure = materializeCpuCompletionValues(cpu)[0] as Closure;
			for (const index of [0, 2 ** 30, -(2 ** 30)]) {
				runCompletionClosure(cpu, closure, [index]);
				assert.deepEqual(materializeCpuCompletionValues(cpu), [4660]);
				assert.equal(memory.readMappedU16LE(TEST_RAM_BASE), 4660);
			}
		}
	});
}

function parseSource(source: string, path = 'struct_addressing.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, source);
	return parser.parseChunk();
}

function compileSource(source: string): CompiledSystemProgram {
	return compileLuaChunkToProgram(parseSource(source), [], {
		entrySource: source,
		programDomain: 'system',
	});
}

function disassembleEntryFunction(compiled: CompiledSystemProgram): string {
	const image = linkTestSystemBlua32(compiled);
	return disassembleTestBlua32Functions(image, [image.vectors.entryFunctionAddress]);
}

function makeDisplacedMemoryCode(): Uint8Array {
	const instructionCount = 10;
	const code = new Uint8Array(instructionCount * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.LOADK, 0, 0, 0, 0);
	writeInstruction(code, 1, OpCode.LOADK, 1, 0, 1, 0);
	writeInstruction(code, 2, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.Word, 0);
	writeInstruction(code, 3, OpCode.LOADK, 1, 0, 2, 0);
	writeInstruction(code, 4, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.Word, 12);
	writeInstruction(code, 5, OpCode.LOAD_MEM_D, 2, 0, MemoryAccessKind.Word, 12);
	writeInstruction(code, 6, OpCode.LOADK, 3, 0, 3, 0);
	writeInstruction(code, 7, OpCode.LOADK, 4, 0, 4, 0);
	writeInstruction(code, 8, OpCode.STORE_MEM_WORDS_D, 3, 0, 2, 16);
	writeInstruction(code, 9, OpCode.RET, 2, 2, 0, 0);
	return code;
}

test('CPU executes displaced memory load/store opcodes', () => {
	const finalized = linkRawTestSystemBlua32({
		text: makeDisplacedMemoryCode(),
		functions: [{ firstWord: 0, wordCount: 10, maxStack: 5 }],
		constants: [TEST_RAM_BASE, 0x11111111, 0x22222222, 0x33333333, 0x44444444],
	});
	const { cpu, memory } = createTestSystemCpu(finalized);

	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0x22222222]);
	assert.equal(memory.readMappedU32LE(TEST_RAM_BASE), 0x11111111);
	assert.equal(memory.readMappedU32LE(TEST_RAM_BASE + 48), 0x22222222);
	assert.equal(memory.readMappedU32LE(TEST_RAM_BASE + 64), 0x33333333);
	assert.equal(memory.readMappedU32LE(TEST_RAM_BASE + 68), 0x44444444);
});

test('compiler emits displaced memory opcodes for register base plus aligned byte offset', () => {
	const source = `
local base = ${TEST_RAM_BASE}
mem[base + 48] = 7
return mem[base + 48]
`;
	const compiled = compileSource(source);
	const disassembly = disassembleEntryFunction(compiled);

	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 0, 48/);
	assert.match(disassembly, /LOAD_MEM_D r\d+, r\d+, 0, 48/);
	assert.deepEqual(runCompiledLua(source), [7]);
});

test('compiler keeps generic memory path for out-of-range or unaligned offsets', () => {
	const outOfRange = disassembleEntryFunction(compileSource(`
local base = ${TEST_RAM_BASE}
mem[base + 1024] = 7
`));
	const unaligned = disassembleEntryFunction(compileSource(`
local base = ${TEST_RAM_BASE}
mem8[base + 2] = 7
`));

	assert.equal(outOfRange.includes('STORE_MEM_D'), false);
	assert.match(outOfRange, /STORE_MEM r\d+, r\d+/);
	assert.equal(unaligned.includes('STORE_MEM_D'), false);
	assert.match(unaligned, /ADD r\d+, r\d+, k\d+\(2\)/);
	assert.match(unaligned, /STORE_MEM r\d+, r\d+/);
});

test('struct views lower fields, arrays, sizeof, offsetof, and address-of to memory words', () => {
	const result = runCompiledLua(`
struct tri
	header: word
	xy: word[3]
	color: word
end
local base<const> = ${TEST_RAM_BASE}
local packets<const>: *tri[2] = base
packets[0].header = 0x11111111
packets[0].xy[2] = 0x22222222
packets[1].color = 0x33333333
return mem[base], mem[base + 12], mem[base + sizeof(tri) + offsetof(tri.color)], &packets[1], sizeof(tri), offsetof(tri.color)
`);

	assert.deepEqual(result, [0x11111111, 0x22222222, 0x33333333, TEST_RAM_BASE + 20, 20, 16]);
});

test('struct views support nested records and row-major multi-dimensional arrays', () => {
	const result = runCompiledLua(`
struct camera
	view: word[4]
	eye: word[4]
end
struct draw
	header: word
	constants: camera
end
local base<const> = ${TEST_RAM_BASE}
local scene<const>: *draw[2][3] = base
scene[1][2].constants.view[3] = 0x12345678
return mem[base + 196], &scene[1][0], sizeof(draw), offsetof(draw.constants.eye)
`);

	assert.deepEqual(result, [0x12345678, TEST_RAM_BASE + 108, 36, 20]);
});

test('pointer arrow fields lower scalar reads and writes to displaced memory opcodes', () => {
	const source = `
struct tri
	xy: f32[3]
	color: word
	joint: word
	weight: word
end
local base<const> = ${TEST_RAM_BASE}
local packet<const>: *tri = base + sizeof(tri)
packet->xy[0] = 1.0
packet->xy[1] = 2.0
packet->xy[2] = 3.0
packet->color = 7
packet->joint = 8
packet->weight = 9
return packet->color, packet->weight
`;
	const compiled = compileSource(source);
	const disassembly = disassembleEntryFunction(compiled);

	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 4, 0/);
	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 0, 20/);
	assert.deepEqual(runCompiledLua(source), [7, 9]);
});

test('pointer dereference and indexed pointer fields lower to direct memory stores', () => {
	const source = `
struct q16_matrix
	m: word[4]
end
local base<const> = ${TEST_RAM_BASE}
local matrices<const>: *q16_matrix = base
matrices->m[0] = 1
matrices->m[1] = 2
matrices->m[2] = 3
matrices->m[3] = 4
matrices[1].m[0] = 5
matrices[1].m[1] = 6
matrices[1].m[2] = 7
matrices[1].m[3] = 8
return mem[base], mem[base + sizeof(q16_matrix) + 12]
`;
	const compiled = compileSource(source);
	const disassembly = disassembleEntryFunction(compiled);

	assert.equal(disassembly.includes('NEWT'), false);
	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 0, 0/);
	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 0, 28/);
	assert.deepEqual(runCompiledLua(source), [1, 8]);
});

test('compiler rejects whole-struct assignment targets', () => {
	assert.throws(
		() => compileSource(`
struct q16_matrix
	m: word[4]
end
local base<const> = ${TEST_RAM_BASE}
local matrices<const>: *q16_matrix = base
*matrices = 1
`),
		/Whole-struct assignment is not supported/,
	);
});

test('compiler pointer diagnostics retain their source location', () => {
	assert.throws(
		() => compileSource(`local address = ${TEST_RAM_BASE}\n*address = 1`),
		/entry struct_addressing\.lua: 2:1: Pointer dereference assignment requires a typed pointer\./,
	);
	assert.throws(
		() => compileSource(`local address = ${TEST_RAM_BASE}\nreturn *address`),
		/entry struct_addressing\.lua: 2:8: Pointer dereference requires a typed pointer\./,
	);
});
