import { decodeBinary, encodeBinary, typedArrayFromBytes } from '../serializer/binencoder';
import type { Program, Proto, SourceRange, Value } from './cpu';

export const VM_PROGRAM_ASSET_ID = '__vm_program__';

export type EncodedProgram = {
	code: Uint8Array;
	constPool: Value[];
	protos: Proto[];
	debugRanges: ReadonlyArray<SourceRange | null>;
	protoIds: string[];
};

export type VmProgramAsset = {
	entryProtoIndex: number;
	program: EncodedProgram;
	moduleProtos: Array<{ path: string; protoIndex: number }>;
	moduleAliases: Array<{ alias: string; path: string }>;
};

export function encodeProgramAsset(asset: VmProgramAsset): Uint8Array {
	return encodeBinary(asset);
}

export function decodeProgramAsset(bytes: Uint8Array): VmProgramAsset {
	return decodeBinary(bytes) as VmProgramAsset;
}

export function inflateProgram(encoded: EncodedProgram): Program {
	return {
		code: typedArrayFromBytes(encoded.code, Uint32Array),
		constPool: encoded.constPool,
		protos: encoded.protos,
		debugRanges: encoded.debugRanges,
		protoIds: encoded.protoIds,
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
