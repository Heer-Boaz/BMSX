import { decodeBinary, requireObject, requireObjectKey } from '../../common/serializer/binencoder';
import { StringValue, asStringId, valueIsString, type Program, type ProgramMetadata, type ProgramModuleExport, type ProgramModuleProto, type ProgramRuntimeSymbols, type Proto, type Value } from '../cpu/cpu';
import { StringPool } from '../cpu/string_pool';

// disable-next-line legacy_sentinel_string_pattern -- Program image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_IMAGE_ID = '__program__';
// disable-next-line legacy_sentinel_string_pattern -- Program symbols image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_SYMBOLS_IMAGE_ID = '__program_symbols__';
export type EncodedValue = null | boolean | number | string;

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
	symbols: ProgramRodataSymbol[];
};

export type ProgramStorageSymbol = {
	name: string;
	offset: number;
	byteCount: number;
	alignment: number;
};

export type ProgramRodataSymbol = ProgramStorageSymbol;

export type ProgramDataSection = {
	bytes: Uint8Array;
	symbols: ProgramDataSymbol[];
};

export type ProgramDataSymbol = ProgramStorageSymbol;

export type ProgramBssSection = {
	byteCount: number;
	symbols: ProgramBssSymbol[];
};

export type ProgramBssSymbol = ProgramStorageSymbol;

export type ProgramVectorTable = {
	resetProtoIndex: number;
	sectionInitProtoIndex: number;
	irqProtoIndex: number;
};

export type ProgramObjectSections = {
	text: ProgramTextSection;
	rodata: ProgramRodataSection;
	data: ProgramDataSection;
	bss: ProgramBssSection;
};

// 'module' and 'export_proto' carry symbolic export-slot names directly in the
// relocation record. The instruction operand is scratch storage until the linker
// resolves it to the final slot or proto index.
export type ProgramIndexedConstRelocKind = 'bx' | 'rk_b' | 'rk_c' | 'const_b' | 'const_c' | 'gl' | 'sys';
export type ProgramSymbolicConstRelocKind = 'module' | 'export_proto';

export type ProgramConstReloc =
	| {
		wordIndex: number;
		kind: ProgramIndexedConstRelocKind;
		constIndex: number;
	}
	| {
		wordIndex: number;
		kind: ProgramSymbolicConstRelocKind;
		symbol: string;
	};

export type ProgramConstValueReloc = {
	constIndex: number;
	kind: 'bss_addr' | 'data_addr' | 'data_lma_addr' | 'rodata_addr';
	symbol: string;
	addend: number;
};

export type ProgramLink = {
	constRelocs: ProgramConstReloc[];
	constValueRelocs: ProgramConstValueReloc[];
	symbols: ProgramRuntimeSymbols;
};

export type ProgramImage = {
	vectors: ProgramVectorTable;
	sections: ProgramObjectSections;
	link: ProgramLink;
};

export type ProgramSymbolsImage = ProgramMetadata;

function encodeProgramRodataConstPool(program: Program): EncodedValue[] {
	const constPool: EncodedValue[] = new Array(program.constPool.length);
	for (let index = 0; index < program.constPool.length; index += 1) {
		const value = program.constPool[index];
		if (value === null || typeof value === 'number' || typeof value === 'boolean') {
			constPool[index] = value as EncodedValue;
			continue;
		}
		if (valueIsString(value)) {
			constPool[index] = program.constPoolStringPool.toString(asStringId(value));
			continue;
		}
		throw new Error(`encodeProgram: unsupported constPool value at index ${index}`);
	}
	return constPool;
}

export function encodeProgramObjectSections(
	program: Program,
	staticModulePaths: string[],
	data: ProgramDataSection,
	bss: ProgramBssSection,
	rodataBytes: Uint8Array,
	rodataSymbols: ProgramRodataSymbol[],
): ProgramObjectSections {
	return {
		text: {
			code: program.code,
			protos: program.protos,
		},
		rodata: {
			constPool: encodeProgramRodataConstPool(program),
			moduleProtos: program.moduleProtos,
			moduleExports: program.moduleExports,
			staticModulePaths,
			bytes: rodataBytes,
			symbols: rodataSymbols,
		},
		data,
		bss,
	};
}

export function buildProgramRomImage(textCode: Uint8Array, rodataBytes: Uint8Array, dataBytes: Uint8Array): Uint8Array {
	const programRom = new Uint8Array(textCode.byteLength + rodataBytes.byteLength + dataBytes.byteLength);
	programRom.set(textCode, 0);
	programRom.set(rodataBytes, textCode.byteLength);
	programRom.set(dataBytes, textCode.byteLength + rodataBytes.byteLength);
	return programRom;
}

export function decodeProgramImage(bytes: Uint8Array): ProgramImage {
	const root = requireObject(decodeBinary(bytes), 'ProgramImage');
	const vectors = decodeProgramVectorTable(requireObjectKey(root, 'vectors', 'ProgramImage', 'ProgramImage.vectors'));
	const sections = decodeProgramObjectSections(requireObjectKey(root, 'sections', 'ProgramImage', 'ProgramImage.sections'));
	const link = decodeProgramLink(requireObjectKey(root, 'link', 'ProgramImage'));
	return {
		vectors,
		sections,
		link,
	};
}

function decodeProgramVectorTable(value: unknown): ProgramVectorTable {
	const vectors = requireObject(value, 'ProgramImage.vectors');
	return {
		resetProtoIndex: requireObjectKey(vectors, 'resetProtoIndex', 'ProgramImage.vectors', 'ProgramImage.vectors.resetProtoIndex') as number,
		sectionInitProtoIndex: requireObjectKey(vectors, 'sectionInitProtoIndex', 'ProgramImage.vectors', 'ProgramImage.vectors.sectionInitProtoIndex') as number,
		irqProtoIndex: requireObjectKey(vectors, 'irqProtoIndex', 'ProgramImage.vectors', 'ProgramImage.vectors.irqProtoIndex') as number,
	};
}

export function decodeProgramSymbolsImage(bytes: Uint8Array): ProgramSymbolsImage {
	const root = requireObject(decodeBinary(bytes), 'ProgramSymbolsImage');
	const metadata = requireObject(requireObjectKey(root, 'metadata', 'ProgramSymbolsImage', 'ProgramSymbolsImage.metadata'), 'ProgramSymbolsImage.metadata');
	requireObjectKey(metadata, 'debugRanges', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.debugRanges');
	requireObjectKey(metadata, 'protoIds', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.protoIds');
	requireObjectKey(metadata, 'localSlotsByProto', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.localSlotsByProto');
	requireObjectKey(metadata, 'upvalueNamesByProto', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.upvalueNamesByProto');
	requireObjectKey(metadata, 'globalNames', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.globalNames');
	requireObjectKey(metadata, 'systemGlobalNames', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.systemGlobalNames');
	requireObject(requireObjectKey(metadata, 'exportProtoIdBySlot', 'ProgramSymbolsImage.metadata', 'ProgramSymbolsImage.metadata.exportProtoIdBySlot'), 'ProgramSymbolsImage.metadata.exportProtoIdBySlot');
	return metadata as ProgramMetadata;
}

function decodeProgramObjectSections(value: unknown): ProgramObjectSections {
	const obj = requireObject(value, 'ProgramImage.sections');
	const text = requireObject(requireObjectKey(obj, 'text', 'ProgramImage.sections', 'ProgramImage.sections.text'), 'ProgramImage.sections.text');
	const rodata = requireObject(requireObjectKey(obj, 'rodata', 'ProgramImage.sections', 'ProgramImage.sections.rodata'), 'ProgramImage.sections.rodata');
	const data = requireObject(requireObjectKey(obj, 'data', 'ProgramImage.sections', 'ProgramImage.sections.data'), 'ProgramImage.sections.data');
	const bss = requireObject(requireObjectKey(obj, 'bss', 'ProgramImage.sections', 'ProgramImage.sections.bss'), 'ProgramImage.sections.bss');
	return {
		text: {
			code: requireObjectKey(text, 'code', 'ProgramImage.sections.text', 'ProgramImage.sections.text.code') as Uint8Array,
			protos: requireObjectKey(text, 'protos', 'ProgramImage.sections.text', 'ProgramImage.sections.text.protos') as Proto[],
		},
		rodata: {
			constPool: requireObjectKey(rodata, 'constPool', 'ProgramImage.sections.rodata', 'ProgramImage.sections.rodata.constPool') as EncodedValue[],
			moduleProtos: decodeModuleProtos(requireObjectKey(rodata, 'moduleProtos', 'ProgramImage.sections.rodata')),
			moduleExports: decodeModuleExports(requireObjectKey(rodata, 'moduleExports', 'ProgramImage.sections.rodata')),
			staticModulePaths: requireObjectKey(rodata, 'staticModulePaths', 'ProgramImage.sections.rodata', 'ProgramImage.sections.rodata.staticModulePaths') as string[],
			bytes: requireObjectKey(rodata, 'bytes', 'ProgramImage.sections.rodata', 'ProgramImage.sections.rodata.bytes') as Uint8Array,
				symbols: decodeStorageSymbols(requireObjectKey(rodata, 'symbols', 'ProgramImage.sections.rodata'), 'rodata'),
		},
		data: {
			bytes: requireObjectKey(data, 'bytes', 'ProgramImage.sections.data', 'ProgramImage.sections.data.bytes') as Uint8Array,
				symbols: decodeStorageSymbols(requireObjectKey(data, 'symbols', 'ProgramImage.sections.data'), 'data'),
		},
		bss: {
			byteCount: requireObjectKey(bss, 'byteCount', 'ProgramImage.sections.bss', 'ProgramImage.sections.bss.byteCount') as number,
				symbols: decodeStorageSymbols(requireObjectKey(bss, 'symbols', 'ProgramImage.sections.bss'), 'bss'),
		},
	};
}

function decodeStorageSymbols(value: unknown, sectionName: 'bss' | 'data' | 'rodata'): ProgramStorageSymbol[] {
	const array = value as [];
	const out: ProgramBssSymbol[] = new Array(array.length);
	for (let index = 0; index < array.length; index += 1) {
		const entryLabel = `ProgramImage.sections.${sectionName}.symbols[${index}]`;
		const entry = requireObject(array[index], entryLabel);
		out[index] = {
			name: requireObjectKey(entry, 'name', entryLabel, `${entryLabel}.name`) as string,
			offset: requireObjectKey(entry, 'offset', entryLabel, `${entryLabel}.offset`) as number,
			byteCount: requireObjectKey(entry, 'byteCount', entryLabel, `${entryLabel}.byteCount`) as number,
			alignment: requireObjectKey(entry, 'alignment', entryLabel, `${entryLabel}.alignment`) as number,
		};
	}
	return out;
}

function decodeModuleProtos(value: unknown): ProgramModuleProto[] {
	const array = value as [];
	const out: ProgramModuleProto[] = new Array(array.length);
	for (let index = 0; index < array.length; index += 1) {
		const entryLabel = `ProgramImage.sections.rodata.moduleProtos[${index}]`;
		const entry = requireObject(array[index], entryLabel);
		out[index] = {
			path: requireObjectKey(entry, 'path', entryLabel, `${entryLabel}.path`) as string,
			protoIndex: requireObjectKey(entry, 'protoIndex', entryLabel, `${entryLabel}.protoIndex`) as number,
		};
	}
	return out;
}

function decodeModuleExports(value: unknown): ProgramModuleExport[] {
	const array = value as [];
	const out: ProgramModuleExport[] = new Array(array.length);
	for (let index = 0; index < array.length; index += 1) {
		const entryLabel = `ProgramImage.sections.rodata.moduleExports[${index}]`;
		const entry = requireObject(array[index], entryLabel);
		out[index] = {
			path: requireObjectKey(entry, 'path', entryLabel, `${entryLabel}.path`) as string,
			exportPathKey: requireObjectKey(entry, 'exportPathKey', entryLabel, `${entryLabel}.exportPathKey`) as string,
			slotName: requireObjectKey(entry, 'slotName', entryLabel, `${entryLabel}.slotName`) as string,
		};
	}
	return out;
}

function decodeProgramLink(value: unknown): ProgramLink {
	const link = requireObject(value, 'ProgramImage.link');
	const relocValues = requireObjectKey(link, 'constRelocs', 'ProgramImage.link') as [];
	const constRelocs: ProgramConstReloc[] = new Array(relocValues.length);
	for (let index = 0; index < relocValues.length; index += 1) {
		const entry = requireObject(relocValues[index], `ProgramImage.link.constRelocs[${index}]`);
		const kind = requireObjectKey(entry, 'kind', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].kind`) as string;
		if (kind !== 'bx' && kind !== 'rk_b' && kind !== 'rk_c' && kind !== 'const_b' && kind !== 'const_c' && kind !== 'gl' && kind !== 'sys' && kind !== 'module' && kind !== 'export_proto') {
			throw new Error(`ProgramImage.link.constRelocs[${index}].kind must be 'bx', 'rk_b', 'rk_c', 'const_b', 'const_c', 'gl', 'sys', 'module' or 'export_proto'.`);
		}
		const wordIndex = requireObjectKey(entry, 'wordIndex', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].wordIndex`) as number;
		if (kind === 'module' || kind === 'export_proto') {
			constRelocs[index] = {
				wordIndex,
				kind,
				symbol: requireObjectKey(entry, 'symbol', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].symbol`) as string,
			};
			continue;
		}
		constRelocs[index] = {
			wordIndex,
			kind,
			constIndex: requireObjectKey(entry, 'constIndex', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].constIndex`) as number,
		};
	}
	const constValueRelocValues = requireObjectKey(link, 'constValueRelocs', 'ProgramImage.link') as [];
	const constValueRelocs: ProgramConstValueReloc[] = new Array(constValueRelocValues.length);
	for (let index = 0; index < constValueRelocValues.length; index += 1) {
		const entryLabel = `ProgramImage.link.constValueRelocs[${index}]`;
		const entry = requireObject(constValueRelocValues[index], entryLabel);
		const kind = requireObjectKey(entry, 'kind', entryLabel, `${entryLabel}.kind`) as string;
		if (kind !== 'bss_addr' && kind !== 'data_addr' && kind !== 'data_lma_addr' && kind !== 'rodata_addr') {
			throw new Error(`${entryLabel}.kind must be 'bss_addr', 'data_addr', 'data_lma_addr' or 'rodata_addr'.`);
		}
		constValueRelocs[index] = {
			constIndex: requireObjectKey(entry, 'constIndex', entryLabel, `${entryLabel}.constIndex`) as number,
			kind,
			symbol: requireObjectKey(entry, 'symbol', entryLabel, `${entryLabel}.symbol`) as string,
			addend: requireObjectKey(entry, 'addend', entryLabel, `${entryLabel}.addend`) as number,
		};
	}
	return {
		constRelocs,
		constValueRelocs,
		symbols: decodeProgramRuntimeSymbols(requireObjectKey(link, 'symbols', 'ProgramImage.link')),
	};
}

function decodeProgramRuntimeSymbols(value: unknown): ProgramRuntimeSymbols {
	const symbols = requireObject(value, 'ProgramImage.link.symbols');
	const exportProtoIdBySlot = requireObject(requireObjectKey(symbols, 'exportProtoIdBySlot', 'ProgramImage.link.symbols', 'ProgramImage.link.symbols.exportProtoIdBySlot'), 'ProgramImage.link.symbols.exportProtoIdBySlot') as ProgramRuntimeSymbols['exportProtoIdBySlot'];
	return {
		protoIds: requireObjectKey(symbols, 'protoIds', 'ProgramImage.link.symbols', 'ProgramImage.link.symbols.protoIds') as string[],
		globalNames: requireObjectKey(symbols, 'globalNames', 'ProgramImage.link.symbols', 'ProgramImage.link.symbols.globalNames') as string[],
		systemGlobalNames: requireObjectKey(symbols, 'systemGlobalNames', 'ProgramImage.link.symbols', 'ProgramImage.link.symbols.systemGlobalNames') as string[],
		exportProtoIdBySlot,
	};
}

export function inflateProgram(sections: ProgramObjectSections): Program {
	const stringPool = new StringPool();
	const constPool: Value[] = new Array(sections.rodata.constPool.length);
	for (let index = 0; index < sections.rodata.constPool.length; index += 1) {
		const value = sections.rodata.constPool[index];
		if (typeof value === 'string') {
			constPool[index] = StringValue.get(stringPool.intern(value));
			continue;
		}
		constPool[index] = value;
	}
	const moduleProtos = sections.rodata.moduleProtos;
	const moduleProtoMap = new Map<string, number>();
	for (let index = 0; index < moduleProtos.length; index += 1) {
		const entry = moduleProtos[index];
		moduleProtoMap.set(entry.path, entry.protoIndex);
	}
	return {
		code: sections.text.code,
		programRom: buildProgramRomImage(sections.text.code, sections.rodata.bytes, sections.data.bytes),
		programRomTextByteLength: sections.text.code.byteLength,
		constPool,
		protos: sections.text.protos,
		moduleProtos,
		moduleExports: sections.rodata.moduleExports,
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
