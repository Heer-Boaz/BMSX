import { SCENARIO_TEST_SOURCE_SUFFIX, scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { registerLuaSourceRecord, type LuaSourceRecord, type LuaSourceRegistry } from '../runtime/source_registry';
import type { HostClock } from '../../hosts/common/clock';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { ROM_GENERATED_MODULE_PATHS } from '../../toolchain/ts/rompack/generated_modules';
import { CART_LIBRARY_ROOT, isCartLibrarySource, isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';
import { assetIdFromSourceName } from '../../toolchain/ts/rompack/assets';
import {
	CARTRIDGE_RESOURCE_DOMAINS,
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
	type LuaResourceCreationRequest,
	type ResourceIdentity,
	type RuntimeResource,
} from '../common/resource';
import {
	applyWorkspaceSourceOverrides,
	readWorkspaceLuaSourceText,
	persistWorkspaceSourceFile,
	type WorkspaceSourceSaveResult,
} from './files';
import {
	deleteWorkspaceLuaSourceOverride,
	setWorkspaceLuaSourceOverride,
	workspaceCanonicalSourceCache,
} from './cache';
import { createWorkspaceRecord, workspaceRecords, type WorkspaceRecord } from './records';
import { joinWorkspacePaths, normalizeRelativeWorkspacePath, stripProjectRootPrefix } from './path';
import { discoverWorkspaceLuaFiles } from './source_files';
import {
	runtimeLuaSourceRegistry,
	resolveRuntimeLuaSource,
	registerRuntimeLuaResource,
	runtimeLuaSourceDomain,
	type RuntimeSourceState,
} from '../runtime/sources';

export * from './files';
export { joinWorkspacePaths } from './path';

function markLuaSourceRegistryChanged(sources: RuntimeSourceState, registry: LuaSourceRegistry): void {
	if (registry === sources.systemLuaSources) {
		sources.systemBlua32MediaDirty = true;
	} else {
		for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
			if (sources.cartridgeSlots[slot]?.luaSources === registry) {
				sources.cartridgeBlua32MediaDirty[slot] = true;
				return;
			}
		}
		throw new Error('Lua source registry is not installed.');
	}
}

function resolveEditableLuaSource(
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
): { registry: LuaSourceRegistry; asset: LuaSourceRecord } {
	const source = resolveRuntimeLuaSource(sources, identity);
	if (!source) {
		throw new Error(`Missing Lua source registry for '${identity.path}'.`);
	}
	return { registry: source.registry, asset: source.record };
}

export function applyLuaTextModelSources(
	sources: RuntimeSourceState,
	snapshots: ReadonlyArray<ResourceIdentity & { source: string }>,
): void {
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		const target = resolveEditableLuaSource(sources, snapshot);
		if (readWorkspaceLuaSourceText(target.registry, target.asset) === snapshot.source) {
			continue;
		}
		setWorkspaceLuaSourceOverride(target.registry, target.asset.source_path, snapshot.source);
		markLuaSourceRegistryChanged(sources, target.registry);
	}
}

export async function saveLuaResourceSource(
	clock: HostClock,
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
	source: string,
): Promise<WorkspaceSourceSaveResult> {
	const target = resolveEditableLuaSource(sources, identity);
	const registry = target.registry;
	const asset = target.asset;
	if (asset.generated) {
		throw new Error(`Generated Lua source '${identity.path}' is read-only.`);
	}
	const sourcePath = asset.source_path;
	const workspacePath = asset.normalized_source_path;
	const result = await persistWorkspaceSourceFile(
		clock,
		workspacePath,
		source,
	);
	const { record } = result;
	asset.src = source;
	asset.base_src = source;
	asset.base_update_timestamp = record.updatedAt;
	asset.update_timestamp = record.updatedAt;
	registerLuaSourceRecord(registry, asset);
	if (asset.program_module) {
		markLuaSourceRegistryChanged(sources, registry);
	}
	workspaceCanonicalSourceCache.set(workspacePath, source);
	deleteWorkspaceLuaSourceOverride(registry, sourcePath);
	return result;
}

export async function createLuaResource(
	clock: HostClock,
	sources: RuntimeSourceState,
	request: LuaResourceCreationRequest,
): Promise<RuntimeResource> {
	const contents = request.contents;
	const relativePath = normalizeRelativeWorkspacePath(request.relativePath);
	if (!relativePath.endsWith('.lua')) throw new Error('New Lua files must have a .lua extension.');
	if (!isRuntimeLuaSourcePath(relativePath)) throw new Error('This folder is excluded from project Lua sources.');
	const registry = runtimeLuaSourceRegistry(sources, request.domain)!;
	const path = joinWorkspacePaths(registry.projectRootPath, relativePath);
	const record = createWorkspaceRecord(clock, contents);
	const asset = createWorkspaceLuaSourceRecord(registry, path, record);
	await workspaceRecords.write(path, record, false);
	return admitWorkspaceLuaResource(sources, request.domain, asset);
}

/** Source files exist independently of ROM membership or the set of open tabs. */
export async function discoverWorkspaceLuaSources(sources: RuntimeSourceState): Promise<ReadonlyMap<string, WorkspaceRecord>> {
	const libraries = sources.cartridgeSlots.some(slot => slot !== null)
		? await discoverWorkspaceLuaFiles(workspaceRecords.provider, CART_LIBRARY_ROOT) : [];
	const readRecords = new Map<string, WorkspaceRecord>();
	for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
		const registry = runtimeLuaSourceRegistry(sources, domain);
		if (registry === undefined) continue; // Empty physical cartridge socket.
		const paths = await discoverWorkspaceLuaFiles(workspaceRecords.provider, registry.projectRootPath);
		if (domain !== SYSTEM_RESOURCE_DOMAIN) paths.push(...libraries);
		const knownPaths = new Set(registry.records.map(record => record.normalized_source_path));
		for (const path of paths) {
			if (knownPaths.has(path)) continue;
			const record = readRecords.get(path) ?? await workspaceRecords.read(path);
			if (record === null) throw new Error(`Workspace source disappeared while opening the project: ${path}`);
			readRecords.set(path, record);
			admitWorkspaceLuaResource(sources, domain, createWorkspaceLuaSourceRecord(registry, path, record));
			knownPaths.add(path);
		}
	}
	return readRecords;
}

function createWorkspaceLuaSourceRecord(registry: LuaSourceRegistry, workspacePath: string, record: WorkspaceRecord): LuaSourceRecord {
	const path = stripProjectRootPrefix(workspacePath, registry.projectRootPath);
	const modulePath = toLuaModulePath(path);
	if (ROM_GENERATED_MODULE_PATHS.includes(modulePath)) throw new Error(`Lua module '${modulePath}' is generated by the ROM packer.`);
	if (registry.module2lua[modulePath]) throw new Error(`Lua module already exists: ${modulePath}`);
	const testSource = path.endsWith(SCENARIO_TEST_SOURCE_SUFFIX);
	const resid = testSource ? scenarioTestAssetId(path) : assetIdFromSourceName(path.slice(0, -4));
	for (const source of registry.records) {
		if (source.resid === resid) throw new Error(`Lua asset '${resid}' already belongs to ${source.source_path}`);
	}
	return {
		resid,
		type: 'lua',
		src: record.contents,
		base_src: record.contents,
		base_update_timestamp: record.updatedAt,
		source_path: path,
		normalized_source_path: workspacePath,
		module_path: modulePath,
		update_timestamp: record.updatedAt,
		generated: false,
		program_module: !testSource,
	};
}

function admitWorkspaceLuaResource(sources: RuntimeSourceState, domain: ResourceDomain, asset: LuaSourceRecord): RuntimeResource {
	const registry = runtimeLuaSourceRegistry(sources, domain)!;
	registerLuaSourceRecord(registry, asset);
	const resource = registerRuntimeLuaResource(sources, domain, asset);
	// An available library is not part of the installed program until imported.
	if (!isCartLibrarySource(asset.normalized_source_path)) {
		if (asset.program_module) registry.can_boot_from_source = true;
		markLuaSourceRegistryChanged(sources, registry);
	}
	return resource;
}

export async function applyWorkspaceOverridesToRegistry(
	sources: RuntimeSourceState,
	params: {
		dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
		registry: LuaSourceRegistry;
		projectRootPath: string;
		observedSources?: ReadonlyMap<string, WorkspaceRecord>;
	},
): Promise<Set<string>> {
	const result = await applyWorkspaceSourceOverrides({
		dirtyRecords: params.dirtyRecords,
		domain: runtimeLuaSourceDomain(sources, params.registry),
		registry: params.registry,
		projectRootPath: params.projectRootPath,
		observedSources: params.observedSources,
	});
	if (result.programChanged) {
		markLuaSourceRegistryChanged(sources, params.registry);
	}
	return result.rejectedDirtyPaths;
}

export async function applyAllWorkspaceSourceOverrides(
	sources: RuntimeSourceState,
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	observedSources?: ReadonlyMap<string, WorkspaceRecord>,
): Promise<Set<string>> {
	const rejectedDirtyPaths = new Set<string>();
	for (let slot = 0; slot < sources.cartridgeSlots.length; slot += 1) {
		const cartridge = sources.cartridgeSlots[slot];
		if (!cartridge || !cartridge.projectRootPath) {
			continue;
		}
		const rejected = await applyWorkspaceOverridesToRegistry(sources, {
			dirtyRecords,
			registry: cartridge.luaSources,
			projectRootPath: cartridge.projectRootPath,
			observedSources,
		});
		for (const path of rejected) {
			rejectedDirtyPaths.add(path);
		}
	}
	const rejectedSystemPaths = await applyWorkspaceOverridesToRegistry(sources, {
		dirtyRecords,
		registry: sources.systemLuaSources,
		projectRootPath: sources.systemProjectRootPath,
		observedSources,
	});
	for (const path of rejectedSystemPaths) {
		rejectedDirtyPaths.add(path);
	}
	return rejectedDirtyPaths;
}
