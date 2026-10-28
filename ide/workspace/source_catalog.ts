import type { StudioSourceContext } from '../../hosts/common/studio_projects';
import type { RomImageDomain } from '../../machine/ts/rompack/image';
import type { RomAsset, RomToolingPackage } from '../../toolchain/ts/rompack/assets';
import type { RomToolingLayer } from '../../toolchain/ts/rompack/loader';
import {
	resourceIdentityKey, resourceIdentityKeyFromParts,
	type ResourceIdentity, type RuntimeResource, type RuntimeResourceLocation,
} from '../common/resource';
import {
	createLuaSourceRegistry, onDidChangeLuaSourceRegistry,
	registerLuaSourceRecord, resolveLuaSourceRecord,
	type LuaSourceMatch, type LuaSourceRecord, type LuaSourceRegistry, type LuaSourceRoot,
} from '../runtime/source_registry';
import { getWorkspaceLuaSourceOverride, setWorkspaceLuaSourceOverride } from './cache';
import { resolveWorkspacePath, stripProjectRootPrefix } from './path';

export type WorkspaceTextSource = {
	readonly contextId: string;
	readonly source: RuntimeResource['source'] & { readonly type: 'aem' | 'data'; readonly source_path: string };
};

export type WorkspaceAssetKind = 'img' | 'audio' | 'model' | 'data' | 'bin' | 'collision_shape' | 'audioevents';
export type WorkspaceAssetBinding<K extends WorkspaceAssetKind> = {
	readonly contextId: string;
	readonly value: RomToolingPackage[K][string];
};
type AssetBindings = { [K in WorkspaceAssetKind]?: ReadonlyMap<string, WorkspaceAssetBinding<K>> };

/** A retained authoring namespace, not an installed socket or a build generation. */
export type WorkspaceSourceContext = {
	readonly admission: StudioSourceContext;
	programRevision: number;
	readonly id: string;
	readonly projectRootPath: string;
	readonly programDomain: RomImageDomain;
	/** Explicit build linkage; module dependency order does not select a BIOS. */
	readonly systemContextId: string | null;
	readonly luaSources: LuaSourceRegistry;
	readonly sourceRoots: readonly LuaSourceRoot[];
	readonly dependencyContextIds: readonly string[];
	readonly previewPackage: RomToolingPackage;
	readonly previewRom: RomToolingLayer | null;
	readonly assetSources: readonly RomAsset[];
};

export type WorkspaceSourceContextAdmission = Omit<WorkspaceSourceContext, 'id' | 'projectRootPath' | 'programRevision'>;

/** Mutable authoring state outlives every execution attachment using its contexts. */
export class WorkspaceSourceCatalog {
	public readonly contexts = new Map<string, WorkspaceSourceContext>();
	public readonly resourceByIdentity = new Map<string, RuntimeResource>();
	public readonly resources: RuntimeResource[] = [];
	public readonly luaResources: RuntimeResource[] = [];
	public readonly workspaceTextSources = new Map<string, WorkspaceTextSource>();
	public revision = 0;
	private readonly listeners = new Set<(contextId: string, path?: string) => void>();
	private readonly contextSubscriptions = new Map<string, () => void>();
	private readonly moduleScopes = new Map<string, ReadonlyMap<string, string>>();
	private readonly assetScopes = new Map<string, AssetBindings>();
	private readonly sourceScopes = new Map<string, readonly WorkspaceSourceContext[]>();

	public getContext(contextId: string): WorkspaceSourceContext {
		return this.contexts.get(contextId)!;
	}

	public admitContext(input: WorkspaceSourceContextAdmission): WorkspaceSourceContext {
		if (this.contexts.has(input.admission.id)) throw new Error(`Source context '${input.admission.id}' is already admitted.`);
		const context: WorkspaceSourceContext = { ...input, programRevision: 0, id: input.admission.id, projectRootPath: input.admission.projectRoot };
		this.contexts.set(context.id, context);
		this.contextSubscriptions.set(context.id, onDidChangeLuaSourceRegistry(context.luaSources, path => {
			if (path !== undefined) {
				const record = context.luaSources.path2lua[path];
				if (record !== undefined && this.resourceByIdentity.get(resourceIdentityKeyFromParts(context.id, path))?.source !== record) {
					this.registerLuaResource(context.id, record);
					return;
				}
			}
			this.emitChange(context.id, path);
		}));
		this.rebuildResources();
		this.emitChange(context.id);
		return context;
	}

	public markProgramChanged(contextId: string): void {
		this.getContext(contextId).programRevision++;
	}

	public onDidChange(listener: (contextId: string, path?: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emitChange(contextId: string, path?: string): void {
		for (const listener of this.listeners) listener(contextId, path);
	}

	public dispose(): void {
		for (const unsubscribe of this.contextSubscriptions.values()) unsubscribe();
		this.contextSubscriptions.clear();
		this.listeners.clear();
		this.contexts.clear();
		this.resourceByIdentity.clear();
		this.resources.length = 0;
		this.luaResources.length = 0;
		this.workspaceTextSources.clear();
		this.moduleScopes.clear();
		this.assetScopes.clear();
		this.sourceScopes.clear();
	}

	public resolveResource(identity: ResourceIdentity): RuntimeResource | undefined {
		return this.resourceByIdentity.get(resourceIdentityKey(identity));
	}

	public resolveLuaSource(identity: ResourceIdentity): (LuaSourceMatch & { contextId: string }) | null {
		const registry = this.getContext(identity.contextId).luaSources;
		const record = resolveLuaSourceRecord(registry, identity.path);
		return record === null ? null : { contextId: identity.contextId, registry, record };
	}

	/** Primary and explicitly bound dependency membership; no physical-domain lookup. */
	public getSourceContexts(contextId: string): readonly WorkspaceSourceContext[] {
		let contexts = this.sourceScopes.get(contextId);
		if (contexts !== undefined) return contexts;
		const result: WorkspaceSourceContext[] = [];
		const seen = new Set<string>();
		const visit = (id: string): void => {
			if (seen.has(id)) return;
			seen.add(id);
			const context = this.getContext(id);
			result.push(context);
			for (const dependencyId of context.dependencyContextIds) visit(dependencyId);
		};
		visit(contextId);
		contexts = result;
		this.sourceScopes.set(contextId, contexts);
		return contexts;
	}

	public getModuleBindings(contextId: string): ReadonlyMap<string, string> {
		const existing = this.moduleScopes.get(contextId);
		if (existing !== undefined) return existing;
		const bindings = new Map<string, string>();
		for (const context of this.getSourceContexts(contextId)) for (const record of context.luaSources.records) {
			if (!bindings.has(record.module_path)) bindings.set(record.module_path, resourceIdentityKeyFromParts(context.id, record.source_path));
		}
		this.moduleScopes.set(contextId, bindings);
		return bindings;
	}

	public resolveModule(contextId: string, specifier: string): RuntimeResource | undefined {
		const address = this.getModuleBindings(contextId).get(specifier);
		return address === undefined ? undefined : this.resourceByIdentity.get(address);
	}

	public getAssetBindings<K extends WorkspaceAssetKind>(contextId: string, kind: K): ReadonlyMap<string, WorkspaceAssetBinding<K>> {
		let bindings = this.assetScopes.get(contextId);
		if (bindings === undefined) {
			bindings = {};
			this.assetScopes.set(contextId, bindings);
		}
		let binding = bindings[kind];
		if (binding === undefined) bindings[kind] = binding = this.bindAssets(this.getSourceContexts(contextId), kind) as AssetBindings[K];
		return binding;
	}

	private bindAssets<K extends WorkspaceAssetKind>(contexts: readonly WorkspaceSourceContext[], kind: K): Map<string, WorkspaceAssetBinding<K>> {
		const bindings = new Map<string, WorkspaceAssetBinding<K>>();
		for (const context of contexts) {
			const assets = context.previewPackage[kind];
			for (const id of Object.keys(assets)) if (!bindings.has(id)) {
				const value = assets[id] as RomToolingPackage[K][string];
				bindings.set(id, { contextId: context.id, value });
			}
		}
		return bindings;
	}

	public resolveAsset<K extends WorkspaceAssetKind>(contextId: string, kind: K, id: string): WorkspaceAssetBinding<K> | undefined {
		return this.getAssetBindings(contextId, kind).get(id);
	}

	public registerLuaResource(contextId: string, source: LuaSourceRecord): RuntimeResource {
		const context = this.getContext(contextId);
		const key = resourceIdentityKeyFromParts(contextId, source.source_path);
		const previous = this.resourceByIdentity.get(key);
		const wasLua = previous?.source.type === 'lua';
		const resource = this.retainResource(previous, contextId, source.source_path, source,
			this.luaLocation(previous?.location, source, context.projectRootPath), source.generated ? undefined : source.normalized_source_path);
		if (previous === undefined) this.resources.push(resource);
		if (!wasLua) this.luaResources.push(resource);
		this.sortResources();
		this.advanceCatalog();
		this.emitChange(contextId);
		return resource;
	}

	public registerTextSources(contextId: string, sources: readonly WorkspaceTextSource['source'][]): void {
		for (const source of sources) this.workspaceTextSources.set(resourceIdentityKeyFromParts(contextId, source.source_path), { contextId, source });
		this.rebuildResources();
		this.emitChange(contextId);
	}

	public rebuildResources(): void {
		const previous = new Map(this.resourceByIdentity);
		this.resourceByIdentity.clear();
		this.resources.length = 0;
		this.luaResources.length = 0;
		for (const context of this.contexts.values()) {
			for (const source of context.luaSources.records) {
				const key = resourceIdentityKeyFromParts(context.id, source.source_path);
				const retained = previous.get(key);
				this.luaResources.push(this.retainResource(retained, context.id, source.source_path, source,
					this.luaLocation(retained?.location, source, context.projectRootPath), source.generated ? undefined : source.normalized_source_path));
			}
			for (const source of context.assetSources) {
				if ((source.type !== 'data' && source.type !== 'aem') || !source.source_path) continue;
				const key = resourceIdentityKeyFromParts(context.id, source.source_path);
				const retained = previous.get(key);
				this.retainResource(retained, context.id, source.source_path, source,
					this.projectLocation(retained?.location, context.projectRootPath, source.source_path),
					resolveWorkspacePath(source.source_path, context.projectRootPath));
			}
		}
		for (const [key, { contextId, source }] of this.workspaceTextSources) {
			if (this.resourceByIdentity.has(key)) continue;
			const context = this.getContext(contextId), retained = previous.get(key);
			this.retainResource(retained, contextId, source.source_path, source,
				this.projectLocation(retained?.location, context.projectRootPath, source.source_path),
				resolveWorkspacePath(source.source_path, context.projectRootPath));
		}
		for (const resource of this.resourceByIdentity.values()) this.resources.push(resource);
		this.sortResources();
		this.advanceCatalog();
	}

	/** Builds copy each admitted mutable registry once, regardless of attachment count. */
	public fork(): WorkspaceSourceCatalog {
		const fork = new WorkspaceSourceCatalog();
		for (const context of this.contexts.values()) {
			const registry = createLuaSourceRegistry(context.projectRootPath, context.luaSources.entrySourcePath);
			for (const record of context.luaSources.records) {
				registerLuaSourceRecord(registry, { ...record });
				const override = getWorkspaceLuaSourceOverride(context.luaSources, record.source_path);
				if (override !== undefined) setWorkspaceLuaSourceOverride(registry, record.source_path, override);
			}
			registry.can_boot_from_source = context.luaSources.can_boot_from_source;
			registry.revision = context.luaSources.revision;
			const sourcePackage = context.previewPackage;
			const previewPackage = { ...sourcePackage, img: { ...sourcePackage.img }, audio: { ...sourcePackage.audio },
				model: { ...sourcePackage.model }, data: { ...sourcePackage.data }, bin: { ...sourcePackage.bin },
				collision_shape: { ...sourcePackage.collision_shape }, audioevents: { ...sourcePackage.audioevents } };
			fork.admitContext({ ...context, luaSources: registry, previewPackage,
				assetSources: context.assetSources.map(source => ({ ...source })),
				previewRom: context.previewRom === null ? null : { ...context.previewRom, package: previewPackage } }).programRevision = context.programRevision;
		}
		for (const [key, source] of this.workspaceTextSources) fork.workspaceTextSources.set(key, { ...source, source: { ...source.source } });
		fork.rebuildResources();
		return fork;
	}

	private advanceCatalog(): void {
		this.revision++;
		this.moduleScopes.clear();
		this.assetScopes.clear();
		this.sourceScopes.clear();
	}

	private sortResources(): void {
		const compare = (left: RuntimeResource, right: RuntimeResource): number => left.path.localeCompare(right.path) || left.contextId.localeCompare(right.contextId);
		this.resources.sort(compare);
		this.luaResources.sort(compare);
	}

	private retainResource(previous: RuntimeResource | undefined, contextId: string, path: string,
		source: RuntimeResource['source'], location: RuntimeResourceLocation, sourceFilePath: string | undefined): RuntimeResource {
		const resource = previous === undefined
			? { contextId, contextLabel: this.getContext(contextId).projectRootPath, path, source, location, sourceFilePath } : previous;
		resource.source = source;
		resource.location = location;
		resource.sourceFilePath = sourceFilePath;
		this.resourceByIdentity.set(resourceIdentityKeyFromParts(contextId, path), resource);
		return resource;
	}

	private projectLocation(previous: RuntimeResourceLocation | undefined, projectRootPath: string, path: string): RuntimeResourceLocation {
		return previous?.kind === 'project' && previous.projectRootPath === projectRootPath && previous.path === path
			? previous : { kind: 'project', projectRootPath, path };
	}

	private luaLocation(previous: RuntimeResourceLocation | undefined, source: LuaSourceRecord, projectRootPath: string): RuntimeResourceLocation {
		if (source.generated) return previous?.kind === 'generated' && previous.path === source.source_path
			? previous : { kind: 'generated', path: source.source_path };
		const path = stripProjectRootPrefix(source.normalized_source_path, projectRootPath);
		if (projectRootPath.length === 0 || path !== source.normalized_source_path) return this.projectLocation(previous, projectRootPath, path);
		return previous?.kind === 'workspace' && previous.path === source.normalized_source_path
			? previous : { kind: 'workspace', path: source.normalized_source_path };
	}
}
