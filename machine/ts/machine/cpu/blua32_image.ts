import { readLE32 } from '../../common/endian';

export const BLUA32_IMAGE_ID = '__blua32__';

export const BLUA32_IMAGE_MAGIC = 0x32334c42;
export const BLUA32_BOOT_HEADER_SIZE = 60;
export const BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET = 40;
export const BLUA32_IMAGE_VERSION = 1;
export const BLUA32_IMAGE_HEADER_SIZE = 96;
export const BLUA32_FUNCTION_RECORD_SIZE = 32;
export const BLUA32_FUNCTION_ALIGNMENT = 16;
export const BLUA32_UPVALUE_RECORD_SIZE = 4;
export const BLUA32_CONSTANT_RECORD_SIZE = 16;
export const BLUA32_GLOBAL_NAME_RECORD_SIZE = 8;

export const BLUA32_FUNCTION_VARARG = 1 << 0;
export const BLUA32_FUNCTION_STATIC = 1 << 1;

export type Blua32BootHeader = {
	imageOffset: number;
	imageByteCount: number;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
	staticLayoutTokenLo: number;
	staticLayoutTokenHi: number;
};

export function decodeBlua32BootHeader(payload: Uint8Array, byteOffset = 0): Blua32BootHeader {
	const view = new DataView(
		payload.buffer,
		payload.byteOffset + byteOffset,
		BLUA32_BOOT_HEADER_SIZE,
	);
	return {
		imageOffset: view.getUint32(32, true),
		imageByteCount: view.getUint32(36, true),
		startupFunctionAddress: view.getUint32(BLUA32_BOOT_STARTUP_FUNCTION_ADDRESS_OFFSET, true),
		irqFunctionAddress: view.getUint32(44, true),
		exceptionFunctionAddress: view.getUint32(48, true),
		staticLayoutTokenLo: view.getUint32(52, true),
		staticLayoutTokenHi: view.getUint32(56, true),
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

export const enum Blua32ConstantTag {
	Nil,
	False,
	True,
	Number,
	String,
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
	stringAddress: number;
	stringByteCount: number;
	rodataAddress: number;
	rodataByteCount: number;
	dataLoadAddress: number;
	dataByteCount: number;
	dataAddress: number;
	bssAddress: number;
	bssByteCount: number;
	textAddress: number;
	textByteCount: number;
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
	isVararg: boolean;
	staticClosure: boolean;
	upvalues: Blua32UpvalueRecord[];
};

export type Blua32EncodedConstant =
	| { tag: Blua32ConstantTag.Nil }
	| { tag: Blua32ConstantTag.False }
	| { tag: Blua32ConstantTag.True }
	| { tag: Blua32ConstantTag.Number; value: number }
	| { tag: Blua32ConstantTag.String; value: string };

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

export function blua32FunctionIndexAtAddress(image: Blua32ImageLayout, functionAddress: number): number {
	return (functionAddress - image.header.functionTableAddress) / BLUA32_FUNCTION_RECORD_SIZE;
}

const stringDecoder = new TextDecoder('utf-8', { fatal: true });

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
	if (readLE32(bytes, 0) !== BLUA32_IMAGE_MAGIC) {
		throw new Error('BLua32 image magic is invalid.');
	}
	if (readLE32(bytes, 4) !== BLUA32_IMAGE_VERSION) {
		throw new Error('BLua32 image version is unsupported.');
	}
	const header: Blua32ImageHeader = {
		imageByteCount: readLE32(bytes, 8),
		flags: readLE32(bytes, 12),
		functionTableAddress: readLE32(bytes, 16),
		functionCount: readLE32(bytes, 20),
		constantTableAddress: readLE32(bytes, 24),
		constantCount: readLE32(bytes, 28),
		globalNameTableAddress: readLE32(bytes, 32),
		globalNameCount: readLE32(bytes, 36),
		systemGlobalNameTableAddress: readLE32(bytes, 40),
		systemGlobalNameCount: readLE32(bytes, 44),
		stringAddress: readLE32(bytes, 48),
		stringByteCount: readLE32(bytes, 52),
		rodataAddress: readLE32(bytes, 56),
		rodataByteCount: readLE32(bytes, 60),
		dataLoadAddress: readLE32(bytes, 64),
		dataByteCount: readLE32(bytes, 68),
		dataAddress: readLE32(bytes, 72),
		bssAddress: readLE32(bytes, 76),
		bssByteCount: readLE32(bytes, 80),
		textAddress: readLE32(bytes, 84),
		textByteCount: readLE32(bytes, 88),
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
	const stringOffset = imageOffset(header.stringAddress, header.stringByteCount, imageAddress, header.imageByteCount);
	const rodataOffset = imageOffset(header.rodataAddress, header.rodataByteCount, imageAddress, header.imageByteCount);
	const dataLoadOffset = imageOffset(header.dataLoadAddress, header.dataByteCount, imageAddress, header.imageByteCount);
	const textOffset = imageOffset(header.textAddress, header.textByteCount, imageAddress, header.imageByteCount);

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const functions = new Array<Blua32FunctionRecord>(header.functionCount);
	for (let index = 0; index < functions.length; index += 1) {
		const offset = functionTableOffset + index * BLUA32_FUNCTION_RECORD_SIZE;
		const address = header.functionTableAddress + index * BLUA32_FUNCTION_RECORD_SIZE;
		const codeAddress = view.getUint32(offset, true);
		const codeByteCount = view.getUint32(offset + 4, true);
		const flags = view.getUint32(offset + 16, true);
		const upvalueTableAddress = view.getUint32(offset + 20, true);
		const upvalueCount = view.getUint32(offset + 24, true);
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
				inStack: (word & 0x80000000) !== 0,
				index: word & 0x7fffffff,
			};
		}
		functions[index] = {
			address,
			codeAddress,
			codeByteCount,
			numParams: view.getUint32(offset + 8, true),
			maxStack: view.getUint32(offset + 12, true),
			isVararg: (flags & BLUA32_FUNCTION_VARARG) !== 0,
			staticClosure: (flags & BLUA32_FUNCTION_STATIC) !== 0,
			upvalues,
		};
	}

	const decodeString = (address: number, byteCount: number): string => {
		if (address < header.stringAddress || byteCount > header.stringByteCount - (address - header.stringAddress)) {
			throw new Error('BLua32 string record points outside the string table.');
		}
		const offset = stringOffset + address - header.stringAddress;
		return stringDecoder.decode(bytes.subarray(offset, offset + byteCount));
	};

	const constantTableOffset = header.constantTableAddress - imageAddress;
	const constants = new Array<Blua32EncodedConstant>(header.constantCount);
	for (let index = 0; index < constants.length; index += 1) {
		const offset = constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		const tag = view.getUint32(offset, true);
		switch (tag) {
			case Blua32ConstantTag.Nil:
				constants[index] = { tag };
				break;
			case Blua32ConstantTag.False:
				constants[index] = { tag };
				break;
			case Blua32ConstantTag.True:
				constants[index] = { tag };
				break;
			case Blua32ConstantTag.Number:
				constants[index] = { tag, value: view.getFloat64(offset + 4, true) };
				break;
			case Blua32ConstantTag.String:
				constants[index] = {
					tag,
					value: decodeString(view.getUint32(offset + 4, true), view.getUint32(offset + 8, true)),
				};
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
			names[index] = decodeString(view.getUint32(offset, true), view.getUint32(offset + 4, true));
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
