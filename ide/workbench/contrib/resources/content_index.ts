import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRange, LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import { resourceIdentityEquals, resourceIdentityKey, type ResourceIdentity, type RuntimeResource } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { computeTextSnapshotFingerprint, getTextSnapshot, getTextSnapshotFingerprint, type TextSnapshotFingerprint } from '../../../editor/text/source_text';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { EditorLuaSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/project';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { collectAnimationDefinitions, type AnimationDefinitionSource } from '../animation/definitions';
import type { BehaviorKind, BehaviorRegistrationSource } from '../behavior_lens/model';
import type { BehaviorRegistrationIndex } from '../behavior_lens/registration_index';
import { collectLuaPrograms, type LuaProgramKind, type LuaProgramOccurrence } from '../lua_program/source';
import type { SceneSourceDefinition, SceneSourceDocument } from '../scene_editor/model';
import type { SceneSourceDocuments } from '../scene_editor/source_documents';
import type { TextFileModelSnapshot } from '../../services/working_copy/text_file_model';

type ProjectContentSource = {
	readonly projectContextId: string;
	readonly ownerResource: RuntimeResource;
	/** A consuming sprite factory is browsed at its consumer, not at the imported table. */
	readonly browserResource: RuntimeResource;
	readonly label: string;
	/** Exact authored occurrence, mapped only by its existing canonical working copy. */
	readonly range: TrackedTextRange;
};

export type ProjectContentEntry = ProjectContentSource & (
	| { readonly kind: BehaviorKind; readonly registration: BehaviorRegistrationSource }
	| { readonly kind: LuaProgramKind; readonly occurrence: LuaProgramOccurrence }
	| { readonly kind: 'animation'; readonly definition: AnimationDefinitionSource }
	| { readonly kind: 'scene'; readonly document: SceneSourceDocument; readonly definition: SceneSourceDefinition }
);

/** Contributions whose visual presentations are document editors, rather than Main subjects. */
export type ProjectDocumentContentEntry = Exclude<ProjectContentEntry, { kind: 'scene' }>;

/** Persisted declaration correspondence, never a name, semantic pointer or command capability. */
export type ProjectContentReference = {
	readonly projectContextId: string;
	readonly kind: ProjectContentEntry['kind'];
	readonly owner: TextFileModelSnapshot;
	readonly browser: TextFileModelSnapshot;
	readonly range: Readonly<TrackedTextRange>;
};

type EntryRecord = {
	readonly entry: ProjectContentEntry;
	analysis: FileSemanticData;
	tracking: ModelTracking | undefined;
	finalReference?: ProjectContentReference;
};
type ModelTracking = {
	readonly model: EditorTextModel;
	readonly ranges: Map<ProjectContentEntry, TrackedTextRange>;
	readonly release: () => void;
};
type ContextGeneration = {
	readonly project: EditorLuaSemanticProject;
	readonly release: () => void;
	snapshot: LuaSemanticWorkspaceSnapshot | undefined;
	dirty: boolean;
	records: readonly EntryRecord[];
};

const EMPTY_ENTRIES: readonly ProjectContentEntry[] = [];

/** Generation-cached declaration projection over the existing source/semantic owners. */
export class ProjectContentIndex {
	public revision = 0;
	private readonly contexts = new Map<string, ContextGeneration>();
	private readonly records = new Map<ProjectContentEntry, EntryRecord>();
	private readonly recordsByOwner = new Map<string, Set<EntryRecord>>();
	private readonly tracking = new Map<EditorTextModel, ModelTracking>();
	private readonly fingerprints = new WeakMap<FileSemanticData, TextSnapshotFingerprint>();
	public entriesByResource: ReadonlyMap<string, readonly ProjectContentEntry[]> = new Map();
	private readonly subscriptions: readonly (() => void)[];
	private catalogRevision = -1;
	private dirty = true;
	private publicationChanged = false;
	private disposed = false;
	private readonly changeListeners = new Set<() => void>();

	public constructor(private readonly models: EditorTextModelService, public readonly catalog: WorkspaceSourceCatalog,
		private readonly registrations: BehaviorRegistrationIndex, private readonly sceneDocuments: SceneSourceDocuments) {
		this.subscriptions = [
			catalog.onDidChange(() => { this.dirty = true; }),
			models.onDidAddModel(model => this.admitModel(model)),
			models.onDidRemoveModel(model => this.retireModel(model)),
			models.onWillClear(() => this.clear()),
		];
	}
	public get acceptingQueries(): boolean { return !this.disposed; }

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	/** Unchanged frames do not query snapshots, scan resources or allocate projection rows. */
	public sync(): boolean {
		if (this.disposed || !this.dirty && this.catalogRevision === this.catalog.revision) return false;
		let changed = this.publicationChanged;
		this.publicationChanged = false;
		for (const [contextId, generation] of this.contexts) if (!this.catalog.contexts.has(contextId)) {
			generation.release();
			for (const record of generation.records) this.retireRecord(record);
			this.contexts.delete(contextId); changed = true;
		}
		for (const contextId of this.catalog.contexts.keys()) {
			const project = getOrCreateSemanticProject(this.models, contextId);
			let generation = this.contexts.get(contextId);
			if (generation === undefined || generation.project !== project) {
				if (generation !== undefined) {
					generation.release();
					for (const record of generation.records) this.retireRecord(record);
					changed = generation.records.length !== 0 || changed;
				}
				const invalidate = () => {
					generation!.dirty = true; this.dirty = true;
				};
				const releaseInvalidation = project.onDidInvalidate(invalidate), releaseDisposal = project.onWillDispose(invalidate);
				generation = { project, release: () => { releaseInvalidation(); releaseDisposal(); },
					dirty: true, snapshot: undefined, records: [] };
				this.contexts.set(contextId, generation);
			}
			project.synchronizeSources(this.catalog);
			if (!generation.dirty && generation.snapshot !== undefined) continue;
			const snapshot = project.getSnapshot();
			if (generation.dirty || generation.snapshot !== snapshot) changed = this.projectContext(contextId, generation, snapshot) || changed;
			generation.snapshot = snapshot; generation.dirty = false;
		}
		this.dirty = false; this.catalogRevision = this.catalog.revision;
		if (!changed) return false;
		const next = new Map<string, ProjectContentEntry[]>();
		for (const generation of this.contexts.values()) for (const { entry } of generation.records) {
			const key = resourceIdentityKey(entry.browserResource);
			let entries = next.get(key);
			if (entries === undefined) { entries = []; next.set(key, entries); }
			entries.push(entry);
		}
		// Unaffected files retain their published array as well as their entry identities.
		const published = new Map<string, readonly ProjectContentEntry[]>();
		for (const [key, entries] of next) {
			const previous = this.entriesByResource.get(key);
			published.set(key, previous !== undefined && previous.length === entries.length && previous.every((entry, index) => entry === entries[index]) ? previous : entries);
		}
		this.entriesByResource = published;
		this.revision++;
		if (!this.disposed) for (const listener of this.changeListeners) listener();
		return true;
	}

	public entriesFor(resource: ResourceIdentity): readonly ProjectContentEntry[] {
		return this.entriesByResource.get(resourceIdentityKey(resource)) ?? EMPTY_ENTRIES;
	}

	/** Command admission consumes the current source generation, never a stale tree payload. */
	public isCurrent(entry: ProjectContentEntry): boolean {
		if (this.disposed) return false;
		this.sync();
		return !this.disposed && this.records.has(entry);
	}

	/** Read the synchronized producer generation without publishing callbacks or admitting working copies. */
	public captureReference(entry: ProjectContentEntry, previous?: ProjectContentReference): ProjectContentReference | undefined {
		const record = this.records.get(entry);
		if (record === undefined) return undefined;
		if (previous !== undefined && this.matchesReference(record, previous)) return previous;
		if (record.finalReference !== undefined) return record.finalReference;
		const browser = entry.kind === 'animation' && entry.definition.consumer !== undefined ? entry.definition.consumer : record.analysis;
		return { projectContextId: entry.projectContextId, kind: entry.kind,
			owner: { resource: { contextId: entry.ownerResource.contextId, path: entry.ownerResource.path }, fingerprint: this.fingerprint(record.analysis) },
			browser: { resource: { contextId: entry.browserResource.contextId, path: entry.browserResource.path }, fingerprint: this.fingerprint(browser) },
			range: { ...entry.range } };
	}

	/** Query the synchronized generation; recovery performs source publication before any view writes. */
	public resolveReference(reference: ProjectContentReference): ProjectContentEntry | undefined {
		for (const entry of this.entriesFor(reference.browser.resource)) if (this.matchesReference(this.records.get(entry)!, reference)) return entry;
		return undefined;
	}

	private matchesReference(record: EntryRecord, reference: ProjectContentReference): boolean {
		const entry = record.entry;
		if (entry.projectContextId !== reference.projectContextId || entry.kind !== reference.kind
			|| !resourceIdentityEquals(entry.ownerResource, reference.owner.resource)
			|| !resourceIdentityEquals(entry.browserResource, reference.browser.resource)
			|| entry.range.start !== reference.range.start || entry.range.end !== reference.range.end) return false;
		const browser = entry.kind === 'animation' && entry.definition.consumer !== undefined ? entry.definition.consumer : record.analysis;
		const ownerFingerprint = record.finalReference === undefined ? this.fingerprint(record.analysis) : record.finalReference.owner.fingerprint;
		const browserFingerprint = record.finalReference === undefined ? this.fingerprint(browser) : record.finalReference.browser.fingerprint;
		return ownerFingerprint.length === reference.owner.fingerprint.length && ownerFingerprint.hash === reference.owner.fingerprint.hash
			&& browserFingerprint.length === reference.browser.fingerprint.length && browserFingerprint.hash === reference.browser.fingerprint.hash;
	}

	private fingerprint(file: FileSemanticData): TextSnapshotFingerprint {
		let fingerprint = this.fingerprints.get(file);
		if (fingerprint === undefined) {
			fingerprint = computeTextSnapshotFingerprint(file.source);
			this.fingerprints.set(file, fingerprint);
		}
		return fingerprint;
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		// Freeze observed correspondence, not a fresh declaration query. Only tracked
		// owners can prove their mapped position in a newer canonical source generation.
		for (const record of this.records.values()) {
			const reference = this.captureReference(record.entry)!;
			const owner = record.tracking?.model, browser = this.models.get(record.entry.browserResource);
			const ownerFingerprint = owner === undefined ? reference.owner.fingerprint : getTextSnapshotFingerprint(owner.buffer);
			const browserFingerprint = resourceIdentityEquals(record.entry.ownerResource, record.entry.browserResource) ? ownerFingerprint
				: browser === undefined ? reference.browser.fingerprint : getTextSnapshotFingerprint(browser.buffer);
			record.finalReference = { ...reference,
				owner: { resource: reference.owner.resource, fingerprint: ownerFingerprint },
				browser: { resource: reference.browser.resource, fingerprint: browserFingerprint } };
		}
		for (const unsubscribe of this.subscriptions) unsubscribe();
		for (const generation of this.contexts.values()) generation.release();
		this.contexts.clear();
		for (const tracking of this.tracking.values()) tracking.release();
		this.tracking.clear(); this.recordsByOwner.clear();
		for (const record of this.records.values()) record.tracking = undefined;
		// Final source/session checkpoints still consume this last inert correspondence.
		this.revision++;
		for (const listener of this.changeListeners) listener();
		this.changeListeners.clear();
	}

	private clear(): void {
		this.publicationChanged = this.entriesByResource.size !== 0 || this.publicationChanged;
		for (const generation of this.contexts.values()) generation.release();
		this.contexts.clear();
		for (const tracking of this.tracking.values()) tracking.release();
		this.tracking.clear(); this.records.clear(); this.recordsByOwner.clear(); this.entriesByResource = new Map();
		this.dirty = true;
	}

	private admitModel(model: EditorTextModel): void {
		// Admission can be followed by an edit before the browser's next refresh.
		// Only the canonical source generation represented by these markers is mappable.
		const records = this.recordsByOwner.get(resourceIdentityKey(model.identity));
		if (records !== undefined) {
			const source = getTextSnapshot(model.buffer);
			for (const record of records) if (source === record.analysis.source) this.track(record, model);
			this.dirty = true;
		}
	}

	private retireModel(model: EditorTextModel): void {
		const tracking = this.tracking.get(model);
		if (tracking !== undefined) {
			tracking.release(); this.tracking.delete(model);
			for (const entry of tracking.ranges.keys()) this.records.get(entry)!.tracking = undefined;
			this.dirty = true;
		}
	}

	private track(record: EntryRecord, model: EditorTextModel): void {
		let tracking = this.tracking.get(model);
		if (tracking === undefined) {
			const ranges = new Map<ProjectContentEntry, TrackedTextRange>();
			tracking = { model, ranges, release: model.trackRanges(ranges) };
			this.tracking.set(model, tracking);
		}
		tracking.ranges.set(record.entry, record.entry.range); record.tracking = tracking;
	}

	private retireRecord(record: EntryRecord): void {
		record.tracking?.ranges.delete(record.entry); this.records.delete(record.entry);
		const key = resourceIdentityKey(record.entry.ownerResource), owners = this.recordsByOwner.get(key)!;
		owners.delete(record);
		if (owners.size === 0) this.recordsByOwner.delete(key);
	}

	private projectContext(contextId: string, generation: ContextGeneration, snapshot: LuaSemanticWorkspaceSnapshot): boolean {
		const previous = new Map<string, Map<number, EntryRecord[]>>();
		for (const record of generation.records) {
			const key = resourceIdentityKey(record.entry.ownerResource);
			let starts = previous.get(key);
			if (starts === undefined) { starts = new Map(); previous.set(key, starts); }
			let records = starts.get(record.entry.range.start);
			if (records === undefined) { records = []; starts.set(record.entry.range.start, records); }
			records.push(record);
		}
		const records: EntryRecord[] = [], used = new Set<EntryRecord>();
		let changed = false;
		const admit = (entry: ProjectContentEntry, analysis: FileSemanticData): void => {
			const model = this.models.get(entry.ownerResource);
			let record = previous.get(resourceIdentityKey(entry.ownerResource))?.get(entry.range.start)?.find(record =>
				!used.has(record) && record.entry.range.start !== record.entry.range.end && record.entry.range.end === entry.range.end
				&& (record.analysis === analysis || record.tracking?.model === model && model !== undefined)
				&& this.sameOccurrence(record.entry, entry));
			if (record === undefined) {
				record = { entry, analysis, tracking: undefined }; this.records.set(entry, record); changed = true;
				const key = resourceIdentityKey(entry.ownerResource);
				let owners = this.recordsByOwner.get(key);
				if (owners === undefined) { owners = new Set(); this.recordsByOwner.set(key, owners); }
				owners.add(record);
			} else if (!this.sameFacts(record.entry, entry)) {
				Object.assign(record.entry, entry, { range: record.entry.range }); changed = true;
			}
			record.analysis = analysis;
			if (model !== undefined && record.tracking === undefined) this.track(record, model);
			used.add(record); records.push(record);
		};
		const source = (owner: RuntimeResource, range: LuaSourceRange, file: FileSemanticData, label: string,
			browserResource = owner): ProjectContentSource => ({ projectContextId: contextId, ownerResource: owner, browserResource, label,
			range: { start: file.chunk.locations.offsetAt(range.start), end: file.chunk.locations.offsetAt(range.end) + 1 } });
		for (const registration of this.registrations.getRegistrations(contextId)) {
			const owner = this.catalog.resolveResource(registration.resource)!;
			const file = snapshot.getFileData(resourceIdentityKey(owner))!;
			admit({ ...source(owner, registration.occurrenceRange, file, registration.label), kind: registration.behaviorKind, registration }, file);
		}
		const animations = new Map<LuaTableConstructorExpression, Set<FileSemanticData | undefined>>();
		for (const resource of this.catalog.luaResources) {
			if (resource.contextId !== contextId) continue;
			const key = resourceIdentityKey(resource), file = snapshot.getFileData(key)!;
			const document = this.sceneDocuments.getForSnapshot(resource, snapshot);
			for (const definition of document.scenes) {
				const idRange = file.chunk.locations.range(definition.id.span);
				const label = stringLiteralValue(definition.id) ?? file.source.slice(file.chunk.locations.offsetAt(idRange.start), file.chunk.locations.offsetAt(idRange.end) + 1);
				admit({ ...source(resource, definition.range, file, label), kind: 'scene', document, definition }, file);
			}
			for (const occurrence of collectLuaPrograms(resource, snapshot)) {
				const range = file.chunk.locations.range(occurrence.call.expression.span);
				admit({ ...source(resource, range, file, `${resource.path}:${range.start.line}`), kind: occurrence.kind, occurrence }, file);
			}
			for (const definition of collectAnimationDefinitions(resource, snapshot)) {
				let consumers = animations.get(definition.table);
				if (consumers === undefined) { consumers = new Set(); animations.set(definition.table, consumers); }
				if (consumers.has(definition.consumer)) continue;
				consumers.add(definition.consumer);
				const owner = this.catalog.resolveResource(generation.project.getResourceIdentity(definition.file.file))!;
				const browserResource = definition.consumer === undefined ? owner
					: this.catalog.resolveResource(generation.project.getResourceIdentity(definition.consumer.file))!;
				admit({ ...source(owner, definition.file.chunk.locations.range(definition.table.span), definition.file, definition.label, browserResource), kind: 'animation', definition }, definition.file);
			}
		}
		for (const record of generation.records) if (!used.has(record)) { this.retireRecord(record); changed = true; }
		if (records.length !== generation.records.length || records.some((record, index) => record !== generation.records[index])) changed = true;
		generation.records = records;
		return changed;
	}

	private sameOccurrence(left: ProjectContentEntry, right: ProjectContentEntry): boolean {
		return left.kind === right.kind && (left.kind !== 'animation' || right.kind === 'animation'
			&& left.definition.consumer?.file === right.definition.consumer?.file);
	}

	private sameFacts(left: ProjectContentEntry, right: ProjectContentEntry): boolean {
		if (left.label !== right.label || left.ownerResource !== right.ownerResource || left.browserResource !== right.browserResource) return false;
		switch (left.kind) {
			case 'scene': return right.kind === 'scene' && left.document === right.document && left.definition === right.definition;
			case 'animation': return right.kind === 'animation' && left.definition.file === right.definition.file
				&& left.definition.table === right.definition.table && left.definition.consumer === right.definition.consumer
				&& left.definition.context === right.definition.context;
			case 'input': case 'progression': return (right.kind === 'input' || right.kind === 'progression')
				&& left.occurrence.file === right.occurrence.file && left.occurrence.call === right.occurrence.call;
			case 'behavior_tree': case 'state_machine': case 'action_effect': return (right.kind === 'behavior_tree' || right.kind === 'state_machine' || right.kind === 'action_effect')
				&& left.registration.semanticId === right.registration.semanticId && left.registration.rowKey === right.registration.rowKey
				&& left.registration.range === right.registration.range && left.registration.occurrenceRange === right.registration.occurrenceRange;
		}
	}
}
