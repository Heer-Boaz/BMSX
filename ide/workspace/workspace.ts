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
	resourceIdentityKeyFromParts,
	type ResourceDomain,
	type TextResourceCreationRequest,
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
import { createWorkspaceRecord, workspaceRecords, type WorkspaceRecord, type WorkspaceRecords } from './records';
import { joinWorkspacePaths, normalizeRelativeWorkspacePath, stripProjectRootPrefix } from './path';
import { discoverWorkspaceSourceFiles, workspaceTextAssetFromPath } from './source_files';
import {
	runtimeLuaSourceRegistry,
	resolveRuntimeLuaSource,
	registerRuntimeLuaResource,
	registerWorkspaceTextSources,
	runtimeLuaSourceDomain,
	type RuntimeSourceState,
	type WorkspaceTextSource,
} from '../runtime/sources';

export * from './files';
export { joinWorkspacePaths } from './path';

const workspaceSourceCreations = new WeakMap<LuaSourceRegistry, Promise<void>>();

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
	expectedSource?: string | null,
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
		expectedSource,
	);
	const { record } = result;
	asset.src = source;
	asset.base_src = source;
	asset.base_update_timestamp = record.updatedAt;
	asset.update_timestamp = record.updatedAt;
	registerLuaSourceRecord(registry, asset);
	const installedSources = identity.domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemInstalledBlua32Sources : sources.cartridgeSlots[identity.domain]!.installedBlua32Sources;
	if (asset.sourceKind === 'project' || installedSources.has(asset.module_path)) {
		markLuaSourceRegistryChanged(sources, registry);
	}
	deleteWorkspaceLuaSourceOverride(registry, sourcePath);
	return result;
}

/** Canonical identity is captured before review and reused unchanged at creation. */
export function prepareTextResourceCreation(request: TextResourceCreationRequest) {
	return { domain: request.domain, path: normalizeRelativeWorkspacePath(request.relativePath), contents: request.contents };
}

export function createTextResource(
	clock: HostClock,
	sources: RuntimeSourceState,
	request: TextResourceCreationRequest,
): Promise<RuntimeResource> {
	return createPreparedTextResource(clock, sources, prepareTextResourceCreation(request));
}

export function createPreparedTextResource(
	clock: HostClock,
	sources: RuntimeSourceState,
	request: ReturnType<typeof prepareTextResourceCreation>,
): Promise<RuntimeResource> {
	const registry = runtimeLuaSourceRegistry(sources, request.domain)!;
	const records = workspaceRecords;
	const previous = workspaceSourceCreations.get(registry);
	const create = () => createWorkspaceTextResource(clock, sources, request, registry, records);
	const result = previous === undefined ? create() : previous.then(create);
	const tail = result.then(() => undefined, () => undefined);
	workspaceSourceCreations.set(registry, tail);
	void tail.then(() => {
		if (workspaceSourceCreations.get(registry) === tail) workspaceSourceCreations.delete(registry);
	});
	return result;
}

async function createWorkspaceTextResource(
	clock: HostClock,
	sources: RuntimeSourceState,
	request: ReturnType<typeof prepareTextResourceCreation>,
	registry: LuaSourceRegistry,
	records: WorkspaceRecords,
): Promise<RuntimeResource> {
	if (runtimeLuaSourceRegistry(sources, request.domain) !== registry) {
		throw new Error(`Project closed before creating '${request.path}'.`);
	}
	const contents = request.contents;
	const relativePath = request.path;
	const path = joinWorkspacePaths(registry.projectRootPath, relativePath);
	const record = createWorkspaceRecord(clock, contents);
	let asset: (LuaSourceRecord & { type: 'lua' }) | WorkspaceTextSource['source'];
	if (relativePath.endsWith('.lua')) {
		if (!isRuntimeLuaSourcePath(relativePath)) throw new Error('This folder is excluded from project Lua sources.');
		asset = createWorkspaceLuaSourceRecord(registry, path, record);
	} else {
		asset = createWorkspaceTextSourceRecord(workspaceTextAssetPaths(sources, request.domain), relativePath, record);
	}
	await records.write(path, record, false);
	workspaceCanonicalSourceCache.set(path, record);
	if (runtimeLuaSourceRegistry(sources, request.domain) !== registry) {
		throw new Error(`Created '${path}', but its project was closed before catalog admission.`);
	}
	if (asset.type === 'lua') return admitWorkspaceLuaResource(sources, request.domain, asset);
	registerWorkspaceTextSources(sources, request.domain, [asset]);
	return sources.resourceByIdentity.get(resourceIdentityKeyFromParts(request.domain, relativePath))!;
}

/** Source files exist independently of ROM membership or the set of open tabs. */
export async function discoverWorkspaceSources(sources: RuntimeSourceState): Promise<ReadonlyMap<string, WorkspaceRecord>> {
	const libraries = sources.cartridgeSlots.some(slot => slot !== null)
		? await discoverWorkspaceSourceFiles(workspaceRecords.provider, CART_LIBRARY_ROOT, false) : [];
	const readRecords = new Map<string, WorkspaceRecord>();
	for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
		const registry = runtimeLuaSourceRegistry(sources, domain);
		if (registry === undefined) continue; // Empty physical cartridge socket.
		const paths = await discoverWorkspaceSourceFiles(workspaceRecords.provider, registry.projectRootPath, true);
		if (domain !== SYSTEM_RESOURCE_DOMAIN) paths.push(...libraries);
		const knownPaths = new Set(registry.records.map(record => record.normalized_source_path));
		const textSources: WorkspaceTextSource['source'][] = [];
		const textAssetPaths = workspaceTextAssetPaths(sources, domain);
		for (const path of paths) {
			const relativePath = stripProjectRootPrefix(path, registry.projectRootPath);
			if (!path.endsWith('.lua')) {
				const record = await workspaceRecords.read(path);
				if (record === null) throw new Error(`Workspace source disappeared while opening the project: ${path}`);
				readRecords.set(path, record);
				workspaceCanonicalSourceCache.set(path, record);
				textSources.push(createWorkspaceTextSourceRecord(textAssetPaths, relativePath, record));
				continue;
			}
			if (knownPaths.has(path)) continue;
			const record = readRecords.get(path) ?? await workspaceRecords.read(path);
			if (record === null) throw new Error(`Workspace source disappeared while opening the project: ${path}`);
			readRecords.set(path, record);
			admitWorkspaceLuaResource(sources, domain, createWorkspaceLuaSourceRecord(registry, path, record));
			knownPaths.add(path);
		}
		if (textSources.length !== 0) registerWorkspaceTextSources(sources, domain, textSources);
	}
	return readRecords;
}

function workspaceTextAssetPaths(sources: RuntimeSourceState, domain: ResourceDomain): Map<string, string> {
	const paths = new Map<string, string>();
	for (const resource of sources.resources) {
		if (resource.domain === domain && (resource.source.type === 'aem' || resource.source.type === 'data')) {
			paths.set(`${resource.source.type}\0${resource.source.resid}`, resource.path);
		}
	}
	return paths;
}

function createWorkspaceTextSourceRecord(
	assetPaths: Map<string, string>, relativePath: string, record: WorkspaceRecord,
): WorkspaceTextSource['source'] {
	const asset = workspaceTextAssetFromPath(relativePath);
	if (asset === undefined) throw new Error('Create a Lua source, YAML data file or AEM document under res/ in a project source folder.');
	const key = `${asset.type}\0${asset.resid}`;
	const existingPath = assetPaths.get(key);
	if (existingPath !== undefined && existingPath !== relativePath) {
		throw new Error(`Asset '${asset.resid}' already belongs to ${existingPath}`);
	}
	assetPaths.set(key, relativePath);
	return { type: asset.type, resid: asset.resid, source_path: relativePath, update_timestamp: record.updatedAt };
}

function createWorkspaceLuaSourceRecord(registry: LuaSourceRegistry, workspacePath: string, record: WorkspaceRecord): LuaSourceRecord & { type: 'lua' } {
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
		sourceKind: testSource ? 'source-only' : isCartLibrarySource(modulePath) ? 'library' : 'project',
		program_module: false,
	};
}

function admitWorkspaceLuaResource(sources: RuntimeSourceState, domain: ResourceDomain, asset: LuaSourceRecord): RuntimeResource {
	const registry = runtimeLuaSourceRegistry(sources, domain)!;
	registerLuaSourceRecord(registry, asset);
	const resource = registerRuntimeLuaResource(sources, domain, asset);
	// An available library is not part of the installed program until imported.
	if (asset.sourceKind !== 'library') {
		if (asset.sourceKind === 'project') registry.can_boot_from_source = true;
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
	const domain = runtimeLuaSourceDomain(sources, params.registry);
	const result = await applyWorkspaceSourceOverrides({
		dirtyRecords: params.dirtyRecords,
		domain,
		registry: params.registry,
		installedSources: domain === SYSTEM_RESOURCE_DOMAIN
			? sources.systemInstalledBlua32Sources
			: sources.cartridgeSlots[domain]!.installedBlua32Sources,
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
