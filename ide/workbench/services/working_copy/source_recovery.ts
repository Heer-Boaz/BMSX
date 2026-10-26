import type { HostClock, TimerHandle } from '../../../../hosts/common/clock';
import { LogLevel, type LogOutput } from '../../../../hosts/common/log';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { resolveRuntimeResource, runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../runtime/sources';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceDirtyRecordPath } from '../../../workspace/files';
import { joinWorkspacePaths } from '../../../workspace/path';
import { createWorkspaceRecord, WORKSPACE_METADATA_DIR, workspaceRecords, type WorkspaceRecord } from '../../../workspace/records';
import { loadWorkspaceDirtySources, publishWorkspaceDirtySources, pruneWorkspaceDirtySources, type PersistedDirtyEntry } from '../../../workspace/source_recovery_store';
import { resolveTextFileModel, textFileMode } from './text_file_model';

export type WorkingCopyRecoveryEntry = PersistedDirtyEntry & { savedSource: string; persistedBaseline: string | null };

export function captureWorkspaceDirtySources(models: EditorTextModelService, sources: RuntimeSourceState,
	clock: HostClock, previous: ReadonlyMap<string, WorkspaceRecord>,
	write?: (projectRoot: string, path: string, record: WorkspaceRecord) => void,
): { dirtyFiles: WorkingCopyRecoveryEntry[]; dirtyRecords: Map<string, WorkspaceRecord> } {
	const dirtyFiles: WorkingCopyRecoveryEntry[] = [], dirtyRecords = new Map<string, WorkspaceRecord>();
	for (const model of models.models) {
		if (!model.dirty) continue;
		const resource = model.resource, root = runtimeSourceProjectRootPath(sources, resource.domain);
		const path = buildWorkspaceDirtyEntryPath(root, resource.domain, resource.path);
		const text = getTextSnapshot(model.buffer);
		let record = previous.get(path);
		if (record === undefined || record.contents !== text) {
			record = createWorkspaceRecord(clock, text);
			write?.(root, buildWorkspaceDirtyRecordPath(path, record.updatedAt), record);
		}
		dirtyFiles.push({ domain: resource.domain, path: resource.path, updatedAt: record.updatedAt,
			savedSource: model.lastSavedSource, persistedBaseline: model.persistedBaseline });
		dirtyRecords.set(path, record);
	}
	return { dirtyFiles, dirtyRecords };
}

export async function restoreWorkspaceDirtyModels(models: EditorTextModelService, sources: RuntimeSourceState,
	entries: readonly PersistedDirtyEntry[], records: ReadonlyMap<string, WorkspaceRecord>): Promise<void> {
	for (const entry of entries) {
		const resource = resolveRuntimeResource(sources, entry);
		if (!resource) throw new Error(`Recovered source '${entry.path}' is not in domain '${entry.domain}'.`);
		const model = await resolveTextFileModel(models, sources, resource);
		const path = buildWorkspaceDirtyEntryPath(runtimeSourceProjectRootPath(sources, entry.domain), entry.domain, entry.path);
		model.restoreDirtySource(records.get(path)!.contents);
	}
}

type RecoveryOptions = {
	identity: string; sourceContextId: string; projectRootPath: string; models: EditorTextModelService;
	sources: RuntimeSourceState; clock: HostClock; logOutput: LogOutput;
};

/** An isolated Studio's source-only recovery; never reads or writes the frontend session/layout. */
export class WorkspaceSourceRecovery {
	private readonly identity: string;
	private readonly statePath: string;
	private entries: WorkingCopyRecoveryEntry[] = [];
	private readonly records = new Map<string, WorkspaceRecord>();
	private timer: TimerHandle | undefined;
	private readonly subscriptions: (() => void)[] = [];
	private pending: Promise<void> = Promise.resolve();
	private stopped = false;
	private revision = 0;
	private publishedRevision = 0;
	public constructor(private readonly options: RecoveryOptions) {
		this.identity = joinWorkspacePaths(options.sourceContextId, options.identity);
		this.statePath = joinWorkspacePaths(options.projectRootPath, WORKSPACE_METADATA_DIR, 'studio', this.identity, 'sources.json');
	}

	public async initialize(): Promise<ReadonlyMap<string, WorkspaceRecord>> {
		const state = await workspaceRecords.read(this.statePath);
		if (state !== null) {
			this.entries = JSON.parse(state.contents).dirtyFiles;
			const loaded = await loadWorkspaceDirtySources(this.options.sources, this.entries, async (_root, path) => {
				const record = await workspaceRecords.read(path);
				if (record === null) throw new Error(`Incomplete source recovery: missing '${path}'.`);
				return record;
			}, this.identity);
			for (const [path, record] of loaded) this.records.set(path, record);
		}
		return this.records;
	}
	public async restoreModels(): Promise<void> {
		const { models, sources } = this.options;
		for (const entry of this.entries) {
			const resource = resolveRuntimeResource(sources, entry);
			if (!resource) throw new Error(`Recovered source '${entry.path}' is not in domain '${entry.domain}'.`);
			const mode = textFileMode(resource);
			if (mode === undefined) throw new Error(`Recovered resource '${entry.path}' has no text model.`);
			const model = models.retain(resource, mode, entry.savedSource, entry.savedSource, entry.persistedBaseline);
			const path = buildWorkspaceDirtyEntryPath(runtimeSourceProjectRootPath(sources, entry.domain), entry.domain, entry.path);
			model.restoreDirtySource(this.records.get(path)!.contents);
		}
	}
	public start(): void {
		const change = () => {
			++this.revision;
			this.timer?.cancel();
			this.timer = this.options.clock.scheduleOnce(2500, () => {
				this.timer = undefined;
				void this.flush().catch(error => this.options.logOutput.log(LogLevel.Error, `Source recovery failed: ${String(error)}`));
			});
		};
		this.subscriptions.push(this.options.models.onDidChangeContent(change), this.options.models.onDidSaveModel(change));
	}
	public flush(): Promise<void> {
		this.timer?.cancel(); this.timer = undefined;
		if (this.stopped) return this.pending;
		const revision = this.revision;
		this.pending = this.pending.catch(() => undefined).then(async () => {
			if (revision === this.publishedRevision) return;
			const { models, sources, clock } = this.options;
			const generation = captureWorkspaceDirtySources(models, sources, clock, this.records);
			await publishWorkspaceDirtySources(sources, generation.dirtyFiles, generation.dirtyRecords, this.entries, this.identity);
			await workspaceRecords.write(this.statePath, createWorkspaceRecord(clock, JSON.stringify({ dirtyFiles: generation.dirtyFiles })));
			await pruneWorkspaceDirtySources(sources, this.entries, generation.dirtyFiles, this.identity);
			this.entries = generation.dirtyFiles;
			this.records.clear();
			for (const [path, record] of generation.dirtyRecords) this.records.set(path, record);
			this.publishedRevision = revision;
		});
		return this.pending;
	}
	private stop(): void {
		this.timer?.cancel(); this.timer = undefined;
		for (const dispose of this.subscriptions) dispose();
		this.subscriptions.length = 0;
	}
	public async shutdown(): Promise<void> {
		this.stop();
		await this.flush();
		this.stopped = true;
	}
	public async discard(): Promise<void> {
		this.stop(); this.stopped = true;
		await this.pending;
		await workspaceRecords.delete(this.statePath);
		await pruneWorkspaceDirtySources(this.options.sources, this.entries, [], this.identity);
		this.entries = []; this.records.clear();
	}
}
