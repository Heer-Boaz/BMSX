import { splitText } from '../../machine/ts/common/text_lines';
import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../../machine/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../machine/ts/lua/compiler';
import { resolveLuaEntryModuleIndex } from '../../machine/ts/lua/entry_module';
import type { LuaChunk } from '../../machine/ts/lua/syntax/ast';
import { toLuaModulePath } from '../../machine/ts/lua/module_path';
import type { Blua32ImageLayout } from '../../machine/ts/rompack/tooling/blua32_image';
import type { Blua32SymbolsImage } from '../../machine/ts/rompack/tooling/blua32_symbols';
import type { RomAsset } from '../../machine/ts/rompack/tooling/assets';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedBlua32Image,
} from '../../machine/ts/rompack/tooling/blua32_linker';

export type GeneratedLuaModule = {
	path: string;
	source: string;
};

type Blua32ImageBuildOptions = {
	luaAssets: ReadonlyArray<RomAsset>;
	externalLuaAssets: ReadonlyArray<RomAsset>;
	generatedLuaModules: ReadonlyArray<GeneratedLuaModule>;
	loadAddress: number;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
} & (
	| { domain: 'system' }
	| {
		domain: 'cart';
		systemImage: Blua32ImageLayout;
		systemSymbols: Blua32SymbolsImage;
	}
);

export function buildBlua32Image(options: Blua32ImageBuildOptions): LinkedBlua32Image {
	const modulePaths = new Set<string>();
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	for (let index = 0; index < options.luaAssets.length; index += 1) {
		const asset = options.luaAssets[index];
		const modulePath = toLuaModulePath(asset.source_path);
		if (modulePaths.has(modulePath)) {
			throw new Error(`ROM Lua module '${modulePath}' is defined more than once.`);
		}
		const chunk = decodeBinary(asset.compiled_buffer!) as LuaChunk;
		modulePaths.add(modulePath);
		const source = asset.buffer!.toString('utf8');
		modules.push({
			path: modulePath,
			chunk,
			source,
		});
	}
	const entryIndex = resolveLuaEntryModuleIndex(modules);
	const entry = modules[entryIndex];
	for (let index = entryIndex; index + 1 < modules.length; index += 1) {
		modules[index] = modules[index + 1];
	}
	modules.length -= 1;
	for (let index = 0; index < options.generatedLuaModules.length; index += 1) {
		const generated = options.generatedLuaModules[index];
		if (modulePaths.has(generated.path)) {
			throw new Error(`Generated Lua module '${generated.path}' conflicts with a ROM Lua asset.`);
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
		programDomain: options.domain,
	});
	const object = encodeCompiledProgramObject(compiled);
	return options.domain === 'cart'
		? linkCartBlua32Image(
			options.systemImage,
			options.systemSymbols,
			object,
			compiled.metadata,
			options.loadAddress,
			options.ramByteCount,
		)
		: linkSystemBlua32Image(
			object,
			compiled.metadata,
			options.loadAddress,
			options.ramByteCount,
		);
}
