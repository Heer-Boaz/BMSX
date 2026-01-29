import { decodeBinary, encodeBinary } from '../serializer/binencoder';
import type { Program, ProgramMetadata, Proto, Value } from './cpu';
import { StringPool, isStringValue, stringValueToString } from './string_pool';

export const PROGRAM_ASSET_ID = '__program__';
export const PROGRAM_SYMBOLS_ASSET_ID = '__program_symbols__';

export type EncodedValue = null | boolean | number | string;

export type EncodedProgram = {
	code: Uint8Array;
	constPool: EncodedValue[];
	protos: Proto[];
};

export type EncodedProgramMetadata = ProgramMetadata;

export type ProgramAsset = {
	entryProtoIndex: number;
	program: EncodedProgram;
	moduleProtos: Array<{ path: string; protoIndex: number }>;
	moduleAliases: Array<{ alias: string; path: string }>;
};

export type ProgramSymbolsAsset = {
	metadata: EncodedProgramMetadata;
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
	return decodeBinary(bytes) as ProgramAsset;
}

export function encodeProgramSymbolsAsset(asset: ProgramSymbolsAsset): Uint8Array {
	return encodeBinary(asset);
}

export function decodeProgramSymbolsAsset(bytes: Uint8Array): ProgramSymbolsAsset {
	return decodeBinary(bytes) as ProgramSymbolsAsset;
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

function stripLuaExtension(candidate: string): string {
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

function registerModuleAliases(aliases: Map<string, string>, path: string): void {
	registerAlias(aliases, path, path);
	registerAlias(aliases, `${path}.lua`, path);
	const dotted = path.replace(/\//g, '.');
	registerAlias(aliases, dotted, path);
	registerAlias(aliases, `${dotted}.lua`, path);

	const base = baseModuleName(path);
	registerAlias(aliases, base, path);
	registerAlias(aliases, `${base}.lua`, path);
	const baseDots = base.replace(/\//g, '.');
	registerAlias(aliases, baseDots, path);
	registerAlias(aliases, `${baseDots}.lua`, path);
}

export function buildModuleAliasesFromPaths(paths: ReadonlyArray<string>): Array<{ alias: string; path: string }> {
	const aliases = new Map<string, string>();
	for (const path of paths) {
		registerModuleAliases(aliases, path);
	}
	return Array.from(aliases, ([alias, path]) => ({ alias, path }));
}
