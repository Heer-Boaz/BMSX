import { byteStringFromBytes, byteStringToText } from '../../../machine/ts/common/byte_string';
import type { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import type { LinkedProgramConstant } from '../lua/compiler/program';
import { integerConstant } from '../lua/number';
import { readLE32 } from '../../../machine/ts/common/endian';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
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
	BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET,
	BLUA32_IMAGE_MAGIC,
	BLUA32_IMAGE_MAGIC_OFFSET,
	BLUA32_IMAGE_RODATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET,
	BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT,
	BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND,
	BLUA32_STRING_RECORD_ROM_FLAG,
	BLUA32_STRING_LENGTH_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET,
	BLUA32_UPVALUE_INDEX_MASK,
	BLUA32_UPVALUE_IN_STACK_MASK,
	BLUA32_UPVALUE_RECORD_SIZE,
} from '../../../machine/ts/spec/blua32/image_format';
import {
	BMSX_ROM_BOOT_HEADER_SIZE,
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET,
} from '../../../machine/ts/spec/bmsx/rom_header';

export const BLUA32_IMAGE_ID = '__blua32__';

export type Blua32BootHeader = {
	imageOffset: number;
	imageByteCount: number;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
	staticLayoutTokenLo: number;
	staticLayoutTokenHi: number;
};

export function decodeBlua32BootHeader(payload: Uint8Array): Blua32BootHeader {
	const view = new DataView(
		payload.buffer,
		payload.byteOffset,
		BMSX_ROM_BOOT_HEADER_SIZE,
	);
	return {
		imageOffset: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, true),
		imageByteCount: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, true),
		startupFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, true),
		irqFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, true),
		exceptionFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, true),
		staticLayoutTokenLo: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET, true),
		staticLayoutTokenHi: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET, true),
	};
}

export function decodeBlua32RomImage(payload: Uint8Array, romBaseAddress: number): Blua32ImageLayout | null {
	const boot = decodeBlua32BootHeader(payload);
	if (boot.imageOffset === 0) {
		return null;
	}
	return decodeBlua32Image(
		payload.subarray(boot.imageOffset, boot.imageOffset + boot.imageByteCount),
		romBaseAddress + boot.imageOffset,
	);
}

export type Blua32ImageHeader = {
	imageByteCount: number;
	flags: number;
	functionTableAddress: number;
	functionCount: number;
	constantTableAddress: number;
	constantCount: number;
	globalNameTableAddress: number;
	globalNameCount: number;
	systemGlobalNameTableAddress: number;
	systemGlobalNameCount: number;
	stringBucketAddress: number;
	stringBucketCount: number;
	rodataAddress: number;
	rodataByteCount: number;
	dataLoadAddress: number;
	dataByteCount: number;
	dataAddress: number;
	bssAddress: number;
	bssByteCount: number;
	textAddress: number;
	textByteCount: number;
	initFunctionAddress: number;
};

export type Blua32UpvalueRecord = {
	inStack: boolean;
	index: number;
};

export type Blua32FunctionRecord = {
	address: number;
	codeAddress: number;
	codeByteCount: number;
	numParams: number;
	maxStack: number;
	flags: number;
	upvalueTableAddress: number;
	isVararg: boolean;
	staticClosure: boolean;
	upvalues: Blua32UpvalueRecord[];
};

export type Blua32EncodedConstant = LinkedProgramConstant;

export type Blua32ImageLayout = {
	address: number;
	bytes: Uint8Array;
	header: Blua32ImageHeader;
	functions: Blua32FunctionRecord[];
	constants: Blua32EncodedConstant[];
	globalNames: string[];
	systemGlobalNames: string[];
	rodataBytes: Uint8Array;
	dataLoadBytes: Uint8Array;
	textBytes: Uint8Array;
};

// Runtime-compiled function records are ordinary mapped-memory records rather
// than members of the linked ROM table. Return -1 when the physical address
// therefore has no linked function index.
export function blua32FunctionIndexAtAddress(image: Blua32ImageLayout, functionAddress: number): number {
	const tableOffset = functionAddress - image.header.functionTableAddress;
	if (tableOffset < 0
		|| tableOffset >= image.header.functionCount * BLUA32_FUNCTION_RECORD_SIZE
		|| tableOffset % BLUA32_FUNCTION_RECORD_SIZE !== 0) {
		return -1;
	}
	return tableOffset / BLUA32_FUNCTION_RECORD_SIZE;
}

/** Lexical ROM extent, regardless of the record that opened the current window. */
export function blua32FunctionIndexAtPc(image: Blua32ImageLayout, pc: number): number {
	return image.functions.findIndex(fn => pc >= fn.codeAddress && pc < fn.codeAddress + fn.codeByteCount);
}


export function alignBlua32ImageOffset(offset: number, baseAddress: number, alignment: number): number {
	return ((baseAddress + offset + alignment - 1) & ~(alignment - 1)) - baseAddress;
}

function imageOffset(address: number, byteCount: number, imageAddress: number, imageByteCount: number): number {
	if (address < imageAddress || byteCount > imageByteCount - (address - imageAddress)) {
		throw new Error('BLua32 image record points outside the executable image.');
	}
	return address - imageAddress;
}

export function decodeBlua32Image(bytes: Uint8Array, imageAddress: number): Blua32ImageLayout {
	if (bytes.byteLength < BLUA32_IMAGE_HEADER_SIZE) {
		throw new Error('BLua32 image is smaller than its header.');
	}
	if (readLE32(bytes, BLUA32_IMAGE_MAGIC_OFFSET) !== BLUA32_IMAGE_MAGIC) {
		throw new Error('BLua32 image magic is invalid.');
	}
	const header: Blua32ImageHeader = {
		imageByteCount: readLE32(bytes, BLUA32_IMAGE_BYTE_COUNT_OFFSET),
		flags: readLE32(bytes, BLUA32_IMAGE_FLAGS_OFFSET),
		functionTableAddress: readLE32(bytes, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET),
		functionCount: readLE32(bytes, BLUA32_IMAGE_FUNCTION_COUNT_OFFSET),
		constantTableAddress: readLE32(bytes, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET),
		constantCount: readLE32(bytes, BLUA32_IMAGE_CONSTANT_COUNT_OFFSET),
		globalNameTableAddress: readLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
		globalNameCount: readLE32(bytes, BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET),
		systemGlobalNameTableAddress: readLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET),
		systemGlobalNameCount: readLE32(bytes, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET),
		stringBucketAddress: readLE32(bytes, BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
		stringBucketCount: readLE32(bytes, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET),
		rodataAddress: readLE32(bytes, BLUA32_IMAGE_RODATA_ADDRESS_OFFSET),
		rodataByteCount: readLE32(bytes, BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET),
		dataLoadAddress: readLE32(bytes, BLUA32_IMAGE_DATA_LOAD_ADDRESS_OFFSET),
		dataByteCount: readLE32(bytes, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET),
		dataAddress: readLE32(bytes, BLUA32_IMAGE_DATA_ADDRESS_OFFSET),
		bssAddress: readLE32(bytes, BLUA32_IMAGE_BSS_ADDRESS_OFFSET),
		bssByteCount: readLE32(bytes, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET),
		textAddress: readLE32(bytes, BLUA32_IMAGE_TEXT_ADDRESS_OFFSET),
		textByteCount: readLE32(bytes, BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET),
		initFunctionAddress: readLE32(bytes, BLUA32_IMAGE_INIT_FUNCTION_ADDRESS_OFFSET),
	};
	if (header.imageByteCount !== bytes.byteLength) {
		throw new Error('BLua32 image byte count does not match its ROM record.');
	}
	if ((header.functionTableAddress & (BLUA32_FUNCTION_ALIGNMENT - 1)) !== 0) {
		throw new Error('BLua32 function table is not aligned.');
	}
	if ((header.textAddress & 3) !== 0 || (header.textByteCount & 3) !== 0) {
		throw new Error('BLua32 text is not word aligned.');
	}
	const functionTableOffset = imageOffset(
		header.functionTableAddress,
		header.functionCount * BLUA32_FUNCTION_RECORD_SIZE,
		imageAddress,
		header.imageByteCount,
	);
	imageOffset(header.constantTableAddress, header.constantCount * BLUA32_CONSTANT_RECORD_SIZE, imageAddress, header.imageByteCount);
	imageOffset(header.globalNameTableAddress, header.globalNameCount * BLUA32_GLOBAL_NAME_RECORD_SIZE, imageAddress, header.imageByteCount);
	imageOffset(header.systemGlobalNameTableAddress, header.systemGlobalNameCount * BLUA32_GLOBAL_NAME_RECORD_SIZE, imageAddress, header.imageByteCount);
	if ((header.stringBucketAddress & 3) !== 0 || header.stringBucketCount === 0
		|| (header.stringBucketCount & (header.stringBucketCount - 1)) !== 0) {
		throw new Error('BLua32 String bucket table is invalid.');
	}
	imageOffset(header.stringBucketAddress, 4 * header.stringBucketCount, imageAddress, header.imageByteCount);
	const rodataOffset = imageOffset(header.rodataAddress, header.rodataByteCount, imageAddress, header.imageByteCount);
	const dataLoadOffset = imageOffset(header.dataLoadAddress, header.dataByteCount, imageAddress, header.imageByteCount);
	const textOffset = imageOffset(header.textAddress, header.textByteCount, imageAddress, header.imageByteCount);

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const functions = new Array<Blua32FunctionRecord>(header.functionCount);
	for (let index = 0; index < functions.length; index += 1) {
		const offset = functionTableOffset + index * BLUA32_FUNCTION_RECORD_SIZE;
		const address = header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE;
		const codeAddress = view.getUint32(offset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, true);
		const codeByteCount = view.getUint32(offset + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, true);
		const flags = view.getUint32(offset + BLUA32_FUNCTION_FLAGS_OFFSET, true);
		const upvalueTableAddress = view.getUint32(offset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, true);
		const upvalueCount = view.getUint32(offset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, true);
		if ((codeAddress & 3) !== 0 || (codeByteCount & 3) !== 0
			|| codeAddress < header.textAddress
			|| codeAddress + codeByteCount > header.textAddress + header.textByteCount) {
			throw new Error('BLua32 function text range is invalid.');
		}
		const upvalueTableOffset = imageOffset(
			upvalueTableAddress,
			upvalueCount * BLUA32_UPVALUE_RECORD_SIZE,
			imageAddress,
			header.imageByteCount,
		);
		const upvalues = new Array<Blua32UpvalueRecord>(upvalueCount);
		for (let upvalueIndex = 0; upvalueIndex < upvalueCount; upvalueIndex += 1) {
			const word = view.getUint32(upvalueTableOffset + upvalueIndex * BLUA32_UPVALUE_RECORD_SIZE, true);
			upvalues[upvalueIndex] = {
				inStack: (word & BLUA32_UPVALUE_IN_STACK_MASK) !== 0,
				index: word & BLUA32_UPVALUE_INDEX_MASK,
			};
		}
		functions[index] = {
			address,
			codeAddress,
			codeByteCount,
			numParams: view.getUint32(offset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET, true),
			maxStack: view.getUint32(offset + BLUA32_FUNCTION_MAX_STACK_OFFSET, true),
			flags,
			upvalueTableAddress,
			isVararg: (flags & BLUA32_FUNCTION_VARARG) !== 0,
			staticClosure: (flags & BLUA32_FUNCTION_STATIC) !== 0,
			upvalues,
		};
	}

	const decodeString = (address: number): string => {
		const offset = imageOffset(address, BLUA32_STRING_RECORD_HEADER_SIZE, imageAddress, header.imageByteCount);
		if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1)) !== 0
			|| readLE32(bytes, offset) !== (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
			throw new Error('BLua32 ROM String header is invalid.');
		}
		const count = readLE32(bytes, offset + BLUA32_STRING_LENGTH_OFFSET);
		imageOffset(address, BLUA32_STRING_RECORD_HEADER_SIZE + count, imageAddress, header.imageByteCount);
		return byteStringFromBytes(bytes, offset + BLUA32_STRING_RECORD_HEADER_SIZE, count);
	};

	const constantTableOffset = header.constantTableAddress - imageAddress;
	const constants = new Array<Blua32EncodedConstant>(header.constantCount);
	for (let index = 0; index < constants.length; index += 1) {
		const offset = constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		const tag = view.getUint32(offset + BLUA32_CONSTANT_TAG_OFFSET, true);
		switch (tag) {
			case Blua32ConstantTag.Nil:
				constants[index] = null;
				break;
			case Blua32ConstantTag.False:
				constants[index] = false;
				break;
			case Blua32ConstantTag.True:
				constants[index] = true;
				break;
			case Blua32ConstantTag.Integer:
				constants[index] = integerConstant(view.getInt32(offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, true));
				break;
			case Blua32ConstantTag.Float:
				constants[index] = { kind: 'float', word: view.getUint32(offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, true) };
				break;
			case Blua32ConstantTag.Builtin:
				constants[index] = { kind: 'builtin', word: view.getUint32(offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, true) as BuiltinFunctionId };
				break;
			case Blua32ConstantTag.CodeFunction:
				constants[index] = { kind: 'code_function', word: view.getUint32(offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, true) };
				break;
			case Blua32ConstantTag.String:
				constants[index] = decodeString(view.getUint32(offset + BLUA32_CONSTANT_PAYLOAD_OFFSET, true));
				break;
			default:
				throw new Error('BLua32 constant tag is invalid.');
		}
	}

	const decodeNames = (tableAddress: number, count: number): string[] => {
		const tableOffset = tableAddress - imageAddress;
		const names = new Array<string>(count);
		for (let index = 0; index < count; index += 1) {
			const offset = tableOffset + index * BLUA32_GLOBAL_NAME_RECORD_SIZE;
			names[index] = byteStringToText(decodeString(view.getUint32(offset + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, true)));
		}
		return names;
	};

	return {
		address: imageAddress,
		bytes,
		header,
		functions,
		constants,
		globalNames: decodeNames(header.globalNameTableAddress, header.globalNameCount),
		systemGlobalNames: decodeNames(header.systemGlobalNameTableAddress, header.systemGlobalNameCount),
		rodataBytes: bytes.subarray(rodataOffset, rodataOffset + header.rodataByteCount),
		dataLoadBytes: bytes.subarray(dataLoadOffset, dataLoadOffset + header.dataByteCount),
		textBytes: bytes.subarray(textOffset, textOffset + header.textByteCount),
	};
}
