import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { runCpuWithinBudget } from './cpu_execution';
import { runGuestToHalt } from './cpu_execution';
import type { Blua32DiagnosticSourceMap } from '../../toolchain/ts/rompack/blua32_diagnostics';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import assert from 'node:assert/strict';
import { writeLE32 } from '../../machine/ts/common/endian';

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
	BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_MAPPED_CODE_FLAG,
	BLUA32_FUNCTION_STATIC,
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
import { SYSTEM_EXECUTION_DOMAIN_ID, type ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { DmaController } from '../../machine/ts/machine/devices/dma/controller';
import { DeviceScheduler } from '../../machine/ts/machine/scheduler/device';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import { describeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/disassembler';
import {
	INSTRUCTION_BYTES,
	readInstructionWord,
	writeInstruction,
} from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import type { ProgramConstant, ProgramMetadata, Proto, UpvalueDesc } from '../../toolchain/ts/lua/compiler/program';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import {
	rewriteResolvedABx,
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
	type LinkedSystemBlua32Image,
} from '../../toolchain/ts/rompack/blua32_linker';
import { buildBlua32Tail } from '../../toolchain/ts/rompack/blua32_tail';
import { cartridgeSlots } from './cartridge';

const TEST_EXECUTABLE_OFFSET = 0x100;
// Reserve BSS in fixtures that execute code generated in main RAM.
export const RAM_CODE_FIXTURE_BYTES = 0x10000;
const LINK_TARGET_RAM_BYTES = PSX_MACHINE_SPEC.ramBytes;

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
	/** Handwritten fixtures normally exercise mapped code rather than bounded ROM functions. */
	verifiedControlFlow?: boolean;
	text: Uint8Array;
	functions: ReadonlyArray<TestBlua32Function>;
	constants?: ReadonlyArray<ProgramConstant>;
	globalNames?: ReadonlyArray<string>;
	systemGlobalNames?: ReadonlyArray<string>;
	constRelocs?: ReadonlyArray<ProgramImageConstReloc>;
	debugRanges?: ReadonlyArray<SourceRange | null>;
	functionIds?: ReadonlyArray<string>;
	startupFunctionIndex?: number;
	irqFunctionIndex?: number;
	exceptionFunctionIndex?: number;
	closureRelocations?: ReadonlyArray<{ wordIndex: number; functionIndex: number } | { wordIndex: number; functionAddress: number } | { wordIndex: number; systemFunctionIndex: number }>;
};

type RawTestSystemBlua32Object = {
	object: ProgramSystemObjectImage;
	metadata: ProgramMetadata;
};

type RawTestCartBlua32Object = {
	object: ProgramCartObjectImage;
	metadata: ProgramMetadata;
};

export function writeTestBlua32Rom(linked: LinkedBlua32Image, diagnosticSources: Blua32DiagnosticSourceMap | null = null): Uint8Array {
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
		? buildBlua32Tail({ id: 'system', index, bytes: rom }, linked, diagnosticSources).bytes
		: buildBlua32Tail({ id: 'cart', index, bytes: rom }, linked, diagnosticSources).bytes;
}

function testVectors(compiled: CompiledProgram, linked: LinkedBlua32Image): TestBlua32Vectors {
	const functionAddresses = linked.symbols.functionAddresses;
	return {
		startupFunctionAddress: linked.startupFunctionAddress,
		entryFunctionAddress: functionAddresses[compiled.entryProtoIndex],
		sectionInitFunctionAddress: functionAddresses[compiled.sectionInitProtoIndex],
		irqFunctionAddress: linked.irqFunctionAddress,
		exceptionFunctionAddress: linked.exceptionFunctionAddress,
		initFunctionAddress: linked.layout.header.initFunctionAddress,
	};
}

function testImage(linked: LinkedSystemBlua32Image, vectors: TestBlua32Vectors): TestBlua32Image {
	return {
		image: linked.layout,
		symbols: linked.symbols,
		biosImports: linked.biosImports,
		vectors,
		staticModulePaths: [],
		romBytes: writeTestBlua32Rom(linked),
	};
}

function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'system',
	bssByteCount?: number,
): RawTestSystemBlua32Object;
function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'cart',
	bssByteCount?: number,
): RawTestCartBlua32Object;
function createRawTestBlua32Object(
	source: TestBlua32Source,
	domain: 'system' | 'cart',
	bssByteCount = 0,
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
		optLevel: 0,
		traceStatements: 'erase',
		preloadModules: [],
		compiledModulePaths: [],
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
		outerBindingsByProto: functions.map(() => []),
		staticScopes: { declarations: [], globals: [], bindingsByProto: functions.map(() => []) },
		functionDefinitionsByProto: functions.map(() => null),
		lexicalDeclarations: [],
		upvalueBindingsByProto: functions.map(() => []),
	};
	const code = source.closureRelocations ? source.text.slice() : source.text;
	for (const relocation of source.closureRelocations ?? []) {
		if ('functionIndex' in relocation)
			rewriteResolvedABx(code, relocation.wordIndex, OpCode.CLOSURE, relocation.functionIndex);
	}
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
				code,
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
				byteCount: bssByteCount,
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
		initFunctionAddress: linked.layout.header.initFunctionAddress,
	};
}

function prepareRawTestImage(linked: LinkedBlua32Image, source: TestBlua32Source, system: LinkedSystemBlua32Image): void {
	if (!source.verifiedControlFlow) {
		linked.layout.header.flags = BLUA32_IMAGE_MAPPED_CODE_FLAG;
		writeLE32(linked.bytes, BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG);
	}
	const text = linked.layout.textBytes, relocations = source.closureRelocations;
	if (!relocations) {
		return;
	}
	for (let index = 0; index < relocations.length; index += 1) {
		const relocation = relocations[index];
		if ('functionIndex' in relocation) continue;
		const address = 'functionAddress' in relocation ? relocation.functionAddress : system.symbols.functionAddresses[relocation.systemFunctionIndex];
		rewriteResolvedABx(text, relocation.wordIndex, OpCode.CLOSURE, address >>> 4);
	}
}

export function linkRawTestSystemBlua32(source: TestBlua32Source, bssByteCount = 0): TestBlua32Image {
	const raw = createRawTestBlua32Object(source, 'system', bssByteCount);
	const linked = linkSystemBlua32Image(
		raw.object,
		raw.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	prepareRawTestImage(linked, source, linked);
	return testImage(linked, rawTestVectors(source, linked));
}

export function linkRawTestBlua32Pair(
	systemSource: TestBlua32Source,
	cartSource: TestBlua32Source,
	bssByteCount = 0,
): TestBlua32ImagePair {
	const systemRaw = createRawTestBlua32Object(systemSource, 'system', bssByteCount);
	const system = linkSystemBlua32Image(
		systemRaw.object,
		systemRaw.metadata,
		SYSTEM_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
		[],
	);
	prepareRawTestImage(system, systemSource, system);
	const cartRaw = createRawTestBlua32Object(cartSource, 'cart', bssByteCount);
	const cart = linkCartBlua32Image(
		system.biosImports,
		cartRaw.object,
		cartRaw.metadata,
		CART_ROM_BASE + TEST_EXECUTABLE_OFFSET,
		LINK_TARGET_RAM_BYTES,
	);
	prepareRawTestImage(cart, cartSource, system);
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
		systemRomBytes: writeTestBlua32Rom(system),
		cartRomBytes: writeTestBlua32Rom(cart),
	};
}

export function linkTestSystemBlua32(
	compiled: CompiledSystemProgram,
	diagnosticSources: Blua32DiagnosticSourceMap | null = null,
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
		romBytes: writeTestBlua32Rom(linked, diagnosticSources),
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
		cartCompiled.biosFunctionConstRelocs.length !== 0 ? BIOS_FUNCTION_EXPORTS : [],
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
		systemRomBytes: writeTestBlua32Rom(system),
		cartRomBytes: writeTestBlua32Rom(cart),
	};
}

export function createTestSystemCpu(
	finalized: Pick<TestBlua32Image, 'romBytes'>,
	executionBackend?: CpuExecutionBackend,
): { cpu: CPU; memory: Memory; irqController: IrqController; executionAddressSpace: ExecutionAddressSpace } {
	const memory = new Memory({ systemRom: finalized.romBytes, cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const irqController = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace, executionBackend);
	cpu.reset();
	return { cpu, memory, irqController, executionAddressSpace };
}

export function createTestBlua32PairCpu(
	finalized: Pick<TestBlua32ImagePair, 'systemRomBytes' | 'cartRomBytes'>,
	executionBackend?: CpuExecutionBackend,
): { cpu: CPU; memory: Memory; irqController: IrqController; executionAddressSpace: ExecutionAddressSpace } {
	const memory = new Memory({
		systemRom: finalized.systemRomBytes,
		cartridgeSlots: cartridgeSlots(finalized.cartRomBytes),
	}, PSX_MACHINE_SPEC.ramBytes);
	const irqController = new IrqController(memory);
	const executionAddressSpace = new ExecutionAddressSpace(memory);
	const cpu = new CPU(memory, irqController, executionAddressSpace, executionBackend);
	const scheduler = new DeviceScheduler(cpu);
	memory.cartridgeController.connect(memory, irqController, new DmaController(memory, cpu, irqController, scheduler));
	cpu.reset();
	return { cpu, memory, irqController, executionAddressSpace };
}

/**
 * Fixture input for hand-addressed MAPPED images: preissue an immutable Closure
 * without placing a call frame. The test is about using the record, not
 * allocating it; cache misses in a real executable fixture use resident BIOS.
 */
export function seedTestRomClosure(cpu: CPU, address: number, domain: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID): number {
	const image = cpu['executionImageForDomain'](domain);
	assert.ok(image);
	assert.ok(cpu['readFunctionRecordOnBus'](image, address, CPU['executionBusSignalsForDomain'](domain)));
	const prototype = cpu['functionRecordLatch'];
	assert.equal(prototype.romBacked, true);
	assert.equal(prototype.recordUpvalueCount, 0);
	return cpu['staticClosureFromLatch']();
}

/**
 * A bare CPU fixture can supply a completed sampled-prototype value when it
 * measures CALL or a canonical hit, not resident allocation.
 */
export function seedTestMappedStaticClosure(cpu: CPU, address: number,
	domain: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID): number {
	const image = cpu['executionImageForDomain'](domain);
	assert.ok(image && cpu['readFunctionRecordOnBus'](image, address, CPU['executionBusSignalsForDomain'](domain)));
	const prototype = cpu['functionRecordLatch'];
	assert.equal(prototype.romBacked, false);
	assert.equal(prototype.recordUpvalueCount, 0);
	assert.ok(prototype.flags & BLUA32_FUNCTION_STATIC);
	return cpu['staticClosureFromLatch']();
}

/** Provision raw capture records when a fixture measures another instruction or GC. */
export function seedTestCapturedClosure(cpu: CPU, address: number, newCells: Uint32Array,
	captures: ArrayLike<number> = newCells, domain: ExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID): number {
	const image = cpu['executionImageForDomain'](domain);
	assert.ok(image);
	assert.ok(cpu['readFunctionRecordOnBus'](image, address, CPU['executionBusSignalsForDomain'](domain)));
	const prototype = cpu['functionRecordLatch'], count = prototype.recordUpvalueCount, latched = !prototype.romBacked;
	assert.equal(captures.length, count);
	const record = cpu.luaHeap.allocateClosureRecord(count, latched, newCells, newCells.length);
	ClosureRecord.initializeRecord(cpu.memory, record, prototype, false, cpu.gc.white(), count, latched);
	for (let i = 0; i < count; ++i) ClosureRecord.setCaptureAddress(cpu.memory, record, i, captures[i]);
	cpu.gc.publishObject(record);
	return record;
}

export function runCompiledTestSystem(compiled: CompiledSystemProgram, cycleBudget: number): CPU {
	const finalized = linkTestSystemBlua32(compiled);
	const cpu = createTestSystemCpu(finalized).cpu;
	runGuestToHalt(cpu, cycleBudget);
	return cpu;
}
