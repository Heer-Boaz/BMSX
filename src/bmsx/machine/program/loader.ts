import { decodeBinary, requireObject, requireObjectKey } from '../../common/serializer/binencoder';
import { asStringId, valueIsString, valueString, type Program, type ProgramMetadata, type Proto, type Value } from '../cpu/cpu';
import { StringPool } from '../cpu/string_pool';

// disable-next-line legacy_sentinel_string_pattern -- Program image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_IMAGE_ID = '__program__';
// disable-next-line legacy_sentinel_string_pattern -- Program symbols image id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_SYMBOLS_IMAGE_ID = '__program_symbols__';
export const PROGRAM_BOOT_HEADER_VERSION = 1;

export type EncodedValue = null | boolean | number | string;

export type EncodedProgram = {
	code: Uint8Array;
	constPool: EncodedValue[];
	protos: Proto[];
};

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

export type ProgramSymbolsImage = {
	metadata: ProgramMetadata;
};

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

export function encodeProgram(program: Program): EncodedProgram {
	return {
		code: program.code,
		constPool: encodeProgramRodataConstPool(program),
		protos: program.protos,
	};
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

export function encodedProgramFromSections(sections: ProgramObjectSections): EncodedProgram {
	return {
		code: sections.text.code,
		constPool: sections.rodata.constPool,
		protos: sections.text.protos,
	};
}

export function inflateProgram(sections: ProgramObjectSections): Program {
	const encoded = encodedProgramFromSections(sections);
	const stringPool = new StringPool();
	const constPool: Value[] = new Array(encoded.constPool.length);
	for (let index = 0; index < encoded.constPool.length; index += 1) {
		const value = encoded.constPool[index];
		if (typeof value === 'string') {
			constPool[index] = valueString(stringPool.intern(value));
			continue;
		}
		constPool[index] = value;
	}
	return {
		code: encoded.code,
		constPool,
		protos: encoded.protos,
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

const BIOS_RES_PREFIX = 'res/';
const BIOS_SYSTEM_RES_PREFIX = 'src/bmsx/res/';

export function toLuaModulePath(sourcePath: string): string {
	const path = stripLuaExtension(sourcePath);
	if (path.startsWith(BIOS_SYSTEM_RES_PREFIX)) {
		return path.substring(BIOS_SYSTEM_RES_PREFIX.length);
	}
	if (path.startsWith(BIOS_RES_PREFIX)) {
		return path.substring(BIOS_RES_PREFIX.length);
	}
	return path;
}
