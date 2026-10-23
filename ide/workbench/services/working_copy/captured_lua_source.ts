import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { capturedLuaSourceAtPc, type CapturedLuaSourceLocation } from '../../../runtime/lua_inspection';
import { resolveLuaSourceRecord, type LuaSourceRegistry } from '../../../runtime/source_registry';
import { runtimeLuaSourceRegistry, type Blua32SourceImage, type RuntimeSourceState } from '../../../runtime/sources';
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
	private catalog: RuntimeSourceState['resourceByIdentity'] | undefined;
	private resource: RuntimeResource | undefined;
	private model: EditorTextModel | undefined;
	private modelVersion = -1;
	private registry: LuaSourceRegistry | undefined;
	private registryRevision = -1;

	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState) {}

	public bind(image: Blua32SourceImage | null, pc: number | undefined): void {
		if (image === null || pc === undefined) { this.clear(); return; }
		if (this.image === image && this.pc === pc) return;
		this.clear();
		this.image = image; this.pc = pc;
		this.location = capturedLuaSourceAtPc(image, pc);
		this.status = 'unavailable'; this.catalog = undefined;
		this.revision++;
		if (this.location !== undefined) {
			this.resourceKey = resourceIdentityKey(this.location.resource);
			this.update();
		}
	}

	public clear(): void {
		if (this.image === null && this.pc === undefined) return;
		this.image = null; this.pc = undefined; this.location = undefined;
		this.status = 'unavailable'; this.catalog = undefined; this.resourceKey = '';
		this.resource = undefined; this.model = undefined; this.modelVersion = -1;
		this.registry = undefined; this.registryRevision = -1; this.revision++;
	}

	/** Unchanged frames perform identity/version lookups, not source decoding, snapshots or comparisons. */
	public update(): void {
		const location = this.location;
		if (location === undefined) return;
		const catalog = this.sources.resourceByIdentity, resource = catalog.get(this.resourceKey);
		const model = this.models.get(location.resource), modelVersion = model === undefined ? -1 : model.version;
		const registry = runtimeLuaSourceRegistry(this.sources, location.resource.domain), registryRevision = registry === undefined ? -1 : registry.revision;
		if (this.catalog === catalog && this.resource === resource && this.model === model && this.modelVersion === modelVersion
			&& this.registry === registry && this.registryRevision === registryRevision) return;
		this.catalog = catalog; this.resource = resource; this.model = model; this.modelVersion = modelVersion;
		this.registry = registry; this.registryRevision = registryRevision; this.revision++;
		const record = registry === undefined ? null : resolveLuaSourceRecord(registry, location.resource.path);
		if (resource === undefined || record === null) { this.status = 'unavailable'; return; }
		const current = model === undefined ? readWorkspaceLuaSourceText(registry!, record) : getTextSnapshot(model.buffer);
		this.status = current === location.installedSource ? 'available' : 'changed';
	}
}
