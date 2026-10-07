import { collectLuaModuleDependencyClosure } from '../../toolchain/ts/lua/compiler/module_graph';
import { resolveLuaEntryModuleIndex } from '../../toolchain/ts/lua/entry_module';
import { isCartLibrarySource } from '../../toolchain/ts/lua/source_paths';
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

export type ProgramSourceContent =
	| { readonly kind: 'workspace' }
	| { readonly kind: 'installed'; readonly sources: ReadonlyMap<string, string> };

/** Workspace membership is not executable membership. Libraries are parsed only on demand. */
export function collectProgramSources(
	registry: LuaSourceRegistry,
	entrySourcePath: string | undefined, moduleRoots: readonly string[],
	content: ProgramSourceContent,
): ProgramSources {
	const available = new Map(registry.records.filter(record => content.kind === 'workspace'
		? record.program_module : content.sources.has(record.module_path)).map(record => [record.module_path, record]));
	const parsed = new Map<string, ProgramSourceModule>();
	const load = (path: string): ProgramSourceModule => {
		let module = parsed.get(path);
		if (module !== undefined) return module;
		const record = available.get(path);
		if (record === undefined) throw new Error(`Program module '${path}' is not available in this workspace.`);
		const source = content.kind === 'workspace'
			? readWorkspaceLuaSourceText(registry, record) : content.sources.get(path)!;
		module = { path, sourcePath: record.source_path, source, chunk: parseLuaChunk(source, path).chunk };
		parsed.set(path, module);
		return module;
	};
	const project: ProgramSourceModule[] = [];
	for (const record of available.values()) {
		if (!isCartLibrarySource(record.normalized_source_path)) project.push(load(record.module_path));
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
