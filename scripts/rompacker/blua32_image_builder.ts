import { splitText } from '../../machine/ts/common/text_lines';
import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { resolveLuaEntryModuleIndex } from '../../toolchain/ts/lua/entry_module';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import type {
	Blua32BiosFunctionExport,
	Blua32BiosImports,
} from '../../toolchain/ts/rompack/blua32_bios_imports';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedCartBlua32Image,
	type LinkedBlua32Image,
	type LinkedSystemBlua32Image,
} from '../../toolchain/ts/rompack/blua32_linker';
import type {
	Blua32DiagnosticSource,
	Blua32DiagnosticSourceMap,
} from '../../toolchain/ts/rompack/blua32_diagnostics';

export type GeneratedLuaModule = {
	path: string;
	source: string;
};

type Blua32ImageBuildOptionsBase = {
	luaAssets: ReadonlyArray<RomAsset>;
	generatedLuaModules: ReadonlyArray<GeneratedLuaModule>;
	loadAddress: number;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
};

type SystemBlua32ImageBuildOptions = Blua32ImageBuildOptionsBase & {
	domain: 'system';
	biosExports: ReadonlyArray<Blua32BiosFunctionExport>;
};

type CartBlua32ImageBuildOptions = Blua32ImageBuildOptionsBase & {
	domain: 'cart';
	biosImports: Blua32BiosImports;
};

type Blua32ImageBuildOptions =
	| SystemBlua32ImageBuildOptions
	| CartBlua32ImageBuildOptions;

export type BuiltBlua32Image<TLinked extends LinkedBlua32Image = LinkedBlua32Image> = {
	linked: TLinked;
	diagnosticSources: Blua32DiagnosticSourceMap;
};

export function buildBlua32Image(options: SystemBlua32ImageBuildOptions): BuiltBlua32Image<LinkedSystemBlua32Image>;
export function buildBlua32Image(options: CartBlua32ImageBuildOptions): BuiltBlua32Image<LinkedCartBlua32Image>;
export function buildBlua32Image(options: Blua32ImageBuildOptions): BuiltBlua32Image {
	const modulePaths = new Set<string>();
	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	const diagnosticSources = new Map<string, Blua32DiagnosticSource>();
	for (let index = 0; index < options.luaAssets.length; index += 1) {
		const asset = options.luaAssets[index];
		const modulePath = toLuaModulePath(asset.source_path);
		if (modulePaths.has(modulePath)) {
			throw new Error(`ROM Lua module '${modulePath}' is defined more than once.`);
		}
		const chunk = decodeBinary(asset.compiled_buffer!) as LuaChunk;
		modulePaths.add(modulePath);
		const source = asset.buffer!.toString('utf8');
		diagnosticSources.set(chunk.range.path, {
			displayPath: asset.source_path,
			source,
		});
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
		const chunk = parseLuaChunk(generated.source, generated.path, splitText(generated.source)).chunk!;
		modulePaths.add(generated.path);
		modules.push({ path: generated.path, chunk, source: generated.source });
		diagnosticSources.set(chunk.range.path, {
			displayPath: sourcePath,
			source: generated.source,
		});
	}

	if (options.domain === 'cart') {
		const compiled = compileLuaChunkToProgram(entry.chunk, modules, {
			optLevel: options.optLevel,
			entrySource: entry.source,
			biosFunctions: options.biosImports.functions,
			programDomain: 'cart',
		});
		return {
			linked: linkCartBlua32Image(
				options.biosImports,
				encodeCompiledProgramObject(compiled),
				compiled.metadata,
				options.loadAddress,
				options.ramByteCount,
			),
			diagnosticSources,
		};
	}
	const compiled = compileLuaChunkToProgram(entry.chunk, modules, {
		optLevel: options.optLevel,
		entrySource: entry.source,
		programDomain: 'system',
	});
	return {
		linked: linkSystemBlua32Image(
			encodeCompiledProgramObject(compiled),
			compiled.metadata,
			options.loadAddress,
			options.ramByteCount,
			options.biosExports,
		),
		diagnosticSources,
	};
}
