import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { DisposableStore } from '../../../common/lifecycle';
import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { capturedLuaSourceAtPc, type CapturedLuaSourceLocation } from '../../../runtime/lua_inspection';
import { onDidChangeLuaSourceRegistry, resolveLuaSourceRecord, type LuaSourceRegistry } from '../../../runtime/source_registry';
import { type Blua32SourceImage } from '../../../runtime/sources';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';

export type CapturedLuaSourceStatus = 'available' | 'changed' | 'unavailable';

/** Admits authored navigation only when its current document still matches this captured installation. */
export class CapturedLuaSourceBinding {
	public revision = 0;
	public status: CapturedLuaSourceStatus = 'unavailable';
	public location: CapturedLuaSourceLocation | undefined;
	private image: Blua32SourceImage | null = null;
	private pc: number | undefined;
	private resourceKey = '';
	private catalog: WorkspaceSourceCatalog['resourceByIdentity'] | undefined;
	private catalogRevision = -1;
	private resource: RuntimeResource | undefined;
	private model: EditorTextModel | undefined;
	private modelVersion = -1;
	private registry: LuaSourceRegistry | undefined;
	private registryRevision = -1;
	private lifetime: DisposableStore | undefined;
	private readonly listeners = new Set<() => void>();

	public constructor(private readonly models: EditorTextModelService, private readonly sourceCatalog: WorkspaceSourceCatalog) {}

	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed(): void {
		this.revision++;
		for (const listener of this.listeners) listener();
	}
	public bind(image: Blua32SourceImage | null, pc: number | undefined): void {
		if (image === null || pc === undefined) { this.clear(); return; }
		if (this.image === image && this.pc === pc) return;
		const previous = this.location;
		this.image = image; this.pc = pc;
		this.location = capturedLuaSourceAtPc(image, pc);
		if (this.location === undefined) {
			this.lifetime?.dispose(); this.lifetime = undefined;
			this.unbindRegistry?.(); this.unbindRegistry = undefined; this.observedRegistry = undefined; this.observedPath = '';
			this.status = 'unavailable'; this.catalog = undefined; this.resourceKey = '';
			this.resource = undefined; this.model = undefined; this.modelVersion = -1; this.registry = undefined; this.registryRevision = -1;
			this.changed(); return;
		}
		const key = resourceIdentityKey(this.location.resource);
		if (key !== this.resourceKey || previous?.installedSource !== this.location.installedSource) this.catalog = undefined;
		this.resourceKey = key;
		if (this.lifetime === undefined) {
			const lifetime = this.lifetime = new DisposableStore();
			const changed = (model: EditorTextModel) => { if (resourceIdentityKey(model.resource) === this.resourceKey) this.update(); };
			lifetime.add({ dispose: this.models.onDidAddModel(changed) });
			lifetime.add({ dispose: this.models.onDidRemoveModel(changed) });
			lifetime.add({ dispose: this.models.onDidChangeContent(changed) });
			lifetime.add({ dispose: this.models.onWillClear(() => this.changed()) });
		}
		if (!this.update()) this.changed();
	}

	private unbindRegistry: (() => void) | undefined;
	private observedRegistry: LuaSourceRegistry | undefined;
	private observedPath = '';
	private observeRegistry(): void {
		const path = this.location!.resource.path;
		if (this.observedRegistry === this.registry && this.observedPath === path) return;
		this.observedRegistry = this.registry; this.observedPath = path;
		this.unbindRegistry?.();
		this.unbindRegistry = undefined;
		if (this.registry === undefined) return;
		const registry = this.registry;
		this.unbindRegistry = onDidChangeLuaSourceRegistry(registry, changedPath => {
			if (changedPath !== undefined && changedPath !== path) {
				this.registryRevision = registry.revision;
				return;
			}
			this.update();
		});
	}

	public clear(): void {
		if (this.image === null && this.pc === undefined) return;
		this.lifetime?.dispose(); this.lifetime = undefined;
		this.unbindRegistry?.(); this.unbindRegistry = undefined; this.observedRegistry = undefined; this.observedPath = '';
		this.image = null; this.pc = undefined; this.location = undefined;
		this.status = 'unavailable'; this.catalog = undefined; this.resourceKey = '';
		this.resource = undefined; this.model = undefined; this.modelVersion = -1;
		this.registry = undefined; this.registryRevision = -1; this.changed();
	}

	/** Unchanged frames perform identity/version lookups, not source decoding, snapshots or comparisons. */
	public update(): boolean {
		const location = this.location;
		if (location === undefined) return false;
		const catalog = this.sourceCatalog.resourceByIdentity, resource = catalog.get(this.resourceKey);
		const model = this.models.get(location.resource), modelVersion = model === undefined ? -1 : model.version;
		const registry = this.sourceCatalog.contexts.get(location.resource.contextId)?.luaSources, registryRevision = registry === undefined ? -1 : registry.revision;
		if (this.catalogRevision === this.sourceCatalog.revision && this.catalog === catalog && this.resource === resource && this.model === model && this.modelVersion === modelVersion
			&& this.registry === registry && this.registryRevision === registryRevision) return false;
		this.catalogRevision = this.sourceCatalog.revision;
		this.catalog = catalog; this.resource = resource; this.model = model; this.modelVersion = modelVersion;
		this.registry = registry; this.registryRevision = registryRevision;
		this.observeRegistry();
		const record = registry === undefined ? null : resolveLuaSourceRecord(registry, location.resource.path);
		if (resource === undefined || record === null) { this.status = 'unavailable'; this.changed(); return true; }
		const current = model === undefined ? readWorkspaceLuaSourceText(registry!, record) : getTextSnapshot(model.buffer);
		this.status = current === location.installedSource ? 'available' : 'changed';
		this.changed(); return true;
	}
}
