import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../machine/ts/lua/compiler';
import type { ProgramConstReloc, ProgramObjectImage } from '../../machine/ts/lua/compiler/program_object';
import { replaceWithJump, replaceWithMov } from '../../machine/ts/lua/compiler/optimizer/values';
import type { Instruction } from '../../machine/ts/lua/compiler/optimizer';
import { OpCode, type ProgramMetadata, type ProgramRuntimeSymbols, type Proto } from '../../machine/ts/machine/cpu/cpu';
import { INSTRUCTION_BYTES, readInstructionWord, writeInstruction } from '../../machine/ts/machine/cpu/instruction_format';
import { CART_ROM_BASE, PROGRAM_STATIC_RAM_BASE, RAM_END, SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { assembleProgramImages, decodeProgramImage, encodeProgramImage } from '../../machine/ts/machine/program/loader';
import { linkCartProgramImage, linkProgramRevision, linkSystemProgramImage } from '../../machine/ts/rompack/tooling/program_linker';
import { parseLuaChunk } from '../lua/cpu_test_harness';

type EncodedWord = {
	op: OpCode;
	a: number;
	b: number;
	c: number;
	ext?: number;
};

const NO_PROGRAM_SOURCES = new Map<string, string>();

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

function makeProgramObject(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string>,
	constRelocs: ReadonlyArray<ProgramConstReloc>,
): ProgramObjectImage {
	const code = buildCode(words);
	const symbols: ProgramRuntimeSymbols = {
		protoIds: ['proto:0'],
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
	return {
		vectors: {
			resetProtoIndex: 0,
			sectionInitProtoIndex: 0,
			irqProtoIndex: 0,
			exceptionProtoIndex: 0,
		},
		sections: {
			text: { code, protos: [makeProto(code.byteLength)] },
			rodata: {
				constPool: Array.from(constPool),
				moduleProtos: [],
				moduleExports: [],
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
			rodataConstRelocs: [],
			symbols,
		},
	};
}

function makeSystemObject(constPoolSize: number): ProgramObjectImage {
	const constPool: number[] = new Array(constPoolSize);
	for (let index = 0; index < constPool.length; index += 1) {
		constPool[index] = index;
	}
	return makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], constPool, []);
}

function makeMetadata(protoId: string, instructionCount: number): ProgramMetadata {
	return {
		debugRanges: new Array(instructionCount).fill(null),
		protoIds: [protoId],
		resumePointsByProto: [[]],
		localSlotsByProto: [[]],
		upvalueNamesByProto: [[]],
		globalNames: [],
		systemGlobalNames: [],
		exportProtoIdBySlot: {},
	};
}

function linkInitialSystemProgram(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string>,
	constRelocs: ReadonlyArray<ProgramConstReloc>,
) {
	const object = makeProgramObject(words, constPool, constRelocs);
	object.link.symbols.protoIds = ['entry'];
	const metadata = makeMetadata('entry', words.length);
	const image = linkSystemProgramImage(object, metadata, SYSTEM_ROM_BASE).image;
	return { object, metadata, image, program: assembleProgramImages(image, null) };
}

function decodeBx(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const wideWord = readInstructionWord(code, wordIndex - 1);
	return (((wideWord >>> 6) & 0x3f) << 20)
		| ((word >>> 24) << 12)
		| (((word >>> 6) & 0x3f) << 6)
		| (word & 0x3f);
}

function decodeSignedRkB(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const raw = (((readInstructionWord(code, wordIndex - 1) >>> 6) & 0x3f) << 9)
		| (((word >>> 27) & 0x7) << 6)
		| ((word >>> 6) & 0x3f);
	return (raw & (1 << 14)) !== 0 ? raw - (1 << 15) : raw;
}

function decodeUnsignedB(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	return (((readInstructionWord(code, wordIndex - 1) >>> 6) & 0x3f) << 9)
		| (((word >>> 27) & 0x7) << 6)
		| ((word >>> 6) & 0x3f);
}

function decodeUnsignedC(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	return ((readInstructionWord(code, wordIndex - 1) & 0x3f) << 9)
		| (((word >>> 24) & 0x7) << 6)
		| (word & 0x3f);
}

test('final program media stores raw sections separately from its descriptor', () => {
	const object = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], ['literal', 3], []);
	object.sections.rodata.moduleProtos.push({ path: 'rooms/castle', protoIndex: 0 });
	object.sections.rodata.staticModulePaths.push('system/init');
	object.sections.rodata.bytes = new Uint8Array([1, 2, 3, 4]);
	object.sections.data.bytes = new Uint8Array([5, 6, 7, 8]);
	const linked = linkSystemProgramImage(object, null, SYSTEM_ROM_BASE + 0x100);
	const encoded = encodeProgramImage(linked.image);
	const decoded = decodeProgramImage(encoded.sections, encoded.descriptor);
	const program = assembleProgramImages(decoded, null);

	assert.deepEqual(Array.from(encoded.sections), [
		1, 2, 3, 4,
		5, 6, 7, 8,
		...object.sections.text.code,
	]);
	assert.deepEqual(Array.from(decoded.sections.rodata.bytes), [1, 2, 3, 4]);
	assert.deepEqual(Array.from(decoded.sections.data.bytes), [5, 6, 7, 8]);
	assert.deepEqual(decoded.sections.rodata.staticModulePaths, ['system/init']);
	assert.deepEqual(decoded.sections.rodata.moduleProtos, [{ path: 'rooms/castle', protoIndex: 0 }]);
	assert.deepEqual(decoded.sections.rodata.constPool, ['literal', 3]);
	assert.deepEqual(decoded.staticLayoutToken, linked.image.staticLayoutToken);
	assert.notEqual(program.code.buffer, encoded.sections.buffer);
	assert.deepEqual(Array.from(program.code), Array.from(object.sections.text.code));
});

test('static layout token changes when an equal-sized storage symbol moves', () => {
	const initial = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	initial.sections.data.bytes = new Uint8Array(8);
	initial.sections.data.symbols = [
		{ name: 'left', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'right', offset: 4, byteCount: 4, alignment: 4 },
	];
	const changed = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	changed.sections.data.bytes = new Uint8Array(8);
	changed.sections.data.symbols = [
		{ name: 'right', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'left', offset: 4, byteCount: 4, alignment: 4 },
	];

	const initialImage = linkSystemProgramImage(initial, null, SYSTEM_ROM_BASE).image;
	const changedImage = linkSystemProgramImage(changed, null, SYSTEM_ROM_BASE).image;
	assert.notDeepEqual(changedImage.staticLayoutToken, initialImage.staticLayoutToken);
});

test('compiler object emits dedicated vector protos and matching symbolic metadata', () => {
	const source = 'while true do halt_until_irq end';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source });
	const object = encodeCompiledProgramObject(compiled);
	const irqProto = object.sections.text.protos[object.vectors.irqProtoIndex];
	const irqOps: OpCode[] = [];
	const firstWord = irqProto.entryPC / INSTRUCTION_BYTES;
	for (let index = 0; index < irqProto.codeLen / INSTRUCTION_BYTES; index += 1) {
		irqOps.push(((readInstructionWord(object.sections.text.code, firstWord + index) >>> 18) & 0x3f) as OpCode);
	}

	assert.notEqual(object.vectors.irqProtoIndex, object.vectors.sectionInitProtoIndex);
	assert.deepEqual(object.link.symbols.protoIds, compiled.metadata.protoIds);
	assert.deepEqual(irqOps, [OpCode.WIDE, OpCode.LOADK, OpCode.LOAD_MEM, OpCode.K0, OpCode.EQ, OpCode.JMP, OpCode.GETGL, OpCode.MOV, OpCode.CALL, OpCode.RFE]);
});

test('compiler object is independent of source registry enumeration order', () => {
	const entrySource = 'return require("alpha").value + require("zeta").value';
	const modules = [
		{ path: 'zeta', source: 'return { value = 7 }' },
		{ path: 'alpha', source: 'return { value = 3 }' },
	].map(module => ({
		path: module.path,
		chunk: parseLuaChunk(module.source, `${module.path}.lua`),
		source: module.source,
	}));
	const forward = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules, { entrySource, optLevel: 3 });
	const reverse = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'entry.lua'), modules.slice().reverse(), { entrySource, optLevel: 3 });

	assert.deepEqual(encodeCompiledProgramObject(reverse), encodeCompiledProgramObject(forward));
	assert.deepEqual(reverse.metadata, forward.metadata);
});

test('compiler isolates firmware vector slots from cartridge vector slots', () => {
	const source = 'function irq(flags) return flags end\nfunction exception() return 1 end\nreturn 0';
	const system = compileLuaChunkToProgram(parseLuaChunk(source, 'system.lua'), [], {
		entrySource: source,
		programDomain: 'system',
	});
	const cart = compileLuaChunkToProgram(parseLuaChunk(source, 'cart.lua'), [], {
		entrySource: source,
		programDomain: 'cart',
	});

	assert.equal(system.metadata.systemGlobalNames.includes('irq'), true);
	assert.equal(system.metadata.globalNames.includes('irq'), false);
	assert.equal(cart.metadata.systemGlobalNames.includes('irq'), false);
	assert.equal(cart.metadata.globalNames.includes('irq'), true);
});

test('optimizer instruction replacement discards obsolete symbolic relocations', () => {
	const moduleLoad: Instruction = {
		op: OpCode.LOADK,
		a: 0,
		b: 0,
		c: 0,
		format: 'ABx',
		rkMask: 0,
		target: null,
		symbolicReloc: { kind: 'module', symbol: 'mod__value' },
	};
	replaceWithMov(moduleLoad, 1, 2);
	assert.equal(moduleLoad.symbolicReloc, undefined);

	const exportLoad: Instruction = {
		op: OpCode.LOADK,
		a: 0,
		b: 0,
		c: 0,
		format: 'ABx',
		rkMask: 0,
		target: null,
		symbolicReloc: { kind: 'export_proto', symbol: 'mod__fn' },
	};
	replaceWithJump(exportLoad, 4);
	assert.equal(exportLoad.symbolicReloc, undefined);
});

test('packer resolves wide cartridge constant operands against the firmware pool', () => {
	const system = linkSystemProgramImage(makeSystemObject(5000), null, SYSTEM_ROM_BASE);
	const cartObject = makeProgramObject(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0x3f, c: 0 },
			{ op: OpCode.ADD, a: 0, b: 0x3f, c: 0, ext: 0x38 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.GETFIELD, a: 0, b: 1, c: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.SETFIELD, a: 1, b: 1, c: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.SELF, a: 2, b: 1, c: 2 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[900001, 900002, 'field_get', 'field_set', 'field_self'],
		[
			{ wordIndex: 1, kind: 'bx', constIndex: 0 },
			{ wordIndex: 3, kind: 'rk_b', constIndex: 1 },
			{ wordIndex: 5, kind: 'const_c', constIndex: 2 },
			{ wordIndex: 7, kind: 'const_b', constIndex: 3 },
			{ wordIndex: 9, kind: 'const_c', constIndex: 4 },
		],
	);
	const cart = linkCartProgramImage(system.image, null, cartObject, null, CART_ROM_BASE);
	const code = cart.image.sections.text.code;

	assert.equal(decodeBx(code, 1), 5000);
	assert.equal(decodeSignedRkB(code, 3), -5002);
	assert.equal(decodeUnsignedC(code, 5), 5002);
	assert.equal(decodeUnsignedB(code, 7), 5003);
	assert.equal(decodeUnsignedC(code, 9), 5004);
	assert.deepEqual(cart.image.sections.rodata.constPool, [900001, 900002, 'field_get', 'field_set', 'field_self']);
});

test('packer resolves firmware and cartridge storage against their physical media', () => {
	const systemObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0, 0, 0], []);
	systemObject.sections.rodata.bytes = new Uint8Array([0x11, 0x12, 0x13, 0x14]);
	systemObject.sections.rodata.symbols = [{ name: 'system_lookup', offset: 0, byteCount: 4, alignment: 4 }];
	systemObject.sections.data = {
		bytes: new Uint8Array([1, 0, 0, 0]),
		symbols: [{ name: 'system_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	systemObject.sections.bss = {
		byteCount: 4,
		symbols: [{ name: 'system_counter', offset: 0, byteCount: 4, alignment: 4 }],
	};
	systemObject.link.constValueRelocs = [
		{ constIndex: 0, kind: 'rodata_addr', symbol: 'system_lookup', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'system_state', addend: 0 },
		{ constIndex: 2, kind: 'bss_addr', symbol: 'system_counter', addend: 0 },
	];
	const systemAddress = SYSTEM_ROM_BASE + 0x100;
	const system = linkSystemProgramImage(systemObject, null, systemAddress);

	const cartObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0, 0, 0], []);
	cartObject.sections.rodata.bytes = new Uint8Array([0x21, 0x22, 0x23, 0x24]);
	cartObject.sections.rodata.symbols = [{ name: 'cart_lookup', offset: 0, byteCount: 4, alignment: 4 }];
	cartObject.sections.data = {
		bytes: new Uint8Array([2, 0, 0, 0]),
		symbols: [{ name: 'cart_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	cartObject.sections.bss = {
		byteCount: 8,
		symbols: [{ name: 'cart_counter', offset: 0, byteCount: 8, alignment: 4 }],
	};
	cartObject.link.constValueRelocs = [
		{ constIndex: 0, kind: 'rodata_addr', symbol: 'cart_lookup', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'cart_state', addend: 0 },
		{ constIndex: 2, kind: 'bss_addr', symbol: 'cart_counter', addend: 4 },
	];
	const cartAddress = CART_ROM_BASE + 0x200;
	const cart = linkCartProgramImage(system.image, null, cartObject, null, cartAddress);
	const program = assembleProgramImages(system.image, cart.image);

	assert.deepEqual(program.constPool, [
		systemAddress,
		systemAddress + 4,
		PROGRAM_STATIC_RAM_BASE + 4,
		cartAddress,
		cartAddress + 4,
		PROGRAM_STATIC_RAM_BASE + 16,
	]);
	assert.equal(system.image.placement.dataBaseAddress, PROGRAM_STATIC_RAM_BASE);
	assert.equal(system.image.placement.bssBaseAddress, PROGRAM_STATIC_RAM_BASE + 4);
	assert.equal(cart.image.placement.dataBaseAddress, PROGRAM_STATIC_RAM_BASE + 8);
	assert.equal(cart.image.placement.bssBaseAddress, PROGRAM_STATIC_RAM_BASE + 12);
	assert.deepEqual(Array.from(system.image.sections.data.bytes), [1, 0, 0, 0]);
	assert.deepEqual(Array.from(cart.image.sections.data.bytes), [2, 0, 0, 0]);
});

test('packer gives cartridge text, consts, protos, vectors, and symbols final indexes', () => {
	const systemObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], ['shared'], []);
	systemObject.link.symbols = {
		protoIds: ['system'],
		globalNames: ['shared_global'],
		systemGlobalNames: ['firmware_global'],
		exportProtoIdBySlot: { system__entry: 'system' },
	};
	const systemMetadata = makeMetadata('system', 1);
	systemMetadata.globalNames = ['shared_global'];
	systemMetadata.systemGlobalNames = ['firmware_global'];
	systemMetadata.exportProtoIdBySlot = { system__entry: 'system' };
	const system = linkSystemProgramImage(systemObject, systemMetadata, SYSTEM_ROM_BASE);

	const cartObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], ['shared', 'cart'], []);
	cartObject.link.symbols = {
		protoIds: ['cart'],
		globalNames: ['shared_global', 'cart_global'],
		systemGlobalNames: ['firmware_global'],
		exportProtoIdBySlot: { cart__entry: 'cart' },
	};
	const cartMetadata = makeMetadata('cart', 1);
	cartMetadata.globalNames = ['shared_global', 'cart_global'];
	cartMetadata.systemGlobalNames = ['firmware_global'];
	cartMetadata.exportProtoIdBySlot = { cart__entry: 'cart' };
	const cart = linkCartProgramImage(system.image, system.metadata, cartObject, cartMetadata, CART_ROM_BASE);

	assert.equal(cart.image.placement.textBasePc, INSTRUCTION_BYTES);
	assert.equal(cart.image.placement.constBaseIndex, 1);
	assert.equal(cart.image.placement.protoBaseIndex, 1);
	assert.deepEqual(cart.image.sections.rodata.constPool, ['cart']);
	assert.deepEqual(cart.image.vectors, { resetProtoIndex: 1, sectionInitProtoIndex: 1, irqProtoIndex: 1, exceptionProtoIndex: 1 });
	assert.deepEqual(cart.image.symbols.protoIds, ['system', 'cart']);
	assert.deepEqual(cart.image.symbols.globalNames, ['shared_global', 'cart_global']);
	assert.deepEqual(cart.image.symbols.systemGlobalNames, ['firmware_global']);
	assert.deepEqual(cart.metadata?.protoIds, ['system', 'cart']);
	assert.equal(cart.metadata?.debugRanges.length, 2);
});

test('hot resume appends changed proto code once and keeps old frame code addressable', () => {
	const {
		object: initialObject,
		metadata: initialMetadata,
		image: initialImage,
		program: initialProgram,
	} = linkInitialSystemProgram([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [1], []);

	const unchanged = linkProgramRevision(
		initialProgram,
		initialMetadata,
		initialObject,
		initialMetadata,
		initialImage,
		SYSTEM_ROM_BASE,
		NO_PROGRAM_SOURCES,
		NO_PROGRAM_SOURCES,
	);
	assert.equal(unchanged.program, initialProgram);
	assert.equal(unchanged.program.code, initialProgram.code);
	assert.equal(unchanged.program.protos, initialProgram.protos);
	assert.equal(unchanged.program.constPool, initialProgram.constPool);
	assert.equal(unchanged.program.constPoolStringPool, initialProgram.constPoolStringPool);

	const changedObject = makeProgramObject(
		[
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[2],
		[{ wordIndex: 0, kind: 'bx', constIndex: 0 }],
	);
	changedObject.link.symbols.protoIds = ['entry'];
	const changedMetadata = makeMetadata('entry', 2);
	const changedImage = linkSystemProgramImage(changedObject, changedMetadata, SYSTEM_ROM_BASE);
	const changed = linkProgramRevision(
		unchanged.program,
		unchanged.metadata,
		changedObject,
		changedMetadata,
		changedImage.image,
		SYSTEM_ROM_BASE,
		NO_PROGRAM_SOURCES,
		NO_PROGRAM_SOURCES,
	);

	assert.deepEqual(
		Array.from(changed.program.code.subarray(0, initialProgram.code.byteLength)),
		Array.from(initialProgram.code),
	);
	assert.equal(changed.program.protos[0].entryPC, initialProgram.code.byteLength);
	assert.equal(changed.program.code.byteLength, initialProgram.code.byteLength + changedObject.sections.text.code.byteLength);
	assert.equal(changed.program.constPoolStringPool, unchanged.program.constPoolStringPool);

	const repeated = linkProgramRevision(
		changed.program,
		changed.metadata,
		changedObject,
		changedMetadata,
		changedImage.image,
		SYSTEM_ROM_BASE,
		NO_PROGRAM_SOURCES,
		NO_PROGRAM_SOURCES,
	);
	assert.equal(repeated.program, changed.program);
	assert.equal(repeated.program.code, changed.program.code);
	assert.equal(repeated.program.protos, changed.program.protos);
	assert.equal(repeated.program.constPool, changed.program.constPool);
	assert.equal(repeated.program.constPoolStringPool, changed.program.constPoolStringPool);
});

test('hot resume maps unchanged source sequence points into appended proto code', () => {
	const firstRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 1, column: 5 } };
	const oldResumeRange = { path: 'entry', start: { line: 2, column: 1 }, end: { line: 2, column: 6 } };
	const initialObject = makeProgramObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], []);
	initialObject.link.symbols.protoIds = ['entry'];
	const initialMetadata = makeMetadata('entry', 2);
	initialMetadata.debugRanges = [
		firstRange,
		oldResumeRange,
	];
	initialMetadata.resumePointsByProto = [[
		{ wordOffset: 0, range: firstRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
		{ wordOffset: 1, range: oldResumeRange, op: OpCode.RET, liveRegisters: [0], uses: [0], defs: [] },
	]];
	const initialImage = linkSystemProgramImage(initialObject, initialMetadata, SYSTEM_ROM_BASE);
	const initialProgram = assembleProgramImages(initialImage.image, null);

	const freshObject = makeProgramObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.K1, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], []);
	freshObject.link.symbols.protoIds = ['entry'];
	const freshMetadata = makeMetadata('entry', 3);
	const freshResumeRange = { path: 'entry', start: { line: 3, column: 1 }, end: { line: 3, column: 6 } };
	freshMetadata.debugRanges = [
		firstRange,
		{ path: 'entry', start: { line: 2, column: 1 }, end: { line: 2, column: 8 } },
		freshResumeRange,
	];
	freshMetadata.resumePointsByProto = [[
		{ wordOffset: 0, range: firstRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
		{ wordOffset: 2, range: freshResumeRange, op: OpCode.RET, liveRegisters: [0], uses: [0], defs: [] },
	]];
	const freshImage = linkSystemProgramImage(freshObject, freshMetadata, SYSTEM_ROM_BASE);
	const previousSources = new Map([['entry', 'first\nresume\n']]);
	const sources = new Map([['entry', 'first\ninserted\nresume\n']]);
	const revision = linkProgramRevision(
		initialProgram,
		initialMetadata,
		freshObject,
		freshMetadata,
		freshImage.image,
		SYSTEM_ROM_BASE,
		previousSources,
		sources,
	);

	const entryPC = initialProgram.code.byteLength;
	assert.equal(revision.pcRelocations[0], entryPC);
	assert.equal(revision.pcRelocations[1], entryPC + 2 * INSTRUCTION_BYTES);
});

test('hot resume does not map a sequence point whose statement crosses an edit', () => {
	const oldRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 3, column: 4 } };
	const initialObject = makeProgramObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], []);
	initialObject.link.symbols.protoIds = ['entry'];
	const initialMetadata = makeMetadata('entry', 2);
	initialMetadata.debugRanges = [oldRange, oldRange];
	initialMetadata.resumePointsByProto = [[
		{ wordOffset: 0, range: oldRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
	]];
	const initialImage = linkSystemProgramImage(initialObject, initialMetadata, SYSTEM_ROM_BASE);
	const initialProgram = assembleProgramImages(initialImage.image, null);

	const freshRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 4, column: 4 } };
	const freshObject = makeProgramObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.K1, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], []);
	freshObject.link.symbols.protoIds = ['entry'];
	const freshMetadata = makeMetadata('entry', 3);
	freshMetadata.debugRanges = [freshRange, freshRange, freshRange];
	freshMetadata.resumePointsByProto = [[
		{ wordOffset: 0, range: freshRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
	]];
	const freshImage = linkSystemProgramImage(freshObject, freshMetadata, SYSTEM_ROM_BASE);
	const revision = linkProgramRevision(
		initialProgram,
		initialMetadata,
		freshObject,
		freshMetadata,
		freshImage.image,
		SYSTEM_ROM_BASE,
		new Map([['entry', 'start\nbody\nend']]),
		new Map([['entry', 'start\ninserted\nbody\nend']]),
	);

	assert.equal(revision.pcRelocations[0], 0);
});

test('hot resume does not map a compiler sequence point edited inside its final token', () => {
	const previousSource = 'left_value = 1\nnext_value = 2\nreturn left_value';
	const source = 'left_value = 1\nnext_value = 2\nreturn next_value';
	const initialCompiled = compileLuaChunkToProgram(parseLuaChunk(previousSource, 'entry'), [], {
		entrySource: previousSource,
		optLevel: 0,
		programDomain: 'system',
	});
	const initialObject = encodeCompiledProgramObject(initialCompiled);
	const initialImage = linkSystemProgramImage(initialObject, initialCompiled.metadata, SYSTEM_ROM_BASE);
	const initialProgram = assembleProgramImages(initialImage.image, null);
	const freshCompiled = compileLuaChunkToProgram(parseLuaChunk(source, 'entry'), [], {
		entrySource: source,
		optLevel: 0,
		programDomain: 'system',
	});
	const freshObject = encodeCompiledProgramObject(freshCompiled);
	const freshImage = linkSystemProgramImage(freshObject, freshCompiled.metadata, SYSTEM_ROM_BASE);
	const initialPoint = initialCompiled.metadata.resumePointsByProto[initialCompiled.entryProtoIndex]
		.find(point => point.range.start.line === 3)!;
	const initialProto = initialProgram.protos[initialCompiled.entryProtoIndex];
	const initialWord = (initialProto.entryPC / INSTRUCTION_BYTES) + initialPoint.wordOffset;
	const revision = linkProgramRevision(
		initialProgram,
		initialCompiled.metadata,
		freshObject,
		freshCompiled.metadata,
		freshImage.image,
		SYSTEM_ROM_BASE,
		new Map([['entry', previousSource]]),
		new Map([['entry', source]]),
	);

	assert.equal(initialPoint.range.end.column, 17);
	assert.equal(revision.pcRelocations[initialWord], initialWord * INSTRUCTION_BYTES);
});

test('compiler resume points address the WIDE prefix of a logical instruction', () => {
	const lines: string[] = [];
	for (let index = 0; index < 520; index += 1) {
		lines.push(`local value_${index} = 0`);
	}
	lines.push('return value_0');
	const source = lines.join('\n');
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'wide_resume.lua'), [], {
		entrySource: source,
		optLevel: 0,
	});
	const points = compiled.metadata.resumePointsByProto[compiled.entryProtoIndex];
	const point = points.find(candidate => candidate.range.start.line > 512)!;
	const proto = compiled.program.protos[compiled.entryProtoIndex];
	const wordIndex = (proto.entryPC / INSTRUCTION_BYTES) + point.wordOffset;

	assert.equal((readInstructionWord(compiled.program.code, wordIndex) >>> 18) & 0x3f, OpCode.WIDE);
	assert.equal((readInstructionWord(compiled.program.code, wordIndex + 1) >>> 18) & 0x3f, point.op);
});

test('hot resume keeps physical rodata addresses stable across text-only edits', () => {
	const programAddress = SYSTEM_ROM_BASE + 0x100;
	const initialObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0], []);
	initialObject.sections.rodata.bytes = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
	initialObject.sections.rodata.symbols = [{ name: 'live_value', offset: 0, byteCount: 4, alignment: 4 }];
	initialObject.link.constValueRelocs = [{ constIndex: 0, kind: 'rodata_addr', symbol: 'live_value', addend: 0 }];
	initialObject.link.symbols.protoIds = ['entry'];
	const initialMetadata = makeMetadata('entry', 1);
	const initialImage = linkSystemProgramImage(initialObject, initialMetadata, programAddress);
	const initialProgram = assembleProgramImages(initialImage.image, null);

	const changedObject = makeProgramObject([
		{ op: OpCode.LOADNIL, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [0], []);
	changedObject.sections.rodata.bytes = initialObject.sections.rodata.bytes;
	changedObject.sections.rodata.symbols = initialObject.sections.rodata.symbols;
	changedObject.link.constValueRelocs = initialObject.link.constValueRelocs;
	changedObject.link.symbols.protoIds = ['entry'];
	const changedMetadata = makeMetadata('entry', 2);
	const changedImage = linkSystemProgramImage(changedObject, changedMetadata, programAddress);
	const revision = linkProgramRevision(
		initialProgram,
		initialMetadata,
		changedObject,
		changedMetadata,
		changedImage.image,
		programAddress,
		NO_PROGRAM_SOURCES,
		NO_PROGRAM_SOURCES,
	);

	assert.equal(initialImage.image.sections.rodata.constPool[0], programAddress);
	assert.equal(changedImage.image.sections.rodata.constPool[0], programAddress);
	assert.equal(revision.program.constPool.length, 1);
	assert.equal(revision.program.constPool[0], programAddress);
});

test('hot resume keeps existing proto slots and relocates new closures to appended slots', () => {
	const initialObject = makeProgramObject(
		[
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[],
	);
	initialObject.sections.text.protos = [
		makeProto(INSTRUCTION_BYTES),
		{ ...makeProto(INSTRUCTION_BYTES), entryPC: INSTRUCTION_BYTES },
	];
	initialObject.link.symbols.protoIds = ['entry', 'retained'];
	const initialMetadata = makeMetadata('entry', 2);
	initialMetadata.protoIds = ['entry', 'retained'];
	initialMetadata.resumePointsByProto = [[], []];
	initialMetadata.localSlotsByProto = [[], []];
	initialMetadata.upvalueNamesByProto = [[], []];
	const initialImage = linkSystemProgramImage(initialObject, initialMetadata, SYSTEM_ROM_BASE);
	const initialProgram = assembleProgramImages(initialImage.image, null);

	const freshObject = makeProgramObject(
		[
			{ op: OpCode.CLOSURE, a: 0, b: 0, c: 1 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[],
	);
	freshObject.sections.text.protos = [
		makeProto(INSTRUCTION_BYTES * 2),
		{ ...makeProto(INSTRUCTION_BYTES), entryPC: INSTRUCTION_BYTES * 2 },
	];
	freshObject.link.symbols.protoIds = ['entry', 'added'];
	const freshMetadata = makeMetadata('entry', 3);
	freshMetadata.protoIds = ['entry', 'added'];
	freshMetadata.resumePointsByProto = [[], []];
	freshMetadata.localSlotsByProto = [[], []];
	freshMetadata.upvalueNamesByProto = [[], []];
	const freshImage = linkSystemProgramImage(freshObject, freshMetadata, SYSTEM_ROM_BASE);
	const revision = linkProgramRevision(
		initialProgram,
		initialMetadata,
		freshObject,
		freshMetadata,
		freshImage.image,
		SYSTEM_ROM_BASE,
		NO_PROGRAM_SOURCES,
		NO_PROGRAM_SOURCES,
	);

	assert.deepEqual(revision.metadata.protoIds, ['entry', 'retained', 'added']);
	assert.equal(revision.program.protos[1].entryPC, INSTRUCTION_BYTES);
	assert.equal(revision.program.protos[2].entryPC, initialProgram.code.byteLength + INSTRUCTION_BYTES * 2);
	const closureWord = readInstructionWord(revision.program.code, initialProgram.code.byteLength / INSTRUCTION_BYTES);
	assert.equal(((closureWord >>> 6) & 0x3f) << 6 | (closureWord & 0x3f), 2);
});

test('hot resume rejects a captured-upvalue layout change instead of corrupting live closures', () => {
	const initialObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	initialObject.sections.text.protos[0].upvalueDescs = [{ inStack: true, index: 0 }];
	initialObject.link.symbols.protoIds = ['entry'];
	const initialMetadata = makeMetadata('entry', 1);
	initialMetadata.upvalueNamesByProto[0] = ['state'];
	const initialImage = linkSystemProgramImage(initialObject, initialMetadata, SYSTEM_ROM_BASE);
	const initialProgram = assembleProgramImages(initialImage.image, null);

	const changedObject = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	changedObject.sections.text.protos[0].upvalueDescs = [{ inStack: true, index: 1 }];
	changedObject.link.symbols.protoIds = ['entry'];
	const changedMetadata = makeMetadata('entry', 1);
	changedMetadata.upvalueNamesByProto[0] = ['replacement'];
	const changedImage = linkSystemProgramImage(changedObject, changedMetadata, SYSTEM_ROM_BASE);

	assert.throws(
		() => linkProgramRevision(
			initialProgram,
			initialMetadata,
			changedObject,
			changedMetadata,
			changedImage.image,
			SYSTEM_ROM_BASE,
			NO_PROGRAM_SOURCES,
			NO_PROGRAM_SOURCES,
		),
		/Hot resume cannot change captured upvalues for proto 'entry'/,
	);
	assert.equal(initialProgram.code.byteLength, INSTRUCTION_BYTES);
	assert.deepEqual(initialProgram.protos[0].upvalueDescs, [{ inStack: true, index: 0 }]);
});

test('a rejected hot revision does not intern constants into the live CPU string pool', () => {
	const {
		object: initialObject,
		metadata: initialMetadata,
		image: initialImage,
		program: initialProgram,
	} = linkInitialSystemProgram([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	const initialStringPoolState = initialProgram.constPoolStringPool.captureState();

	const changedObject = makeProgramObject(
		[
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		['revision-only'],
		[{ wordIndex: 0, kind: 'export_proto', symbol: 'missing__export' }],
	);
	changedObject.link.symbols.protoIds = ['entry'];
	const changedMetadata = makeMetadata('entry', 2);

	assert.throws(
		() => linkProgramRevision(
			initialProgram,
			initialMetadata,
			changedObject,
			changedMetadata,
			initialImage,
			SYSTEM_ROM_BASE,
			NO_PROGRAM_SOURCES,
			NO_PROGRAM_SOURCES,
		),
		/Unable to resolve module export slot 'missing__export'/,
	);
	assert.deepEqual(initialProgram.constPoolStringPool.captureState(), initialStringPoolState);
});

test('firmware export relocations resolve before cartridge linking', () => {
	const systemObject = makeProgramObject(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'export_proto', symbol: 'system__boot' }],
	);
	systemObject.link.symbols.protoIds = ['system'];
	systemObject.link.symbols.exportProtoIdBySlot = { system__boot: 'system' };
	const system = linkSystemProgramImage(systemObject, null, SYSTEM_ROM_BASE);
	assert.equal(((readInstructionWord(system.image.sections.text.code, 1) >>> 18) & 0x3f) as OpCode, OpCode.CLOSURE);
	assert.equal(decodeBx(system.image.sections.text.code, 1), 0);

	const invalidSystem = makeProgramObject(
		[
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[],
		[{ wordIndex: 1, kind: 'module', symbol: 'cart__only' }],
	);
	assert.throws(
		() => linkSystemProgramImage(invalidSystem, null, SYSTEM_ROM_BASE),
		/Unable to resolve module export slot 'cart__only'/,
	);
});

test('packer preserves string literals that resemble obsolete relocation markers', () => {
	const literal = 'exportproto:system__boot';
	const object = makeProgramObject(
		[
			{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
			{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
			{ op: OpCode.LOADK, a: 1, b: 1, c: 0 },
			{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		],
		[literal],
		[{ wordIndex: 2, kind: 'export_proto', symbol: 'system__boot' }],
	);
	object.link.symbols.protoIds = ['system'];
	object.link.symbols.exportProtoIdBySlot = { system__boot: 'system' };
	const linked = linkSystemProgramImage(object, null, SYSTEM_ROM_BASE);
	assert.equal(linked.image.sections.rodata.constPool[0], literal);
});

test('packer rejects static storage beyond the physical RAM window', () => {
	const object = makeProgramObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [], []);
	object.sections.bss.byteCount = RAM_END - PROGRAM_STATIC_RAM_BASE + 4;
	assert.throws(
		() => linkSystemProgramImage(object, null, SYSTEM_ROM_BASE),
		/static RAM range .* exceeds RAM end/,
	);
});
