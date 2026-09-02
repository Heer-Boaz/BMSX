import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import assert from 'node:assert/strict';

import {
	encodeCompiledProgramObject,
	type CompiledCartProgram,
	type CompiledProgram,
	type CompiledSystemProgram,
} from '../../toolchain/ts/lua/compiler';
import type {
	ProgramCartObjectImage,
	ProgramImageConstReloc,
	ProgramSystemObjectImage,
} from '../../toolchain/ts/lua/compiler/program_object';
import type {
	Blua32ImageLayout,
} from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_IMAGE_HEADER_SIZE,
} from '../../machine/ts/spec/blua32/image_format';
import {
	type Blua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import type { Blua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';
import {
	CPU,
	RunResult,
} from '../../machine/ts/machine/cpu/cpu';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { describeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import {
	BASE_BX_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	readInstructionWord,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import type { ProgramMetadata, Proto, UpvalueDesc } from '../../toolchain/ts/lua/compiler/program';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
	type LinkedSystemBlua32Image,
} from '../../toolchain/ts/rompack/blua32_linker';
import { buildBlua32Tail } from '../../toolchain/ts/rompack/blua32_tail';
import { cartridgeSlots } from './cartridge';

const TEST_EXECUTABLE_OFFSET = 0x100;
const LINK_TARGET_RAM_BYTES = PSX_MACHINE_SPEC.ramBytes;

export function blua32TestFunctionAddress(romBaseAddress: number, functionIndex: number): number {
	return romBaseAddress
		+ TEST_EXECUTABLE_OFFSET
		+ BLUA32_IMAGE_HEADER_SIZE
		+ functionIndex * BLUA32_FUNCTION_RECORD_SIZE;
}

type TestBlua32Vectors = {
	startupFunctionAddress: number;
	entryFunctionAddress: number;
	sectionInitFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
	initFunctionAddress: number;
};

export type TestBlua32Image = {
	image: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
	biosImports: Blua32BiosImports;
	vectors: TestBlua32Vectors;
	staticModulePaths: ReadonlyArray<string>;
	romBytes: Uint8Array;
};

export type TestBlua32ImagePair = {
	systemImage: Blua32ImageLayout;
	systemSymbols: Blua32SymbolsImage;
	systemBiosImports: Blua32BiosImports;
	systemVectors: TestBlua32Vectors;
	systemStaticModulePaths: ReadonlyArray<string>;
	cartImage: Blua32ImageLayout;
	cartSymbols: Blua32SymbolsImage;
	cartVectors: TestBlua32Vectors;
	cartStaticModulePaths: ReadonlyArray<string>;
	systemRomBytes: Uint8Array;
	cartRomBytes: Uint8Array;
};

export type TestBlua32Function = {
	firstWord: number;
	wordCount: number;
	numParams?: number;
	maxStack?: number;
	isVararg?: boolean;
	staticClosure?: boolean;
	upvalueDescs?: ReadonlyArray<UpvalueDesc>;
};

export type TestBlua32Source = {
	text: Uint8Array;
	functions: ReadonlyArray<TestBlua32Function>;
	constants?: ReadonlyArray<null | boolean | number | string>;
	globalNames?: ReadonlyArray<string>;
	systemGlobalNames?: ReadonlyArray<string>;
	constRelocs?: ReadonlyArray<ProgramImageConstReloc>;
	debugRanges?: ReadonlyArray<SourceRange | null>;
	functionIds?: ReadonlyArray<string>;
	startupFunctionIndex?: number;
	irqFunctionIndex?: number;
	exceptionFunctionIndex?: number;
	closureRelocations?: ReadonlyArray<{
		wordIndex: number;
		functionAddress: number;
	}>;
};

type RawTestSystemBlua32Object = {
	object: ProgramSystemObjectImage;
	metadata: ProgramMetadata;
};

type RawTestCartBlua32Object = {
	object: ProgramCartObjectImage;
	metadata: ProgramMetadata;
};

function writeTestRom(linked: LinkedBlua32Image): Uint8Array {
	const rom = new Uint8Array(TEST_EXECUTABLE_OFFSET + linked.bytes.byteLength);
	rom.set(linked.bytes, TEST_EXECUTABLE_OFFSET);
	writeCartRomHeader(rom, {
		headerSize: CART_ROM_HEADER_SIZE,
		manifestOffset: 0,
		manifestLength: 0,
		tocOffset: 0,
		tocLength: 0,
		dataOffset: TEST_EXECUTABLE_OFFSET,
		dataLength: linked.bytes.byteLength,
		blua32ImageOffset: TEST_EXECUTABLE_OFFSET,
		blua32ImageByteCount: linked.bytes.byteLength,
		blua32StartupFunctionAddress: linked.startupFunctionAddress,
		blua32IrqFunctionAddress: linked.irqFunctionAddress,
		blua32ExceptionFunctionAddress: linked.exceptionFunctionAddress,
		blua32StaticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
		blua32StaticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
		blua32DiagnosticDirectoryOffset: 0,
		metadataOffset: 0,
		metadataLength: 0,
	});
	const index = {
		entries: [],
		projectRootPath: '',
		cart_manifest: null,
	};
	return linked.domain === 'system'
		? buildBlua32Tail({ id: 'system', index, bytes: rom }, linked, null).bytes
		: buildBlua32Tail({ id: 'cart', index, bytes: rom }, linked, null).bytes;
}

function testVectors(compiled: CompiledProgram, linked: LinkedBlua32Image): TestBlua32Vectors {
	const functionAddresses = linked.symbols.functionAddresses;
	return {
		startupFunctionAddress: linked.startupFunctionAddress,
		entryFunctionAddress: functionAddresses[compiled.entryProtoIndex],
		sectionInitFunctionAddress: functionAddresses[compiled.sectionInitProtoIndex],
		irqFunctionAddress: linked.irqFunctionAddress,
		exceptionFunctionAddress: linked.exceptionFunctionAddress,
		initFunctionAddress: linked.initFunctionAddress,
	};
}

function testImage(linked: LinkedSystemBlua32Image, vectors: TestBlua32Vectors): TestBlua32Image {
	return {
		image: linked.layout,
		symbols: linked.symbols,
		biosImports: linked.biosImports,
		vectors,
		staticModulePaths: [],
		romBytes: writeTestRom(linked),
	};
}

function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'system',
): RawTestSystemBlua32Object;
function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'cart',
): RawTestCartBlua32Object;
function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'system' | 'cart',
): RawTestSystemBlua32Object | RawTestCartBlua32Object {
	const functions = new Array<Proto>(source.functions.length);
	for (let index = 0; index < source.functions.length; index += 1) {
		const functionSource = source.functions[index];
		functions[index] = {
			entryPC: functionSource.firstWord * INSTRUCTION_BYTES,
			codeLen: functionSource.wordCount * INSTRUCTION_BYTES,
			numParams: functionSource.numParams ?? 0,
			maxStack: functionSource.maxStack ?? 1,
			isVararg: functionSource.isVararg ?? false,
			staticClosure: functionSource.staticClosure ?? true,
			upvalueDescs: functionSource.upvalueDescs
				? Array.from(functionSource.upvalueDescs)
				: [],
		};
	}
	const functionIds = source.functionIds
		? Array.from(source.functionIds)
		: functions.map((_, index) => `test/function/${index}`);
	const debugRanges = source.debugRanges
		? Array.from(source.debugRanges)
		: new Array<SourceRange | null>(source.text.byteLength / INSTRUCTION_BYTES).fill(null);
	const globalNames = source.globalNames ? Array.from(source.globalNames) : [];
	const systemGlobalNames = source.systemGlobalNames ? Array.from(source.systemGlobalNames) : [];
	const metadata: ProgramMetadata = {
		protoIds: functionIds,
		protoDisplayNames: functionIds.slice(),
		globalNames,
		systemGlobalNames,
		exportProtoIdBySlot: {},
		initParticipants: [],
		debugRanges,
		debugInlineCallSites: debugRanges.map(() => []),
		statementPointsByProto: functions.map(() => []),
		resumePointsByProto: functions.map(() => []),
		localSlotsByProto: functions.map(() => []),
		upvalueNamesByProto: functions.map(() => []),
	};
	const objectBase = {
		vectors: {
			resetProtoIndex: source.startupFunctionIndex ?? 0,
			sectionInitProtoIndex: source.startupFunctionIndex ?? 0,
			irqProtoIndex: source.irqFunctionIndex ?? 0,
			exceptionProtoIndex: source.exceptionFunctionIndex ?? 0,
			initProtoIndex: null,
		},
		sections: {
			text: {
				code: source.text,
				protos: functions,
			},
			rodata: {
				constPool: source.constants ? Array.from(source.constants) : [],
				moduleProtos: [],
				moduleExports: [],
				staticModulePaths: [],
				bytes: new Uint8Array(0),
				symbols: [],
			},
			data: {
				bytes: new Uint8Array(0),
				symbols: [],
			},
			bss: {
				byteCount: 0,
				symbols: [],
			},
		},
	};
	const link = {
		constRelocs: source.constRelocs ? Array.from(source.constRelocs) : [],
		constValueRelocs: [],
		rodataConstRelocs: [],
		symbols: metadata,
	};
	if (domain === 'system') {
		const object: ProgramSystemObjectImage = {
			domain,
			...objectBase,
			link,
		};
		return { object, metadata };
	}
	const object: ProgramCartObjectImage = {
		domain,
		...objectBase,
		link: {
			...link,
			biosFunctionConstRelocs: [],
		},
	};
	return { object, metadata };
}

function rawTestVectors(source: TestBlua32Source, linked: LinkedBlua32Image): TestBlua32Vectors {
	const startupFunctionIndex = source.startupFunctionIndex ?? 0;
	return {
		startupFunctionAddress: linked.startupFunctionAddress,
		entryFunctionAddress: linked.symbols.functionAddresses[startupFunctionIndex],
		sectionInitFunctionAddress: linked.symbols.functionAddresses[startupFunctionIndex],
		irqFunctionAddress: linked.irqFunctionAddress,
		exceptionFunctionAddress: linked.exceptionFunctionAddress,
		initFunctionAddress: linked.initFunctionAddress,
	};
}

function applyRawTestClosureRelocations(
	text: Uint8Array,
	relocations: TestBlua32Source['closureRelocations'],
): void {
	if (!relocations) {
		return;
	}
	for (let index = 0; index < relocations.length; index += 1) {
		const relocation = relocations[index];
		const word = readInstructionWord(text, relocation.wordIndex);
		const wideWord = readInstructionWord(text, relocation.wordIndex - 1);
		const functionOperand = relocation.functionAddress >> 4;
		writeInstruction(
			text,
			relocation.wordIndex - 1,
			OpCode.WIDE,
			(wideWord >>> 12) & 0x3f,
			functionOperand >> BASE_BX_BITS,
			wideWord & 0x3f,
		);
		writeInstruction(
			text,
			relocation.wordIndex,
			OpCode.CLOSURE,
			(word >>> 12) & 0x3f,
			(functionOperand >>> 6) & 0x3f,
			functionOperand & 0x3f,
			functionOperand >> MAX_BX_BITS,
		);
	}
}

export function linkRawTestSystemBlua32(source: TestBlua32Source): TestBlua32Image {
	const raw = createRawTestBlua32Object(source, 'system');
	const linked = linkSystemBlua32Image(
		raw.object,
		raw.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	applyRawTestClosureRelocations(linked.layout.textBytes, source.closureRelocations);
	return testImage(linked, rawTestVectors(source, linked));
}

export function linkRawTestBlua32Pair(
	systemSource: TestBlua32Source,
	cartSource: TestBlua32Source,
): TestBlua32ImagePair {
	const systemRaw = createRawTestBlua32Object(systemSource, 'system');
	const system = linkSystemBlua32Image(
		systemRaw.object,
		systemRaw.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	applyRawTestClosureRelocations(system.layout.textBytes, systemSource.closureRelocations);
	const cartRaw = createRawTestBlua32Object(cartSource, 'cart');
	const cart = linkCartBlua32Image(
		system.biosImports,
		cartRaw.object,
		cartRaw.metadata,
		CART_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
	);
	applyRawTestClosureRelocations(cart.layout.textBytes, cartSource.closureRelocations);
	return {
		systemImage: system.layout,
		systemSymbols: system.symbols,
		systemBiosImports: system.biosImports,
		systemVectors: rawTestVectors(systemSource, system),
		systemStaticModulePaths: [],
		cartImage: cart.layout,
		cartSymbols: cart.symbols,
		cartVectors: rawTestVectors(cartSource, cart),
		cartStaticModulePaths: [],
		systemRomBytes: writeTestRom(system),
		cartRomBytes: writeTestRom(cart),
	};
}

export function linkTestSystemBlua32(
	compiled: CompiledSystemProgram,
): TestBlua32Image {
	const linked = linkSystemBlua32Image(
		encodeCompiledProgramObject(compiled),
		compiled.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	return {
		image: linked.layout,
		symbols: linked.symbols,
		biosImports: linked.biosImports,
		vectors: testVectors(compiled, linked),
		staticModulePaths: compiled.staticModulePaths,
		romBytes: writeTestRom(linked),
	};
}

export function disassembleTestBlua32Functions(
	image: TestBlua32Image,
	functionAddresses: ReadonlyArray<number>,
): string {
	const layout = image.image;
	const lines: string[] = [];
	for (let selectionIndex = 0; selectionIndex < functionAddresses.length; selectionIndex += 1) {
		const functionIndex = image.symbols.functionAddresses.indexOf(functionAddresses[selectionIndex]);
		const fn = layout.functions[functionIndex];
		lines.push(
			`; function=${functionIndex}` +
			` id=${image.symbols.metadata.functionIds[functionIndex]}` +
			` entry=${fn.codeAddress}` +
			` len=${fn.codeByteCount}` +
			` params=${fn.numParams}` +
			` vararg=${fn.isVararg ? 1 : 0}` +
			` stack=${fn.maxStack}` +
			` upvalues=${fn.upvalues.length}`,
		);
		let pc = fn.codeAddress;
		while (pc < fn.codeAddress + fn.codeByteCount) {
			const instruction = describeBlua32InstructionAtPc(layout, image.symbols, pc);
			lines.push(`${instruction.pcText}: ${instruction.instructionText}`);
			const wordIndex = (pc - layout.header.textAddress) / INSTRUCTION_BYTES;
			const word = readInstructionWord(layout.textBytes, wordIndex);
			pc += ((word >>> 18) & 0x3f) === OpCode.WIDE
				? INSTRUCTION_BYTES * 2
				: INSTRUCTION_BYTES;
		}
		if (selectionIndex < functionAddresses.length - 1) {
			lines.push('');
		}
	}
	return lines.join('\n');
}

export function linkTestBlua32Pair(
	systemCompiled: CompiledSystemProgram,
	cartCompiled: CompiledCartProgram,
): TestBlua32ImagePair {
	const system = linkSystemBlua32Image(
		encodeCompiledProgramObject(systemCompiled),
		systemCompiled.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	const cart = linkCartBlua32Image(
		system.biosImports,
		encodeCompiledProgramObject(cartCompiled),
		cartCompiled.metadata,
		CART_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
	);
	return {
		systemImage: system.layout,
		systemSymbols: system.symbols,
		systemBiosImports: system.biosImports,
		systemVectors: testVectors(systemCompiled, system),
		systemStaticModulePaths: systemCompiled.staticModulePaths,
		cartImage: cart.layout,
		cartSymbols: cart.symbols,
		cartVectors: testVectors(cartCompiled, cart),
		cartStaticModulePaths: cartCompiled.staticModulePaths,
		systemRomBytes: writeTestRom(system),
		cartRomBytes: writeTestRom(cart),
	};
}

export function createTestSystemCpu(
	finalized: TestBlua32Image,
): { cpu: CPU; memory: Memory; irqController: IrqController; executionAddressSpace: ExecutionAddressSpace } {
	const memory = new Memory({ systemRom: finalized.romBytes, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const irqController = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace);
	cpu.reset();
	return { cpu, memory, irqController, executionAddressSpace };
}

export function createTestBlua32PairCpu(
	finalized: TestBlua32ImagePair,
): { cpu: CPU; memory: Memory; irqController: IrqController; executionAddressSpace: ExecutionAddressSpace } {
	const memory = new Memory({
		systemRom: finalized.systemRomBytes,
		cartridgeSlots: cartridgeSlots(finalized.cartRomBytes),
	}, PSX_MACHINE_SPEC.ramBytes);
	const irqController = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace);
	cpu.reset();
	return { cpu, memory, irqController, executionAddressSpace };
}

export function runCompiledTestSystem(compiled: CompiledSystemProgram, cycleBudget: number): CPU {
	const finalized = linkTestSystemBlua32(compiled);
	const cpu = createTestSystemCpu(finalized).cpu;
	assert.equal(cpu.runUntilDepth(0, cycleBudget), RunResult.Halted);
	return cpu;
}
