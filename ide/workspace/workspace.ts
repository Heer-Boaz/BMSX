import { SCENARIO_TEST_SOURCE_SUFFIX, scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { registerLuaSourceRecord, type LuaSourceRecord, type LuaSourceRegistry, type LuaSourceKind } from '../runtime/source_registry';
import type { HostClock } from '../../hosts/common/clock';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { ROM_GENERATED_MODULE_PATHS } from '../../toolchain/ts/rompack/generated_modules';
import { isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';
import { assetIdFromSourceName } from '../../toolchain/ts/rompack/assets';
import {
	resourceIdentityKeyFromParts,
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
import type { WorkspaceSourceCatalog, WorkspaceTextSource } from './source_catalog';

export * from './files';
export { joinWorkspacePaths } from './path';

const workspaceSourceCreations = new WeakMap<LuaSourceRegistry, Promise<void>>();

function resolveEditableLuaSource(
	catalog: WorkspaceSourceCatalog,
	identity: ResourceIdentity,
): { registry: LuaSourceRegistry; asset: LuaSourceRecord } {
	const source = catalog.resolveLuaSource(identity);
	if (!source) {
		throw new Error(`Missing Lua source registry for '${identity.path}'.`);
	}
	return { registry: source.registry, asset: source.record };
}

export function applyLuaTextModelSources(
	catalog: WorkspaceSourceCatalog,
	snapshots: ReadonlyArray<ResourceIdentity & { source: string }>,
): void {
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		const target = resolveEditableLuaSource(catalog, snapshot);
		if (readWorkspaceLuaSourceText(target.registry, target.asset) === snapshot.source) {
			continue;
		}
		setWorkspaceLuaSourceOverride(target.registry, target.asset.source_path, snapshot.source);
		if (target.asset.sourceKind === 'project' || target.asset.program_module) catalog.markProgramChanged(snapshot.contextId);
	}
}

export async function saveLuaResourceSource(
	clock: HostClock,
	catalog: WorkspaceSourceCatalog,
	identity: ResourceIdentity,
	source: string,
	expectedSource?: string | null,
): Promise<WorkspaceSourceSaveResult> {
	const target = resolveEditableLuaSource(catalog, identity);
	const registry = target.registry;
	const asset = target.asset;
	if (asset.generated) {
		throw new Error(`Generated Lua source '${identity.path}' is read-only.`);
	}
	const sourcePath = asset.source_path;
	const workspacePath = asset.normalized_source_path;
	const sourceChanged = readWorkspaceLuaSourceText(registry, asset) !== source;
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
	if (sourceChanged && (asset.sourceKind === 'project' || asset.program_module)) catalog.markProgramChanged(identity.contextId);
	deleteWorkspaceLuaSourceOverride(registry, sourcePath);
	return result;
}

/** Canonical identity is captured before review and reused unchanged at creation. */
export function prepareTextResourceCreation(request: TextResourceCreationRequest) {
	return { contextId: request.contextId, path: normalizeRelativeWorkspacePath(request.relativePath), contents: request.contents };
}

export async function createTextResource(
	clock: HostClock,
	catalog: WorkspaceSourceCatalog,
	request: TextResourceCreationRequest,
): Promise<RuntimeResource> {
	return createPreparedTextResource(clock, catalog, prepareTextResourceCreation(request));
}

export function createPreparedTextResource(
	clock: HostClock,
	catalog: WorkspaceSourceCatalog,
	request: ReturnType<typeof prepareTextResourceCreation>,
): Promise<RuntimeResource> {
	const registry = catalog.getContext(request.contextId).luaSources;
	const records = workspaceRecords;
	const previous = workspaceSourceCreations.get(registry);
	const create = () => createWorkspaceTextResource(clock, catalog, request, registry, records);
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
	catalog: WorkspaceSourceCatalog,
	request: ReturnType<typeof prepareTextResourceCreation>,
	registry: LuaSourceRegistry,
	records: WorkspaceRecords,
): Promise<RuntimeResource> {
	if (catalog.contexts.get(request.contextId)?.luaSources !== registry) {
		throw new Error(`Project closed before creating '${request.path}'.`);
	}
	const contents = request.contents;
	const relativePath = request.path;
	const path = joinWorkspacePaths(registry.projectRootPath, relativePath);
	const record = createWorkspaceRecord(clock, contents);
	let asset: (LuaSourceRecord & { type: 'lua' }) | WorkspaceTextSource['source'];
	if (relativePath.endsWith('.lua')) {
		if (!isRuntimeLuaSourcePath(relativePath)) throw new Error('This folder is excluded from project Lua sources.');
		asset = createWorkspaceLuaSourceRecord(registry, path, relativePath, toLuaModulePath(relativePath), 'project', record);
	} else {
		asset = createWorkspaceTextSourceRecord(workspaceTextAssetPaths(catalog, request.contextId), relativePath, record);
	}
	await records.write(path, record, false);
	workspaceCanonicalSourceCache.set(path, record);
	if (catalog.contexts.get(request.contextId)?.luaSources !== registry) {
		throw new Error(`Created '${path}', but its project was closed before catalog admission.`);
	}
	if (asset.type === 'lua') return admitWorkspaceLuaResource(catalog, request.contextId, asset);
	catalog.registerTextSources(request.contextId, [asset]);
	return catalog.resourceByIdentity.get(resourceIdentityKeyFromParts(request.contextId, relativePath))!;
}

/** Source files exist independently of ROM membership or the set of open tabs. */
export async function discoverWorkspaceSources(catalog: WorkspaceSourceCatalog): Promise<ReadonlyMap<string, WorkspaceRecord>> {
	const readRecords = new Map<string, WorkspaceRecord>();
	for (const context of catalog.contexts.values()) {
		const registry = context.luaSources;
		const knownPaths = new Set(registry.records.map(record => record.normalized_source_path));
		const textSources: WorkspaceTextSource['source'][] = [];
		const textAssetPaths = workspaceTextAssetPaths(catalog, context.id);
		for (const root of context.sourceRoots) {
			const paths = await discoverWorkspaceSourceFiles(workspaceRecords.provider, root.path, root.structured);
			for (const path of paths) {
				const relativePath = stripProjectRootPrefix(path, root.path);
				const resourcePath = joinWorkspacePaths(root.resourcePathPrefix, relativePath);
				if (path.endsWith('.lua') && knownPaths.has(path)) continue;
				let record = readRecords.get(path);
				if (record === undefined) {
					const read = await workspaceRecords.read(path);
					if (read === null) throw new Error(`Workspace source disappeared while opening the project: ${path}`);
					record = read;
					readRecords.set(path, record);
				}
				workspaceCanonicalSourceCache.set(path, record);
				if (path.endsWith('.lua')) {
					const modulePath = toLuaModulePath(joinWorkspacePaths(root.modulePathPrefix, relativePath));
					admitWorkspaceLuaResource(catalog, context.id,
						createWorkspaceLuaSourceRecord(registry, path, resourcePath, modulePath, root.sourceKind, record));
					knownPaths.add(path);
				} else {
					textSources.push(createWorkspaceTextSourceRecord(textAssetPaths, resourcePath, record));
				}
			}
		}
		if (textSources.length !== 0) catalog.registerTextSources(context.id, textSources);
	}
	return readRecords;
}

function workspaceTextAssetPaths(catalog: WorkspaceSourceCatalog, contextId: string): Map<string, string> {
	const paths = new Map<string, string>();
	for (const resource of catalog.resources) {
		if (resource.contextId === contextId && (resource.source.type === 'aem' || resource.source.type === 'data')) {
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

function createWorkspaceLuaSourceRecord(registry: LuaSourceRegistry, workspacePath: string, path: string, modulePath: string,
	sourceKind: LuaSourceKind, record: WorkspaceRecord): LuaSourceRecord & { type: 'lua' } {
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
		sourceKind: testSource ? 'source-only' : sourceKind,
		program_module: false,
	};
}

function admitWorkspaceLuaResource(catalog: WorkspaceSourceCatalog, contextId: string, asset: LuaSourceRecord): RuntimeResource {
	const registry = catalog.getContext(contextId).luaSources;
	registerLuaSourceRecord(registry, asset);
	if (asset.sourceKind === 'project') {
		registry.can_boot_from_source = true;
		catalog.markProgramChanged(contextId);
	}
	return catalog.resolveResource({ contextId, path: asset.source_path })!;
}

export async function applyWorkspaceOverridesToRegistry(
	catalog: WorkspaceSourceCatalog,
	params: {
		dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
		contextId: string;
		observedSources?: ReadonlyMap<string, WorkspaceRecord>;
	},
): Promise<Set<string>> {
	const context = catalog.getContext(params.contextId);
	const result = await applyWorkspaceSourceOverrides({
		dirtyRecords: params.dirtyRecords, contextId: context.id,
		registry: context.luaSources, projectRootPath: context.projectRootPath, observedSources: params.observedSources,
	});
	if (result.programChanged) catalog.markProgramChanged(context.id);
	return result.rejectedDirtyPaths;
}

export async function applyAllWorkspaceSourceOverrides(
	catalog: WorkspaceSourceCatalog,
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	observedSources?: ReadonlyMap<string, WorkspaceRecord>,
): Promise<Set<string>> {
	const rejectedDirtyPaths = new Set<string>();
	for (const context of catalog.contexts.values()) {
		const rejected = await applyWorkspaceOverridesToRegistry(catalog, { dirtyRecords, contextId: context.id, observedSources });
		for (const path of rejected) rejectedDirtyPaths.add(path);
	}
	return rejectedDirtyPaths;
}
