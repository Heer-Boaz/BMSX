import { TEST_SYSTEM_CONTEXT_ID } from './runtime_sources';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import type { LuaProjectModuleBindings } from '../../toolchain/ts/lua/semantic/module_resolution';
import { buildLuaFileSemanticData, type FileSemanticData, type LuaSemanticWorkspaceSnapshotInput } from '../../toolchain/ts/lua/semantic/model';
import type { ParsedLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { resourceIdentityKey, type ResourceIdentity } from '../../ide/common/resource';

/** Conventional fixture files share one path-derived import namespace. */
export function createPathModuleBindingsFixture(paths: readonly string[]): LuaProjectModuleBindings {
	const modules = new Map<string, string>();
	for (const path of paths) modules.set(toLuaModulePath(path), path);
	return new Map(paths.map(path => [path, modules]));
}

/** Emits complete source/project input; opaque-address tests supply their own bindings. */
export function createPathModuleProjectFixture<T extends LuaSemanticWorkspaceSnapshotInput>(
	sources: readonly T[],
): [readonly T[], LuaProjectModuleBindings] {
	return [sources, createPathModuleBindingsFixture(sources.map(source => source.path))];
}

export type ResourceLuaSemanticFixtureFile = FileSemanticData & { readonly resource: ResourceIdentity };

/** Authored fixture facts are bound at their canonical resource address. */
export function buildResourceLuaSemanticFixtureFile(
	source: string, resource: ResourceIdentity, parsed?: ParsedLuaChunk,
): ResourceLuaSemanticFixtureFile {
	return Object.assign(buildLuaFileSemanticData(source, resourceIdentityKey(resource), parsed), { resource });
}

/** SDK anchors are explicit system-namespace fixture files; cartridge scopes prefer their own files. */
export function createResourceModuleProjectFixture(
	files: readonly ResourceLuaSemanticFixtureFile[], apiModules: readonly string[],
): [readonly LuaSemanticWorkspaceSnapshotInput[], LuaProjectModuleBindings] {
	const admitted = files.slice();
	for (const module of apiModules) {
		const resource = { contextId: TEST_SYSTEM_CONTEXT_ID, path: `${module}.lua` };
		if (!admitted.some(file => resourceIdentityKey(file.resource) === resourceIdentityKey(resource))) {
			admitted.push(buildResourceLuaSemanticFixtureFile('', resource));
		}
	}
	const scopes = new Map<string, Map<string, string>>();
	for (const file of admitted) {
		if (scopes.has(file.resource.contextId)) continue;
		const modules = new Map<string, string>();
		for (const candidate of admitted) {
			if (candidate.resource.contextId === file.resource.contextId) modules.set(toLuaModulePath(candidate.resource.path), candidate.file);
		}
		if (file.resource.contextId !== TEST_SYSTEM_CONTEXT_ID) {
			for (const candidate of admitted) {
				const module = toLuaModulePath(candidate.resource.path);
				if (candidate.resource.contextId === TEST_SYSTEM_CONTEXT_ID && !modules.has(module)) modules.set(module, candidate.file);
			}
		}
		scopes.set(file.resource.contextId, modules);
	}
	return [admitted.map(file => ({ path: file.file, source: file.source, analysis: file })),
		new Map(admitted.map(file => [file.file, scopes.get(file.resource.contextId)!]))];
}
