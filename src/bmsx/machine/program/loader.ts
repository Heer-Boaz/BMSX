import { decodeBinary, encodeBinary, requireObject, requireObjectKey } from '../../common/serializer/binencoder';
import { StringValue, asStringId, valueIsString, type Program, type ProgramMetadata, type Proto, type Value } from '../cpu/cpu';
import { StringPool } from '../cpu/string_pool';

// disable-next-line legacy_sentinel_string_pattern -- Program image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_IMAGE_ID = '__program__';
// disable-next-line legacy_sentinel_string_pattern -- Program symbols image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_SYMBOLS_IMAGE_ID = '__program_symbols__';
export const PROGRAM_BOOT_HEADER_VERSION = 1;

export type EncodedValue = null | boolean | number | string;

export type ProgramTextSection = {
	code: Uint8Array;
	protos: Proto[];
};

export type ProgramRodataSection = {
	constPool: EncodedValue[];
	moduleProtos: Array<{ path: string; protoIndex: number }>;
	staticModulePaths: string[];
};

export type ProgramDataSection = {
	bytes: Uint8Array;
};

export type ProgramBssSection = {
	byteCount: number;
};

export type ProgramObjectSections = {
	text: ProgramTextSection;
	rodata: ProgramRodataSection;
	data: ProgramDataSection;
	bss: ProgramBssSection;
};

export type ProgramConstRelocKind = 'bx' | 'rk_b' | 'rk_c' | 'const_b' | 'const_c' | 'gl' | 'sys' | 'module';

export type ProgramConstReloc = {
	wordIndex: number;
	kind: ProgramConstRelocKind;
	constIndex: number;
};

export type ProgramLink = {
	constRelocs: ProgramConstReloc[];
};

export type ProgramImage = {
	entryProtoIndex: number;
	sections: ProgramObjectSections;
	link: ProgramLink;
};

export type ProgramSymbolsImage = ProgramMetadata;

export type ProgramBootHeader = {
	version: number;
	flags: number;
	entryProtoIndex: number;
	codeByteCount: number;
	constPoolCount: number;
	protoCount: number;
	constRelocCount: number;
};

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
	moduleProtos: Array<{ path: string; protoIndex: number }>,
	staticModulePaths: string[],
): ProgramObjectSections {
	return {
		text: {
			code: program.code,
			protos: program.protos,
		},
		rodata: {
			constPool: encodeProgramRodataConstPool(program),
			moduleProtos,
			staticModulePaths,
		},
		data: { bytes: new Uint8Array(0) },
		bss: { byteCount: 0 },
	};
}

export function decodeProgramImage(bytes: Uint8Array): ProgramImage {
	const root = requireObject(decodeBinary(bytes), 'ProgramImage');
	const entryProtoIndex = requireObjectKey(root, 'entryProtoIndex', 'ProgramImage', 'ProgramImage.entryProtoIndex') as number;
	const sections = decodeProgramObjectSections(requireObjectKey(root, 'sections', 'ProgramImage', 'ProgramImage.sections'));
	const link = decodeProgramLink(requireObjectKey(root, 'link', 'ProgramImage'));
	return {
		entryProtoIndex,
		sections,
		link,
	};
}

// disable-next-line single_line_method_pattern -- ProgramImage binary encoding is owned by the program loader/producer boundary.
export function encodeProgramImage(asset: ProgramImage): Uint8Array {
	return encodeBinary(asset);
}

export function decodeProgramSymbolsImage(bytes: Uint8Array): ProgramSymbolsImage {
	const root = requireObject(decodeBinary(bytes), 'ProgramSymbolsImage');
	return requireObjectKey(root, 'metadata', 'ProgramSymbolsImage', 'ProgramSymbolsImage.metadata') as ProgramMetadata;
}

export function buildProgramBootHeader(asset: ProgramImage): ProgramBootHeader {
	return {
		version: PROGRAM_BOOT_HEADER_VERSION,
		flags: 0,
		entryProtoIndex: asset.entryProtoIndex,
		codeByteCount: asset.sections.text.code.length,
		constPoolCount: asset.sections.rodata.constPool.length,
		protoCount: asset.sections.text.protos.length,
		constRelocCount: asset.link.constRelocs.length,
	};
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
			staticModulePaths: requireObjectKey(rodata, 'staticModulePaths', 'ProgramImage.sections.rodata', 'ProgramImage.sections.rodata.staticModulePaths') as string[],
		},
		data: {
			bytes: requireObjectKey(data, 'bytes', 'ProgramImage.sections.data', 'ProgramImage.sections.data.bytes') as Uint8Array,
		},
		bss: {
			byteCount: requireObjectKey(bss, 'byteCount', 'ProgramImage.sections.bss', 'ProgramImage.sections.bss.byteCount') as number,
		},
	};
}

function decodeModuleProtos(value: unknown): Array<{ path: string; protoIndex: number }> {
	const array = value as [];
	const out: Array<{ path: string; protoIndex: number }> = new Array(array.length);
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

function decodeProgramLink(value: unknown): ProgramLink {
	const link = requireObject(value, 'ProgramImage.link');
	const relocValues = requireObjectKey(link, 'constRelocs', 'ProgramImage.link') as [];
	const constRelocs: ProgramConstReloc[] = new Array(relocValues.length);
	for (let index = 0; index < relocValues.length; index += 1) {
		const entry = requireObject(relocValues[index], `ProgramImage.link.constRelocs[${index}]`);
		const kind = requireObjectKey(entry, 'kind', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].kind`) as string;
		if (kind !== 'bx' && kind !== 'rk_b' && kind !== 'rk_c' && kind !== 'const_b' && kind !== 'const_c' && kind !== 'gl' && kind !== 'sys' && kind !== 'module') {
			throw new Error(`ProgramImage.link.constRelocs[${index}].kind must be 'bx', 'rk_b', 'rk_c', 'const_b', 'const_c', 'gl', 'sys' or 'module'.`);
		}
		constRelocs[index] = {
			wordIndex: requireObjectKey(entry, 'wordIndex', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].wordIndex`) as number,
			kind,
			constIndex: requireObjectKey(entry, 'constIndex', `ProgramImage.link.constRelocs[${index}]`, `ProgramImage.link.constRelocs[${index}].constIndex`) as number,
		};
	}
	return { constRelocs };
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
	return {
		code: sections.text.code,
		constPool,
		protos: sections.text.protos,
		stringPool,
		constPoolStringPool: stringPool,
	};
}

export function buildModuleProtoMap(entries: ReadonlyArray<{ path: string; protoIndex: number }>): Map<string, number> {
	const map = new Map<string, number>();
	for (const entry of entries) {
		map.set(entry.path, entry.protoIndex);
	}
	return map;
}

export function stripLuaExtension(candidate: string): string {
	const lower = candidate.toLowerCase();
	if (lower.endsWith('.lua')) {
		return candidate.slice(0, candidate.length - 4);
	}
	return candidate;
}

const CART_SOURCE_PREFIX = 'src/carts/';
const ENGINE_RESOURCE_SOURCE_PREFIX = 'src/bmsx/res/';
const RESOURCE_SOURCE_PREFIX = 'res/';
const MODULE_PATH_SOURCE_PREFIXES = [
	ENGINE_RESOURCE_SOURCE_PREFIX,
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
