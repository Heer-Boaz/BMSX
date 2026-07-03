import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, OpCode, RunResult, type Program, type ProgramMetadata, type Proto } from '../../machine/ts/machine/cpu/cpu';
import { disassembleProgram } from '../../machine/ts/machine/cpu/disassembler';
import { writeInstruction, INSTRUCTION_BYTES } from '../../machine/ts/machine/cpu/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/machine/memory/access_kind';
import { RAM_BASE } from '../../machine/ts/machine/memory/map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';
import { runCompiledLua } from './cpu_test_harness';

const TEST_RAM_BASE = RAM_BASE + 0x20000;

function parseSource(source: string, path = 'struct_addressing.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

function compileSource(source: string): ReturnType<typeof compileLuaChunkToProgram> {
	return compileLuaChunkToProgram(parseSource(source), [], { entrySource: source });
}

function makeProto(codeLen: number): Proto {
	return {
		entryPC: 0,
		codeLen,
		numParams: 0,
		isVararg: false,
		maxStack: 5,
		upvalueDescs: [],
		staticClosure: false,
	};
}

function makeMetadata(instructionCount: number): ProgramMetadata {
	return {
		debugRanges: new Array(instructionCount).fill(null),
		protoIds: ['main'],
		localSlotsByProto: [[]],
		upvalueNamesByProto: [[]],
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
}

function makeDisplacedMemoryProgram(cpu: CPU): Program {
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
	writeInstruction(code, 9, OpCode.RET, 2, 1, 0, 0);
	const pool = cpu.stringPool;
	return {
		code,
		programRom: code,
		programRomTextByteLength: code.byteLength,
		constPool: [TEST_RAM_BASE, 0x11111111, 0x22222222, 0x33333333, 0x44444444],
		protos: [makeProto(code.length)],
		stringPool: pool,
		constPoolStringPool: pool,
	};
}

test('CPU executes displaced memory load/store opcodes', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	const metadata = makeMetadata(10);
	cpu.setProgram(makeDisplacedMemoryProgram(cpu), metadata, metadata);
	cpu.start(0);

	assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
	assert.deepEqual(Array.from(cpu.lastReturnValues), [0x22222222]);
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
	const disassembly = disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: false });

	assert.match(disassembly, /STORE_MEM_D r\d+, r\d+, 0, 48/);
	assert.match(disassembly, /LOAD_MEM_D r\d+, r\d+, 0, 48/);
	assert.deepEqual(runCompiledLua(source), [7]);
});

test('compiler keeps generic memory path for out-of-range or unaligned offsets', () => {
	const outOfRange = disassembleProgram(compileSource(`
local base = ${TEST_RAM_BASE}
mem[base + 1024] = 7
`).program, null, { showProtoHeaders: false });
	const unaligned = disassembleProgram(compileSource(`
local base = ${TEST_RAM_BASE}
mem8[base + 2] = 7
`).program, null, { showProtoHeaders: false });

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
	const disassembly = disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: false });

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
	const disassembly = disassembleProgram(compiled.program, compiled.metadata, { showProtoHeaders: false });

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
