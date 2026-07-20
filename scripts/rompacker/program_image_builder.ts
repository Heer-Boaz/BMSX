import { splitText } from '../../machine/ts/common/text_lines';
import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../../machine/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../machine/ts/lua/compiler';
import type { LuaChunk } from '../../machine/ts/lua/syntax/ast';
import { toLuaModulePath, type ProgramImage, type ProgramSymbolsImage } from '../../machine/ts/machine/program/loader';
import type { RomAsset } from '../../machine/ts/rompack/format';
import { linkCartProgramImage, linkSystemProgramImage, type LinkedProgramImage } from '../../machine/ts/rompack/tooling/program_linker';

export type GeneratedProgramModule = {
	path: string;
	source: string;
};

type ProgramImageBuildOptions = {
	luaAssets: ReadonlyArray<RomAsset>;
	externalLuaAssets: ReadonlyArray<RomAsset>;
	generatedLuaModules: ReadonlyArray<GeneratedProgramModule>;
	entryPath: string;
	loadAddress: number;
	optLevel: 0 | 1 | 2 | 3;
} & (
	| { programDomain: 'system' }
	| {
		programDomain: 'cart';
		systemProgram: { image: ProgramImage; metadata: ProgramSymbolsImage | null };
	}
);

export function buildProgramImage(options: ProgramImageBuildOptions): LinkedProgramImage {
	const entryModulePath = toLuaModulePath(options.entryPath);
	const modulePaths = new Set<string>();
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	let entry: { chunk: LuaChunk; source: string } | null = null;
	for (let index = 0; index < options.luaAssets.length; index += 1) {
		const asset = options.luaAssets[index];
		const modulePath = toLuaModulePath(asset.source_path);
		if (modulePaths.has(modulePath)) {
			throw new Error(`[RomPacker] ROM Lua module '${modulePath}' is defined more than once.`);
		}
		const chunk = decodeBinary(asset.compiled_buffer!) as LuaChunk;
		modulePaths.add(modulePath);
		const source = asset.buffer!.toString('utf8');
		if (modulePath === entryModulePath) {
			entry = { chunk, source };
			continue;
		}
		modules.push({
			path: modulePath,
			chunk,
			source,
		});
	}
	if (entry === null) {
		throw new Error(`[RomPacker] Lua entry '${options.entryPath}' not found in asset list.`);
	}
	for (let index = 0; index < options.generatedLuaModules.length; index += 1) {
		const generated = options.generatedLuaModules[index];
		if (modulePaths.has(generated.path)) {
			throw new Error(`[RomPacker] Generated Lua module '${generated.path}' conflicts with a ROM Lua asset.`);
		}
		const sourcePath = `${generated.path}.lua`;
		const chunk = parseLuaChunk(generated.source, sourcePath, splitText(generated.source)).chunk!;
		modulePaths.add(generated.path);
		modules.push({ path: generated.path, chunk, source: generated.source });
	}

	const externalModules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	for (let index = 0; index < options.externalLuaAssets.length; index += 1) {
		const asset = options.externalLuaAssets[index];
		const modulePath = toLuaModulePath(asset.source_path);
		if (modulePaths.has(modulePath)) {
			continue;
		}
		externalModules.push({
			path: modulePath,
			chunk: decodeBinary(asset.compiled_buffer!) as LuaChunk,
			source: asset.buffer!.toString('utf8'),
		});
	}

	const compiled = compileLuaChunkToProgram(entry.chunk, modules, {
		optLevel: options.optLevel,
		entrySource: entry.source,
		externalModules,
		programDomain: options.programDomain,
	});
	const object = encodeCompiledProgramObject(compiled);
	return options.programDomain === 'cart'
		? linkCartProgramImage(options.systemProgram.image, options.systemProgram.metadata, object, compiled.metadata, options.loadAddress)
		: linkSystemProgramImage(object, compiled.metadata, options.loadAddress);
}
