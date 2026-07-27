import { OpCode } from '../../spec/blua32/opcode';
import {
	BASE_BX_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	readInstructionWord,
	writeInstruction,
} from '../../spec/blua32/instruction_format';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET,
	BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_FUNCTION_ALIGNMENT,
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE,
	BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
	BLUA32_FUNCTION_VARARG,
	BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
	BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET,
	BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET,
	BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET,
	BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET,
	BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_FUNCTION_COUNT_OFFSET,
	BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_RODATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_STRING_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_VERSION,
	BLUA32_IMAGE_VERSION_OFFSET,
	BLUA32_UPVALUE_IN_STACK_MASK,
	BLUA32_UPVALUE_RECORD_SIZE,
} from '../../spec/blua32/image_format';
import {
	decodeBlua32Image,
	type Blua32ImageLayout,
} from './blua32_image';
import {
	BLUA32_SYMBOLS_VERSION,
	type Blua32DebugMetadata,
	type Blua32ModuleFunction,
	type Blua32StaticLayoutToken,
	type Blua32SymbolsImage,
} from './blua32_symbols';
import type {
	ProgramBssSymbol,
	ProgramConstReloc,
	ProgramConstValueReloc,
	ProgramDataSymbol,
	ProgramObjectImage,
	ProgramRodataSymbol,
	ProgramStorageSymbol,
} from '../../lua/compiler/program_object';
import type {
	ProgramMetadata,
	ProgramRuntimeSymbols,
} from '../../lua/compiler/program';
import { RAM_END } from '../../machine/memory/map';
import { DYNAMIC_RAM_BASE } from '../../spec/bmsx/memory_map';
import { writeLE32 } from '../../common/endian';
import { fmix32 } from '../../machine/common/hash';
import { hashAssetId } from '../tokens';

export type LinkedBlua32Image = {
	bytes: Uint8Array;
	layout: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
};

export type Blua32LinkBaseline = {
	image: Blua32ImageLayout;
	symbols: Blua32SymbolsImage;
};

type ObjectConstant = null | boolean | number | string;

type FunctionRecordLayout = {
	protoIndexBySlot: number[];
	functionIds: string[];
	hasTombstones: boolean;
};

type ImageBuildInput = {
	object: ProgramObjectImage;
	metadata: ProgramMetadata;
	loadAddress: number;
	dataAddress: number;
	bssAddress: number;
	globalNames: string[];
	systemGlobalNames: string[];
	externalSymbols: Blua32SymbolsImage | null;
	previous?: Blua32LinkBaseline;
};

type StringRecord = {
	offset: number;
	bytes: Uint8Array;
};

const stringEncoder = new TextEncoder();

function alignImageOffset(offset: number, imageAddress: number, alignment: number): number {
	const address = imageAddress + offset;
	return ((address + alignment - 1) & ~(alignment - 1)) - imageAddress;
}

function assertStaticRamFits(baseAddress: number, byteCount: number): void {
	if (baseAddress > RAM_END || byteCount > RAM_END - baseAddress) {
		throw new Error('BLua32 static storage exceeds RAM.');
	}
}

function mixStaticLayoutWord(token: Blua32StaticLayoutToken, value: number): void {
	const word = value >>> 0;
	token.lo = fmix32(token.lo ^ word);
	token.hi = fmix32(token.hi ^ word ^ token.lo);
}

function mixStaticLayoutSection(
	token: Blua32StaticLayoutToken,
	section: number,
	baseAddress: number,
	byteCount: number,
	symbols: ReadonlyArray<ProgramStorageSymbol>,
): void {
	mixStaticLayoutWord(token, section);
	mixStaticLayoutWord(token, baseAddress);
	mixStaticLayoutWord(token, byteCount);
	mixStaticLayoutWord(token, symbols.length);
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		const nameToken = hashAssetId(symbol.name);
		mixStaticLayoutWord(token, nameToken.lo);
		mixStaticLayoutWord(token, nameToken.hi);
		mixStaticLayoutWord(token, symbol.offset);
		mixStaticLayoutWord(token, symbol.byteCount);
		mixStaticLayoutWord(token, symbol.alignment);
	}
}

function buildStaticLayoutToken(
	rodataAddress: number,
	rodataByteCount: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	dataAddress: number,
	dataByteCount: number,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	bssAddress: number,
	bssByteCount: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
): Blua32StaticLayoutToken {
	const token = { lo: 0x84222325, hi: 0xcbf29ce4 };
	mixStaticLayoutSection(token, 1, rodataAddress, rodataByteCount, rodataSymbols);
	mixStaticLayoutSection(token, 2, dataAddress, dataByteCount, dataSymbols);
	mixStaticLayoutSection(token, 3, bssAddress, bssByteCount, bssSymbols);
	return token;
}

function resolveStorageSymbolAddress(
	symbols: ReadonlyArray<ProgramBssSymbol | ProgramDataSymbol | ProgramRodataSymbol>,
	baseAddress: number,
	symbolName: string,
	addend: number,
): number {
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		if (symbol.name === symbolName) {
			return baseAddress + symbol.offset + addend;
		}
	}
	throw new Error(`BLua32 static symbol '${symbolName}' is undefined.`);
}

function resolveConstValueRelocation(
	reloc: ProgramConstValueReloc,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataAddress: number,
	dataLoadAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataAddress: number,
): number {
	switch (reloc.kind) {
		case 'data_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataAddress, reloc.symbol, reloc.addend);
		case 'data_lma_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataLoadAddress, reloc.symbol, reloc.addend);
		case 'bss_addr':
			return resolveStorageSymbolAddress(bssSymbols, bssAddress, reloc.symbol, reloc.addend);
		case 'rodata_addr':
			return resolveStorageSymbolAddress(rodataSymbols, rodataAddress, reloc.symbol, reloc.addend);
	}
}

function resolveConstValues(
	constants: ReadonlyArray<ObjectConstant>,
	relocs: ReadonlyArray<ProgramConstValueReloc>,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataAddress: number,
	dataLoadAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataAddress: number,
): ObjectConstant[] {
	const resolved = constants.slice();
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		resolved[reloc.constIndex] = resolveConstValueRelocation(
			reloc,
			dataSymbols,
			dataAddress,
			dataLoadAddress,
			bssSymbols,
			bssAddress,
			rodataSymbols,
			rodataAddress,
		);
	}
	return resolved;
}

function mergeNamedSlots(
	systemNames: ReadonlyArray<string>,
	imageNames: ReadonlyArray<string>,
): { names: string[]; remap: number[] } {
	const names = systemNames.slice();
	const slotByName = new Map<string, number>();
	for (let index = 0; index < names.length; index += 1) {
		slotByName.set(names[index], index);
	}
	const remap = new Array<number>(imageNames.length);
	for (let index = 0; index < imageNames.length; index += 1) {
		const name = imageNames[index];
		const slot = slotByName.get(name);
		if (slot === undefined) {
			remap[index] = names.length;
			slotByName.set(name, names.length);
			names.push(name);
		} else {
			remap[index] = slot;
		}
	}
	return { names, remap };
}

function indexNames(names: ReadonlyArray<string>): Map<string, number> {
	const slots = new Map<string, number>();
	for (let index = 0; index < names.length; index += 1) {
		slots.set(names[index], index);
	}
	return slots;
}

function rewriteResolvedABx(code: Uint8Array, wordIndex: number, op: OpCode, value: number): void {
	const word = readInstructionWord(code, wordIndex);
	const wideWord = readInstructionWord(code, wordIndex - 1);
	if (((wideWord >>> 18) & 0x3f) !== OpCode.WIDE) {
		throw new Error('Relocatable BLua32 ABx instruction has no WIDE word.');
	}
	const a = (word >>> 12) & 0x3f;
	const wideA = (wideWord >>> 12) & 0x3f;
	const wideC = wideWord & 0x3f;
	const wide = value >> BASE_BX_BITS;
	if (value > MAX_EXT_BX) {
		throw new Error('Relocated BLua32 ABx operand exceeds the instruction word.');
	}
	writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wide & 0x3f, wideC);
	writeInstruction(
		code,
		wordIndex,
		op,
		a,
		(value >>> 6) & 0x3f,
		value & MAX_LOW_BX,
		(value >> MAX_BX_BITS) & 0xff,
	);
}

function rewriteLocalClosures(code: Uint8Array, functionAddresses: ReadonlyArray<number>): void {
	const instructionCount = code.byteLength / INSTRUCTION_BYTES;
	for (let wordIndex = 1; wordIndex < instructionCount; wordIndex += 1) {
		const word = readInstructionWord(code, wordIndex);
		if (((word >>> 18) & 0x3f) !== OpCode.CLOSURE) {
			continue;
		}
		const wideWord = readInstructionWord(code, wordIndex - 1);
		if (((wideWord >>> 18) & 0x3f) !== OpCode.WIDE) {
			throw new Error('BLua32 closure instruction has no WIDE word.');
		}
		const functionIndex = (((wideWord >>> 6) & 0x3f) << BASE_BX_BITS)
			| ((word >>> 24) << MAX_BX_BITS)
			| (word & MAX_LOW_BX);
		rewriteResolvedABx(code, wordIndex, OpCode.CLOSURE, functionAddresses[functionIndex] >> 4);
	}
}

function rewriteNamedSlots(
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	globalRemap: ReadonlyArray<number>,
	systemGlobalRemap: ReadonlyArray<number>,
): void {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'gl' && reloc.kind !== 'sys') {
			continue;
		}
		const word = readInstructionWord(code, reloc.wordIndex);
		rewriteResolvedABx(
			code,
			reloc.wordIndex,
			(word >>> 18) & 0x3f,
			reloc.kind === 'gl' ? globalRemap[reloc.constIndex] : systemGlobalRemap[reloc.constIndex],
		);
	}
}

function functionAddressesById(ids: ReadonlyArray<string>, addresses: ReadonlyArray<number>): Map<string, number> {
	const addressById = new Map<string, number>();
	for (let index = 0; index < ids.length; index += 1) {
		addressById.set(ids[index], addresses[index]);
	}
	return addressById;
}

function moduleAddressesByPath(entries: ReadonlyArray<Blua32ModuleFunction>): Map<string, number> {
	const addresses = new Map<string, number>();
	for (let index = 0; index < entries.length; index += 1) {
		addresses.set(entries[index].path, entries[index].address);
	}
	return addresses;
}

function layoutFunctionRecords(
	functionIds: ReadonlyArray<string>,
	previous?: Blua32LinkBaseline,
): FunctionRecordLayout {
	const protoIndexBySlot: number[] = [];
	const assigned = new Uint8Array(functionIds.length);
	let hasTombstones = false;

	if (previous) {
		const protoIndexById = new Map<string, number>();
		for (let protoIndex = 0; protoIndex < functionIds.length; protoIndex += 1) {
			protoIndexById.set(functionIds[protoIndex], protoIndex);
		}
		const previousIds = previous.symbols.metadata.functionIds;
		for (let slot = 0; slot < previousIds.length; slot += 1) {
			const protoIndex = protoIndexById.get(previousIds[slot]);
			if (protoIndex === undefined) {
				protoIndexBySlot.push(-1);
				hasTombstones = true;
				continue;
			}
			protoIndexBySlot.push(protoIndex);
			assigned[protoIndex] = 1;
		}
	}

	for (let protoIndex = 0; protoIndex < functionIds.length; protoIndex += 1) {
		if (assigned[protoIndex] !== 0) {
			continue;
		}
		protoIndexBySlot.push(protoIndex);
	}

	const orderedFunctionIds = new Array<string>(protoIndexBySlot.length);
	for (let slot = 0; slot < protoIndexBySlot.length; slot += 1) {
		const protoIndex = protoIndexBySlot[slot];
		orderedFunctionIds[slot] = protoIndex < 0
			? previous!.symbols.metadata.functionIds[slot]
			: functionIds[protoIndex];
	}
	return {
		protoIndexBySlot,
		functionIds: orderedFunctionIds,
		hasTombstones,
	};
}

function rewriteSymbolicRelocations(
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	globalSlotByName: ReadonlyMap<string, number>,
	systemGlobalSlotByName: ReadonlyMap<string, number>,
	localSymbols: ProgramRuntimeSymbols,
	localFunctionAddressById: ReadonlyMap<string, number>,
	localModuleAddressByPath: ReadonlyMap<string, number>,
	externalSymbols: Blua32SymbolsImage | null,
): void {
	const externalFunctionAddressById = externalSymbols === null
		? null
		: functionAddressesById(externalSymbols.metadata.functionIds, externalSymbols.functionAddresses);
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		switch (reloc.kind) {
			case 'module': {
				const globalSlot = globalSlotByName.get(reloc.symbol);
				if (globalSlot !== undefined) {
					rewriteResolvedABx(code, reloc.wordIndex, OpCode.GETGL, globalSlot);
					break;
				}
				const systemSlot = systemGlobalSlotByName.get(reloc.symbol);
				if (systemSlot === undefined) {
					throw new Error(`BLua32 global symbol '${reloc.symbol}' is undefined.`);
				}
				rewriteResolvedABx(code, reloc.wordIndex, OpCode.GETSYS, systemSlot);
				break;
			}
			case 'export_proto': {
				const localId = localSymbols.exportProtoIdBySlot[reloc.symbol];
				const localAddress = localId === undefined ? undefined : localFunctionAddressById.get(localId);
				if (localAddress !== undefined) {
					rewriteResolvedABx(code, reloc.wordIndex, OpCode.CLOSURE, localAddress >> 4);
					break;
				}
				const externalId = externalSymbols?.metadata.staticFunctionIdBySlot[reloc.symbol];
				const externalAddress = externalId === undefined ? undefined : externalFunctionAddressById?.get(externalId);
				if (externalAddress !== undefined) {
					rewriteResolvedABx(code, reloc.wordIndex, OpCode.CLOSURE, externalAddress >> 4);
					break;
				}
				const globalSlot = globalSlotByName.get(reloc.symbol);
				if (globalSlot !== undefined) {
					rewriteResolvedABx(code, reloc.wordIndex, OpCode.GETGL, globalSlot);
					break;
				}
				const systemSlot = systemGlobalSlotByName.get(reloc.symbol);
				if (systemSlot === undefined) {
					throw new Error(`BLua32 function symbol '${reloc.symbol}' is undefined.`);
				}
				rewriteResolvedABx(code, reloc.wordIndex, OpCode.GETSYS, systemSlot);
				break;
			}
			case 'module_init': {
				const localAddress = localModuleAddressByPath.get(reloc.symbol);
				if (localAddress === undefined) {
					throw new Error(`BLua32 module initializer '${reloc.symbol}' is not part of this executable image.`);
				}
				rewriteResolvedABx(code, reloc.wordIndex, OpCode.CLOSURE, localAddress >> 4);
				break;
			}
		}
	}
}

function buildImage(input: ImageBuildInput): LinkedBlua32Image {
	const object = input.object;
	const text = object.sections.text;
	const rodata = object.sections.rodata;
	const data = object.sections.data;
	const bss = object.sections.bss;
	const functionLayout = layoutFunctionRecords(input.metadata.protoIds, input.previous);
	const functionCount = functionLayout.protoIndexBySlot.length;
	const textByteCount = text.code.byteLength + (functionLayout.hasTombstones ? INSTRUCTION_BYTES : 0);

	let offset = BLUA32_IMAGE_HEADER_SIZE;
	const rodataOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = rodataOffset + rodata.bytes.byteLength;
	const dataLoadOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = dataLoadOffset + data.bytes.byteLength;
	const functionTableOffset = alignImageOffset(offset, input.loadAddress, BLUA32_FUNCTION_ALIGNMENT);
	offset = functionTableOffset + functionCount * BLUA32_FUNCTION_RECORD_SIZE;
	const upvalueTableOffset = alignImageOffset(
		offset,
		input.loadAddress,
		BLUA32_UPVALUE_RECORD_SIZE,
	);
	let upvalueByteCount = 0;
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		const upvalueCount = protoIndex < 0
			? input.previous!.image.functions[slot].upvalues.length
			: text.protos[protoIndex].upvalueDescs.length;
		upvalueByteCount += upvalueCount * BLUA32_UPVALUE_RECORD_SIZE;
	}
	offset = upvalueTableOffset + upvalueByteCount;
	const constantTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = constantTableOffset + rodata.constPool.length * BLUA32_CONSTANT_RECORD_SIZE;
	const globalNameTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = globalNameTableOffset + input.globalNames.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;
	const systemGlobalNameTableOffset = alignImageOffset(offset, input.loadAddress, 4);
	offset = systemGlobalNameTableOffset + input.systemGlobalNames.length * BLUA32_GLOBAL_NAME_RECORD_SIZE;

	const stringRecordByValue = new Map<string, StringRecord>();
	const stringRecords: StringRecord[] = [];
	let stringByteCount = 0;
	const internString = (value: string): StringRecord => {
		const existing = stringRecordByValue.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const record = { offset: stringByteCount, bytes: stringEncoder.encode(value) };
		stringByteCount += record.bytes.byteLength;
		stringRecordByValue.set(value, record);
		stringRecords.push(record);
		return record;
	};
	for (let index = 0; index < rodata.constPool.length; index += 1) {
		const value = rodata.constPool[index];
		if (typeof value === 'string') {
			internString(value);
		}
	}
	for (let index = 0; index < input.globalNames.length; index += 1) {
		internString(input.globalNames[index]);
	}
	for (let index = 0; index < input.systemGlobalNames.length; index += 1) {
		internString(input.systemGlobalNames[index]);
	}

	const stringTableOffset = offset;
	offset += stringByteCount;
	const textOffset = alignImageOffset(offset, input.loadAddress, INSTRUCTION_BYTES);
	const imageByteCount = textOffset + textByteCount;

	const functionTableAddress = input.loadAddress + functionTableOffset;
	const functionAddresses = new Array<number>(functionCount);
	const functionAddressByProtoIndex = new Array<number>(text.protos.length);
	for (let slot = 0; slot < functionCount; slot += 1) {
		const address = functionTableAddress + slot * BLUA32_FUNCTION_RECORD_SIZE;
		functionAddresses[slot] = address;
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		if (protoIndex >= 0) {
			functionAddressByProtoIndex[protoIndex] = address;
		}
	}
	const moduleFunctions = new Array<Blua32ModuleFunction>(rodata.moduleProtos.length);
	for (let index = 0; index < moduleFunctions.length; index += 1) {
		const entry = rodata.moduleProtos[index];
		moduleFunctions[index] = { path: entry.path, address: functionAddressByProtoIndex[entry.protoIndex] };
	}
	const localFunctionAddressById = functionAddressesById(
		object.link.symbols.protoIds,
		functionAddressByProtoIndex,
	);
	const localModuleAddressByPath = moduleAddressesByPath(moduleFunctions);

	const code = new Uint8Array(textByteCount);
	code.set(text.code);
	if (functionLayout.hasTombstones) {
		writeInstruction(code, text.code.byteLength / INSTRUCTION_BYTES, OpCode.WIDE, 0, 0, 0);
	}
	rewriteLocalClosures(code, functionAddressByProtoIndex);
	const globalRemap = new Array<number>(object.link.symbols.globalNames.length);
	const systemGlobalRemap = new Array<number>(object.link.symbols.systemGlobalNames.length);
	const globalSlotByName = indexNames(input.globalNames);
	const systemGlobalSlotByName = indexNames(input.systemGlobalNames);
	for (let index = 0; index < globalRemap.length; index += 1) {
		globalRemap[index] = globalSlotByName.get(object.link.symbols.globalNames[index]) as number;
	}
	for (let index = 0; index < systemGlobalRemap.length; index += 1) {
		systemGlobalRemap[index] = systemGlobalSlotByName.get(object.link.symbols.systemGlobalNames[index]) as number;
	}
	rewriteNamedSlots(code, object.link.constRelocs, globalRemap, systemGlobalRemap);
	rewriteSymbolicRelocations(
		code,
		object.link.constRelocs,
		globalSlotByName,
		systemGlobalSlotByName,
		object.link.symbols,
		localFunctionAddressById,
		localModuleAddressByPath,
		input.externalSymbols,
	);

	const rodataAddress = input.loadAddress + rodataOffset;
	const dataLoadAddress = input.loadAddress + dataLoadOffset;
	const constants = resolveConstValues(
		rodata.constPool,
		object.link.constValueRelocs,
		data.symbols,
		input.dataAddress,
		dataLoadAddress,
		bss.symbols,
		input.bssAddress,
		rodata.symbols,
		rodataAddress,
	);
	const rodataBytes = rodata.bytes.slice();
	for (let index = 0; index < object.link.rodataConstRelocs.length; index += 1) {
		const reloc = object.link.rodataConstRelocs[index];
		writeLE32(rodataBytes, reloc.byteOffset, reloc.constIndex);
	}

	const bytes = new Uint8Array(imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_MAGIC_OFFSET, BLUA32_IMAGE_MAGIC);
	writeLE32(bytes, BLUA32_IMAGE_VERSION_OFFSET, BLUA32_IMAGE_VERSION);
	writeLE32(bytes, BLUA32_IMAGE_BYTE_COUNT_OFFSET, imageByteCount);
	writeLE32(bytes, BLUA32_IMAGE_FLAGS_OFFSET, 0);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET, functionTableAddress);
	writeLE32(bytes, BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, functionCount);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET, input.loadAddress + constantTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, constants.length);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + globalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, input.globalNames.length);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, input.loadAddress + systemGlobalNameTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET, input.systemGlobalNames.length);
	writeLE32(bytes, BLUA32_IMAGE_STRING_ADDRESS_OFFSET, input.loadAddress + stringTableOffset);
	writeLE32(bytes, BLUA32_IMAGE_STRING_BYTE_COUNT_OFFSET, stringByteCount);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_ADDRESS_OFFSET, rodataAddress);
	writeLE32(bytes, BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET, rodataBytes.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET, dataLoadAddress);
	writeLE32(bytes, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET, data.bytes.byteLength);
	writeLE32(bytes, BLUA32_IMAGE_DATA_ADDRESS_OFFSET, input.dataAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_ADDRESS_OFFSET, input.bssAddress);
	writeLE32(bytes, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET, bss.byteCount);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_ADDRESS_OFFSET, input.loadAddress + textOffset);
	writeLE32(bytes, BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET, code.byteLength);

	let upvalueOffset = upvalueTableOffset;
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		const currentProto = protoIndex < 0 ? null : text.protos[protoIndex];
		const record = currentProto === null
			? input.previous!.image.functions[slot]
			: currentProto;
		const upvalues = currentProto === null
			? input.previous!.image.functions[slot].upvalues
			: currentProto.upvalueDescs;
		const recordOffset = functionTableOffset + slot * BLUA32_FUNCTION_RECORD_SIZE;
		writeLE32(
			bytes,
			recordOffset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
			currentProto === null
				? input.loadAddress + textOffset + text.code.byteLength
				: input.loadAddress + textOffset + currentProto.entryPC,
		);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, currentProto === null ? INSTRUCTION_BYTES : currentProto.codeLen);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, record.numParams);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_MAX_STACK_OFFSET, record.maxStack);
		writeLE32(
			bytes,
			recordOffset + BLUA32_FUNCTION_FLAGS_OFFSET,
			(record.isVararg ? BLUA32_FUNCTION_VARARG : 0)
				| (record.staticClosure ? BLUA32_FUNCTION_STATIC : 0),
		);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, input.loadAddress + upvalueOffset);
		writeLE32(bytes, recordOffset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, upvalues.length);
		for (let upvalueIndex = 0; upvalueIndex < upvalues.length; upvalueIndex += 1) {
			const upvalue = upvalues[upvalueIndex];
			writeLE32(bytes, upvalueOffset, (upvalue.inStack ? BLUA32_UPVALUE_IN_STACK_MASK : 0) | upvalue.index);
			upvalueOffset += BLUA32_UPVALUE_RECORD_SIZE;
		}
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const stringAddress = input.loadAddress + stringTableOffset;
	for (let index = 0; index < constants.length; index += 1) {
		const value = constants[index];
		const recordOffset = constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		if (value === null) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Nil);
		} else if (value === false) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.False);
		} else if (value === true) {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.True);
		} else if (typeof value === 'string') {
			const stringRecord = stringRecordByValue.get(value) as StringRecord;
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.String);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, stringAddress + stringRecord.offset);
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET, stringRecord.bytes.byteLength);
		} else {
			writeLE32(bytes, recordOffset + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Number);
			view.setFloat64(recordOffset + BLUA32_CONSTANT_PAYLOAD_OFFSET, value, true);
		}
	}

	const writeNames = (tableOffset: number, names: ReadonlyArray<string>): void => {
		for (let index = 0; index < names.length; index += 1) {
			const stringRecord = stringRecordByValue.get(names[index]) as StringRecord;
			const recordOffset = tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			writeLE32(bytes, recordOffset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, stringAddress + stringRecord.offset);
			writeLE32(bytes, recordOffset + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET, stringRecord.bytes.byteLength);
		}
	};
	writeNames(globalNameTableOffset, input.globalNames);
	writeNames(systemGlobalNameTableOffset, input.systemGlobalNames);
	for (let index = 0; index < stringRecords.length; index += 1) {
		const record = stringRecords[index];
		bytes.set(record.bytes, stringTableOffset + record.offset);
	}
	bytes.set(rodataBytes, rodataOffset);
	bytes.set(data.bytes, dataLoadOffset);
	bytes.set(code, textOffset);

	const staticLayoutToken = buildStaticLayoutToken(
		rodataAddress,
		rodataBytes.byteLength,
		rodata.symbols,
		input.dataAddress,
		data.bytes.byteLength,
		data.symbols,
		input.bssAddress,
		bss.byteCount,
		bss.symbols,
	);
	const resumePointsByFunction = new Array<Blua32DebugMetadata['resumePointsByFunction'][number]>(functionCount);
	const localSlotsByFunction = new Array<Blua32DebugMetadata['localSlotsByFunction'][number]>(functionCount);
	const upvalueNamesByFunction = new Array<Blua32DebugMetadata['upvalueNamesByFunction'][number]>(functionCount);
	const noDebugRecords: readonly [] = [];
	for (let slot = 0; slot < functionCount; slot += 1) {
		const protoIndex = functionLayout.protoIndexBySlot[slot];
		if (protoIndex < 0) {
			resumePointsByFunction[slot] = noDebugRecords;
			localSlotsByFunction[slot] = noDebugRecords;
			upvalueNamesByFunction[slot]
				= input.previous!.symbols.metadata.upvalueNamesByFunction[slot];
			continue;
		}
		resumePointsByFunction[slot] = input.metadata.resumePointsByProto[protoIndex];
		localSlotsByFunction[slot] = input.metadata.localSlotsByProto[protoIndex];
		upvalueNamesByFunction[slot] = input.metadata.upvalueNamesByProto[protoIndex];
	}
	const metadata: Blua32DebugMetadata = {
		functionIds: functionLayout.functionIds,
		globalNames: input.globalNames,
		systemGlobalNames: input.systemGlobalNames,
		staticFunctionIdBySlot: input.metadata.exportProtoIdBySlot,
		debugRanges: functionLayout.hasTombstones
			? [...input.metadata.debugRanges, null]
			: input.metadata.debugRanges,
		resumePointsByFunction,
		localSlotsByFunction,
		upvalueNamesByFunction,
	};
	return {
		bytes,
		layout: decodeBlua32Image(bytes, input.loadAddress),
		symbols: {
			version: BLUA32_SYMBOLS_VERSION,
			imageAddress: input.loadAddress,
			functionAddresses,
			moduleFunctions,
			staticLayoutToken,
			metadata,
		},
		startupFunctionAddress: functionAddressByProtoIndex[object.vectors.resetProtoIndex],
		irqFunctionAddress: functionAddressByProtoIndex[object.vectors.irqProtoIndex],
		exceptionFunctionAddress: functionAddressByProtoIndex[object.vectors.exceptionProtoIndex],
	};
}

export function linkSystemBlua32Image(
	object: ProgramObjectImage,
	metadata: ProgramMetadata,
	loadAddress: number,
	previous?: Blua32LinkBaseline,
): LinkedBlua32Image {
	const dataAddress = DYNAMIC_RAM_BASE;
	const bssAddress = dataAddress + object.sections.data.bytes.byteLength;
	assertStaticRamFits(dataAddress, object.sections.data.bytes.byteLength + object.sections.bss.byteCount);
	return buildImage({
		object,
		metadata,
		loadAddress,
		dataAddress,
		bssAddress,
		globalNames: object.link.symbols.globalNames.slice(),
		systemGlobalNames: object.link.symbols.systemGlobalNames.slice(),
		externalSymbols: null,
		previous,
	});
}

export function linkCartBlua32Image(
	systemImage: Blua32ImageLayout,
	systemSymbols: Blua32SymbolsImage,
	object: ProgramObjectImage,
	metadata: ProgramMetadata,
	loadAddress: number,
	previous?: Blua32LinkBaseline,
): LinkedBlua32Image {
	const globals = mergeNamedSlots(systemImage.globalNames, object.link.symbols.globalNames);
	const systemGlobals = mergeNamedSlots(systemImage.systemGlobalNames, object.link.symbols.systemGlobalNames);
	const dataAddress = systemImage.header.bssAddress + systemImage.header.bssByteCount;
	const bssAddress = dataAddress + object.sections.data.bytes.byteLength;
	assertStaticRamFits(
		DYNAMIC_RAM_BASE,
		bssAddress + object.sections.bss.byteCount - DYNAMIC_RAM_BASE,
	);
	return buildImage({
		object,
		metadata,
		loadAddress,
		dataAddress,
		bssAddress,
		globalNames: globals.names,
		systemGlobalNames: systemGlobals.names,
		externalSymbols: systemSymbols,
		previous,
	});
}
