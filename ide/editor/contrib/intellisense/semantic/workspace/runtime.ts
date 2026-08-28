import type { ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import { getOrCreateSemanticWorkspace, syncSemanticWorkspacePath, type SemanticWorkspacePathInput } from './state';
import type { LuaDefinitionInfo } from '../../../../../../toolchain/ts/lua/syntax/ast/index';
import {
	buildLuaFileSemanticData,
	type FileSemanticData,
	type LuaSemanticModel,
	type LuaSemanticWorkspace,
	type LuaSemanticWorkspaceSnapshot,
} from '../../../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRegistry } from '../../../../../runtime/source_registry';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../../../../common/resource';
import { runtimeLuaSourceRegistry } from '../../../../../runtime/sources';
import type { RuntimeSourceState } from '../../../../../runtime/sources';
import { readWorkspaceLuaSourceText } from '../../../../../workspace/files';

export type RuntimeSemanticCacheEntry = {
	source: string;
	model?: LuaSemanticModel;
	definitions?: ReadonlyArray<LuaDefinitionInfo>;
	parsed?: ParsedLuaChunk;
	analysis?: FileSemanticData;
};

type PrimedWorkspaceState = {
	primaryRegistry: LuaSourceRegistry;
	primaryRevision: number;
	systemRegistry: LuaSourceRegistry;
	systemRevision: number;
};

const primedWorkspaceStates = new WeakMap<LuaSemanticWorkspace, PrimedWorkspaceState>();
export const runtimeSemanticCache = new Map<ResourceDomain, Map<string, RuntimeSemanticCacheEntry>>();

export function runtimeSemanticCacheForDomain(domain: ResourceDomain): Map<string, RuntimeSemanticCacheEntry> {
	let cache = runtimeSemanticCache.get(domain);
	if (!cache) {
		cache = new Map();
		runtimeSemanticCache.set(domain, cache);
	}
	return cache;
}

export function cacheRuntimeSemanticWorkspaceAnalysis(
	domain: ResourceDomain,
	path: string,
	source: string,
	data: FileSemanticData,
	parsed?: ParsedLuaChunk,
): void {
	runtimeSemanticCacheForDomain(domain).set(path, {
		source,
		model: data.model,
		definitions: data.model.definitions,
		parsed,
		analysis: data,
	});
}

export function cacheRuntimeSemanticParseState(
	domain: ResourceDomain,
	path: string,
	source: string,
	parsed: ParsedLuaChunk,
): void {
	const cache = runtimeSemanticCacheForDomain(domain);
	const cacheEntry = cache.get(path);
	cache.set(path, {
		source,
		model: cacheEntry?.model,
		definitions: cacheEntry?.definitions,
		parsed,
	});
}

export function syncRuntimeSemanticWorkspacePath(
	domain: ResourceDomain,
	input: SemanticWorkspacePathInput,
	workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace(domain),
): FileSemanticData {
	const data = syncSemanticWorkspacePath(workspace, input.path, input.source, input.parsed);
	cacheRuntimeSemanticWorkspaceAnalysis(domain, input.path, data.source, data, data.parsed);
	return data;
}

export function primeRuntimeSemanticWorkspaceProjectSources(
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace(domain),
): LuaSemanticWorkspace {
	const primaryRegistry = runtimeLuaSourceRegistry(sources, domain)!;
	const systemRegistry = sources.systemLuaSources;
	const primed = primedWorkspaceStates.get(workspace);
	if (primed
		&& primed.primaryRegistry === primaryRegistry
		&& primed.primaryRevision === primaryRegistry.revision
		&& primed.systemRegistry === systemRegistry
		&& primed.systemRevision === systemRegistry.revision) {
		return workspace;
	}
	const cache = runtimeSemanticCacheForDomain(domain);
	const registries = domain === SYSTEM_RESOURCE_DOMAIN
		? [systemRegistry]
		: [primaryRegistry, systemRegistry];
	const seenPaths = new Set<string>();
	const changedAnalyses: FileSemanticData[] = [];
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const registry = registries[registryIndex];
		for (let recordIndex = 0; recordIndex < registry.records.length; recordIndex += 1) {
			const path = registry.records[recordIndex].source_path;
			if (seenPaths.has(path)) {
				continue;
			}
			seenPaths.add(path);
			const cacheEntry = cache.get(path);
			const source = readWorkspaceLuaSourceText(registry, registry.records[recordIndex]);
			const existing = workspace.getFileData(path);
			if (existing && existing.source === source) {
				continue;
			}
			const cachedSource = cacheEntry?.source === source ? cacheEntry : null;
			const parsed = cachedSource?.parsed;
			changedAnalyses.push(
				cachedSource?.analysis
					?? buildLuaFileSemanticData(source, path, parsed),
			);
		}
	}
	workspace.updateFiles(changedAnalyses);
	for (let index = 0; index < changedAnalyses.length; index += 1) {
		const analysis = changedAnalyses[index];
		cacheRuntimeSemanticWorkspaceAnalysis(
			domain,
			analysis.model.file,
			analysis.source,
			workspace.getFileData(analysis.model.file),
			analysis.parsed,
		);
	}
	primedWorkspaceStates.set(workspace, {
		primaryRegistry,
		primaryRevision: primaryRegistry.revision,
		systemRegistry,
		systemRevision: systemRegistry.revision,
	});
	return workspace;
}

export function prepareRuntimeSemanticWorkspaceForEditorBuffer(
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	input: SemanticWorkspacePathInput,
): LuaSemanticWorkspaceSnapshot {
	const workspace = getOrCreateSemanticWorkspace(domain);
	syncRuntimeSemanticWorkspacePath(domain, input, workspace);
	primeRuntimeSemanticWorkspaceProjectSources(sources, domain, workspace);
	return workspace.getSnapshot();
}
