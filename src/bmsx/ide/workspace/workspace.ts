import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/program/sources';
import type { StorageService } from '../../platform';
import { Runtime } from '../../machine/runtime/runtime';
import * as luaPipeline from '../runtime/lua_pipeline';
import type { LuaResourceCreationRequest, ResourceDescriptor } from '../../rompack/resource';
import {
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
	return runtime.cartLuaSources ? runtime.cartLuaSources : runtime.activeLuaSources;
}

function resolveEngineProjectRootPath(): string {
	return Runtime.instance.engineProjectRootPath;
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
		return runtime.cartProjectRootPath;
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[path]) {
		return resolveEngineProjectRootPath();
	}
	return runtime.cartProjectRootPath;
}

export async function saveLuaResourceSource(path: string, source: string): Promise<void> {
	const runtime = Runtime.instance;
	const registry = resolveLuaSourceRegistry(path);
	const asset = registry.path2lua[path];
	const sourcePath = asset.source_path;
	await persistWorkspaceSourceFile(sourcePath, source, resolveLuaSourceProjectRootPath(sourcePath));
	asset.src = source;
	asset.update_timestamp = runtime.clock.dateNow();
	registry.path2lua[sourcePath] = asset;
	luaPipeline.markSourceChunkAsDirty(sourcePath);
}

export async function createLuaResource(request: LuaResourceCreationRequest): Promise<ResourceDescriptor> {
	const runtime = Runtime.instance;
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
		update_timestamp: runtime.clock.dateNow(),
	};
	const registerAsset = (registry: LuaSourceRegistry): void => {
		registry.path2lua[asset.source_path] = asset;
		registry.can_boot_from_source = true;
	};
	const registry = isEngineLuaSourcePath(asset.source_path)
		? runtime.engineLuaSources
		: resolveEditableCartLuaSources();
	registerAsset(registry);
	luaPipeline.invalidateModuleAliases();
	const filesystemPath = asset.source_path;
	await persistWorkspaceSourceFile(filesystemPath, contents, isEngineLuaSourcePath(filesystemPath) ? resolveEngineProjectRootPath() : runtime.cartProjectRootPath);
	luaPipeline.markSourceChunkAsDirty(asset.source_path);
	const descriptor: ResourceDescriptor = { path: asset.source_path, type: 'lua' };
	return descriptor;
}

export async function applyWorkspaceOverridesToRegistry(params: { registry: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath?: string }): Promise<Set<string>> {
	const runtime = Runtime.instance;
	return await applyWorkspaceSourceOverrides({
		registry: params.registry,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: params.projectRootPath ?? runtime.cartProjectRootPath,
		timestampNow: runtime.clock.dateNow(),
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
	const root = Runtime.instance.cartProjectRootPath;
	for (const asset of Object.values(cart.path2lua)) {
		await discardWorkspaceDirtyPath(storage, root, asset.source_path);
	}
	const statePath = buildWorkspaceStateFilePath(root);
	const stateKey = buildWorkspaceStorageKey(root, statePath);
	storage.removeItem(stateKey);
	await deleteWorkspaceFile(statePath);
}

async function clearWorkspaceDirtyFiles(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = Runtime.instance.cartProjectRootPath;
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
	const registries = luaPipeline.listLuaSourceRegistries();
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
