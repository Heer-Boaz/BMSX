import { bindBlua32CodeFunctions, linkBlua32ResetCode } from './blua32_reset_code';
import { SYSTEM_STARTUP_MODULE_PATH } from '../lua/compiler/system_boot_symbols';
import {
	utf8FatalDecoder,
} from '../../../machine/ts/common/serializer/binencoder';
import { parseLuaChunk } from '../lua/analysis/parse';
import { compileLuaChunkToProgram, encodeCompiledProgramObject, type ManagedEntry } from '../lua/compiler';
import { LuaCaptureLayout } from '../lua/compiler/capture_layout';
import type { ProgramObjectImage } from '../lua/compiler/program_object';
import { resolveLuaEntryModuleIndex } from '../lua/entry_module';
import { selectLuaProgramModules } from '../lua/compiler/module_graph';
import type { LuaChunk } from '../lua/syntax/ast';
import { toLuaModulePath } from '../lua/module_path';
import type {
	Blua32BiosFunctionExport,
	Blua32BiosImports,
} from './blua32_bios_imports';
import type { RomAsset } from './assets';
import {
	applyBlua32LinkValues,
	linkCartBlua32Image,
	linkSystemBlua32Image,
	type Blua32LinkBaseline,
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
import type { TraceStatementSelection } from '../lua/compiler/trace_statement';

export type GeneratedLuaModule = {
	path: string;
	source: string;
	sourceMap?: LuaSourceMap;
	linkValues?: ReadonlyMap<string, number>;
};

function systemStartupLayoutModule(entries: readonly string[]): GeneratedLuaModule {
	return {
		path: SYSTEM_STARTUP_MODULE_PATH,
		source: 'module<const>\nreturn { ' + entries.map(entry => entry + ' = 0').join(', ') + ' }',
		linkValues: new Map(entries.map(entry => [entry, 0])),
	};
}

export type Blua32StaticExport = {
	readonly path: string;
	readonly exportPathKey: string;
};

/** Static function selected by the firmware recipe for its prepared execution frame. */
export type Blua32PreparedEntry = Blua32StaticExport & {
	readonly valueSlots: number;
};

export type Blua32SourceModule = {
	readonly path: string;
	readonly displayPath: string;
	readonly chunk: LuaChunk;
	readonly source: string;
	readonly sourceMap?: LuaSourceMap;
	readonly linkValues?: ReadonlyMap<string, number>;
};

type Blua32ImageBuildOptionsBase = {
	luaModules: ReadonlyArray<Blua32SourceModule>;
	generatedLuaModules: ReadonlyArray<GeneratedLuaModule>;
	entryComposition?: ComposedLuaSource;
	entryModulePath?: string;
	loadAddress: number;
	ramByteCount: number;
	optLevel: 0 | 1 | 2 | 3;
	traceStatements: TraceStatementSelection;
	preloadModules?: readonly string[];
};

export type Blua32SystemBuildRecipe = {
	resetModule?: string;
	irqModule?: string;
	exceptionModule?: string;
	preparedEntry?: Blua32PreparedEntry;
	userIrqEntry?: Blua32StaticExport;
	exceptionBridge?: Blua32StaticExport;
	managedEntries?: readonly ManagedEntry[];
	biosExports: ReadonlyArray<Blua32BiosFunctionExport>;
};

export function systemBuildModuleRoots(recipe: Blua32SystemBuildRecipe): string[] {
	const roots = (recipe.managedEntries ?? []).map(entry => entry.path);
	for (const path of [recipe.resetModule, recipe.preparedEntry?.path, recipe.userIrqEntry?.path,
		recipe.exceptionBridge?.path, recipe.irqModule, recipe.exceptionModule]) {
		if (path !== undefined) roots.push(path);
	}
	for (const entry of recipe.biosExports) roots.push(entry.path);
	return roots;
}

type SystemBlua32ImageBuildOptions = Blua32ImageBuildOptionsBase & Blua32SystemBuildRecipe & {
	domain: 'system';
	previous?: Blua32LinkBaseline;
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
	/** Entry body boundary after section and static module initialization. Tooling only. */
	entryCodeAddress: number;
	diagnosticSources: Blua32DiagnosticSourceMap;
};

/** Parse canonical program sources once for this compilation; syntax never lives in ROM. */
export function parseBlua32SourceModules(assets: ReadonlyArray<RomAsset>): Blua32SourceModule[] {
	const modules: Blua32SourceModule[] = [];
	for (let index = 0; index < assets.length; index += 1) {
		const asset = assets[index];
		if (asset.type !== 'lua' || !asset.program_module) {
			continue;
		}
		const path = toLuaModulePath(asset.source_path);
		const source = utf8FatalDecoder.decode(asset.buffer!);
		let chunk: LuaChunk;
		try {
			chunk = parseLuaChunk(source, path).chunk;
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) throw error;
			throw new LuaSyntaxError(error.message, asset.source_path!, error.line, error.column);
		}
		modules.push({
			path,
			displayPath: asset.source_path!,
			chunk,
			source,
		});
	}
	return modules;
}

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
	const modules = options.luaModules.slice();
	const generatedSourceMaps = new Map<string, LuaSourceMap>();
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		if (modulePaths.has(module.path)) {
			throw new Error(`ROM Lua module '${module.path}' is defined more than once.`);
		}
		modulePaths.add(module.path);
	}
	const entryIndex = resolveLuaEntryModuleIndex(modules, options.entryModulePath);
	let entry = modules[entryIndex];
	const entryOrigin = entry.chunk.locations.range(entry.chunk.span);
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
	const authoredReset = options.domain === 'system' && options.resetModule !== undefined;
	const managedEntries = options.domain === 'system' ? options.managedEntries ?? [] : [];
	const startupSymbols: string[] = [];
	if (authoredReset) {
		startupSymbols.push('managed_entry');
		if (options.preparedEntry !== undefined) startupSymbols.push('prepared_entry', 'managed_entry_slots');
		startupSymbols.push('managed_exception');
		if (options.userIrqEntry !== undefined) startupSymbols.push('user_irq');
		if (options.exceptionBridge !== undefined) startupSymbols.push('exception_bridge');
	}
	for (const { symbol } of managedEntries) {
		if (startupSymbols.includes(symbol)) throw new Error(`System startup symbol '${symbol}' is already defined.`);
		startupSymbols.push(symbol);
	}
	const generatedModules = startupSymbols.length !== 0
		? [...options.generatedLuaModules, systemStartupLayoutModule(startupSymbols)]
		: options.generatedLuaModules;
	for (const generated of generatedModules) {
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
	for (let index = entryIndex; index + 1 < modules.length; index += 1) {
		modules[index] = modules[index + 1];
	}
	modules.length -= 1;
	const moduleRoots = [...(options.preloadModules ?? []), ...generatedModules.map(module => module.path)];
	if (options.domain === 'system') moduleRoots.push(...systemBuildModuleRoots(options));
	const programModules = selectLuaProgramModules(entry.chunk, modules, moduleRoots);
	const diagnosticSources = new Map<string, Blua32DiagnosticSource>();
	for (let moduleIndex = 0; moduleIndex <= programModules.length; moduleIndex += 1) {
		const module = moduleIndex === 0 ? entry : programModules[moduleIndex - 1];
		diagnosticSources.set(module.chunk.locations.path, {
			displayPath: module.displayPath,
			source: module.source,
		});
		if (module.sourceMap !== undefined) {
			for (const mapped of module.sourceMap.sources) {
				diagnosticSources.set(mapped.rangePath, {
					displayPath: mapped.displayPath,
					source: mapped.source,
				});
			}
		}
	}

	if (options.domain === 'cart') {
		const compiled = compileLuaChunkToProgram(entry.chunk, programModules, {
			entryOrigin,
			optLevel: options.optLevel,
			entrySource: entry.source,
			entrySourceMap: entry.sourceMap,
			biosFunctions: options.biosImports.functions,
			programDomain: 'cart',
			traceStatements: options.traceStatements,
			preloadModules: options.preloadModules,
		});
		const object = encodeCompiledProgramObject(compiled);
		const linked = linkCartBlua32Image(
				options.biosImports,
				object,
				compiled.metadata,
				options.loadAddress,
				options.ramByteCount,
		);
		return {
			linked,
			entryCodeAddress: linked.layout.functions[linked.functionProtoIndices.indexOf(compiled.entryProtoIndex)].codeAddress,
			object,
			diagnosticSources,
		};
	}
	const compiled = compileLuaChunkToProgram(entry.chunk, programModules, {
		entryOrigin,
		optLevel: options.optLevel,
		entrySource: entry.source,
		entrySourceMap: entry.sourceMap,
		programDomain: 'system',
		resetModule: options.resetModule,
		irqModule: options.irqModule,
		exceptionModule: options.exceptionModule,
		managedEntries,
		traceStatements: options.traceStatements,
		preloadModules: options.preloadModules,
		captureLayout: options.previous?.captureSources === undefined
			? undefined : new LuaCaptureLayout(options.previous.symbols.metadata, options.previous.captureSources),
		installedConstants: options.previous?.image.constants,
	});
	const object = encodeCompiledProgramObject(compiled);
	const linked = linkSystemBlua32Image(object, compiled.metadata, options.loadAddress, options.ramByteCount,
		options.biosExports, options.previous);
	const values = new Map(Array.from(compiled.managedEntryProtos, ([symbol, proto]) =>
		[symbol, linked.layout.functions[linked.functionProtoIndices.indexOf(proto)].address]));
	let userIrq: number | undefined, bridge: number | undefined;
	if (authoredReset) {
		const managed = linked.layout.functions[linked.functionProtoIndices.indexOf(compiled.startupProtoIndex)];
		values.set('managed_entry', managed.address);
		if (compiled.managedExceptionProtoIndex !== undefined) {
			const handler = linked.layout.functions[linked.functionProtoIndices.indexOf(compiled.managedExceptionProtoIndex)];
			values.set('managed_exception', handler.address);
		}
		const resolveStaticEntry = (entry: Blua32StaticExport, role: string) => {
			const exported = object.sections.rodata.moduleExports.find(candidate =>
				candidate.path === entry.path && candidate.exportPathKey === entry.exportPathKey);
			const protoId = exported === undefined ? undefined : object.link.symbols.exportProtoIdBySlot[exported.slotName];
			if (protoId === undefined)
				throw new Error(`${role} '${entry.path}:${entry.exportPathKey}' is not a static function export.`);
			return linked.functionProtoIndices.indexOf(compiled.metadata.protoIds.indexOf(protoId));
		};
		const prepared = options.preparedEntry;
		if (prepared !== undefined) {
			const target = linked.layout.functions[resolveStaticEntry(prepared, 'Prepared System entry')];
			if (Math.max(target.numParams, target.maxStack) > prepared.valueSlots)
				throw new Error(`Prepared System entry '${prepared.path}:${prepared.exportPathKey}' does not fit its ${prepared.valueSlots}-slot frame.`);
			values.set('prepared_entry', target.address);
			values.set('managed_entry_slots', Math.max(1, managed.numParams, managed.maxStack));
		}
		userIrq = options.userIrqEntry === undefined ? undefined
			: resolveStaticEntry(options.userIrqEntry, 'User IRQ entry');
		if (userIrq !== undefined) values.set('user_irq', linked.layout.functions[userIrq].address);
		bridge = options.exceptionBridge === undefined ? undefined : resolveStaticEntry(options.exceptionBridge, 'Exception bridge');
		if (bridge !== undefined) values.set('exception_bridge', linked.layout.functions[bridge].address);
	}
	if (startupSymbols.length !== 0)
		applyBlua32LinkValues(linked, object.link.constValueRelocs, SYSTEM_STARTUP_MODULE_PATH, values);
	bindBlua32CodeFunctions(linked.layout, managedEntries.filter(entry => entry.callable)
		.map(entry => linked.functionProtoIndices.indexOf(compiled.managedEntryProtos.get(entry.symbol)!)));
	const directRoots = authoredReset ? [
		linked.functionProtoIndices.indexOf(compiled.resetProtoIndex),
		linked.functionProtoIndices.indexOf(compiled.irqProtoIndex),
		linked.functionProtoIndices.indexOf(compiled.exceptionProtoIndex), [userIrq, bridge],
	] as const : undefined;
	if (directRoots !== undefined) linkBlua32ResetCode(linked.layout, ...directRoots);
	linked.symbols.systemRecipe = {
		resetModule: options.resetModule, irqModule: options.irqModule, exceptionModule: options.exceptionModule,
		preparedEntry: options.preparedEntry, userIrqEntry: options.userIrqEntry, exceptionBridge: options.exceptionBridge,
		managedEntries, biosExports: options.biosExports,
	};
	return {
		linked,
		entryCodeAddress: linked.layout.functions[linked.functionProtoIndices.indexOf(compiled.entryProtoIndex)].codeAddress,
		object,
		diagnosticSources,
	};
}
