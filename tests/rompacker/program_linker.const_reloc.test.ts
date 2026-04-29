import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../src/bmsx/common/text_lines';
import { LuaLexer } from '../../src/bmsx/lua/syntax/lexer';
import { LuaParser } from '../../src/bmsx/lua/syntax/parser';
import { CPU, OpCode, RunResult, Table, createNativeFunction, type Proto } from '../../src/bmsx/machine/cpu/cpu';
import { INSTRUCTION_BYTES, readInstructionWord, writeInstruction } from '../../src/bmsx/machine/cpu/instruction_format';
import { appendLuaChunkToProgram, compileLuaChunkToProgram } from '../../src/bmsx/machine/program/compiler';
import type { ProgramImage, ProgramConstReloc } from '../../src/bmsx/machine/program/loader';
import { linkProgramImages } from '../../src/bmsx/machine/program/linker';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { isStringValue, stringValueToString } from '../../src/bmsx/machine/memory/string/pool';

type EncodedWord = {
	op: OpCode;
	a: number;
	b: number;
	c: number;
	ext?: number;
};

function parseChunk(source: string, path: string = 'test.lua') {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
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

function makeProgramImage(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string>,
	constRelocs: ReadonlyArray<ProgramConstReloc>,
): ProgramImage {
	const code = buildCode(words);
	return {
		entryProtoIndex: 0,
		program: {
			code,
			constPool: Array.from(constPool),
			protos: [makeProto(code.length)],
			},
			moduleProtos: [],
			staticModulePaths: [],
			link: {
			constRelocs: Array.from(constRelocs),
		},
	};
}

function makeSystemImage(constPoolSize: number): ProgramImage {
	const constPool = new Array<null | boolean | number | string>(constPoolSize);
	for (let index = 0; index < constPoolSize; index += 1) {
		constPool[index] = index;
	}
	return makeProgramImage(
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

function collectProtoOps(program: { code: Uint8Array; protos: Proto[] }, protoIndex: number): OpCode[] {
	const proto = program.protos[protoIndex];
	const startWord = proto.entryPC / INSTRUCTION_BYTES;
	const wordCount = proto.codeLen / INSTRUCTION_BYTES;
	const ops: OpCode[] = [];
	for (let index = 0; index < wordCount; index += 1) {
		ops.push(((readInstructionWord(program.code, startWord + index) >>> 18) & 0x3f) as OpCode);
	}
	return ops;
}

function collectProtoGlobalNames(
	program: { code: Uint8Array; protos: Proto[] },
	globalNames: ReadonlyArray<string>,
	protoIndex: number,
	opcode: OpCode,
): string[] {
	const proto = program.protos[protoIndex];
	const startWord = proto.entryPC / INSTRUCTION_BYTES;
	const wordCount = proto.codeLen / INSTRUCTION_BYTES;
	const names: string[] = [];
	for (let index = 0; index < wordCount; index += 1) {
		const wordIndex = startWord + index;
		const word = readInstructionWord(program.code, wordIndex);
		const op = ((word >>> 18) & 0x3f) as OpCode;
		if (op !== opcode) {
			continue;
		}
		const ext = word >>> 24;
		const bLow = (word >>> 6) & 0x3f;
		const cLow = word & 0x3f;
		let wideB = 0;
		if (wordIndex > startWord) {
			const prevWord = readInstructionWord(program.code, wordIndex - 1);
			const prevOp = ((prevWord >>> 18) & 0x3f) as OpCode;
			if (prevOp === OpCode.WIDE) {
				wideB = (prevWord >>> 6) & 0x3f;
			}
		}
		const slot = (wideB << 20) | (ext << 12) | ((bLow << 6) | cLow);
		names.push(globalNames[slot]);
	}
	return names;
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
	const source = 'return sys_rom_data, sys_vdp_stream_base, cart_manifest';
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

test('ProgramCompiler rewrites const require member access to flattened GETGL slots', () => {
	const moduleSource = [
		'local mod<const> = {}',
		'function mod.foo()',
		'\treturn 1',
		'end',
		'return mod',
	].join('\n');
	const entrySource = [
		'local mod<const> = require("mod")',
		'return mod.foo()',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[{ path: 'mod', chunk: parseChunk(moduleSource, 'mod'), source: moduleSource }],
		{ entrySource },
	);
	const entryLoads = collectProtoGlobalNames(compiled.program, compiled.metadata.globalNames, compiled.entryProtoIndex, OpCode.GETGL);
	const entryOps = collectProtoOps(compiled.program, compiled.entryProtoIndex);
	assert.ok(entryLoads.includes('mod__foo'));
	assert.equal(entryOps.includes(OpCode.GETFIELD), false);
	assert.equal(entryOps.includes(OpCode.SELF), false);
});

test('ProgramCompiler rewrites external const require member access inside closures', () => {
	const moduleSource = [
		'local mod<const> = {}',
		'function mod.foo()',
		'\treturn 1',
		'end',
		'return mod',
	].join('\n');
	const entrySource = [
		'local mod<const> = require("mod")',
		'local function read_foo()',
		'\treturn mod.foo()',
		'end',
		'return read_foo()',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[],
		{
			entrySource,
			externalModules: [{ path: 'mod', chunk: parseChunk(moduleSource, 'mod'), source: moduleSource }],
		},
	);
	const closureProtoIndex = compiled.metadata.protoIds.findIndex((id) => id.includes('read_foo'));
	assert.notEqual(closureProtoIndex, -1);
	const closureLoads = collectProtoGlobalNames(compiled.program, compiled.metadata.globalNames, closureProtoIndex, OpCode.GETGL);
	const closureOps = collectProtoOps(compiled.program, closureProtoIndex);
	assert.ok(closureLoads.includes('mod__foo'));
	assert.equal(closureOps.includes(OpCode.GETUP), false);
	assert.equal(closureOps.includes(OpCode.GETFIELD), false);
});

test('ProgramCompiler emits nil for missing direct external require fields inside closures', () => {
	const moduleSource = [
		'local mod<const> = {}',
		'function mod.foo()',
		'\treturn 1',
		'end',
		'return mod',
	].join('\n');
	const entrySource = [
		'local mod<const> = require("mod")',
		'local function read_missing()',
		'\treturn mod.missing',
		'end',
		'return read_missing()',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[],
		{
			entrySource,
			externalModules: [{ path: 'mod', chunk: parseChunk(moduleSource, 'mod'), source: moduleSource }],
		},
	);
	const closureProtoIndex = compiled.metadata.protoIds.findIndex((id) => id.includes('read_missing'));
	assert.notEqual(closureProtoIndex, -1);
	const closureOps = collectProtoOps(compiled.program, closureProtoIndex);
	assert.equal(closureOps.includes(OpCode.GETUP), false);
	assert.equal(closureOps.includes(OpCode.GETFIELD), false);
});

test('ProgramCompiler rejects external module roots captured as closure upvalues', () => {
	const moduleSource = [
		'local mod<const> = {}',
		'function mod.foo()',
		'\treturn 1',
		'end',
		'return mod',
	].join('\n');
	const entrySource = [
		'local mod<const> = require("mod")',
		'local function read_root()',
		'\treturn mod',
		'end',
		'return read_root()',
	].join('\n');
	assert.throws(
		() => compileLuaChunkToProgram(
			parseChunk(entrySource, 'cart.lua'),
			[],
			{
				entrySource,
				externalModules: [{ path: 'mod', chunk: parseChunk(moduleSource, 'mod'), source: moduleSource }],
			},
		),
		/External module 'mod' is compile-time only/,
	);
});

test('ProgramCompiler emits module export slot stores from module returns', () => {
	const moduleSource = [
		'local constants<const> = {}',
		'constants.room = { tile_size = 8 }',
		'return constants',
	].join('\n');
	const entrySource = [
		'local constants<const> = require("constants")',
		'local room<const> = constants.room',
		'return room.tile_size',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[{ path: 'constants', chunk: parseChunk(moduleSource, 'constants'), source: moduleSource }],
		{ entrySource },
	);
	const moduleProtoIndex = compiled.moduleProtoMap.get('constants');
	assert.notEqual(moduleProtoIndex, undefined);
	const moduleStores = collectProtoGlobalNames(compiled.program, compiled.metadata.globalNames, moduleProtoIndex!, OpCode.SETGL);
	const entryLoads = collectProtoGlobalNames(compiled.program, compiled.metadata.globalNames, compiled.entryProtoIndex, OpCode.GETGL);
	const entryOps = collectProtoOps(compiled.program, compiled.entryProtoIndex);
	assert.ok(moduleStores.includes('constants__room'));
	assert.ok(moduleStores.includes('constants__room__tile_size'));
	assert.ok(entryLoads.includes('constants__room'));
	assert.ok(entryLoads.includes('constants__room__tile_size'));
	assert.equal(entryOps.includes(OpCode.GETFIELD), false);
});

test('flattened module export slots stay in sync with runtime require results', () => {
	const moduleSource = [
		'local constants<const> = {}',
		'constants.room = { tile_size = 8 }',
		'return constants',
	].join('\n');
	const entrySource = [
		'local constants<const> = require("constants")',
		'local room<const> = constants.room',
		'return room.tile_size, constants.room',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[{ path: 'constants', chunk: parseChunk(moduleSource, 'constants'), source: moduleSource }],
		{ entrySource },
	);
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata);
	const requireFn = createNativeFunction('require', (args, out) => {
		assert.ok(isStringValue(args[0]));
		const moduleName = stringValueToString(args[0]);
		assert.equal(moduleName, 'constants');
		const protoIndex = compiled.moduleProtoMap.get('constants');
		assert.notEqual(protoIndex, undefined);
		cpu.call({ protoIndex: protoIndex!, upvalues: [] }, []);
		assert.equal(cpu.run(100000), RunResult.Halted);
		const value = cpu.lastReturnValues[0];
		out.push(value !== undefined ? value : null);
	});
	cpu.setGlobalByKey(cpu.getStringPool().intern('require'), requireFn);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.run(100000), RunResult.Halted);
	assert.equal(cpu.lastReturnValues[0], 8);
	const room = cpu.lastReturnValues[1];
	assert.ok(room instanceof Table);
	assert.equal(room.getStringKey(cpu.getStringPool().intern('tile_size')), 8);
	assert.equal(cpu.getGlobalByKey(cpu.getStringPool().intern('constants__room__tile_size')), 8);
});

test('flattened module export slots survive program append swaps', () => {
	const moduleSource = [
		'local constants<const> = {}',
		'constants.room = { tile_size = 8 }',
		'return constants',
	].join('\n');
	const entrySource = [
		'local constants<const> = require("constants")',
		'return constants.room.tile_size',
	].join('\n');
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[{ path: 'constants', chunk: parseChunk(moduleSource, 'constants'), source: moduleSource }],
		{ entrySource },
	);
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata);
	const requireFn = createNativeFunction('require', (args, out) => {
		assert.ok(isStringValue(args[0]));
		assert.equal(stringValueToString(args[0]), 'constants');
		const protoIndex = compiled.moduleProtoMap.get('constants');
		assert.notEqual(protoIndex, undefined);
		cpu.call({ protoIndex: protoIndex!, upvalues: [] }, []);
		assert.equal(cpu.run(100000), RunResult.Halted);
		const value = cpu.lastReturnValues[0];
		out.push(value !== undefined ? value : null);
	});
	cpu.setGlobalByKey(cpu.getStringPool().intern('require'), requireFn);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.run(100000), RunResult.Halted);
	const slotKey = cpu.getStringPool().intern('constants__room__tile_size');
	assert.equal(cpu.getGlobalByKey(slotKey), 8);

	const consoleSource = 'return 1';
	const appended = appendLuaChunkToProgram(
		compiled.program,
		compiled.metadata,
		parseChunk(consoleSource, 'console'),
		{ entrySource: consoleSource },
	);
	cpu.setProgram(appended.program, appended.metadata);
	assert.equal(cpu.getGlobalByKey(slotKey), 8);
});

test('ProgramLinker patches Bx relocations against large system const pools', () => {
	const systemImage = makeSystemImage(5000);
	const cartAsset = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0, ext: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[900001],
		[{ wordIndex: 1, kind: 'bx', constIndex: 0 }],
	);

	const linked = linkProgramImages(systemImage, null, cartAsset, null);
	const linkedCode = linked.programImage.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeBx(linkedCode, cartBaseWord + 1), 5000);
});

test('ProgramLinker patches RK(B) relocations against large system const pools', () => {
	const systemImage = makeSystemImage(5000);
	const cartAsset = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0x3f, c: 0 },
			{ op: OpCode.ADD, a: 0, b: 0x3f, c: 0, ext: 0x38 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[900002],
		[{ wordIndex: 1, kind: 'rk_b', constIndex: 0 }],
	);

	const linked = linkProgramImages(systemImage, null, cartAsset, null);
	const linkedCode = linked.programImage.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeSignedRkB(linkedCode, cartBaseWord + 1), -5001);
});

test('ProgramLinker patches direct field const relocations against large system const pools', () => {
	const systemImage = makeSystemImage(5000);
	const cartAsset = makeProgramImage(
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

	const linked = linkProgramImages(systemImage, null, cartAsset, null);
	const linkedCode = linked.programImage.program.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 1), 5000);
	assert.equal(decodeUnsignedB(linkedCode, cartBaseWord + 3), 5001);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 5), 5002);
});
