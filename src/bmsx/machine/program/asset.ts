import { decodeBinary, encodeBinary, requireObject, requireObjectKey } from '../../common/serializer/binencoder';
import type { Program, ProgramMetadata, Proto, Value } from '../cpu/cpu';
import { StringPool, isStringValue, stringValueToString } from '../memory/string/pool';

// disable-next-line legacy_sentinel_string_pattern -- Program asset id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_ASSET_ID = '__program__';
// disable-next-line legacy_sentinel_string_pattern -- Program symbols asset id is a TS/C++/bootrom binary contract, not an alias fallback.
export const PROGRAM_SYMBOLS_ASSET_ID = '__program_symbols__';
export const PROGRAM_BOOT_HEADER_VERSION = 1;
export const PROGRAM_BOOT_FLAG_HAS_BIOS_ENGINE_ALIAS = 1 << 0;

export type EncodedValue = null | boolean | number | string;

export type EncodedProgram = {
	code: Uint8Array;
	constPool: EncodedValue[];
	protos: Proto[];
};

export type EncodedProgramMetadata = ProgramMetadata;

export type ProgramConstRelocKind = 'bx' | 'rk_b' | 'rk_c' | 'const_b' | 'const_c' | 'gl' | 'sys';

export type ProgramConstReloc = {
	wordIndex: number;
	kind: ProgramConstRelocKind;
	constIndex: number;
};

export type ProgramLink = {
	constRelocs: ProgramConstReloc[];
};

export type ProgramAsset = {
	entryProtoIndex: number;
	program: EncodedProgram;
	moduleProtos: Array<{ path: string; protoIndex: number }>;
	moduleAliases: Array<{ alias: string; path: string }>;
	link: ProgramLink;
};

export type ProgramSymbolsAsset = {
	metadata: EncodedProgramMetadata;
};

export type ProgramBootHeader = {
	version: number;
	flags: number;
	entryProtoIndex: number;
	codeByteCount: number;
	constPoolCount: number;
	protoCount: number;
	moduleAliasCount: number;
	constRelocCount: number;
};

export function encodeProgram(program: Program): EncodedProgram {
	const constPool: EncodedValue[] = new Array(program.constPool.length);
	for (let index = 0; index < program.constPool.length; index += 1) {
		const value = program.constPool[index];
		if (value === null || typeof value === 'number' || typeof value === 'boolean') {
			constPool[index] = value as EncodedValue;
			continue;
		}
		if (isStringValue(value)) {
			constPool[index] = stringValueToString(value);
			continue;
		}
		throw new Error(`encodeProgram: unsupported constPool value at index ${index}`);
	}
	return {
		code: program.code,
		constPool,
		protos: program.protos,
	};
}

export function encodeProgramAsset(asset: ProgramAsset): Uint8Array {
	return encodeBinary(asset);
}

export function decodeProgramAsset(bytes: Uint8Array): ProgramAsset {
	const root = requireObject(decodeBinary(bytes), 'ProgramAsset');
	const entryProtoIndex = requireNumber(requireObjectKey(root, 'entryProtoIndex', 'ProgramAsset'), 'ProgramAsset.entryProtoIndex');
	const program = decodeEncodedProgram(requireObjectKey(root, 'program', 'ProgramAsset'));
	const moduleProtos = decodeModuleProtos(requireObjectKey(root, 'moduleProtos', 'ProgramAsset'));
	const moduleAliases = decodeModuleAliases(requireObjectKey(root, 'moduleAliases', 'ProgramAsset'));
	const link = decodeProgramLink(requireObjectKey(root, 'link', 'ProgramAsset'));
	return {
		entryProtoIndex,
		program,
		moduleProtos,
		moduleAliases,
		link,
	};
}

export function encodeProgramSymbolsAsset(asset: ProgramSymbolsAsset): Uint8Array {
	return encodeBinary(asset);
}

export function decodeProgramSymbolsAsset(bytes: Uint8Array): ProgramSymbolsAsset {
	return decodeBinary(bytes) as ProgramSymbolsAsset;
}

export function buildProgramBootHeader(asset: ProgramAsset): ProgramBootHeader {
	let flags = 0;
	for (let index = 0; index < asset.moduleAliases.length; index += 1) {
		if (asset.moduleAliases[index].alias === 'bios/engine') {
			flags |= PROGRAM_BOOT_FLAG_HAS_BIOS_ENGINE_ALIAS;
			break;
		}
	}
	return {
		version: PROGRAM_BOOT_HEADER_VERSION,
		flags,
		entryProtoIndex: asset.entryProtoIndex,
		codeByteCount: asset.program.code.length,
		constPoolCount: asset.program.constPool.length,
		protoCount: asset.program.protos.length,
		moduleAliasCount: asset.moduleAliases.length,
		constRelocCount: asset.link.constRelocs.length,
	};
}

function requireNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number.`);
	}
	return value;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new Error(`${label} must be a string.`);
	}
	return value;
}

function requireArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array.`);
	}
	return value;
}

function requireUint8Array(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array)) {
		throw new Error(`${label} must be Uint8Array.`);
	}
	return value;
}

function decodeEncodedProgram(value: unknown): EncodedProgram {
	const obj = requireObject(value, 'ProgramAsset.program');
	return {
		code: requireUint8Array(requireObjectKey(obj, 'code', 'ProgramAsset.program'), 'ProgramAsset.program.code'),
		constPool: requireArray(requireObjectKey(obj, 'constPool', 'ProgramAsset.program'), 'ProgramAsset.program.constPool') as EncodedValue[],
		protos: requireArray(requireObjectKey(obj, 'protos', 'ProgramAsset.program'), 'ProgramAsset.program.protos') as Proto[],
	};
}

function decodeModuleProtos(value: unknown): Array<{ path: string; protoIndex: number }> {
	const array = requireArray(value, 'ProgramAsset.moduleProtos');
	const out: Array<{ path: string; protoIndex: number }> = new Array(array.length);
	for (let index = 0; index < array.length; index += 1) {
		const entry = requireObject(array[index], `ProgramAsset.moduleProtos[${index}]`);
		out[index] = {
			path: requireString(requireObjectKey(entry, 'path', `ProgramAsset.moduleProtos[${index}]`), `ProgramAsset.moduleProtos[${index}].path`),
			protoIndex: requireNumber(requireObjectKey(entry, 'protoIndex', `ProgramAsset.moduleProtos[${index}]`), `ProgramAsset.moduleProtos[${index}].protoIndex`),
		};
	}
	return out;
}

function decodeModuleAliases(value: unknown): Array<{ alias: string; path: string }> {
	const array = requireArray(value, 'ProgramAsset.moduleAliases');
	const out: Array<{ alias: string; path: string }> = new Array(array.length);
	for (let index = 0; index < array.length; index += 1) {
		const entry = requireObject(array[index], `ProgramAsset.moduleAliases[${index}]`);
		out[index] = {
			alias: requireString(requireObjectKey(entry, 'alias', `ProgramAsset.moduleAliases[${index}]`), `ProgramAsset.moduleAliases[${index}].alias`),
			path: requireString(requireObjectKey(entry, 'path', `ProgramAsset.moduleAliases[${index}]`), `ProgramAsset.moduleAliases[${index}].path`),
		};
	}
	return out;
}

function decodeProgramLink(value: unknown): ProgramLink {
	const link = requireObject(value, 'ProgramAsset.link');
	const relocValues = requireArray(requireObjectKey(link, 'constRelocs', 'ProgramAsset.link'), 'ProgramAsset.link.constRelocs');
	const constRelocs: ProgramConstReloc[] = new Array(relocValues.length);
	for (let index = 0; index < relocValues.length; index += 1) {
		const entry = requireObject(relocValues[index], `ProgramAsset.link.constRelocs[${index}]`);
		const kind = requireString(requireObjectKey(entry, 'kind', `ProgramAsset.link.constRelocs[${index}]`), `ProgramAsset.link.constRelocs[${index}].kind`);
		if (kind !== 'bx' && kind !== 'rk_b' && kind !== 'rk_c' && kind !== 'const_b' && kind !== 'const_c' && kind !== 'gl' && kind !== 'sys') {
			throw new Error(`ProgramAsset.link.constRelocs[${index}].kind must be 'bx', 'rk_b', 'rk_c', 'const_b', 'const_c', 'gl', 'sys'.`);
		}
		constRelocs[index] = {
			wordIndex: requireNumber(requireObjectKey(entry, 'wordIndex', `ProgramAsset.link.constRelocs[${index}]`), `ProgramAsset.link.constRelocs[${index}].wordIndex`),
			kind,
			constIndex: requireNumber(requireObjectKey(entry, 'constIndex', `ProgramAsset.link.constRelocs[${index}]`), `ProgramAsset.link.constRelocs[${index}].constIndex`),
		};
	}
	return { constRelocs };
}

export function inflateProgram(encoded: EncodedProgram): Program {
	const stringPool = new StringPool();
	const constPool: Value[] = new Array(encoded.constPool.length);
	for (let index = 0; index < encoded.constPool.length; index += 1) {
		const value = encoded.constPool[index];
		if (typeof value === 'string') {
			constPool[index] = stringPool.intern(value);
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

export function buildModuleAliasMap(entries: ReadonlyArray<{ alias: string; path: string }>): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of entries) {
		if (!map.has(entry.alias)) {
			map.set(entry.alias, entry.path);
		}
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

function baseModuleName(path: string): string {
	const index = path.lastIndexOf('/');
	const name = index >= 0 ? path.slice(index + 1) : path;
	return stripLuaExtension(name);
}

function registerAlias(aliases: Map<string, string>, alias: string, path: string): void {
	if (!alias || alias.length === 0) {
		return;
	}
	if (!aliases.has(alias)) {
		aliases.set(alias, path);
	}
}

const BIOS_RES_PREFIX = 'res/';
const BIOS_ENGINE_RES_PREFIX = 'src/bmsx/res/';

function makeEngineCompactPath(path: string): string | null {
	if (path.startsWith(BIOS_ENGINE_RES_PREFIX)) {
		return path.substring(BIOS_ENGINE_RES_PREFIX.length);
	}
	if (path.startsWith(BIOS_RES_PREFIX)) {
		return path.substring(BIOS_RES_PREFIX.length);
	}
	return null;
}

function registerModuleAliases(aliases: Map<string, string>, path: string): void {
	const pathWithoutExt = stripLuaExtension(path);
	const compactPath = makeEngineCompactPath(pathWithoutExt);
	const isEngineResource = compactPath !== null;

	registerAlias(aliases, path, path);
	if (pathWithoutExt !== path) {
		registerAlias(aliases, pathWithoutExt, path);
	}
	const aliasWithLua = path.endsWith('.lua') ? `${pathWithoutExt}.lua` : `${path}.lua`;
	registerAlias(aliases, aliasWithLua, path);
	if (compactPath !== null) {
		registerAlias(aliases, compactPath, path);
		registerAlias(aliases, `${compactPath}.lua`, path);
		if (compactPath.startsWith('bios/')) {
			const biosRelativePath = compactPath.slice('bios/'.length);
			registerAlias(aliases, biosRelativePath, path);
			registerAlias(aliases, `${biosRelativePath}.lua`, path);
		}
	}
	const dotted = pathWithoutExt.replace(/\//g, '.');
	registerAlias(aliases, dotted, path);
	registerAlias(aliases, `${dotted}.lua`, path);

	if (isEngineResource) {
		const base = baseModuleName(pathWithoutExt);
		registerAlias(aliases, base, path);
		registerAlias(aliases, `${base}.lua`, path);
		const baseDots = base.replace(/\//g, '.');
		registerAlias(aliases, baseDots, path);
		registerAlias(aliases, `${baseDots}.lua`, path);
	}
}

export function buildModuleAliasesFromPaths(paths: ReadonlyArray<string>): Array<{ alias: string; path: string }> {
	const aliases = new Map<string, string>();
	for (const path of paths) {
		registerModuleAliases(aliases, path);
	}
	return Array.from(aliases, ([alias, path]) => ({ alias, path }));
}
