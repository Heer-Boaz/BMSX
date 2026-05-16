import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/program/sources';
import { toLuaModulePath } from '../../machine/program/loader';
import type { StorageService } from '../../platform';
import type { Runtime } from '../../machine/runtime/runtime';
import * as luaPipeline from '../runtime/lua_pipeline';
import type { LuaResourceCreationRequest, ResourceDescriptor } from '../../rompack/tooling/resource';
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
import { workspaceSourceCache } from './cache';
import { clearWorkspaceDirtyBuffers } from '../workbench/workspace/autosave';

export * from './files';
export { joinWorkspacePaths } from './path';

function resolveEditableCartLuaSources(runtime: Runtime): LuaSourceRegistry {
	return runtime.cartLuaSources ?? runtime.activeLuaSources;
}

export function resolveLuaSourceRegistry(runtime: Runtime, path: string): LuaSourceRegistry {
	const cart = runtime.cartLuaSources;
	if (cart && (cart.path2lua[path] || cart.module2lua[path])) {
		return cart;
	}
	const system = runtime.systemLuaSources;
	if (system && (system.path2lua[path] || system.module2lua[path])) {
		return system;
	}
	throw new Error(`Missing Lua source registry for '${path}'.`);
}

export function resolveLuaSourceProjectRootPath(runtime: Runtime, path: string): string {
	const cart = runtime.cartLuaSources;
	if (cart && (cart.path2lua[path] || cart.module2lua[path])) {
		return runtime.cartProjectRootPath;
	}
	const system = runtime.systemLuaSources;
	if (system && (system.path2lua[path] || system.module2lua[path])) {
		return runtime.systemProjectRootPath;
	}
	return runtime.cartProjectRootPath;
}

export async function saveLuaResourceSource(runtime: Runtime, path: string, source: string): Promise<void> {
	const registry = resolveLuaSourceRegistry(runtime, path);
	const asset = registry.path2lua[path] ?? registry.module2lua[path];
	const sourcePath = asset.source_path;
	const projectRootPath = resolveLuaSourceProjectRootPath(runtime, sourcePath);
	await persistWorkspaceSourceFile(sourcePath, source, projectRootPath);
	const updatedAt = runtime.clock.dateNow();
	asset.src = source;
	asset.base_update_timestamp = updatedAt;
	asset.update_timestamp = updatedAt;
	registry.path2lua[sourcePath] = asset;
	registry.module2lua[asset.module_path] = asset;
	persistWorkspaceOverridesToLocalStorage(runtime.storageService, projectRootPath, new Map([[
		sourcePath,
		{ source, path: sourcePath, cartPath: sourcePath, updatedAt },
	]]), updatedAt);
	const dirtyPath = buildWorkspaceDirtyEntryPath(projectRootPath, sourcePath);
	runtime.storageService.removeItem(buildWorkspaceStorageKey(projectRootPath, dirtyPath));
	await deleteWorkspaceServerFile(dirtyPath);
	workspaceSourceCache.delete(dirtyPath);
	workspaceSourceCache.set(sourcePath, source);
	luaPipeline.markSourceChunkAsDirty(runtime, sourcePath);
}

export async function createLuaResource(runtime: Runtime, request: LuaResourceCreationRequest): Promise<ResourceDescriptor> {
	const contents = typeof request.contents === 'string' ? request.contents : '';
	const path = request.path;
	const slashIndex = path.lastIndexOf('/');
	const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	const asset: LuaSourceRecord = {
		resid: baseName,
		type: 'lua',
		src: contents,
		base_src: contents,
		base_update_timestamp: runtime.clock.dateNow(),
		source_path: path,
		module_path: toLuaModulePath(path),
		update_timestamp: runtime.clock.dateNow(),
	};
	const registerAsset = (registry: LuaSourceRegistry): void => {
		registry.path2lua[asset.source_path] = asset;
		registry.module2lua[asset.module_path] = asset;
		registry.can_boot_from_source = true;
	};
	const registry = runtime.systemLuaSources && asset.source_path.startsWith('bios/')
		? runtime.systemLuaSources
		: resolveEditableCartLuaSources(runtime);
	registerAsset(registry);
	luaPipeline.invalidateModuleLookups(runtime);
	const filesystemPath = asset.source_path;
	await persistWorkspaceSourceFile(filesystemPath, contents, asset.source_path.startsWith('bios/') ? runtime.systemProjectRootPath : runtime.cartProjectRootPath);
	runtime.luaGenericChunksExecuted.delete(asset.source_path);
	const descriptor: ResourceDescriptor = { path: asset.source_path, type: 'lua' };
	return descriptor;
}

export async function applyWorkspaceOverridesToRegistry(runtime: Runtime, params: { registry: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath?: string }): Promise<Set<string>> {
	return await applyWorkspaceSourceOverrides({
		registry: params.registry,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: params.projectRootPath ?? runtime.cartProjectRootPath,
		timestampNow: runtime.clock.dateNow(),
	});
}

export async function applyWorkspaceOverridesToCart(runtime: Runtime, params: { cart: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath: string }): Promise<Set<string>> {
	return await applyWorkspaceOverridesToRegistry(runtime, {
		registry: params.cart,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: params.projectRootPath,
	});
}

async function discardWorkspaceDirtyPath(storage: StorageService, root: string, cartPath: string): Promise<void> {
	const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
	const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
	storage.removeItem(storageKey);
	await deleteWorkspaceServerFile(dirtyPath);
}

async function discardWorkspaceCanonicalPath(storage: StorageService, root: string, cartPath: string): Promise<void> {
	const storageKey = buildWorkspaceStorageKey(root, cartPath);
	storage.removeItem(storageKey);
	await deleteWorkspaceServerFile(resolveWorkspacePath(cartPath, root));
}

export async function clearWorkspaceArtifacts(runtime: Runtime, cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = runtime.cartProjectRootPath;
	for (const asset of Object.values(cart.path2lua)) {
		await discardWorkspaceDirtyPath(storage, root, asset.source_path);
		await discardWorkspaceCanonicalPath(storage, root, asset.source_path);
	}
	const statePath = joinWorkspacePaths(root, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
	const stateKey = buildWorkspaceStorageKey(root, statePath);
	storage.removeItem(stateKey);
	await deleteWorkspaceServerFile(statePath);
}

async function clearWorkspaceDirtyFiles(runtime: Runtime, cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = runtime.cartProjectRootPath;
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of Object.values(cart.path2lua)) {
		await discardWorkspaceDirtyPath(storage, root, asset.source_path);
	}
	for (const dirtyPath of scratchPaths) {
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceServerFile(dirtyPath);
	}
}

export async function resetWorkspaceDirtyBuffersAndStorage(runtime: Runtime): Promise<void> {
	const registry = resolveEditableCartLuaSources(runtime);
	await clearWorkspaceDirtyFiles(runtime, registry, runtime.storageService);
	await applyWorkspaceSourceOverrides({
		registry,
		storage: runtime.storageService,
		includeServer: false,
		projectRootPath: runtime.cartProjectRootPath,
		timestampNow: runtime.clock.dateNow(),
	});
	clearWorkspaceDirtyBuffers(runtime);
}

export async function nukeWorkspaceState(runtime: Runtime): Promise<void> {
	const registry = resolveEditableCartLuaSources(runtime);
	await clearWorkspaceArtifacts(runtime, registry, runtime.storageService);
	await applyWorkspaceSourceOverrides({
		registry,
		storage: runtime.storageService,
		includeServer: false,
		projectRootPath: runtime.cartProjectRootPath,
		timestampNow: runtime.clock.dateNow(),
	});
	clearWorkspaceDirtyBuffers(runtime);
}

export function listResources(runtime: Runtime): ResourceDescriptor[] {
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const registries = luaPipeline.listLuaSourceRegistries(runtime);
	for (const entry of registries) {
		const registry = entry.registry;
		const readOnly = entry.readOnly;
		for (const asset of Object.values(registry.path2lua)) {
			const path = asset.source_path;
			if (descriptorsByPath.has(path)) {
				continue;
			}
			descriptorsByPath.set(path, { path, type: asset.type, asset_id: asset.resid, readOnly });
		}
	}
	const descriptors = Array.from(descriptorsByPath.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}
