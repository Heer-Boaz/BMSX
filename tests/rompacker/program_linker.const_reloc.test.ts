import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LuaLexer } from '../../src/bmsx/lua/syntax/lualexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/luaparser';
import { OpCode, type Proto } from '../../src/bmsx/emulator/cpu';
import { INSTRUCTION_BYTES, readInstructionWord, writeInstruction } from '../../src/bmsx/emulator/instruction_format';
import { compileLuaChunkToProgram } from '../../src/bmsx/emulator/program_compiler';
import type { ProgramAsset, ProgramConstReloc } from '../../src/bmsx/emulator/program_asset';
import { linkProgramAssets } from '../../src/bmsx/emulator/program_linker';

type EncodedWord = {
	op: OpCode;
	a: number;
	b: number;
	c: number;
	ext?: number;
};

function parseChunk(source: string) {
	const lexer = new LuaLexer(source, 'test.lua');
	const parser = new LuaParser(lexer.scanTokens(), 'test.lua', source);
	return parser.parseChunk();
}

function buildCode(words: ReadonlyArray<EncodedWord>): Uint8Array {
	const code = new Uint8Array(words.length * INSTRUCTION_BYTES);
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		writeInstruction(code, index, word.op, word.a, word.b, word.c, word.ext ?? 0);
	}
	return code;
}

function makeProto(codeLen: number): Proto {
	return {
		entryPC: 0,
		codeLen,
		numParams: 0,
		isVararg: false,
		maxStack: 2,
		upvalueDescs: [],
	};
}

function makeProgramAsset(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string>,
	constRelocs: ReadonlyArray<ProgramConstReloc>,
): ProgramAsset {
	const code = buildCode(words);
	return {
		entryProtoIndex: 0,
		program: {
			code,
			constPool: Array.from(constPool),
			protos: [makeProto(code.length)],
		},
		moduleProtos: [],
		moduleAliases: [],
		link: {
			constRelocs: Array.from(constRelocs),
		},
	};
}

function makeEngineAsset(constPoolSize: number): ProgramAsset {
	const constPool = new Array<null | boolean | number | string>(constPoolSize);
	for (let index = 0; index < constPoolSize; index += 1) {
		constPool[index] = index;
	}
	return makeProgramAsset(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		constPool,
		[],
	);
}

function decodeBx(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const ext = word >>> 24;
	const bLow = (word >>> 6) & 0x3f;
	const cLow = word & 0x3f;
	const bxLow = (bLow << 6) | cLow;
	const wideWord = readInstructionWord(code, wordIndex - 1);
	const wideB = (wideWord >>> 6) & 0x3f;
	return (wideB << 20) | (ext << 12) | bxLow;
}

function decodeSignedRkB(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const bLow = (word >>> 6) & 0x3f;
	const ext = word >>> 24;
	const extB = (ext >>> 3) & 0x7;
	const wideWord = readInstructionWord(code, wordIndex - 1);
	const wideB = (wideWord >>> 6) & 0x3f;
	const raw = (wideB << 9) | (extB << 6) | bLow;
	return (raw & (1 << 14)) !== 0 ? raw - (1 << 15) : raw;
}

function decodeUnsignedB(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const bLow = (word >>> 6) & 0x3f;
	const ext = word >>> 24;
	const extB = (ext >>> 3) & 0x7;
	const wideWord = readInstructionWord(code, wordIndex - 1);
	const wideB = (wideWord >>> 6) & 0x3f;
	return (wideB << 9) | (extB << 6) | bLow;
}

function decodeUnsignedC(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const cLow = word & 0x3f;
	const ext = word >>> 24;
	const extC = ext & 0x7;
	const wideWord = readInstructionWord(code, wordIndex - 1);
	const wideC = wideWord & 0x3f;
	return (wideC << 9) | (extC << 6) | cLow;
}

function collectOps(code: Uint8Array): OpCode[] {
	const ops: OpCode[] = [];
	const instructionCount = code.length / INSTRUCTION_BYTES;
	for (let index = 0; index < instructionCount; index += 1) {
		ops.push(((readInstructionWord(code, index) >>> 18) & 0x3f) as OpCode);
	}
	return ops;
}

test('ProgramCompiler emits WIDE before LOADK const sites', () => {
	const source = 'local a = "hello"\nreturn a';
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	const code = compiled.program.code;
	const instructionCount = code.length / INSTRUCTION_BYTES;
	let foundLoadK = false;
	for (let index = 0; index < instructionCount; index += 1) {
		const op = (readInstructionWord(code, index) >>> 18) & 0x3f;
		if (op !== OpCode.LOADK) {
			continue;
		}
		foundLoadK = true;
		assert.ok(index > 0);
		const prevOp = (readInstructionWord(code, index - 1) >>> 18) & 0x3f;
		assert.equal(prevOp, OpCode.WIDE);
	}
	assert.equal(foundLoadK, true);
});

test('ProgramCompiler emits WIDE before RK const reloc sites', () => {
	const source = 'local a = 1\nreturn a + 2';
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	const rkRelocs = compiled.constRelocs.filter(reloc => reloc.kind === 'rk_b' || reloc.kind === 'rk_c');
	assert.ok(rkRelocs.length > 0);
	for (const reloc of rkRelocs) {
		assert.ok(reloc.wordIndex > 0);
		const prevOp = (readInstructionWord(compiled.program.code, reloc.wordIndex - 1) >>> 18) & 0x3f;
		assert.equal(prevOp, OpCode.WIDE);
	}
});

test('ProgramCompiler emits specialized table opcodes for constant field and integer access', () => {
	const source = [
		'local t = {}',
		't.foo = 1',
		't[2] = 3',
		'local a = t.foo',
		'local b = t[2]',
		'return a, b',
	].join('\n');
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	const ops = collectOps(compiled.program.code);
	assert.ok(ops.includes(OpCode.SETFIELD));
	assert.ok(ops.includes(OpCode.GETFIELD));
	assert.ok(ops.includes(OpCode.SETI));
	assert.ok(ops.includes(OpCode.GETI));
});

test('ProgramCompiler emits SELF for method calls with constant method names', () => {
	const source = [
		'local function call_method(obj)',
		'\treturn obj:ping()',
		'end',
		'return call_method',
	].join('\n');
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	const ops = collectOps(compiled.program.code);
	assert.ok(ops.includes(OpCode.SELF));
});

test('ProgramCompiler rejects undefined identifiers when source is provided', () => {
	const source = 'return missing_value';
	const chunk = parseChunk(source);
	assert.throws(
		() => compileLuaChunkToProgram(chunk, [], { entrySource: source }),
		/error\(s\):[\s\S]*'missing_value' is not defined\./,
	);
});

test('ProgramCompiler accepts shared runtime globals when source is provided', () => {
	const source = 'return assets, sys_vdp_stream_base, cart_manifest';
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler does not confuse shadowed locals with outer const bindings', () => {
	const source = [
		'local outer<const> = 1',
		'local function read_shadow()',
		'\tlocal outer = 2',
		'\touter = outer + 1',
		'\treturn outer',
		'end',
		'return read_shadow()',
	].join('\n');
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramLinker patches Bx relocations against large engine const pools', () => {
	const engineAsset = makeEngineAsset(5000);
	const cartAsset = makeProgramAsset(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0, ext: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[900001],
		[{ wordIndex: 1, kind: 'bx', constIndex: 0 }],
	);

	const linked = linkProgramAssets(engineAsset, null, cartAsset, null);
	const linkedCode = linked.programAsset.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeBx(linkedCode, cartBaseWord + 1), 5000);
});

test('ProgramLinker patches RK(B) relocations against large engine const pools', () => {
	const engineAsset = makeEngineAsset(5000);
	const cartAsset = makeProgramAsset(
		[
			{ op: OpCode.WIDE, a: 0, b: 0x3f, c: 0 },
			{ op: OpCode.ADD, a: 0, b: 0x3f, c: 0, ext: 0x38 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[900002],
		[{ wordIndex: 1, kind: 'rk_b', constIndex: 0 }],
	);

	const linked = linkProgramAssets(engineAsset, null, cartAsset, null);
	const linkedCode = linked.programAsset.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeSignedRkB(linkedCode, cartBaseWord + 1), -5001);
});

test('ProgramLinker patches direct field const relocations against large engine const pools', () => {
	const engineAsset = makeEngineAsset(5000);
	const cartAsset = makeProgramAsset(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.GETFIELD, a: 0, b: 1, c: 0, ext: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.SETFIELD, a: 1, b: 1, c: 0, ext: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.SELF, a: 2, b: 1, c: 2, ext: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		['field_get', 'field_set', 'field_self'],
		[
			{ wordIndex: 1, kind: 'const_c', constIndex: 0 },
			{ wordIndex: 3, kind: 'const_b', constIndex: 1 },
			{ wordIndex: 5, kind: 'const_c', constIndex: 2 },
		],
	);

	const linked = linkProgramAssets(engineAsset, null, cartAsset, null);
	const linkedCode = linked.programAsset.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 1), 5000);
	assert.equal(decodeUnsignedB(linkedCode, cartBaseWord + 3), 5001);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 5), 5002);
});
