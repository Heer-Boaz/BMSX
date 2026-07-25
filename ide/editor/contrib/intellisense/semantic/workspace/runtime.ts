import type { ParsedLuaChunk } from '../../../../../../machine/ts/lua/analysis/parse';
import { splitText } from '../../../../../../machine/ts/common/text_lines';
import * as luaPipeline from '../../../../../runtime/lua_pipeline';
import { machineManager } from '../../../../../../machine/ts/core/machine_manager';
import { getOrCreateSemanticWorkspace, syncSemanticWorkspacePath, type SemanticWorkspacePathInput } from './state';
import type { LuaDefinitionInfo } from '../../../../../../machine/ts/lua/syntax/ast/index';
import type { FileSemanticData, LuaSemanticModel, LuaSemanticWorkspace, LuaSemanticWorkspaceSnapshot } from '../../../../../../machine/ts/lua/semantic/model';
import type { LuaSourceRegistry } from '../../../../../../machine/ts/lua/source_registry';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../../../../common/resource';
import { runtimeLuaSourceRegistry } from '../../../../../runtime/sources';

export type RuntimeSemanticCacheEntry = {
	source: string;
	model?: LuaSemanticModel;
	definitions?: ReadonlyArray<LuaDefinitionInfo>;
	parsed?: ParsedLuaChunk;
	lines?: readonly string[];
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
		lines: data.lines,
		analysis: data,
	});
}

export function cacheRuntimeSemanticParseState(
	domain: ResourceDomain,
	path: string,
	source: string,
	lines: readonly string[],
	parsed: ParsedLuaChunk,
): void {
	const cache = runtimeSemanticCacheForDomain(domain);
	const cacheEntry = cache.get(path);
	cache.set(path, {
		source,
		model: cacheEntry?.model,
		definitions: cacheEntry?.definitions,
		parsed,
		lines,
	});
}

export function syncRuntimeSemanticWorkspacePath(
	domain: ResourceDomain,
	input: SemanticWorkspacePathInput,
	workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace(domain),
): FileSemanticData {
	const data = syncSemanticWorkspacePath(input, workspace);
	cacheRuntimeSemanticWorkspaceAnalysis(domain, input.path, data.source, data, data.parsed);
	return data;
}

export function primeRuntimeSemanticWorkspaceProjectSources(
	domain: ResourceDomain,
	workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace(domain),
): LuaSemanticWorkspace {
	const sources = machineManager.sourceState;
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
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const registry = registries[registryIndex];
		const sourceDomain = registry === systemRegistry ? SYSTEM_RESOURCE_DOMAIN : domain;
		for (let recordIndex = 0; recordIndex < registry.records.length; recordIndex += 1) {
			const path = registry.records[recordIndex].source_path;
			if (seenPaths.has(path)) {
				continue;
			}
			seenPaths.add(path);
			const cacheEntry = cache.get(path);
			const source = luaPipeline.resourceSourceForChunk({ domain: sourceDomain, path });
			const existing = workspace.getFileData(path);
			if (existing && existing.source === source) {
				continue;
			}
			const cachedSource = cacheEntry?.source === source ? cacheEntry : null;
			const lines = cachedSource?.lines ?? splitText(source);
			const parsed = cachedSource?.parsed;
			workspace.updateFile(path, source, lines, parsed, undefined);
			const data = workspace.getFileData(path);
			cacheRuntimeSemanticWorkspaceAnalysis(domain, path, source, data, parsed);
		}
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
	domain: ResourceDomain,
	input: SemanticWorkspacePathInput,
): LuaSemanticWorkspaceSnapshot {
	const workspace = getOrCreateSemanticWorkspace(domain);
	syncRuntimeSemanticWorkspacePath(domain, input, workspace);
	primeRuntimeSemanticWorkspaceProjectSources(domain, workspace);
	return workspace.getSnapshot();
}
