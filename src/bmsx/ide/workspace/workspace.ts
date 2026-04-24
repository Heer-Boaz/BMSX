import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/program/sources';
import type { StorageService } from '../../platform';
import { Runtime } from '../../machine/runtime/runtime';
import * as luaPipeline from '../runtime/lua_pipeline';
import { engineCore } from '../../core/engine';
import type { LuaResourceCreationRequest, ResourceDescriptor } from '../../rompack/resource';
import {
	DEFAULT_ENGINE_PROJECT_ROOT_PATH,
	applyWorkspaceSourceOverrides,
	collectScratchWorkspaceDirtyPaths,
	deleteWorkspaceFile,
	persistWorkspaceSourceFile,
	buildWorkspaceDirtyEntryPath,
	buildWorkspaceStateFilePath,
	buildWorkspaceStorageKey,
} from './files';

export * from './files';
export { joinWorkspacePaths } from './path';

function resolveEditableCartLuaSources(): LuaSourceRegistry {
	const runtime = Runtime.instance;
	return runtime.cartLuaSources ? runtime.cartLuaSources : engineCore.sources;
}

function resolveEngineProjectRootPath(): string {
	const engineRoot = engineCore.engine_layer.index.projectRootPath;
	return engineRoot && engineRoot.length > 0 ? engineRoot : DEFAULT_ENGINE_PROJECT_ROOT_PATH;
}

function isEngineLuaSourcePath(path: string): boolean {
	return path === 'res/bios' || path.startsWith('res/bios/');
}

export function resolveLuaSourceRegistry(path: string): LuaSourceRegistry {
	const runtime = Runtime.instance;
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[path]) {
		return cart;
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[path]) {
		return engine;
	}
	throw new Error(`Missing Lua source registry for '${path}'.`);
}

export function resolveLuaSourceProjectRootPath(path: string): string {
	const runtime = Runtime.instance;
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[path]) {
		return engineCore.cart_project_root_path;
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[path]) {
		return resolveEngineProjectRootPath();
	}
	return engineCore.cart_project_root_path;
}

export async function saveLuaResourceSource(path: string, source: string): Promise<void> {
	const registry = resolveLuaSourceRegistry(path);
	const asset = registry.path2lua[path];
	const sourcePath = asset.source_path;
	await persistWorkspaceSourceFile(sourcePath, source, resolveLuaSourceProjectRootPath(sourcePath));
	asset.src = source;
	asset.update_timestamp = engineCore.platform.clock.dateNow();
	registry.path2lua[sourcePath] = asset;
	luaPipeline.markSourceChunkAsDirty(Runtime.instance, sourcePath);
}

export async function createLuaResource(request: LuaResourceCreationRequest): Promise<ResourceDescriptor> {
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
		source_path: path,
		update_timestamp: engineCore.platform.clock.dateNow(),
	};
	const registerAsset = (registry: LuaSourceRegistry): void => {
		registry.path2lua[asset.source_path] = asset;
		registry.can_boot_from_source = true;
	};
	const registry = isEngineLuaSourcePath(asset.source_path)
		? Runtime.instance.engineLuaSources
		: resolveEditableCartLuaSources();
	registerAsset(registry);
	luaPipeline.invalidateModuleAliases(Runtime.instance);
	const filesystemPath = asset.source_path;
	await persistWorkspaceSourceFile(filesystemPath, contents, isEngineLuaSourcePath(filesystemPath) ? resolveEngineProjectRootPath() : engineCore.cart_project_root_path);
	luaPipeline.markSourceChunkAsDirty(Runtime.instance, asset.source_path);
	const descriptor: ResourceDescriptor = { path: asset.source_path, type: 'lua' };
	return descriptor;
}

export async function applyWorkspaceOverridesToRegistry(params: { registry: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath?: string }): Promise<Set<string>> {
	return await applyWorkspaceSourceOverrides({
		registry: params.registry,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: params.projectRootPath ?? engineCore.cart_project_root_path,
		timestampNow: engineCore.platform.clock.dateNow(),
	});
}

export async function applyWorkspaceOverridesToCart(params: { cart: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath: string }): Promise<Set<string>> {
	return await applyWorkspaceOverridesToRegistry({
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
	await deleteWorkspaceFile(dirtyPath);
}

export async function clearWorkspaceArtifacts(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = engineCore.cart_project_root_path;
	for (const asset of Object.values(cart.path2lua)) {
		await discardWorkspaceDirtyPath(storage, root, asset.source_path);
	}
	const statePath = buildWorkspaceStateFilePath(root);
	const stateKey = buildWorkspaceStorageKey(root, statePath);
	storage.removeItem(stateKey);
	await deleteWorkspaceFile(statePath);
}

async function clearWorkspaceDirtyFiles(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = engineCore.cart_project_root_path;
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of Object.values(cart.path2lua)) {
		await discardWorkspaceDirtyPath(storage, root, asset.source_path);
	}
	for (const dirtyPath of scratchPaths) {
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceFile(dirtyPath);
	}
}

export async function resetWorkspaceDirtyBuffersAndStorage(): Promise<void> {
	const runtime = Runtime.instance;
	await clearWorkspaceDirtyFiles(resolveEditableCartLuaSources(), runtime.storageService);
}

export async function nukeWorkspaceState(): Promise<void> {
	const runtime = Runtime.instance;
	await clearWorkspaceArtifacts(resolveEditableCartLuaSources(), runtime.storageService);
}

export function listResources(): ResourceDescriptor[] {
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const registries = luaPipeline.listLuaSourceRegistries(Runtime.instance);
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
