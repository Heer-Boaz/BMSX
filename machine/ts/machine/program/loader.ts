import { decodeBinary, encodeBinary } from '../../common/serializer/binencoder';
import { StringValue, type Program, type ProgramMetadata, type ProgramModuleExport, type ProgramModuleProto, type ProgramRuntimeSymbols, type Proto, type Value } from '../cpu/cpu';
import { StringPool } from '../cpu/string_pool';

// disable-next-line legacy_sentinel_string_pattern -- Program image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_IMAGE_ID = '__program__';
// disable-next-line legacy_sentinel_string_pattern -- Program symbols image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_SYMBOLS_IMAGE_ID = '__program_symbols__';

export type EncodedValue = null | boolean | number | string;

export type ProgramPlacement = {
	textBasePc: number;
	constBaseIndex: number;
	protoBaseIndex: number;
	dataBaseAddress: number;
	bssBaseAddress: number;
};

export type ProgramStaticLayoutToken = {
	lo: number;
	hi: number;
};

export type ProgramTextSection = {
	code: Uint8Array;
	protos: Proto[];
};

export type ProgramRodataSection = {
	constPool: EncodedValue[];
	moduleProtos: ProgramModuleProto[];
	moduleExports: ProgramModuleExport[];
	staticModulePaths: string[];
	bytes: Uint8Array;
};

export type ProgramDataSection = {
	bytes: Uint8Array;
};

export type ProgramBssSection = {
	byteCount: number;
};

export type ProgramSections = {
	text: ProgramTextSection;
	rodata: ProgramRodataSection;
	data: ProgramDataSection;
	bss: ProgramBssSection;
};

export type ProgramVectorTable = {
	resetProtoIndex: number;
	sectionInitProtoIndex: number;
	irqProtoIndex: number;
	exceptionProtoIndex: number;
};

export type ProgramBootTarget = 'system' | 'cart';

export type ProgramImage = {
	placement: ProgramPlacement;
	staticLayoutToken: ProgramStaticLayoutToken;
	vectors: ProgramVectorTable;
	sections: ProgramSections;
	symbols: ProgramRuntimeSymbols;
};

export type ProgramSymbolsImage = ProgramMetadata;

export type EncodedProgramImage = {
	sections: Uint8Array<ArrayBuffer>;
	descriptor: Uint8Array;
};

type ProgramImageDescriptor = {
	placement: ProgramPlacement;
	staticLayoutToken: ProgramStaticLayoutToken;
	vectors: ProgramVectorTable;
	sections: {
		text: { byteCount: number; protos: Proto[] };
		rodata: {
			byteCount: number;
			constPool: EncodedValue[];
			moduleProtos: ProgramModuleProto[];
			moduleExports: ProgramModuleExport[];
			staticModulePaths: string[];
		};
		data: { byteCount: number };
		bss: ProgramBssSection;
	};
	symbols: ProgramRuntimeSymbols;
};

export function encodeProgramImage(programImage: ProgramImage): EncodedProgramImage {
	const text = programImage.sections.text.code;
	const rodata = programImage.sections.rodata.bytes;
	const data = programImage.sections.data.bytes;
	const sections = new Uint8Array(text.byteLength + rodata.byteLength + data.byteLength);
	sections.set(rodata, 0);
	sections.set(data, rodata.byteLength);
	sections.set(text, rodata.byteLength + data.byteLength);
	const descriptor = encodeBinary({
		placement: programImage.placement,
		staticLayoutToken: programImage.staticLayoutToken,
		vectors: programImage.vectors,
		sections: {
			text: { byteCount: text.byteLength, protos: programImage.sections.text.protos },
			rodata: {
				byteCount: rodata.byteLength,
				constPool: programImage.sections.rodata.constPool,
				moduleProtos: programImage.sections.rodata.moduleProtos,
				moduleExports: programImage.sections.rodata.moduleExports,
				staticModulePaths: programImage.sections.rodata.staticModulePaths,
			},
			data: { byteCount: data.byteLength },
			bss: programImage.sections.bss,
		},
		symbols: programImage.symbols,
	} satisfies ProgramImageDescriptor);
	return { sections, descriptor };
}

export function decodeProgramImage(sectionBytes: Uint8Array, descriptorBytes: Uint8Array): ProgramImage {
	const descriptor = decodeBinary(descriptorBytes) as ProgramImageDescriptor;
	const rodataEnd = descriptor.sections.rodata.byteCount;
	const dataEnd = rodataEnd + descriptor.sections.data.byteCount;
	const textEnd = dataEnd + descriptor.sections.text.byteCount;
	return {
		placement: descriptor.placement,
		staticLayoutToken: descriptor.staticLayoutToken,
		vectors: descriptor.vectors,
		sections: {
			text: {
				code: sectionBytes.subarray(dataEnd, textEnd),
				protos: descriptor.sections.text.protos,
			},
			rodata: {
				constPool: descriptor.sections.rodata.constPool,
				moduleProtos: descriptor.sections.rodata.moduleProtos,
				moduleExports: descriptor.sections.rodata.moduleExports,
				staticModulePaths: descriptor.sections.rodata.staticModulePaths,
				bytes: sectionBytes.subarray(0, rodataEnd),
			},
			data: { bytes: sectionBytes.subarray(rodataEnd, dataEnd) },
			bss: descriptor.sections.bss,
		},
		symbols: descriptor.symbols,
	};
}

export function decodeProgramSymbolsImage(bytes: Uint8Array): ProgramSymbolsImage {
	return (decodeBinary(bytes) as { metadata: ProgramMetadata }).metadata;
}

function decodeProgramConst(value: EncodedValue, stringPool: StringPool): Value {
	if (typeof value === 'string') {
		return StringValue.get(stringPool.intern(value));
	}
	return value;
}

export function assembleProgramImages(systemImage: ProgramImage, cartImage: ProgramImage | null): Program {
	const codeByteLength = cartImage
		? cartImage.placement.textBasePc + cartImage.sections.text.code.byteLength
		: systemImage.sections.text.code.byteLength;
	const code = new Uint8Array(codeByteLength);
	code.set(systemImage.sections.text.code, systemImage.placement.textBasePc);
	if (cartImage) {
		code.set(cartImage.sections.text.code, cartImage.placement.textBasePc);
	}

	const stringPool = new StringPool();
	const constPool: Value[] = cartImage
		? new Array(cartImage.placement.constBaseIndex + cartImage.sections.rodata.constPool.length)
		: new Array(systemImage.sections.rodata.constPool.length);
	for (let index = 0; index < systemImage.sections.rodata.constPool.length; index += 1) {
		constPool[index] = decodeProgramConst(systemImage.sections.rodata.constPool[index], stringPool);
	}
	if (cartImage) {
		for (let index = 0; index < cartImage.sections.rodata.constPool.length; index += 1) {
			constPool[cartImage.placement.constBaseIndex + index] = decodeProgramConst(
				cartImage.sections.rodata.constPool[index],
				stringPool,
			);
		}
	}

	const protos: Proto[] = cartImage
		? new Array(cartImage.placement.protoBaseIndex + cartImage.sections.text.protos.length)
		: new Array(systemImage.sections.text.protos.length);
	for (let index = 0; index < systemImage.sections.text.protos.length; index += 1) {
		protos[index] = systemImage.sections.text.protos[index];
	}
	if (cartImage) {
		for (let index = 0; index < cartImage.sections.text.protos.length; index += 1) {
			protos[cartImage.placement.protoBaseIndex + index] = cartImage.sections.text.protos[index];
		}
	}

	const moduleProtos = cartImage
		? systemImage.sections.rodata.moduleProtos.concat(cartImage.sections.rodata.moduleProtos)
		: systemImage.sections.rodata.moduleProtos;
	const moduleExports = cartImage
		? systemImage.sections.rodata.moduleExports.concat(cartImage.sections.rodata.moduleExports)
		: systemImage.sections.rodata.moduleExports;
	const moduleProtoMap = new Map<string, number>();
	for (let index = 0; index < moduleProtos.length; index += 1) {
		const entry = moduleProtos[index];
		moduleProtoMap.set(entry.path, entry.protoIndex);
	}
	return {
		code,
		constPool,
		protos,
		moduleProtos,
		moduleExports,
		moduleProtoMap,
		stringPool,
		constPoolStringPool: stringPool,
	};
}

export function stripLuaExtension(candidate: string): string {
	const lower = candidate.toLowerCase();
	if (lower.endsWith('.lua')) {
		return candidate.slice(0, candidate.length - 4);
	}
	return candidate;
}

const CART_SOURCE_PREFIX = 'carts/';
const FIRMWARE_RESOURCE_SOURCE_PREFIX = 'machine/firmware/res/';
const FIRMWARE_SOURCE_PREFIX = 'machine/firmware/';
const RESOURCE_SOURCE_PREFIX = 'res/';
const MODULE_PATH_SOURCE_PREFIXES = [
	FIRMWARE_RESOURCE_SOURCE_PREFIX,
	FIRMWARE_SOURCE_PREFIX,
	RESOURCE_SOURCE_PREFIX,
];

export function toLuaModulePath(sourcePath: string): string {
	const path = stripLuaExtension(sourcePath.includes('\\') ? sourcePath.replace(/\\/g, '/') : sourcePath);
	if (path.startsWith(CART_SOURCE_PREFIX)) {
		const cartRelative = path.substring(CART_SOURCE_PREFIX.length);
		const cartNameEnd = cartRelative.indexOf('/');
		return cartNameEnd >= 0 ? cartRelative.substring(cartNameEnd + 1) : cartRelative;
	}
	for (let index = 0; index < MODULE_PATH_SOURCE_PREFIXES.length; index += 1) {
		const prefix = MODULE_PATH_SOURCE_PREFIXES[index];
		if (path.startsWith(prefix)) {
			return path.substring(prefix.length);
		}
	}
	return path;
}
