import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../machine/ts/lua/compiler';
import type {
	ProgramConstReloc,
	ProgramObjectImage,
} from '../../machine/ts/lua/compiler/program_object';
import type { Instruction } from '../../machine/ts/lua/compiler/optimizer';
import { replaceWithJump, replaceWithMov } from '../../machine/ts/lua/compiler/optimizer/values';
import {
	OpCode,
} from '../../machine/ts/machine/cpu/cpu';
import type { SourceRange } from '../../machine/ts/rompack/tooling/blua32_symbols';
import type {
	ProgramMetadata,
	ProgramRuntimeSymbols,
	Proto,
} from '../../machine/ts/lua/compiler/program';
import {
	BLUA32_FUNCTION_RECORD_SIZE,
	Blua32ConstantTag,
} from '../../machine/ts/machine/cpu/blua32_image';
import {
	INSTRUCTION_BYTES,
	readInstructionWord,
	writeInstruction,
} from '../../machine/ts/machine/cpu/instruction_format';
import {
	CART_ROM_BASE,
	DYNAMIC_RAM_BASE,
	RAM_END,
	SYSTEM_ROM_BASE,
} from '../../machine/ts/machine/memory/map';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
} from '../../machine/ts/rompack/tooling/blua32_linker';
import {
	buildBlua32ExecutionRevision,
	relocatedInstructionPc,
} from '../../machine/ts/rompack/tooling/blua32_revision';
import { parseLuaChunk } from '../lua/cpu_test_harness';

type EncodedWord = {
	op: OpCode;
	a: number;
	b: number;
	c: number;
	ext?: number;
};

const NO_SOURCES = new Map<string, string>();

function buildCode(words: ReadonlyArray<EncodedWord>): Uint8Array {
	const code = new Uint8Array(words.length * INSTRUCTION_BYTES);
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		writeInstruction(code, index, word.op, word.a, word.b, word.c, word.ext ?? 0);
	}
	return code;
}

function makeProto(firstWord: number, wordCount: number): Proto {
	return {
		entryPC: firstWord * INSTRUCTION_BYTES,
		codeLen: wordCount * INSTRUCTION_BYTES,
		numParams: 0,
		isVararg: false,
		maxStack: 2,
		upvalueDescs: [],
		staticClosure: true,
	};
}

function runtimeSymbols(
	protoIds: string[],
	globalNames: string[] = [],
	systemGlobalNames: string[] = [],
	exportProtoIdBySlot: Record<string, string> = {},
): ProgramRuntimeSymbols {
	return {
		protoIds,
		globalNames,
		systemGlobalNames,
		exportProtoIdBySlot,
	};
}

function makeMetadata(
	protoIds: string[],
	instructionCount: number,
	globalNames: string[] = [],
	systemGlobalNames: string[] = [],
	exportProtoIdBySlot: Record<string, string> = {},
): ProgramMetadata {
	return {
		debugRanges: new Array(instructionCount).fill(null),
		protoIds,
		resumePointsByProto: protoIds.map(() => []),
		localSlotsByProto: protoIds.map(() => []),
		upvalueNamesByProto: protoIds.map(() => []),
		globalNames,
		systemGlobalNames,
		exportProtoIdBySlot,
	};
}

function makeObject(
	words: ReadonlyArray<EncodedWord>,
	constPool: ReadonlyArray<null | boolean | number | string> = [],
	constRelocs: ReadonlyArray<ProgramConstReloc> = [],
): { object: ProgramObjectImage; metadata: ProgramMetadata } {
	const code = buildCode(words);
	const metadata = makeMetadata(['entry'], words.length);
	return {
		object: {
			vectors: {
				resetProtoIndex: 0,
				sectionInitProtoIndex: 0,
				irqProtoIndex: 0,
				exceptionProtoIndex: 0,
			},
			sections: {
				text: { code, protos: [makeProto(0, words.length)] },
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
				symbols: runtimeSymbols(['entry']),
			},
		},
		metadata,
	};
}

function setFunctionIds(
	object: ProgramObjectImage,
	metadata: ProgramMetadata,
	ids: string[],
): void {
	object.link.symbols.protoIds = ids;
	metadata.protoIds = ids;
	metadata.resumePointsByProto = ids.map(() => []);
	metadata.localSlotsByProto = ids.map(() => []);
	metadata.upvalueNamesByProto = ids.map(() => []);
}

function decodeBx(code: Uint8Array, wordIndex: number): number {
	const word = readInstructionWord(code, wordIndex);
	const wideWord = readInstructionWord(code, wordIndex - 1);
	return (((wideWord >>> 6) & 0x3f) << 20)
		| ((word >>> 24) << 12)
		| (((word >>> 6) & 0x3f) << 6)
		| (word & 0x3f);
}

function constantValues(constants: ReturnType<typeof linkSystemBlua32Image>['layout']['constants']): Array<null | boolean | number | string> {
	return constants.map(constant => {
		switch (constant.tag) {
			case Blua32ConstantTag.Nil: return null;
			case Blua32ConstantTag.False: return false;
			case Blua32ConstantTag.True: return true;
			case Blua32ConstantTag.Number:
			case Blua32ConstantTag.String:
				return constant.value;
		}
	});
}

test('BLua32 linker emits one self-describing physical image', () => {
	const { object, metadata } = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], ['literal', 3]);
	object.sections.rodata.moduleProtos.push({ path: 'rooms/castle', protoIndex: 0 });
	object.sections.rodata.bytes = new Uint8Array([1, 2, 3, 4]);
	object.sections.data.bytes = new Uint8Array([5, 6, 7, 8]);
	const loadAddress = SYSTEM_ROM_BASE + 0x100;
	const linked = linkSystemBlua32Image(object, metadata, loadAddress);
	const image = linked.layout;

	assert.equal(image.address, loadAddress);
	assert.equal(image.header.imageByteCount, linked.bytes.byteLength);
	assert.equal(image.functions[0].address, image.header.functionTableAddress);
	assert.equal(image.functions[0].codeAddress, image.header.textAddress);
	assert.deepEqual(Array.from(image.rodataBytes), [1, 2, 3, 4]);
	assert.deepEqual(Array.from(image.dataLoadBytes), [5, 6, 7, 8]);
	assert.deepEqual(Array.from(image.textBytes), Array.from(object.sections.text.code));
	assert.deepEqual(constantValues(image.constants), ['literal', 3]);
	assert.deepEqual(linked.symbols.moduleFunctions, [{
		path: 'rooms/castle',
		address: image.functions[0].address,
	}]);
	assert.equal(linked.startupFunctionAddress, image.functions[0].address);
});

test('BLua32 static layout token changes when an equal-sized storage symbol moves', () => {
	const initial = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	initial.object.sections.data.bytes = new Uint8Array(8);
	initial.object.sections.data.symbols = [
		{ name: 'left', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'right', offset: 4, byteCount: 4, alignment: 4 },
	];
	const changed = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	changed.object.sections.data.bytes = new Uint8Array(8);
	changed.object.sections.data.symbols = [
		{ name: 'right', offset: 0, byteCount: 4, alignment: 4 },
		{ name: 'left', offset: 4, byteCount: 4, alignment: 4 },
	];

	const initialImage = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);
	const changedImage = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);
	assert.notDeepEqual(changedImage.symbols.staticLayoutToken, initialImage.symbols.staticLayoutToken);
});

test('compiler vectors become distinct physical BLua32 function addresses', () => {
	const source = 'while true do halt_until_irq end';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source });
	const object = encodeCompiledProgramObject(compiled);
	const linked = linkSystemBlua32Image(object, compiled.metadata, SYSTEM_ROM_BASE + 0x100);
	const addresses = linked.symbols.functionAddresses;
	const irq = linked.layout.functions[object.vectors.irqProtoIndex];
	const irqOps: OpCode[] = [];
	const firstWord = (irq.codeAddress - linked.layout.header.textAddress) / INSTRUCTION_BYTES;
	for (let index = 0; index < irq.codeByteCount / INSTRUCTION_BYTES; index += 1) {
		irqOps.push(((readInstructionWord(linked.layout.textBytes, firstWord + index) >>> 18) & 0x3f) as OpCode);
	}

	assert.notEqual(object.vectors.irqProtoIndex, object.vectors.sectionInitProtoIndex);
	assert.equal(linked.startupFunctionAddress, addresses[object.vectors.resetProtoIndex]);
	assert.equal(linked.irqFunctionAddress, addresses[object.vectors.irqProtoIndex]);
	assert.equal(linked.exceptionFunctionAddress, addresses[object.vectors.exceptionProtoIndex]);
	assert.deepEqual(linked.symbols.metadata.functionIds, compiled.metadata.protoIds);
	assert.equal(irqOps.at(-1), OpCode.RFE);
});

test('compiler object and physical BLua32 image ignore source registry enumeration order', () => {
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
	const forwardImage = linkSystemBlua32Image(
		encodeCompiledProgramObject(forward),
		forward.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);
	const reverseImage = linkSystemBlua32Image(
		encodeCompiledProgramObject(reverse),
		reverse.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);

	assert.deepEqual(reverseImage.bytes, forwardImage.bytes);
	assert.deepEqual(reverseImage.symbols, forwardImage.symbols);
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

test('BLua32 linker rewrites local and firmware closure operands to physical addresses', () => {
	const system = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 1 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	system.object.sections.text.protos = [
		makeProto(0, 3),
		makeProto(3, 1),
	];
	setFunctionIds(system.object, system.metadata, ['system/entry', 'system/export']);
	system.object.link.symbols.exportProtoIdBySlot = { system__boot: 'system/export' };
	system.metadata.exportProtoIdBySlot = { system__boot: 'system/export' };
	const linkedSystem = linkSystemBlua32Image(
		system.object,
		system.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);
	assert.equal(
		decodeBx(linkedSystem.layout.textBytes, 1),
		linkedSystem.symbols.functionAddresses[1] >> 4,
	);

	const cart = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.LOADK, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], [{ wordIndex: 1, kind: 'export_proto', symbol: 'system__boot' }]);
	const linkedCart = linkCartBlua32Image(
		linkedSystem.layout,
		linkedSystem.symbols,
		cart.object,
		cart.metadata,
		CART_ROM_BASE + 0x100,
	);
	assert.equal(
		(readInstructionWord(linkedCart.layout.textBytes, 1) >>> 18) & 0x3f,
		OpCode.CLOSURE,
	);
	assert.equal(
		decodeBx(linkedCart.layout.textBytes, 1),
		linkedSystem.symbols.functionAddresses[1] >> 4,
	);
});

test('cartridge global operands use the merged physical slot tables', () => {
	const system = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	system.object.link.symbols = runtimeSymbols(['system'], ['shared'], ['firmware']);
	system.metadata = makeMetadata(['system'], 1, ['shared'], ['firmware']);
	const linkedSystem = linkSystemBlua32Image(
		system.object,
		system.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);

	const cart = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.GETGL, a: 0, b: 0, c: 0 },
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.GETGL, a: 1, b: 0, c: 1 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [], [
		{ wordIndex: 1, kind: 'gl', constIndex: 0 },
		{ wordIndex: 3, kind: 'gl', constIndex: 1 },
	]);
	cart.object.link.symbols = runtimeSymbols(['cart'], ['cart_only', 'shared'], ['firmware']);
	cart.metadata = makeMetadata(['cart'], 5, ['cart_only', 'shared'], ['firmware']);
	const linkedCart = linkCartBlua32Image(
		linkedSystem.layout,
		linkedSystem.symbols,
		cart.object,
		cart.metadata,
		CART_ROM_BASE + 0x100,
	);

	assert.deepEqual(linkedCart.layout.globalNames, ['shared', 'cart_only']);
	assert.deepEqual(linkedCart.layout.systemGlobalNames, ['firmware']);
	assert.equal(decodeBx(linkedCart.layout.textBytes, 1), 1);
	assert.equal(decodeBx(linkedCart.layout.textBytes, 3), 0);
});

test('system and cartridge storage relocations resolve against physical ROM and RAM sections', () => {
	const system = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0, 0, 0]);
	system.object.sections.rodata.bytes = new Uint8Array([0x11, 0x12, 0x13, 0x14]);
	system.object.sections.rodata.symbols = [{ name: 'system_lookup', offset: 0, byteCount: 4, alignment: 4 }];
	system.object.sections.data = {
		bytes: new Uint8Array([1, 0, 0, 0]),
		symbols: [{ name: 'system_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	system.object.sections.bss = {
		byteCount: 4,
		symbols: [{ name: 'system_counter', offset: 0, byteCount: 4, alignment: 4 }],
	};
	system.object.link.constValueRelocs = [
		{ constIndex: 0, kind: 'rodata_addr', symbol: 'system_lookup', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'system_state', addend: 0 },
		{ constIndex: 2, kind: 'bss_addr', symbol: 'system_counter', addend: 0 },
	];
	const linkedSystem = linkSystemBlua32Image(
		system.object,
		system.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);

	const cart = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0, 0, 0]);
	cart.object.sections.rodata.bytes = new Uint8Array([0x21, 0x22, 0x23, 0x24]);
	cart.object.sections.rodata.symbols = [{ name: 'cart_lookup', offset: 0, byteCount: 4, alignment: 4 }];
	cart.object.sections.data = {
		bytes: new Uint8Array([2, 0, 0, 0]),
		symbols: [{ name: 'cart_state', offset: 0, byteCount: 4, alignment: 4 }],
	};
	cart.object.sections.bss = {
		byteCount: 8,
		symbols: [{ name: 'cart_counter', offset: 0, byteCount: 8, alignment: 4 }],
	};
	cart.object.link.constValueRelocs = [
		{ constIndex: 0, kind: 'rodata_addr', symbol: 'cart_lookup', addend: 0 },
		{ constIndex: 1, kind: 'data_lma_addr', symbol: 'cart_state', addend: 0 },
		{ constIndex: 2, kind: 'bss_addr', symbol: 'cart_counter', addend: 4 },
	];
	const linkedCart = linkCartBlua32Image(
		linkedSystem.layout,
		linkedSystem.symbols,
		cart.object,
		cart.metadata,
		CART_ROM_BASE + 0x200,
	);

	assert.deepEqual(constantValues(linkedSystem.layout.constants), [
		linkedSystem.layout.header.rodataAddress,
		linkedSystem.layout.header.dataLoadAddress,
		DYNAMIC_RAM_BASE + 4,
	]);
	assert.deepEqual(constantValues(linkedCart.layout.constants), [
		linkedCart.layout.header.rodataAddress,
		linkedCart.layout.header.dataLoadAddress,
		DYNAMIC_RAM_BASE + 16,
	]);
	assert.equal(linkedSystem.layout.header.dataAddress, DYNAMIC_RAM_BASE);
	assert.equal(linkedSystem.layout.header.bssAddress, DYNAMIC_RAM_BASE + 4);
	assert.equal(linkedCart.layout.header.dataAddress, DYNAMIC_RAM_BASE + 8);
	assert.equal(linkedCart.layout.header.bssAddress, DYNAMIC_RAM_BASE + 12);
	assert.deepEqual(Array.from(linkedSystem.layout.dataLoadBytes), [1, 0, 0, 0]);
	assert.deepEqual(Array.from(linkedCart.layout.dataLoadBytes), [2, 0, 0, 0]);
});

test('BLua32 hot revision maps unchanged physical function code one word at a time', () => {
	const initial = makeObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);
	const fresh = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);
	const revision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		NO_SOURCES,
		fresh,
		NO_SOURCES,
	);

	assert.equal(revision.functionAddresses[0], fresh.symbols.functionAddresses[0]);
	assert.deepEqual(Array.from(revision.pcAddresses), [
		fresh.layout.functions[0].codeAddress,
		fresh.layout.functions[0].codeAddress + INSTRUCTION_BYTES,
	]);
});

test('BLua32 hot revision relocates the latched opcode word across WIDE encoding changes', () => {
	const range: SourceRange = {
		path: 'entry',
		start: { line: 1, column: 1 },
		end: { line: 1, column: 7 },
	};
	const previousObject = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	previousObject.metadata.debugRanges = [range, range];
	previousObject.metadata.resumePointsByProto = [[{
		wordOffset: 0,
		range,
		op: OpCode.RET,
		liveRegisters: [],
		uses: [],
		defs: [],
	}]];
	const previous = linkSystemBlua32Image(
		previousObject.object,
		previousObject.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);

	const freshObject = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	freshObject.metadata.debugRanges = [range];
	freshObject.metadata.resumePointsByProto = [[{
		wordOffset: 0,
		range,
		op: OpCode.RET,
		liveRegisters: [],
		uses: [],
		defs: [],
	}]];
	const fresh = linkSystemBlua32Image(
		freshObject.object,
		freshObject.metadata,
		SYSTEM_ROM_BASE + 0x100,
		{ image: previous.layout, symbols: previous.symbols },
	);
	const revision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		NO_SOURCES,
		fresh,
		NO_SOURCES,
	);

	assert.equal(
		relocatedInstructionPc(
			revision,
			previous.layout,
			fresh.layout,
			previous.layout.functions[0].codeAddress + INSTRUCTION_BYTES,
		),
		fresh.layout.functions[0].codeAddress,
	);
});

test('BLua32 hot revision translates unchanged suffix sequence points into changed physical text', () => {
	const firstRange: SourceRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 1, column: 5 } };
	const oldResumeRange: SourceRange = { path: 'entry', start: { line: 2, column: 1 }, end: { line: 2, column: 6 } };
	const initial = makeObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	initial.metadata.debugRanges = [firstRange, oldResumeRange];
	initial.metadata.resumePointsByProto = [[
		{ wordOffset: 0, range: firstRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
		{ wordOffset: 1, range: oldResumeRange, op: OpCode.RET, liveRegisters: [0], uses: [0], defs: [] },
	]];
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const freshRange: SourceRange = { path: 'entry', start: { line: 3, column: 1 }, end: { line: 3, column: 6 } };
	const changed = makeObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.K1, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	changed.metadata.debugRanges = [
		firstRange,
		{ path: 'entry', start: { line: 2, column: 1 }, end: { line: 2, column: 8 } },
		freshRange,
	];
	changed.metadata.resumePointsByProto = [[
		{ wordOffset: 0, range: firstRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
		{ wordOffset: 2, range: freshRange, op: OpCode.RET, liveRegisters: [0], uses: [0], defs: [] },
	]];
	const linked = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);
	const revision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		new Map([['entry', 'first\nresume\n']]),
		linked,
		new Map([['entry', 'first\ninserted\nresume\n']]),
	);

	assert.equal(revision.pcAddresses[0], linked.layout.functions[0].codeAddress);
	assert.equal(
		revision.pcAddresses[1],
		linked.layout.functions[0].codeAddress + 2 * INSTRUCTION_BYTES,
	);
});

test('BLua32 hot revision leaves a sequence point crossing an edit unmapped', () => {
	const oldRange: SourceRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 3, column: 4 } };
	const initial = makeObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	initial.metadata.debugRanges = [oldRange, oldRange];
	initial.metadata.resumePointsByProto = [[
		{ wordOffset: 0, range: oldRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
	]];
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const freshRange: SourceRange = { path: 'entry', start: { line: 1, column: 1 }, end: { line: 4, column: 4 } };
	const changed = makeObject([
		{ op: OpCode.K0, a: 0, b: 0, c: 0 },
		{ op: OpCode.K1, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	changed.metadata.debugRanges = [freshRange, freshRange, freshRange];
	changed.metadata.resumePointsByProto = [[
		{ wordOffset: 0, range: freshRange, op: OpCode.K0, liveRegisters: [], uses: [], defs: [0] },
	]];
	const linked = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);
	const revision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		new Map([['entry', 'start\nbody\nend']]),
		linked,
		new Map([['entry', 'start\ninserted\nbody\nend']]),
	);

	assert.equal(revision.pcAddresses[0], -1);
});

test('BLua32 hot revision rejects captured-upvalue layout changes', () => {
	const initial = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	initial.object.sections.text.protos[0].upvalueDescs = [{ inStack: true, index: 0 }];
	initial.metadata.upvalueNamesByProto[0] = ['state'];
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const changed = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	changed.object.sections.text.protos[0].upvalueDescs = [{ inStack: true, index: 1 }];
	changed.metadata.upvalueNamesByProto[0] = ['replacement'];
	const linked = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);

	assert.throws(
		() => buildBlua32ExecutionRevision(
			previous.layout,
			previous.symbols,
			NO_SOURCES,
			linked,
			NO_SOURCES,
		),
		/Hot resume cannot change closure identity for 'entry'/,
	);
});

test('BLua32 hot revision rejects a changed static storage layout', () => {
	const initial = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);
	const changed = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	changed.object.sections.bss.byteCount = 4;
	const linked = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);

	assert.throws(
		() => buildBlua32ExecutionRevision(
			previous.layout,
			previous.symbols,
			NO_SOURCES,
			linked,
			NO_SOURCES,
		),
		/Hot resume cannot change the static storage layout/,
	);
});

test('BLua32 hot revision leaves removed physical functions unmapped', () => {
	const initial = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	initial.object.sections.text.protos = [makeProto(0, 1), makeProto(1, 1)];
	setFunctionIds(initial.object, initial.metadata, ['entry', 'removed']);
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);
	const changed = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	const linked = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);
	const revision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		NO_SOURCES,
		linked,
		NO_SOURCES,
	);

	assert.equal(revision.functionAddresses[1], 0);
	assert.equal(revision.pcAddresses[1], -1);
});

test('BLua32 Hot Resume rejects a static-closure identity change at a stable function address', () => {
	const initial = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	initial.object.sections.text.protos = [makeProto(0, 1), makeProto(1, 1)];
	initial.object.sections.text.protos[1].staticClosure = false;
	setFunctionIds(initial.object, initial.metadata, ['entry', 'target']);
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const changed = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	changed.object.sections.text.protos = [makeProto(0, 1), makeProto(1, 1)];
	setFunctionIds(changed.object, changed.metadata, ['entry', 'target']);
	const linked = linkSystemBlua32Image(
		changed.object,
		changed.metadata,
		SYSTEM_ROM_BASE + 0x100,
		{ image: previous.layout, symbols: previous.symbols },
	);

	assert.equal(linked.symbols.functionAddresses[1], previous.symbols.functionAddresses[1]);
	assert.throws(
		() => buildBlua32ExecutionRevision(
			previous.layout,
			previous.symbols,
			NO_SOURCES,
			linked,
			NO_SOURCES,
		),
		/Hot resume cannot change closure identity for 'target'/,
	);
});

test('BLua32 Hot Resume preserves function-record addresses across reorder, removal, and reinsertion', () => {
	const initial = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 2 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	initial.object.sections.text.protos = [
		makeProto(0, 3),
		makeProto(3, 1),
		makeProto(4, 1),
	];
	initial.object.sections.text.protos[1].staticClosure = false;
	initial.object.sections.text.protos[1].upvalueDescs = [{ inStack: true, index: 0 }];
	setFunctionIds(initial.object, initial.metadata, ['entry', 'middle', 'tail']);
	initial.metadata.upvalueNamesByProto[1] = ['captured'];
	const previous = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const changed = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 1 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	changed.object.sections.text.protos = [
		makeProto(0, 3),
		makeProto(3, 1),
		makeProto(4, 1),
	];
	setFunctionIds(changed.object, changed.metadata, ['entry', 'tail', 'new']);
	const linked = linkSystemBlua32Image(
		changed.object,
		changed.metadata,
		SYSTEM_ROM_BASE + 0x100,
		{ image: previous.layout, symbols: previous.symbols },
	);

	assert.deepEqual(linked.symbols.metadata.functionIds, ['entry', 'middle', 'tail', 'new']);
	assert.deepEqual(
		linked.symbols.functionAddresses.slice(0, 3),
		previous.symbols.functionAddresses,
	);
	assert.equal(
		linked.symbols.functionAddresses[3],
		previous.symbols.functionAddresses[2] + BLUA32_FUNCTION_RECORD_SIZE,
	);
	assert.equal(decodeBx(linked.layout.textBytes, 1), linked.symbols.functionAddresses[2] >> 4);
	assert.equal(linked.layout.functions[1].staticClosure, false);
	assert.deepEqual(linked.layout.functions[1].upvalues, [{ inStack: true, index: 0 }]);
	assert.deepEqual(linked.symbols.metadata.upvalueNamesByFunction[1], ['captured']);
	assert.equal(linked.layout.functions[1].codeByteCount, INSTRUCTION_BYTES);
	assert.equal(
		(readInstructionWord(
			linked.layout.textBytes,
			(linked.layout.functions[1].codeAddress - linked.layout.header.textAddress) / INSTRUCTION_BYTES,
		) >>> 18) & 0x3f,
		OpCode.WIDE,
	);

	const removalRevision = buildBlua32ExecutionRevision(
		previous.layout,
		previous.symbols,
		NO_SOURCES,
		linked,
		NO_SOURCES,
	);
	assert.deepEqual(
		Array.from(removalRevision.functionAddresses),
		previous.symbols.functionAddresses,
	);
	assert.equal(
		removalRevision.pcAddresses[
			(previous.layout.functions[1].codeAddress - previous.layout.header.textAddress) / INSTRUCTION_BYTES
		],
		-1,
	);

	const reinserted = makeObject([
		{ op: OpCode.WIDE, a: 0, b: 0, c: 0 },
		{ op: OpCode.CLOSURE, a: 0, b: 0, c: 2 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	]);
	reinserted.object.sections.text.protos = [
		makeProto(0, 3),
		makeProto(3, 1),
		makeProto(4, 1),
		makeProto(5, 1),
	];
	reinserted.object.sections.text.protos[1].staticClosure = false;
	reinserted.object.sections.text.protos[1].upvalueDescs = [{ inStack: true, index: 0 }];
	setFunctionIds(reinserted.object, reinserted.metadata, ['entry', 'middle', 'tail', 'new']);
	reinserted.metadata.upvalueNamesByProto[1] = ['captured'];
	const restored = linkSystemBlua32Image(
		reinserted.object,
		reinserted.metadata,
		SYSTEM_ROM_BASE + 0x100,
		{ image: linked.layout, symbols: linked.symbols },
	);

	assert.deepEqual(restored.symbols.metadata.functionIds, ['entry', 'middle', 'tail', 'new']);
	assert.deepEqual(restored.symbols.functionAddresses, linked.symbols.functionAddresses);
	assert.doesNotThrow(() => buildBlua32ExecutionRevision(
		linked.layout,
		linked.symbols,
		NO_SOURCES,
		restored,
		NO_SOURCES,
	));
});

test('text-only BLua32 revisions keep physical rodata addresses stable', () => {
	const initial = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }], [0]);
	initial.object.sections.rodata.bytes = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
	initial.object.sections.rodata.symbols = [{ name: 'live_value', offset: 0, byteCount: 4, alignment: 4 }];
	initial.object.link.constValueRelocs = [{
		constIndex: 0,
		kind: 'rodata_addr',
		symbol: 'live_value',
		addend: 0,
	}];
	const initialImage = linkSystemBlua32Image(initial.object, initial.metadata, SYSTEM_ROM_BASE + 0x100);

	const changed = makeObject([
		{ op: OpCode.LOADNIL, a: 0, b: 0, c: 0 },
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [0]);
	changed.object.sections.rodata.bytes = initial.object.sections.rodata.bytes;
	changed.object.sections.rodata.symbols = initial.object.sections.rodata.symbols;
	changed.object.link.constValueRelocs = initial.object.link.constValueRelocs;
	const changedImage = linkSystemBlua32Image(changed.object, changed.metadata, SYSTEM_ROM_BASE + 0x100);

	assert.equal(initialImage.layout.header.rodataAddress, changedImage.layout.header.rodataAddress);
	assert.deepEqual(constantValues(initialImage.layout.constants), [initialImage.layout.header.rodataAddress]);
	assert.deepEqual(constantValues(changedImage.layout.constants), [changedImage.layout.header.rodataAddress]);
});

test('BLua32 linker preserves string literals that resemble obsolete relocation markers', () => {
	const literal = 'exportproto:system__boot';
	const linkedSource = makeObject([
		{ op: OpCode.RET, a: 0, b: 1, c: 0 },
	], [literal]);
	const linked = linkSystemBlua32Image(
		linkedSource.object,
		linkedSource.metadata,
		SYSTEM_ROM_BASE + 0x100,
	);
	assert.deepEqual(constantValues(linked.layout.constants), [literal]);
});

test('BLua32 linker rejects static storage beyond the physical RAM window', () => {
	const source = makeObject([{ op: OpCode.RET, a: 0, b: 1, c: 0 }]);
	source.object.sections.bss.byteCount = RAM_END - DYNAMIC_RAM_BASE + 4;
	assert.throws(
		() => linkSystemBlua32Image(
			source.object,
			source.metadata,
			SYSTEM_ROM_BASE + 0x100,
		),
		/BLua32 static storage exceeds RAM/,
	);
});
