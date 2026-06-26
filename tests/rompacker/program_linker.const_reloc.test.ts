import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, OpCode, RunResult, StringValue, Table, asStringId, createNativeFunction, valueIsString, type Proto } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, readInstructionWord, writeInstruction } from '../../machine/ts/machine/cpu/instruction_format';
import { appendLuaChunkToProgram, compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/machine/program/compiler';
import { decodeProgramSymbolsImage, inflateProgram, type ProgramImage, type ProgramConstReloc, type ProgramSymbolsImage } from '../../machine/ts/machine/program/loader';
import { inflateExecutableProgramImage, linkBootProgramImages, linkProgramImages, resolveRuntimeProgramRelocations } from '../../machine/ts/machine/program/linker';
import { replaceWithJump, replaceWithMov } from '../../machine/ts/machine/program/optimizer/values';
import type { Instruction } from '../../machine/ts/machine/program/optimizer';
import { SYSTEM_BASE_PC } from '../../machine/ts/machine/program/layout';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { PROGRAM_ROM_BASE, PROGRAM_STATIC_RAM_BASE, RAM_END } from '../../machine/ts/machine/memory/map';

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
		staticClosure: false,
	};
}

function makeProgramImage(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string>,
	constRelocs: ReadonlyArray<ProgramConstReloc>,
): ProgramImage {
	const code = buildCode(words);
	return {
		vectors: {
			resetProtoIndex: 0,
			sectionInitProtoIndex: 0,
			irqProtoIndex: 0,
		},
		sections: {
			text: {
				code,
				protos: [makeProto(code.length)],
			},
			rodata: {
				constPool: Array.from(constPool),
				moduleProtos: [],
				staticModulePaths: [],
				bytes: new Uint8Array(0),
				symbols: [],
			},
			data: { bytes: new Uint8Array(0), symbols: [] },
			bss: { byteCount: 0, symbols: [] },
		},
		link: {
			constRelocs: Array.from(constRelocs),
			constValueRelocs: [],
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

test('ProgramImage exposes text and rodata as ROM sections', () => {
	const image = makeProgramImage(
		[{ op: OpCode.RETURN, a: 0, b: 1, c: 0 }],
		['literal', 3],
		[],
	);
	image.sections.rodata.moduleProtos.push({ path: 'rooms/castle', protoIndex: 0 });
	image.sections.rodata.staticModulePaths.push('system/init');
	image.sections.rodata.bytes = new Uint8Array([1, 2, 3, 4]);

	const program = inflateProgram(image.sections);

	assert.deepEqual(image.vectors, { resetProtoIndex: 0, sectionInitProtoIndex: 0, irqProtoIndex: 0 });
	assert.equal(image.sections.text.code.length, INSTRUCTION_BYTES);
	assert.equal(image.sections.rodata.constPool.length, 2);
	assert.equal(image.sections.text.protos.length, 1);
	assert.equal(program.code, image.sections.text.code);
	assert.deepEqual(Array.from(program.programRom), Array.from(image.sections.text.code).concat([1, 2, 3, 4]));
	assert.equal(program.programRomTextByteLength, image.sections.text.code.byteLength);
	assert.equal(program.protos, image.sections.text.protos);
	assert.equal(image.sections.data.bytes.byteLength, 0);
	assert.equal(image.sections.bss.byteCount, 0);
});

test('ProgramCompiler emits a dedicated IRQ vector proto', () => {
	const source = 'while true do halt_until_irq end';
	const compiled = compileLuaChunkToProgram(parseChunk(source), [], { entrySource: source });
	const image = encodeCompiledProgramImage(compiled);
	const irqProto = image.sections.text.protos[image.vectors.irqProtoIndex];
	const wordIndex = irqProto.entryPC / INSTRUCTION_BYTES;
	const irqOps: OpCode[] = [];
	for (let index = 0; index < irqProto.codeLen / INSTRUCTION_BYTES; index += 1) {
		irqOps.push(((readInstructionWord(image.sections.text.code, wordIndex + index) >>> 18) & 0x3f) as OpCode);
	}

	assert.notEqual(image.vectors.irqProtoIndex, image.vectors.sectionInitProtoIndex);
	assert.deepEqual(irqOps, [OpCode.WIDE, OpCode.LOADK, OpCode.LOAD_MEM, OpCode.K0, OpCode.EQ, OpCode.JMP, OpCode.GETGL, OpCode.MOV, OpCode.CALL, OpCode.KNIL, OpCode.RET]);
});

function makeProgramSymbols(protoId: string, instructionCount: number): ProgramSymbolsImage {
	return {
		debugRanges: new Array(instructionCount).fill(null),
		protoIds: [protoId],
		localSlotsByProto: [[]],
		upvalueNamesByProto: [[]],
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
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

function collectProtoRelocSymbols(
	compiled: ReturnType<typeof compileLuaChunkToProgram>,
	protoIndex: number,
	kind: 'module' | 'export_proto',
): string[] {
	const proto = compiled.program.protos[protoIndex];
	const startWord = proto.entryPC / INSTRUCTION_BYTES;
	const endWord = startWord + proto.codeLen / INSTRUCTION_BYTES;
	const symbols: string[] = [];
	for (const reloc of compiled.constRelocs) {
		if (reloc.kind !== kind || reloc.wordIndex < startWord || reloc.wordIndex >= endWord) {
			continue;
		}
		symbols.push(reloc.symbol);
	}
	return symbols;
}


test('optimizer instruction rewrites discard symbolic relocation metadata', () => {
	const loadModuleSymbol: Instruction = {
		op: OpCode.LOADK,
		a: 0,
		b: 0,
		c: 0,
		format: 'ABx',
		rkMask: 0,
		target: null,
		symbolicReloc: { kind: 'module', symbol: 'mod__value' },
	};
	replaceWithMov(loadModuleSymbol, 1, 2);
	assert.equal(loadModuleSymbol.symbolicReloc, undefined);

	const loadExportSymbol: Instruction = {
		op: OpCode.LOADK,
		a: 0,
		b: 0,
		c: 0,
		format: 'ABx',
		rkMask: 0,
		target: null,
		symbolicReloc: { kind: 'export_proto', symbol: 'mod__fn' },
	};
	replaceWithJump(loadExportSymbol, 4);
	assert.equal(loadExportSymbol.symbolicReloc, undefined);
});

test('ProgramSymbols decoder requires the current metadata contract', () => {
	const metadata = { ...makeProgramSymbols('main', 1) };
	delete (metadata as Partial<ProgramSymbolsImage>).upvalueNamesByProto;
	assert.throws(
		() => decodeProgramSymbolsImage(encodeBinary({ metadata })),
		/upvalueNamesByProto/,
	);
});

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
	const source = 'return sys_boot_cart, sys_vdp_stream_base, cart_manifest';
	const chunk = parseChunk(source);
	const compiled = compileLuaChunkToProgram(chunk, [], { entrySource: source });
	assert.ok(compiled.program.code.length > 0);
});

test('ProgramCompiler rejects machine ABI value constants as implicit runtime globals', () => {
	const source = 'return sys_bus_fault_access_word, sys_host_fault_flag_active, irq_vblank, sys_irq_flags, sys_irq_ack, sys_irq_mask';
	const chunk = parseChunk(source);
	assert.throws(
		() => compileLuaChunkToProgram(chunk, [], { entrySource: source }),
		/error\(s\):[\s\S]*'sys_bus_fault_access_word' is not defined\.[\s\S]*'sys_host_fault_flag_active' is not defined\.[\s\S]*'irq_vblank' is not defined\.[\s\S]*'sys_irq_flags' is not defined\.[\s\S]*'sys_irq_ack' is not defined\.[\s\S]*'sys_irq_mask' is not defined\./,
	);
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

test('ProgramCompiler rewrites const require member call targets to export-proto relocations', () => {
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
	const entryTargets = collectProtoRelocSymbols(compiled, compiled.entryProtoIndex, 'export_proto');
	const entryOps = collectProtoOps(compiled.program, compiled.entryProtoIndex);
	assert.ok(entryTargets.includes('mod__foo'));
	assert.equal(entryOps.includes(OpCode.GETFIELD), false);
	assert.equal(entryOps.includes(OpCode.SELF), false);
});

test('ProgramCompiler rewrites external const require member call targets inside closures', () => {
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
	const closureTargets = collectProtoRelocSymbols(compiled, closureProtoIndex, 'export_proto');
	const closureOps = collectProtoOps(compiled.program, closureProtoIndex);
	assert.ok(closureTargets.includes('mod__foo'));
	assert.equal(closureOps.includes(OpCode.GETUP), false);
	assert.equal(closureOps.includes(OpCode.GETFIELD), false);
});

test('ProgramCompiler emits module-slot relocations for direct external root fields inside closures', () => {
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
	const closureTargets = collectProtoRelocSymbols(compiled, closureProtoIndex, 'module');
	const closureOps = collectProtoOps(compiled.program, closureProtoIndex);
	assert.ok(closureTargets.includes('mod__missing'));
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
	assert.equal(entryOps.includes(OpCode.GETFIELD), true);
});

test('ProgramCompiler canonicalizes raw module source paths at the API boundary', () => {
	const entrySource = [
		'local room<const> = require("room/index")',
		'return room.value',
	].join('\n');
	const moduleSource = 'return { value = 7 }';
	const compiled = compileLuaChunkToProgram(
		parseChunk(entrySource, 'cart.lua'),
		[{
			path: 'carts/pietious/room/index.lua',
			chunk: parseChunk(moduleSource, 'carts/pietious/room/index.lua'),
			source: moduleSource,
		}],
		{ entrySource },
	);

	assert.equal(compiled.moduleProtoMap.has('room/index'), true);
	assert.equal(compiled.moduleProtoMap.has('carts/pietious/room/index.lua'), false);
	assert.ok(compiled.metadata.protoIds.some(id => id.includes('module:room/index')));
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
		assert.ok(valueIsString(args[0]));
		const moduleName = cpu.stringPool.toString(asStringId(args[0]));
		assert.equal(moduleName, 'constants');
		const protoIndex = compiled.moduleProtoMap.get('constants');
		assert.notEqual(protoIndex, undefined);
		const targetDepth = cpu.getFrameDepth();
		cpu.call({ protoIndex: protoIndex!, upvalues: [] }, []);
		assert.equal(cpu.runUntilDepth(targetDepth, 100000), RunResult.Halted);
		const value = cpu.lastReturnValues[0];
		out.push(value !== undefined ? value : null);
	});
	cpu.setGlobalByKey(StringValue.get(cpu.stringPool.intern('require')), requireFn);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.equal(cpu.lastReturnValues[0], 8);
	const room = cpu.lastReturnValues[1];
	assert.ok(room instanceof Table);
	assert.equal(room.getStringKey(StringValue.get(cpu.stringPool.intern('tile_size'))), 8);
	assert.equal(cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('constants__room__tile_size'))), 8);
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
		assert.ok(valueIsString(args[0]));
		assert.equal(cpu.stringPool.toString(asStringId(args[0])), 'constants');
		const protoIndex = compiled.moduleProtoMap.get('constants');
		assert.notEqual(protoIndex, undefined);
		const targetDepth = cpu.getFrameDepth();
		cpu.call({ protoIndex: protoIndex!, upvalues: [] }, []);
		assert.equal(cpu.runUntilDepth(targetDepth, 100000), RunResult.Halted);
		const value = cpu.lastReturnValues[0];
		out.push(value !== undefined ? value : null);
	});
	cpu.setGlobalByKey(StringValue.get(cpu.stringPool.intern('require')), requireFn);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const slotKey = StringValue.get(cpu.stringPool.intern('constants__room__tile_size'));
	assert.equal(cpu.getGlobalByKey(slotKey), 8);

	const hostEvalSource = 'return 1';
	const appended = appendLuaChunkToProgram(
		compiled.program,
		compiled.metadata,
		parseChunk(hostEvalSource, 'host_eval'),
		{ entrySource: hostEvalSource },
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
	const linkedCode = linked.programImage.sections.text.code;
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
	const linkedCode = linked.programImage.sections.text.code;
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
	const linkedCode = linked.programImage.sections.text.code;
	const cartBaseWord = (0x80000 / INSTRUCTION_BYTES);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 1), 5000);
	assert.equal(decodeUnsignedB(linkedCode, cartBaseWord + 3), 5001);
	assert.equal(decodeUnsignedC(linkedCode, cartBaseWord + 5), 5002);
});

test('ProgramLinker rejects cart global relocations without symbols metadata', () => {
	const systemImage = makeSystemImage(1);
	const cartImage = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.GETGL, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'gl', constIndex: 0 }],
	);
	const systemSymbols = makeProgramSymbols('system', systemImage.sections.text.code.length / INSTRUCTION_BYTES);
	assert.throws(
		() => linkProgramImages(systemImage, systemSymbols, cartImage, null),
		/Missing cart symbols metadata required to resolve cart relocations/,
	);
});

test('ProgramLinker owns linked boot vector selection', () => {
	const systemImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	systemImage.sections.rodata.staticModulePaths = ['system/init'];
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	cartImage.sections.rodata.staticModulePaths = ['cart/init'];
	const systemBoot = linkBootProgramImages(systemImage, null, cartImage, null, 'system');
	assert.deepEqual(systemBoot.vectors, systemImage.vectors);
	assert.equal(systemBoot.bssBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.deepEqual(systemBoot.staticModulePaths, ['system/init']);
	assert.deepEqual(systemBoot.cartVectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1 });
	assert.deepEqual(systemBoot.cartStaticModulePaths, ['cart/init']);

	const cartBoot = linkBootProgramImages(systemImage, null, cartImage, null, 'cart');
	assert.deepEqual(cartBoot.vectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1 });
	assert.equal(cartBoot.bssBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.deepEqual(cartBoot.staticModulePaths, ['system/init', 'cart/init']);
	assert.deepEqual(cartBoot.cartVectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1 });
	assert.deepEqual(cartBoot.cartStaticModulePaths, ['cart/init']);
});


test('ProgramLinker resolves .data VMA and LMA constants before executable install', () => {
	const systemImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[0, 0],
		[],
	);
	systemImage.sections.data = {
		bytes: new Uint8Array([1, 0, 0, 0]),
		symbols: [{ name: 'system_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	systemImage.link.constValueRelocs = [
		{ constIndex: 0, kind: 'data_addr', symbol: 'system_state', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'system_state', addend: 0 },
	];
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[0, 0],
		[],
	);
	cartImage.sections.data = {
		bytes: new Uint8Array([2, 0, 0, 0]),
		symbols: [{ name: 'cart_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	cartImage.link.constValueRelocs = [
		{ constIndex: 0, kind: 'data_addr', symbol: 'cart_state', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'cart_state', addend: 0 },
	];

	const linked = linkProgramImages(systemImage, null, cartImage, null);
	const systemDataLma = PROGRAM_ROM_BASE + linked.programImage.sections.text.code.byteLength + linked.programImage.sections.rodata.bytes.byteLength;
	assert.deepEqual(linked.programImage.sections.rodata.constPool, [PROGRAM_STATIC_RAM_BASE, systemDataLma, PROGRAM_STATIC_RAM_BASE + 4, systemDataLma + 4]);
	assert.equal(linked.systemDataBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.equal(linked.cartDataBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
	assert.equal(linked.systemBssBaseAddress, PROGRAM_STATIC_RAM_BASE + 8);
	assert.deepEqual(Array.from(linked.programImage.sections.data.bytes), [1, 0, 0, 0, 2, 0, 0, 0]);
	assert.deepEqual(linked.programImage.sections.data.symbols, [
		{ name: 'system_state', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'cart_state', offset: 4, byteCount: 4, alignment: 4 },
	]);
	assert.deepEqual(linked.programImage.link.constValueRelocs, []);
});

test('ProgramLinker resolves .bss address constants and boot vectors', () => {
	const systemImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[0],
		[],
	);
	systemImage.sections.bss = {
		byteCount: 4,
		symbols: [{ name: 'system_counter', offset: 0, byteCount: 4, alignment: 4 }],
	};
	systemImage.link.constValueRelocs = [{ constIndex: 0, kind: 'bss_addr', symbol: 'system_counter', addend: 0 }];
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[0],
		[],
	);
	cartImage.sections.bss = {
		byteCount: 8,
		symbols: [{ name: 'cart_state', offset: 0, byteCount: 8, alignment: 4 }],
	};
	cartImage.link.constValueRelocs = [{ constIndex: 0, kind: 'bss_addr', symbol: 'cart_state', addend: 4 }];

	const linked = linkProgramImages(systemImage, null, cartImage, null);
	assert.deepEqual(linked.programImage.sections.rodata.constPool, [PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + 8]);
	assert.equal(linked.programImage.sections.bss.byteCount, 12);
	assert.deepEqual(linked.programImage.sections.bss.symbols, [
		{ name: 'system_counter', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'cart_state', offset: 4, byteCount: 8, alignment: 4 },
	]);
	assert.deepEqual(linked.programImage.link.constValueRelocs, []);
	assert.equal(linked.systemBssBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.equal(linked.cartBssBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
	assert.deepEqual(linked.systemVectors, { resetProtoIndex: 0, sectionInitProtoIndex: 0, irqProtoIndex: 0 });
	assert.deepEqual(linked.cartVectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1 });

	const systemBoot = linkBootProgramImages(systemImage, null, cartImage, null, 'system');
	assert.deepEqual(systemBoot.vectors, { resetProtoIndex: 0, sectionInitProtoIndex: 0, irqProtoIndex: 0 });
	assert.equal(systemBoot.bssBaseAddress, PROGRAM_STATIC_RAM_BASE);
	const cartBoot = linkBootProgramImages(systemImage, null, cartImage, null, 'cart');
	assert.deepEqual(cartBoot.vectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1 });
	assert.equal(cartBoot.bssBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
});

test('inflateExecutableProgramImage resolves .bss constants against explicit non-default image base', () => {
	const image = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[0],
		[],
	);
	image.sections.bss = {
		byteCount: 8,
		symbols: [{ name: 'cart_state', offset: 4, byteCount: 4, alignment: 4 }],
	};
	image.link.constValueRelocs = [{ constIndex: 0, kind: 'bss_addr', symbol: 'cart_state', addend: 0 }];

	const program = inflateExecutableProgramImage(image, null, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + 16);
	assert.notEqual(program.constPool[0], PROGRAM_STATIC_RAM_BASE + 4);
	assert.deepEqual(program.constPool, [PROGRAM_STATIC_RAM_BASE + 20]);
});

test('ProgramLinker rejects .bss ranges outside RAM', () => {
	const systemImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	systemImage.sections.bss.byteCount = RAM_END - PROGRAM_STATIC_RAM_BASE + 4;
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);

	assert.throws(
		() => linkProgramImages(systemImage, null, cartImage, null),
		/static RAM range .* exceeds RAM end/,
	);
});

test('ProgramLinker resolves system export-proto relocations before layout merge', () => {
	const systemImage = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'export_proto', symbol: 'system__boot' }],
	);
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	const systemSymbols = makeProgramSymbols('system', systemImage.sections.text.code.length / INSTRUCTION_BYTES);
	const cartSymbols = makeProgramSymbols('cart', cartImage.sections.text.code.length / INSTRUCTION_BYTES);
	systemSymbols.exportProtoIdBySlot = { system__boot: 'system' };
	const linked = linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols);
	const systemBaseWord = SYSTEM_BASE_PC / INSTRUCTION_BYTES + 1;
	const word = readInstructionWord(linked.programImage.sections.text.code, systemBaseWord);
	assert.equal(((word >>> 18) & 0x3f) as OpCode, OpCode.CLOSURE);
	assert.equal(decodeBx(linked.programImage.sections.text.code, systemBaseWord), 0);
});

test('ProgramLinker resolves symbolic relocations without rodata payload constants', () => {
	const systemImage = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'export_proto', symbol: 'system__boot' }],
	);
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	const systemSymbols = makeProgramSymbols('system', systemImage.sections.text.code.length / INSTRUCTION_BYTES);
	const cartSymbols = makeProgramSymbols('cart', cartImage.sections.text.code.length / INSTRUCTION_BYTES);
	systemSymbols.exportProtoIdBySlot = { system__boot: 'system' };

	const linked = linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols);

	assert.equal(linked.programImage.sections.rodata.constPool.length, 0);
});

test('resolveRuntimeProgramRelocations resolves symbolic relocations without const-pool payloads', () => {
	const image = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		['runtime literal'],
		[{ wordIndex: 1, kind: 'export_proto', symbol: 'main__entry' }],
	);
	const program = inflateProgram(image.sections);
	const metadata = makeProgramSymbols('main', image.sections.text.code.length / INSTRUCTION_BYTES);
	metadata.exportProtoIdBySlot = { main__entry: 'main' };

	resolveRuntimeProgramRelocations(program, metadata, image.link.constRelocs);

	assert.equal(((readInstructionWord(program.code, 1) >>> 18) & 0x3f) as OpCode, OpCode.CLOSURE);
	const runtimeConst = program.constPool[0];
	assert.ok(valueIsString(runtimeConst));
	assert.equal(program.constPoolStringPool.toString(asStringId(runtimeConst)), 'runtime literal');
});

test('inflateExecutableProgramImage resolves object relocs before runtime install', () => {
	const image = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		['runtime literal'],
		[{ wordIndex: 1, kind: 'export_proto', symbol: 'main__entry' }],
	);
	const metadata = makeProgramSymbols('main', image.sections.text.code.length / INSTRUCTION_BYTES);
	metadata.exportProtoIdBySlot = { main__entry: 'main' };

	const program = inflateExecutableProgramImage(image, metadata);

	assert.equal(((readInstructionWord(program.code, 1) >>> 18) & 0x3f) as OpCode, OpCode.CLOSURE);
	const runtimeConst = program.constPool[0];
	assert.ok(valueIsString(runtimeConst));
	assert.equal(program.constPoolStringPool.toString(asStringId(runtimeConst)), 'runtime literal');
});

test('inflateExecutableProgramImage rejects object relocs without metadata', () => {
	const image = makeProgramImage(
		[
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 0, kind: 'module', symbol: 'main__entry' }],
	);

	assert.throws(
		() => inflateExecutableProgramImage(image, null),
		/program image relocations require metadata/,
	);
});

test('compiled program images resolve hot-resume export relocs through the executable boundary', () => {
	const baseSource = 'return 1';
	const baseCompiled = compileLuaChunkToProgram(parseChunk(baseSource, 'cart.lua'), [], { entrySource: baseSource });
	const baseProgram = inflateExecutableProgramImage(encodeCompiledProgramImage(baseCompiled), baseCompiled.metadata);
	const moduleSource = [
		'local mod<const> = {}',
		'function mod.foo()',
		'	return 7',
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
		{
			baseProgram,
			baseMetadata: baseCompiled.metadata,
			entrySource,
		},
	);
	const image = encodeCompiledProgramImage(compiled);
	const reloc = image.link.constRelocs.find(record => record.kind === 'export_proto' && record.symbol === 'mod__foo');
	assert.ok(reloc);
	const executable = inflateExecutableProgramImage(image, compiled.metadata);

	assert.equal(((readInstructionWord(executable.code, reloc.wordIndex) >>> 18) & 0x3f) as OpCode, OpCode.CLOSURE);
});

test('appended host-eval code preserves the installed program ROM mapping', () => {
	const baseSource = 'rodata value: word[1] = { 0x12345678 }\nreturn 1';
	const baseCompiled = compileLuaChunkToProgram(parseChunk(baseSource, 'cart.lua'), [], { entrySource: baseSource });
	const baseImage = encodeCompiledProgramImage(baseCompiled);
	const baseProgram = inflateExecutableProgramImage(baseImage, baseCompiled.metadata);
	const entrySource = 'return "host eval literal"';
	const appended = appendLuaChunkToProgram(
		baseProgram,
		baseCompiled.metadata,
		parseChunk(entrySource, 'host_eval'),
		{ entrySource },
	);
	resolveRuntimeProgramRelocations(appended.program, appended.metadata, appended.constRelocs);
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const cpu = new CPU(memory);
	cpu.setProgram(appended.program, appended.metadata);
	cpu.start(appended.entryProtoIndex);

	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.equal(appended.program.programRom, baseProgram.programRom);
	assert.equal(appended.program.programRomTextByteLength, baseProgram.programRomTextByteLength);
	assert.equal(memory.readU32(PROGRAM_ROM_BASE + baseImage.sections.text.code.byteLength), 0x12345678);
	const returned = cpu.lastReturnValues[0];
	assert.ok(valueIsString(returned));
	assert.equal(cpu.stringPool.toString(asStringId(returned)), 'host eval literal');
});

test('ProgramCompiler treats old reloc marker text as ordinary string literals', () => {
	const exportText = 'exportproto:literal__value';
	const moduleText = 'modslot:literal__module';
	const source = `return ${JSON.stringify(exportText)}, ${JSON.stringify(moduleText)}`;
	const compiled = compileLuaChunkToProgram(parseChunk(source), [], {
		entrySource: source,
		optLevel: 0,
	});

	assert.equal(compiled.constRelocs.some(reloc => reloc.kind === 'module' || reloc.kind === 'export_proto'), false);
});

test('ProgramLinker preserves ordinary string literals that match old reloc marker text', () => {
	const literal = 'exportproto:system__boot';
	const systemImage = makeProgramImage(
		[
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 1, b: 1, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[literal],
		[{ wordIndex: 2, kind: 'export_proto', symbol: 'system__boot' }],
	);
	const cartImage = makeProgramImage([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	const systemSymbols = makeProgramSymbols('system', systemImage.sections.text.code.length / INSTRUCTION_BYTES);
	const cartSymbols = makeProgramSymbols('cart', cartImage.sections.text.code.length / INSTRUCTION_BYTES);
	systemSymbols.exportProtoIdBySlot = { system__boot: 'system' };

	const linked = linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols);

	assert.equal(linked.programImage.sections.rodata.constPool[0], literal);
});

test('ProgramLinker resolves system symbolic relocations against system symbols only', () => {
	const systemImage = makeProgramImage(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'module', symbol: 'cart__only' }],
	);
	const cartImage = makeProgramImage(
		[{ op: OpCode.RET, a: 0, b: 1, c: 0 }],
		[],
		[],
	);
	const systemSymbols = makeProgramSymbols('system', systemImage.sections.text.code.length / INSTRUCTION_BYTES);
	const cartSymbols = makeProgramSymbols('cart', cartImage.sections.text.code.length / INSTRUCTION_BYTES);
	cartSymbols.globalNames = ['cart__only'];
	assert.throws(
		() => linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols),
		/Unable to resolve module export slot 'cart__only'/,
	);
});


test('appendLuaChunkToProgram rejects new storage sections', () => {
	const base = makeProgramImage([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	const program = inflateProgram(base.sections);
	const metadata = makeProgramSymbols('base', base.sections.text.code.length / INSTRUCTION_BYTES);
	assert.throws(
		() => appendLuaChunkToProgram(program, metadata, parseChunk('data value: word = 1\nreturn *value', 'host_eval'), { entrySource: 'data value: word = 1\nreturn *value' }),
		/host-eval append cannot declare \.data storage/i,
	);
});

test('appendLuaChunkToProgram preserves absolute program ROM bytes', () => {
	const base = makeProgramImage(
		[
			{ op: OpCode.MOVE, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[],
	);
	base.sections.rodata.bytes = new Uint8Array([1, 2, 3, 4]);
	const program = inflateProgram(base.sections);
	const metadata = makeProgramSymbols('base', base.sections.text.code.length / INSTRUCTION_BYTES);
	const programRomBytes = Array.from(program.programRom);
	const programRomTextByteLength = program.programRomTextByteLength;

	const source = 'return 1';
	const appended = appendLuaChunkToProgram(program, metadata, parseChunk(source, 'host_eval'), { entrySource: source });

	assert.equal(appended.program.code.byteLength > program.code.byteLength, true);
	assert.deepEqual(Array.from(appended.program.programRom), programRomBytes);
	assert.equal(appended.program.programRomTextByteLength, programRomTextByteLength);
});
