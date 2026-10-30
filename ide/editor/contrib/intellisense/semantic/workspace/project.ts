import { toLuaModulePath } from '../../../../../../toolchain/ts/lua/module_path';
import { SourceChangeMap } from '../../../../../../toolchain/ts/text/source_changes';
import { updateLuaChunk, type ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshot,
} from '../../../../../../toolchain/ts/lua/semantic/model';
import { type LuaSourceRecord, type LuaSourceRegistry } from '../../../../../runtime/source_registry';
import type { WorkspaceSourceCatalog } from '../../../../../workspace/source_catalog';
import { type ResourceIdentity, resourceIdentityKey } from '../../../../../common/resource';
import type { LuaModuleBindings } from '../../../../../../toolchain/ts/lua/semantic/module_resolution';
import { readWorkspaceLuaSourceText } from '../../../../../workspace/files';
import type { EditorTextModelService } from '../../../../model/model_service';
import type { EditorTextModel } from '../../../../model/text_model';
import { getTextSnapshot } from '../../../../text/source_text';
import type { TextBuffer } from '../../../../text/text_buffer';

export type SemanticDocumentInput = {
	resource: ResourceIdentity;
	source: string;
	parsed?: ParsedLuaChunk;
};

type ModelAnalysisBaseline = {
	readonly model: EditorTextModel;
	readonly version: number;
	changes: SourceChangeMap;
};

type ProjectBaseSource = {
	readonly resource: ResourceIdentity;
	readonly registry: LuaSourceRegistry;
	readonly record: LuaSourceRecord;
};

// The editor project is the single mutable owner above immutable semantic
// workspace snapshots. Model events queue source changes, not analysis work.
// Admitted context registries provide the base; retained models and explicit document
// inputs own the newer source regardless of which view happens to be active.
export class EditorLuaSemanticProject {
	private disposed = false;
	public get isDisposed(): boolean { return this.disposed; }
	private readonly workspace = new LuaSemanticWorkspace(new Map());
	private readonly documentPaths = new Set<string>();
	private readonly pendingPaths = new Set<string>();
	private readonly modelBaselines = new Map<string, ModelAnalysisBaseline>();
	private readonly resourcesByAddress = new Map<string, ResourceIdentity>();
	private readonly contextBindings = new Map<string, LuaModuleBindings>();
	private readonly sourceContextIds = new Set<string>();
	private moduleBindingsDirty = false;
	private readonly fileModuleBindings = new Map<string, {
		readonly analysis: FileSemanticData | undefined;
		readonly scope: LuaModuleBindings;
		readonly bindings: LuaModuleBindings;
	}>();
	private baseSources: ReadonlyMap<string, ProjectBaseSource> = new Map();
	private readonly modelSubscriptions: readonly (() => void)[];
	private readonly invalidationListeners = new Set<() => void>();
	private readonly disposeListeners = new Set<() => void>();
	private catalogSubscription: (() => void) | undefined;
	private generationValue = 0;
	private catalog: WorkspaceSourceCatalog | undefined;
	private sourcesDirty = false;
	private catalogRevision = -1;
	private readonly sourceRevisions = new Map<string, { registry: LuaSourceRegistry; revision: number }>();

	public constructor(
		private readonly contextId: string,
		private readonly models: EditorTextModelService,
	) {
		this.sourceContextIds.add(contextId);
		this.contextBindings.set(contextId, new Map());
		const queueModel = (model: EditorTextModel): void => {
			if (model.resource.source.type === 'lua'
				&& this.sourceContextIds.has(model.identity.contextId)) {
				const address = this.admitResource(model.identity);
				this.pendingPaths.add(address);
				this.invalidate();
			}
		};
		this.modelSubscriptions = [
			models.onDidAddModel(queueModel),
			models.onDidApplyChanges((model, event) => {
				const baseline = this.modelBaselines.get(resourceIdentityKey(model.identity));
				if (baseline?.model === model) baseline.changes = baseline.changes.append(event.changes);
				queueModel(model);
			}),
			models.onDidRemoveModel(model => {
				if (this.modelBaselines.get(resourceIdentityKey(model.identity))?.model === model) this.modelBaselines.delete(resourceIdentityKey(model.identity));
				if (model.resource.source.type === 'lua' && this.sourceContextIds.has(model.identity.contextId)) this.documentPaths.delete(resourceIdentityKey(model.identity));
				queueModel(model);
			}),
		];
		for (const model of models.models) queueModel(model);
	}

	public dispose(): void {
		this.disposed = true;
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		for (const unsubscribe of this.modelSubscriptions) unsubscribe();
		this.catalogSubscription?.();
		this.invalidationListeners.clear();
		this.pendingPaths.clear();
		this.modelBaselines.clear();
	}

	public get generation(): number { return this.generationValue; }

	/** Admitted import contexts, without synchronizing or querying a source generation. */
	public hasSourceContext(contextId: string): boolean { return this.sourceContextIds.has(contextId); }

	public onDidInvalidate(listener: () => void): () => void {
		this.invalidationListeners.add(listener);
		return () => this.invalidationListeners.delete(listener);
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	private invalidate(): void {
		this.generationValue++;
		for (const listener of this.invalidationListeners) listener();
	}

	public synchronizeSources(catalog: WorkspaceSourceCatalog): void {
		const queued = this.sourcesDirty;
		if (this.refreshSources(catalog) && !queued) this.invalidate();
	}

	/** Context membership and import policy are supplied once by the catalog owner. */
	private refreshSources(catalog: WorkspaceSourceCatalog): boolean {
		this.sourcesDirty = false;
		const contexts = catalog.getSourceContexts(this.contextId);
		let changed = this.catalog !== catalog || this.catalogRevision !== catalog.revision || this.sourceRevisions.size !== contexts.length;
		if (!changed) for (const context of contexts) {
			const previous = this.sourceRevisions.get(context.id);
			if (previous?.registry !== context.luaSources || previous.revision !== context.luaSources.revision) { changed = true; break; }
		}
		if (!changed) return false;
		if (this.catalog !== catalog) {
			this.catalogSubscription?.();
			this.catalogSubscription = catalog.onDidChange(contextId => {
				if (!this.sourceContextIds.has(contextId) || this.sourcesDirty) return;
				this.sourcesDirty = true;
				this.invalidate();
			});
		}
		this.catalog = catalog;
		this.catalogRevision = catalog.revision;
		this.sourceContextIds.clear();
		this.sourceRevisions.clear();
		this.contextBindings.clear();
		const nextBaseSources = new Map<string, ProjectBaseSource>();
		for (const context of contexts) {
			this.sourceContextIds.add(context.id);
			const registry = context.luaSources;
			this.sourceRevisions.set(context.id, { registry, revision: registry.revision });
			this.contextBindings.set(context.id, catalog.getModuleBindings(context.id));
			for (const record of registry.records) {
				const resource = { contextId: context.id, path: record.source_path };
				const address = this.admitResource(resource);
				nextBaseSources.set(address, { resource, registry, record });
				this.pendingPaths.add(address);
			}
		}
		for (const model of this.models.models) if (model.resource.source.type === 'lua' && this.sourceContextIds.has(model.identity.contextId)) {
			this.pendingPaths.add(this.admitResource(model.identity));
		}
		for (const path of this.baseSources.keys()) if (!nextBaseSources.has(path)) this.pendingPaths.add(path);
		this.moduleBindingsDirty = true;
		this.baseSources = nextBaseSources;
		return true;
	}

	private synchronizeDocuments(): void {
		if (this.sourcesDirty) this.refreshSources(this.catalog!);
		if (this.pendingPaths.size === 0) { this.publishModuleBindings(); return; }
		const changedAnalyses: FileSemanticData[] = [];
		const removedPaths: string[] = [];
		for (const path of this.pendingPaths) {
			const base = this.baseSources.get(path);
			const model = this.models.get(this.getResourceIdentity(path));
			if (model === undefined && this.documentPaths.has(path)) {
				this.modelBaselines.delete(path);
				continue;
			}
			const baseline = this.modelBaselines.get(path);
			if (baseline?.model === model && model !== undefined && baseline.version === model.version) continue;
			if (model === undefined || baseline?.model !== model) this.modelBaselines.delete(path);
			if (model === undefined && base === undefined) {
				removedPaths.push(path);
				continue;
			}
			const source = model === undefined
				? readWorkspaceLuaSourceText(base!.registry, base!.record)
				: getTextSnapshot(model.buffer);
			const existing = this.workspace.getFileData(path);
			if (existing === undefined || existing.source !== source) {
				const parsed = model !== undefined && baseline?.model === model
					? updateLuaChunk(existing!.chunk, source, baseline.changes)
					: undefined;
				changedAnalyses.push(buildLuaFileSemanticData(source, path, parsed));
			}
			if (model !== undefined) this.modelBaselines.set(path, {
				model, version: model.version, changes: SourceChangeMap.unchanged(source.length),
			});
		}
		this.pendingPaths.clear();
		this.workspace.updateFiles(changedAnalyses, removedPaths);
		if (changedAnalyses.length !== 0 || removedPaths.length !== 0) this.moduleBindingsDirty = true;
		this.publishModuleBindings();
	}

	/** Retained buffers consume queued edits; detached buffers supply a full source generation. */
	public analyzeDocument(resource: ResourceIdentity, buffer: TextBuffer): FileSemanticData {
		const path = this.admitResource(resource);
		const model = this.models.get(resource);
		if (model !== undefined && model.buffer === buffer) {
			if (this.modelBaselines.get(path)?.model !== model) this.pendingPaths.add(path);
			this.synchronizeDocuments();
			return this.workspace.getFileData(path)!;
		}
		return this.updateDocument(resource, getTextSnapshot(buffer));
	}

	public updateDocument(resource: ResourceIdentity, source: string, parsed?: ParsedLuaChunk): FileSemanticData {
		const path = this.admitResource(resource);
		this.modelBaselines.delete(path);
		this.documentPaths.add(path);
		const previous = this.workspace.getFileData(path);
		const result = this.workspace.updateFile(path, source, parsed);
		if (result !== previous) { this.moduleBindingsDirty = true; this.invalidate(); }
		this.publishModuleBindings();
		return result;
	}

	public updateDocuments(inputs: ReadonlyArray<SemanticDocumentInput>): void {
		const changedAnalyses: FileSemanticData[] = [];
		for (let index = 0; index < inputs.length; index += 1) {
			const input = inputs[index];
			const path = this.admitResource(input.resource);
			this.modelBaselines.delete(path);
			this.documentPaths.add(path);
			const existing = this.workspace.getFileData(path);
			if (!existing || existing.source !== input.source
				|| (input.parsed !== undefined && existing.chunk !== input.parsed.chunk)) {
				changedAnalyses.push(buildLuaFileSemanticData(
					input.source,
					path,
					input.parsed,
				));
			}
		}
		this.workspace.updateFiles(changedAnalyses);
		if (changedAnalyses.length > 0) { this.moduleBindingsDirty = true; this.invalidate(); }
		this.publishModuleBindings();
	}

	public getFileData(resource: ResourceIdentity): FileSemanticData | undefined {
		this.synchronizeDocuments();
		return this.workspace.getFileData(resourceIdentityKey(resource));
	}

	/** Preferred import names come from admitted module metadata, not written-spelling aliases. */
	public getModuleCatalog(resource: ResourceIdentity): LuaModuleBindings {
		this.synchronizeDocuments();
		return this.contextBindings.get(resource.contextId)!;
	}

	/** Semantic file addresses stay opaque outside their owning project. */
	public getResourceIdentity(address: string): ResourceIdentity {
		return this.resourcesByAddress.get(address)!;
	}

	private admitResource(resource: ResourceIdentity): string {
		const address = resourceIdentityKey(resource);
		if (!this.resourcesByAddress.has(address)) {
			this.resourcesByAddress.set(address, { contextId: resource.contextId, path: resource.path });
			this.moduleBindingsDirty = true;
		}
		return address;
	}

	private publishModuleBindings(): void {
		if (!this.moduleBindingsDirty) return;
		const bindings = new Map<string, LuaModuleBindings>();
		for (const [address, resource] of this.resourcesByAddress) {
			const scope = this.contextBindings.get(resource.contextId)!;
			const analysis = this.workspace.getFileData(address);
			let cached = this.fileModuleBindings.get(address);
			if (cached === undefined || cached.analysis !== analysis || cached.scope !== scope) {
				let aliases: Map<string, string> | undefined;
				if (analysis !== undefined) for (const reference of analysis.moduleReferences) {
					if (scope.has(reference.value)) continue;
					const target = scope.get(toLuaModulePath(reference.value));
					if (target === undefined) continue;
					if (aliases === undefined) aliases = new Map(scope);
					aliases.set(reference.value, target);
				}
				cached = { analysis, scope, bindings: aliases === undefined ? scope : aliases };
				this.fileModuleBindings.set(address, cached);
			}
			bindings.set(address, cached.bindings);
		}
		this.workspace.setModuleBindings(bindings);
		this.moduleBindingsDirty = false;
	}

	public getSnapshot(): LuaSemanticWorkspaceSnapshot {
		this.synchronizeDocuments();
		return this.workspace.getSnapshot();
	}
}
