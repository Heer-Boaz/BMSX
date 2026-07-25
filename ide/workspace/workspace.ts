import { runtimeWorkbenchState } from '../runtime/workbench_state';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { registerLuaSourceRecord, type LuaSourceRecord, type LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import { toLuaModulePath } from '../../machine/ts/lua/module_path';
import type { StorageService } from '../../machine/ts/platform/index';
import { ROM_GENERATED_MODULE_PATHS } from '../../machine/ts/rompack/format';
import {
	CARTRIDGE_RESOURCE_DOMAINS,
	SYSTEM_RESOURCE_DOMAIN,
	type LuaResourceCreationRequest,
	type ResourceDescriptor,
	type ResourceDomain,
	type ResourceIdentity,
} from '../common/resource';
import { joinWorkspacePaths, resolveWorkspacePath } from './path';
import {
	applyWorkspaceSourceOverrides,
	collectScratchWorkspaceDirtyPaths,
	deleteWorkspaceServerFile,
	persistWorkspaceSourceFile,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceStorageKey,
	persistWorkspaceOverridesToLocalStorage,
	WORKSPACE_METADATA_DIR,
	WORKSPACE_STATE_FILE,
} from './files';
import {
	deleteWorkspaceLuaSourceOverride,
	setWorkspaceLuaSourceOverride,
	workspaceFileCache,
} from './cache';
import { clearWorkspaceDirtyBuffers } from '../workbench/workspace/autosave';
import { runtimeSemanticCache } from '../editor/contrib/intellisense/semantic/workspace/runtime';
import {
	developmentCartridgeSource,
	resolveRuntimeLuaSource,
	runtimeLuaSourceDomain,
} from '../runtime/sources';

export * from './files';
export { joinWorkspacePaths } from './path';

function resolveEditableCartLuaSources(): LuaSourceRegistry {
	const sources = runtimeWorkbenchState.sources;
	const cartridge = developmentCartridgeSource(sources);
	return cartridge ? cartridge.luaSources : sources.activeLuaSources;
}

function markLuaSourceRegistryChanged(registry: LuaSourceRegistry): void {
	const sources = runtimeWorkbenchState.sources;
	if (registry === sources.systemLuaSources) {
		sources.systemBlua32MediaDirty = true;
	} else {
		for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
			if (sources.cartridgeSlots[slot]?.luaSources === registry) {
				sources.cartridgeBlua32MediaDirty[slot] = true;
				runtimeSemanticCache.delete(slot);
				return;
			}
		}
		throw new Error('Lua source registry is not installed.');
	}
	runtimeSemanticCache.clear();
}

function resolveEditableLuaSource(identity: ResourceIdentity): { registry: LuaSourceRegistry; asset: LuaSourceRecord } {
	const source = resolveRuntimeLuaSource(runtimeWorkbenchState.sources, identity);
	if (!source) {
		throw new Error(`Missing Lua source registry for '${identity.path}'.`);
	}
	return { registry: source.registry, asset: source.record };
}

export function applyLuaCodeTabSources(snapshots: ReadonlyArray<ResourceIdentity & { source: string }>): void {
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		const target = resolveEditableLuaSource(snapshot);
		setWorkspaceLuaSourceOverride(target.registry, target.asset.source_path, snapshot.source);
		markLuaSourceRegistryChanged(target.registry);
	}
}

export async function saveLuaResourceSource(identity: ResourceIdentity, source: string): Promise<void> {
	const target = resolveEditableLuaSource(identity);
	const registry = target.registry;
	const asset = target.asset;
	if (asset.generated) {
		throw new Error(`Generated Lua source '${identity.path}' is read-only.`);
	}
	const sourcePath = asset.source_path;
	const projectRootPath = registry.projectRootPath;
	await persistWorkspaceSourceFile(sourcePath, source, projectRootPath);
	const updatedAt = machineManager.platform.clock.dateNow();
	asset.src = source;
	asset.base_src = source;
	asset.base_update_timestamp = updatedAt;
	asset.update_timestamp = updatedAt;
	registerLuaSourceRecord(registry, asset);
	markLuaSourceRegistryChanged(registry);
	persistWorkspaceOverridesToLocalStorage(machineManager.platform.storage, projectRootPath, new Map([[
		sourcePath,
		{ source, path: sourcePath, cartPath: sourcePath, updatedAt },
	]]), updatedAt);
	const dirtyPath = buildWorkspaceDirtyEntryPath(projectRootPath, identity.domain, sourcePath);
	machineManager.platform.storage.removeItem(buildWorkspaceStorageKey(projectRootPath, dirtyPath));
	await deleteWorkspaceServerFile(dirtyPath);
	workspaceFileCache.delete(dirtyPath);
	workspaceFileCache.set(resolveWorkspacePath(sourcePath, projectRootPath), source);
	deleteWorkspaceLuaSourceOverride(registry, sourcePath);
}

export async function createLuaResource(request: LuaResourceCreationRequest): Promise<ResourceDescriptor> {
	const contents = typeof request.contents === 'string' ? request.contents : '';
	const path = request.path;
	const slashIndex = path.lastIndexOf('/');
	const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	const modulePath = toLuaModulePath(path);
	if (ROM_GENERATED_MODULE_PATHS.includes(modulePath)) {
		throw new Error(`Lua module '${modulePath}' is generated by the ROM packer.`);
	}
	const updatedAt = machineManager.platform.clock.dateNow();
	const asset: LuaSourceRecord = {
		resid: baseName,
		type: 'lua',
		src: contents,
		base_src: contents,
		base_update_timestamp: updatedAt,
		source_path: path,
		module_path: modulePath,
		update_timestamp: updatedAt,
		generated: false,
	};
	const systemSource = asset.source_path.startsWith('bios/') || asset.source_path.startsWith('system/');
	const sources = runtimeWorkbenchState.sources;
	const registry = systemSource
		? sources.systemLuaSources
		: resolveEditableCartLuaSources();
	const domain = runtimeLuaSourceDomain(sources, registry);
	registerLuaSourceRecord(registry, asset);
	registry.can_boot_from_source = true;
	markLuaSourceRegistryChanged(registry);
	const filesystemPath = asset.source_path;
	await persistWorkspaceSourceFile(filesystemPath, contents, registry.projectRootPath);
	const descriptor: ResourceDescriptor = { domain, path: asset.source_path, type: 'lua' };
	return descriptor;
}

export async function applyWorkspaceOverridesToRegistry(params: {
	registry: LuaSourceRegistry;
	storage: StorageService;
	includeServer?: boolean;
	projectRootPath: string;
}): Promise<Set<string>> {
	const domain = runtimeLuaSourceDomain(runtimeWorkbenchState.sources, params.registry);
	const changed = await applyWorkspaceSourceOverrides({
		domain,
		registry: params.registry,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: params.projectRootPath,
		timestampNow: machineManager.platform.clock.dateNow(),
	});
	if (changed.size !== 0) {
		markLuaSourceRegistryChanged(params.registry);
	}
	return changed;
}

async function discardWorkspaceDirtyPath(
	storage: StorageService,
	root: string,
	domain: ResourceDomain,
	cartPath: string,
): Promise<void> {
	const dirtyPath = buildWorkspaceDirtyEntryPath(root, domain, cartPath);
	const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
	storage.removeItem(storageKey);
	await deleteWorkspaceServerFile(dirtyPath);
}

async function discardWorkspaceCanonicalPath(storage: StorageService, root: string, cartPath: string): Promise<void> {
	const storageKey = buildWorkspaceStorageKey(root, cartPath);
	storage.removeItem(storageKey);
	await deleteWorkspaceServerFile(resolveWorkspacePath(cartPath, root));
}

export async function clearWorkspaceArtifacts(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = cart.projectRootPath;
	const domain = runtimeLuaSourceDomain(runtimeWorkbenchState.sources, cart);
	for (const asset of cart.records) {
		if (asset.generated) {
			continue;
		}
		await discardWorkspaceDirtyPath(storage, root, domain, asset.source_path);
		await discardWorkspaceCanonicalPath(storage, root, asset.source_path);
	}
	const statePath = joinWorkspacePaths(root, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
	const stateKey = buildWorkspaceStorageKey(root, statePath);
	storage.removeItem(stateKey);
	await deleteWorkspaceServerFile(statePath);
}

async function clearWorkspaceDirtyFiles(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = cart.projectRootPath;
	const domain = runtimeLuaSourceDomain(runtimeWorkbenchState.sources, cart);
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of cart.records) {
		if (asset.generated) {
			continue;
		}
		await discardWorkspaceDirtyPath(storage, root, domain, asset.source_path);
	}
	for (const dirtyPath of scratchPaths) {
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceServerFile(dirtyPath);
	}
}

// Re-applies the saved (canonical) sources and clears dirty buffers, returning the
// workspace to its on-disk baseline. Shared tail of the reset/nuke flows.
async function reapplyWorkspaceBaseline(registry: LuaSourceRegistry): Promise<void> {
	const domain = runtimeLuaSourceDomain(runtimeWorkbenchState.sources, registry);
	const changed = await applyWorkspaceSourceOverrides({
		domain,
		registry,
		storage: machineManager.platform.storage,
		includeServer: false,
		projectRootPath: registry.projectRootPath,
		timestampNow: machineManager.platform.clock.dateNow(),
	});
	if (changed.size !== 0) {
		markLuaSourceRegistryChanged(registry);
	}
	clearWorkspaceDirtyBuffers();
}

export async function resetWorkspaceDirtyBuffersAndStorage(): Promise<void> {
	const registry = resolveEditableCartLuaSources();
	await clearWorkspaceDirtyFiles(registry, machineManager.platform.storage);
	await reapplyWorkspaceBaseline(registry);
}

export async function nukeWorkspaceState(): Promise<void> {
	const registry = resolveEditableCartLuaSources();
	await clearWorkspaceArtifacts(registry, machineManager.platform.storage);
	await reapplyWorkspaceBaseline(registry);
}

export function listResources(): ResourceDescriptor[] {
	const sources = runtimeWorkbenchState.sources;
	const descriptors: ResourceDescriptor[] = [];
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
		const cartridge = sources.cartridgeSlots[domain];
		if (cartridge === null) {
			continue;
		}
		const registry = cartridge.luaSources;
		for (const asset of registry.records) {
			descriptors.push({
				domain,
				path: asset.source_path,
				type: asset.type,
				asset_id: asset.resid,
				readOnly: asset.generated,
			});
		}
	}
	for (const asset of sources.systemLuaSources.records) {
		descriptors.push({
			domain: SYSTEM_RESOURCE_DOMAIN,
			path: asset.source_path,
			type: asset.type,
			asset_id: asset.resid,
			readOnly: asset.generated,
		});
	}
	descriptors.sort((left, right) => left.path.localeCompare(right.path) || left.domain - right.domain);
	return descriptors;
}
