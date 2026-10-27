import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { collectLuaModuleDependencyClosure } from '../../toolchain/ts/lua/compiler/module_graph';
import { resolveLuaEntryModuleIndex } from '../../toolchain/ts/lua/entry_module';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { LuaSourceRegistry } from './source_registry';

export type ProgramSourceModule = {
	path: string;
	sourcePath: string;
	chunk: LuaChunk;
	source: string;
	linkValues?: ReadonlyMap<string, number>;
};

export type ProgramSources = {
	entry: ProgramSourceModule;
	modules: ProgramSourceModule[];
	/** Parsed project files and reachable library modules, reused for source publication. */
	parsed: ReadonlyMap<string, ProgramSourceModule>;
};

/** Workspace membership is not executable membership. Libraries are parsed only on demand. */
export function collectProgramSources(
	registry: LuaSourceRegistry,
	entrySourcePath: string | undefined, moduleRoots: readonly string[],
): ProgramSources {
	const available = new Map(registry.records.filter(record => record.sourceKind !== 'source-only').map(record => [record.module_path, record]));
	const parsed = new Map<string, ProgramSourceModule>();
	const load = (path: string): ProgramSourceModule => {
		let module = parsed.get(path);
		if (module !== undefined) return module;
		const record = available.get(path);
		if (record === undefined) throw new Error(`Program module '${path}' is not available in this workspace.`);
		const source = readWorkspaceLuaSourceText(registry, record);
		module = { path, sourcePath: record.source_path, source, chunk: parseLuaChunk(source, path).chunk };
		parsed.set(path, module);
		return module;
	};
	const project: ProgramSourceModule[] = [];
	for (const record of available.values()) {
		if (record.sourceKind === 'project') project.push(load(record.module_path));
	}
	const entry = entrySourcePath === undefined
		? project[resolveLuaEntryModuleIndex(project)] : load(registry.path2lua[entrySourcePath].module_path);
	const roots = [...moduleRoots];
	for (const record of available.values()) if (record.generated) roots.push(record.module_path);
	const included = new Set(collectLuaModuleDependencyClosure(
		[entry.chunk, ...roots.map(path => load(path).chunk)], new Set(available.keys()), path => load(path).chunk,
	));
	for (const path of roots) included.add(path);
	included.delete(entry.path);
	return { entry, modules: [...available.keys()].filter(path => included.has(path)).map(load), parsed };
}

/** Relinking consumes the installed image's complete source membership and entry, not today's catalog. */
export function collectInstalledProgramSources(
	sources: ReadonlyMap<string, Blua32CompiledSource>, compiledModulePaths: readonly string[],
): ProgramSources {
	const parsed = new Map<string, ProgramSourceModule>();
	for (const path of compiledModulePaths) {
		const record = sources.get(path);
		if (record === undefined) throw new Error(`Installed compiler input '${path}' has no embedded source text.`);
		const source = readBlua32CompiledSource(record);
		parsed.set(path, { path, sourcePath: record.displayPath, source, chunk: parseLuaChunk(source, path).chunk });
	}
	const entry = parsed.get(compiledModulePaths[0])!;
	const modules: ProgramSourceModule[] = [];
	for (const module of parsed.values()) if (module !== entry) modules.push(module);
	return { entry, modules, parsed };
}
