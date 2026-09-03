import {
	decodeBinary,
	utf8FatalDecoder,
} from '../../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../lua/compiler';
import type { ProgramObjectImage } from '../lua/compiler/program_object';
import { resolveLuaEntryModuleIndex } from '../lua/entry_module';
import type { LuaChunk } from '../lua/syntax/ast';
import { toLuaModulePath } from '../lua/module_path';
import type {
	Blua32BiosFunctionExport,
	Blua32BiosImports,
} from './blua32_bios_imports';
import type { RomAsset } from './assets';
import {
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type LinkedCartBlua32Image,
	type LinkedBlua32Image,
	type LinkedSystemBlua32Image,
} from './blua32_linker';
import type {
	Blua32DiagnosticSource,
	Blua32DiagnosticSourceMap,
} from './blua32_diagnostics';
import {
	mapLuaSourcePosition,
	type ComposedLuaSource,
	type LuaSourceMap,
} from '../lua/compiler/source_map';
import { LuaSyntaxError } from '../lua/errors';
import type { TraceStatementMode } from '../lua/compiler/trace_statement';

export type GeneratedLuaModule = {
	path: string;
	source: string;
	sourceMap?: LuaSourceMap;
	linkValues?: ReadonlyMap<string, number>;
};

type Blua32ImageBuildOptionsBase = {
	luaAssets: ReadonlyArray<RomAsset>;
	generatedLuaModules: ReadonlyArray<GeneratedLuaModule>;
	entryComposition?: ComposedLuaSource;
	loadAddress: number;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
	traceStatements: TraceStatementMode;
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
	object: ProgramObjectImage;
	diagnosticSources: Blua32DiagnosticSourceMap;
};

function parseMappedLuaChunk(
	source: string,
	path: string,
	sourceMaps: ReadonlyMap<string, LuaSourceMap>,
): LuaChunk {
	try {
		return parseLuaChunk(source, path).chunk!;
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) {
			throw error;
		}
		const mapped = mapLuaSourcePosition(
			sourceMaps,
			error.path,
			{ line: error.line, column: error.column },
		);
		throw new LuaSyntaxError(error.message, mapped.displayPath, mapped.line, mapped.column);
	}
}

export function buildBlua32Image(options: SystemBlua32ImageBuildOptions): BuiltBlua32Image<LinkedSystemBlua32Image>;
export function buildBlua32Image(options: CartBlua32ImageBuildOptions): BuiltBlua32Image<LinkedCartBlua32Image>;
export function buildBlua32Image(options: Blua32ImageBuildOptions): BuiltBlua32Image {
	const modulePaths = new Set<string>();
	const modules: Array<{
		path: string;
		displayPath: string;
		chunk: LuaChunk;
		source: string;
		sourceMap?: LuaSourceMap;
		linkValues?: ReadonlyMap<string, number>;
	}> = [];
	const diagnosticSources = new Map<string, Blua32DiagnosticSource>();
	const generatedSourceMaps = new Map<string, LuaSourceMap>();
	for (let index = 0; index < options.luaAssets.length; index += 1) {
		const asset = options.luaAssets[index];
		const modulePath = toLuaModulePath(asset.source_path);
		if (modulePaths.has(modulePath)) {
			throw new Error(`ROM Lua module '${modulePath}' is defined more than once.`);
		}
		const chunk = decodeBinary(asset.compiled_buffer!) as LuaChunk;
		modulePaths.add(modulePath);
		const source = utf8FatalDecoder.decode(asset.buffer!);
		modules.push({
			path: modulePath,
			displayPath: asset.source_path,
			chunk,
			source,
		});
	}
	const entryIndex = resolveLuaEntryModuleIndex(modules);
	let entry = modules[entryIndex];
	if (options.entryComposition !== undefined) {
		const composition = options.entryComposition;
		if (modulePaths.has(composition.sourceMap.generatedPath)) {
			throw new Error(`Generated Lua entry '${composition.sourceMap.generatedPath}' conflicts with a ROM Lua asset.`);
		}
		modulePaths.add(composition.sourceMap.generatedPath);
		generatedSourceMaps.set(composition.sourceMap.generatedPath, composition.sourceMap);
		entry = {
			path: composition.sourceMap.generatedPath,
			displayPath: `${composition.sourceMap.generatedPath}.lua`,
			chunk: parseMappedLuaChunk(
				composition.source,
				composition.sourceMap.generatedPath,
				generatedSourceMaps,
			),
			source: composition.source,
			sourceMap: composition.sourceMap,
		};
		modules[entryIndex] = entry;
	}
	for (let index = 0; index < options.generatedLuaModules.length; index += 1) {
		const generated = options.generatedLuaModules[index];
		if (modulePaths.has(generated.path)) {
			throw new Error(`Generated Lua module '${generated.path}' conflicts with a ROM Lua asset.`);
		}
		const sourcePath = `${generated.path}.lua`;
		if (generated.sourceMap !== undefined) {
			generatedSourceMaps.set(generated.path, generated.sourceMap);
		}
		modulePaths.add(generated.path);
		modules.push({
			path: generated.path,
			displayPath: sourcePath,
			chunk: parseMappedLuaChunk(generated.source, generated.path, generatedSourceMaps),
			source: generated.source,
			sourceMap: generated.sourceMap,
			linkValues: generated.linkValues,
		});
	}
	for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
		const module = modules[moduleIndex];
		diagnosticSources.set(module.chunk.range.path, {
			displayPath: module.displayPath,
			source: module.source,
		});
		if (module.sourceMap !== undefined) {
			for (let sourceIndex = 0; sourceIndex < module.sourceMap.sources.length; sourceIndex += 1) {
				const mapped = module.sourceMap.sources[sourceIndex];
				diagnosticSources.set(mapped.rangePath, {
					displayPath: mapped.displayPath,
					source: mapped.source,
				});
			}
		}
	}
	for (let index = entryIndex; index + 1 < modules.length; index += 1) {
		modules[index] = modules[index + 1];
	}
	modules.length -= 1;

	if (options.domain === 'cart') {
		const compiled = compileLuaChunkToProgram(entry.chunk, modules, {
			optLevel: options.optLevel,
			entrySource: entry.source,
			entrySourceMap: entry.sourceMap,
			biosFunctions: options.biosImports.functions,
			programDomain: 'cart',
			traceStatements: options.traceStatements,
		});
		const object = encodeCompiledProgramObject(compiled);
		return {
			linked: linkCartBlua32Image(
				options.biosImports,
				object,
				compiled.metadata,
				options.loadAddress,
				options.ramByteCount,
			),
			object,
			diagnosticSources,
		};
	}
	const compiled = compileLuaChunkToProgram(entry.chunk, modules, {
		optLevel: options.optLevel,
		entrySource: entry.source,
		entrySourceMap: entry.sourceMap,
		programDomain: 'system',
		traceStatements: options.traceStatements,
	});
	const object = encodeCompiledProgramObject(compiled);
	return {
		linked: linkSystemBlua32Image(
			object,
			compiled.metadata,
			options.loadAddress,
			options.ramByteCount,
			options.biosExports,
		),
		object,
		diagnosticSources,
	};
}
