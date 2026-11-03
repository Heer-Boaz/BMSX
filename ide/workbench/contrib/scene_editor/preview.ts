import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { ResourceIdentity } from '../../../common/resource';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { WorkspaceRecord } from '../../../workspace/records';
import { captureCurrentLuaSource, captureLuaTextModelSources } from '../../services/working_copy/lua_sources';
import type { ScenarioRunService } from '../../services/testing/scenario_runs';
import { buildExecutionMedia } from '../../services/execution/source_media';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneRuntimePreview, type ScenePreviewTimeline } from './runtime_preview';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';

/** Shared build admission; each independent Scene document owns its subject and machine. */
export class ScenePreviewService {
	private readonly documents = new Set<SceneDocumentPreview>();
	private readonly operations = new Set<Promise<void>>();
	private readonly subscriptions: readonly (() => void)[];
	private closed = false;
	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState,
		private readonly dirtyRecords: ReadonlyMap<string, WorkspaceRecord>, private readonly model: MachineModelSpec,
		private readonly tests: ScenarioRunService) {
		this.subscriptions = [models.onDidChangeContent(() => this.invalidate()), sources.catalog.onDidChange(() => this.invalidate()),
			models.onWillClear(() => { for (const document of this.documents) document.stop(); })];
	}
	public create(authoring: SceneAuthoringContext): SceneDocumentPreview {
		if (this.closed) throw new Error('Scene previews are closed.');
		const document = new SceneDocumentPreview(authoring, this); this.documents.add(document); return document;
	}
	public initializations(contextId: string) {
		this.tests.refreshSources();
		return this.tests.collection.roots.filter(root => root.contextId === contextId)
			.flatMap(root => root.children.filter(module => module.suite?.kind === 'integration' && module.suite.setup));
	}
	public build(contextId: string, initialization?: ResourceIdentity) {
		if (initialization !== undefined && !this.initializations(contextId).some(module => module.resource.path === initialization.path
			&& module.resource.contextId === initialization.contextId)) throw new Error('The selected integration setup is no longer available. Choose an initialization.');
		const fixture = initialization === undefined ? undefined : { sourcePath: initialization.path,
			source: captureCurrentLuaSource(this.models, this.sources.catalog, initialization).source };
		return buildExecutionMedia(this.sources, new Map(this.dirtyRecords), captureLuaTextModelSources(this.models, this.sources.catalog, true), contextId, this.model, fixture);
	}
	private invalidate(): void { for (const document of this.documents) document.invalidate(); }
	public release(document: SceneDocumentPreview): void { this.documents.delete(document); }
	public retainOperation(operation: Promise<void>): void {
		this.operations.add(operation);
		void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
	}
	public async dispose(): Promise<void> {
		this.closed = true;
		for (const release of this.subscriptions) release();
		for (const document of this.documents) document.dispose();
		await Promise.all(this.operations);
	}
}

/** Revision-owned preview. Old pixels and picks are retired together before an
 * edit/Undo can rebuild; source authority never moves into the guest heap. */
export class SceneDocumentPreview {
	public session: SceneRuntimePreview | undefined;
	public enabled = false;
	public state: 'stopped' | 'building' | 'ready' | 'seeking' | 'failed' = 'stopped';
	public error: string | undefined;
	public selectedTimeline: ScenePreviewTimeline | undefined;
	public time = 0;
	public requestedTime = 0;
	public statusText = '';
	public initialization: ResourceIdentity | undefined;
	private timelineAnchor: TrackedTextRange | undefined;
	private timelineKey: ScenePreviewTimeline['stableKey'];
	private releaseAnchor: (() => void) | undefined;
	private pendingTime: number | undefined;
	private revision = 0;
	private dirty = false;
	private operation: Promise<void> = Promise.resolve();
	private retirement: Promise<void> = Promise.resolve();
	private readonly listeners = new Set<() => void>();
	public constructor(public readonly authoring: SceneAuthoringContext, private readonly service: ScenePreviewService) {}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void {
		this.statusText = this.error ?? (this.state === 'ready' || this.state === 'seeking'
			? this.selectedTimeline === undefined ? 'Choose Timeline… to seek' : `${this.selectedTimeline.label} · ${this.time} ms`
			: this.state === 'building' ? 'Constructing…' : 'Stopped');
		for (const listener of this.listeners) listener();
	}
	public start(): Promise<void> { this.enabled = true; this.invalidate(); return this.update(); }
	public chooseInitialization(resource: ResourceIdentity | undefined): void {
		this.initialization = resource;
		this.releaseAnchor?.(); this.releaseAnchor = undefined; this.timelineAnchor = undefined; this.timelineKey = undefined;
		this.time = this.requestedTime = 0; this.pendingTime = undefined;
		this.invalidate(); this.changed();
	}
	public stop(): void {
		this.enabled = false; this.revision++; this.retireSession();
		this.state = 'stopped'; this.dirty = false; this.pendingTime = undefined; this.requestedTime = this.time;
		this.error = undefined; this.selectedTimeline = undefined; this.changed();
	}
	public invalidate(): void {
		if (!this.enabled) return;
		this.revision++; this.dirty = true; this.retireSession();
		this.state = 'building'; this.error = undefined; this.selectedTimeline = undefined; this.changed();
	}
	public update(): Promise<void> {
		if (!this.enabled) return this.operation;
		if (this.dirty) {
			this.dirty = false;
			this.operation = this.rebuild(this.revision);
			this.service.retainOperation(this.operation);
		} else if (this.state === 'ready' && this.pendingTime !== undefined && this.selectedTimeline !== undefined) {
			const time = this.pendingTime; this.pendingTime = undefined;
			this.operation = this.sample(this.revision, this.session!, this.selectedTimeline, time);
			this.service.retainOperation(this.operation);
		}
		return this.operation;
	}
	private async rebuild(revision: number): Promise<void> {
		try {
			this.authoring.refresh();
			const subject = this.authoring.subject, document = this.authoring.document;
			if (subject === undefined || document === undefined || subject.resolution !== 'complete') throw new Error('Preview requires a complete authored member list.');
			const path = this.authoring.workingCopy.identity.path;
			const [media] = await Promise.all([this.service.build(this.authoring.workingCopy.identity.contextId, this.initialization), this.retirement]);
			if (revision !== this.revision) return;
			const session = this.session = new SceneRuntimePreview(media);
			await session.initialize({ modulePath: toLuaModulePath(path),
				registration: subject.registrationRange, memberCount: subject.objects.length });
			if (revision !== this.revision) return;
			const anchor = this.timelineAnchor, time = this.requestedTime;
			if (anchor !== undefined && this.timelineKey !== undefined) {
				const index = subject.objects.findIndex(entry => luaSourceRangeMatchesTextRange(this.authoring.workingCopy.buffer,
					document.analysis.chunk.locations.range(entry.field.span), anchor));
				this.selectedTimeline = session.timelines.find(timeline => timeline.memberIndex === index + 1 && timeline.stableKey === this.timelineKey);
				if (this.selectedTimeline !== undefined) {
					this.pendingTime = undefined;
					await session.seek(this.selectedTimeline, time);
				}
			}
			if (revision !== this.revision) return;
			if (this.selectedTimeline !== undefined) this.time = time;
			this.state = 'ready'; this.changed();
		} catch (error) { this.failed(revision, error); }
	}
	public selectTimeline(timeline: ScenePreviewTimeline): void {
		this.selectedTimeline = timeline; this.timelineKey = timeline.stableKey; this.time = 0;
		this.releaseAnchor?.();
		const entry = this.authoring.subject!.objects[timeline.memberIndex - 1];
		this.timelineAnchor = luaSourceRangeToTextRange(this.authoring.workingCopy.buffer, this.authoring.document!.analysis.chunk.locations.range(entry.field.span));
		this.releaseAnchor = this.authoring.workingCopy.trackRanges(new Map([[0, this.timelineAnchor]]));
		this.seek(0);
	}
	public seek(time: number): void { this.pendingTime = time; this.requestedTime = time; }
	private async sample(revision: number, session: SceneRuntimePreview, timeline: ScenePreviewTimeline, time: number): Promise<void> {
		this.state = 'seeking'; this.changed();
		try {
			await session.seek(timeline, time);
			if (revision !== this.revision) return;
			this.time = time; this.state = 'ready'; this.changed();
		} catch (error) { this.failed(revision, error); }
	}
	private failed(revision: number, error: unknown): void {
		if (revision !== this.revision) return;
		this.retireSession(); this.selectedTimeline = undefined; this.pendingTime = undefined;
		this.state = 'failed'; this.error = String(error); this.changed();
	}
	private retireSession(): void {
		const session = this.session;
		if (session === undefined) return;
		this.session = undefined;
		const revision = this.revision;
		this.retirement = session.dispose().catch(error => {
			// The physical target is gone even when teardown fails. Report that
			// failure, cancel this revision, and allow a subsequent source fix to boot.
			if (revision !== this.revision || this.state === 'failed') return;
			this.revision++; this.dirty = false; this.failed(this.revision, error);
		});
		this.service.retainOperation(this.retirement);
	}
	public dispose(): void { this.stop(); this.releaseAnchor?.(); this.service.release(this); this.listeners.clear(); }
}
