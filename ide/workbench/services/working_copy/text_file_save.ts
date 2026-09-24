import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { HostClock } from '../../../../hosts/common/clock';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { EditorTextModel, EditorTextModelSnapshot } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { applyAemSourceRevision, type AemSourceApplyResult } from '../../../runtime/aem';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../runtime/sources';
import { workspaceCanonicalSourceCache } from '../../../workspace/cache';
import { persistWorkspaceSourceFile } from '../../../workspace/files';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { resolveWorkspacePath } from '../../../workspace/path';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import type { WorkspaceRecordPersistence } from '../../../workspace/records';

export type TextFileSaveResult = { readonly snapshot: EditorTextModelSnapshot } & (
	| { readonly status: 'saved'; readonly persistence: WorkspaceRecordPersistence;
		readonly application: AemSourceApplyResult | { readonly status: 'not-requested' } }
	| { readonly status: 'failed'; readonly error: unknown }
);

export type TextFileSaveOperation = {
	readonly id: number;
	readonly snapshot: EditorTextModelSnapshot;
	readonly completion: Promise<TextFileSaveResult>;
	readonly result: TextFileSaveResult | undefined;
};

/** Owns accepted Save operations until persistence and format-specific application finish. */
export class TextFileSaveService {
	private readonly pending = new Map<EditorTextModel, TextFileSaveOperation>();
	private readonly latest = new WeakMap<EditorTextModel, TextFileSaveOperation>();
	private serial = 0;
	private closing = false;

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly sources: RuntimeSourceState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly runtime: Runtime,
		private readonly runtimeTasks: RuntimeTaskQueue,
	) {}

	public get acceptingSaves(): boolean { return !this.closing; }
	/** Historical acknowledgement of this model's latest Save, never inferred from connectivity. */
	public latestOperation(model: EditorTextModel): TextFileSaveOperation | undefined { return this.latest.get(model); }

	public save(model: EditorTextModel): TextFileSaveOperation {
		if (this.closing) throw new Error('Cannot save after workbench shutdown has started.');
		if (this.models.get(model.identity) !== model) throw new Error(`Source '${model.resource.path}' no longer belongs to this workspace.`);
		if (model.readOnly) throw new Error(`Source '${model.resource.path}' is read-only.`);
		const previous = this.pending.get(model);
		if (previous?.snapshot.version === model.version) return previous;
		const snapshot = model.createSnapshot();
		// Admission captures the text now, not after the preceding write finishes.
		const completion = (previous === undefined ? this.performSave(model, snapshot)
			: previous.completion.then(() => this.performSave(model, snapshot))).then(result => {
			operation.result = result;
			return result;
		}).finally(() => {
			if (this.pending.get(model) === operation) this.pending.delete(model);
		});
		const operation = { id: ++this.serial, snapshot, completion, result: undefined as TextFileSaveResult | undefined };
		this.pending.set(model, operation);
		this.latest.set(model, operation);
		return operation;
	}

	/** Drain source writes before recovery checkpoints, model disposal or workspace replacement. */
	public async shutdown(): Promise<void> {
		this.closing = true;
		await Promise.all(Array.from(this.pending.values(), operation => operation.completion));
	}

	private async performSave(model: EditorTextModel, snapshot: EditorTextModelSnapshot): Promise<TextFileSaveResult> {
		const resource = model.resource;
		let persistence: WorkspaceRecordPersistence;
		try {
			switch (model.mode) {
				case 'lua':
					({ persistence } = await saveLuaResourceSource(this.storage, this.clock, this.sources, resource, snapshot.source));
					break;
				case 'yaml':
				case 'aem': {
					const root = runtimeSourceProjectRootPath(this.sources, resource.domain);
					const path = resolveWorkspacePath(resource.path, root);
					({ persistence } = await persistWorkspaceSourceFile(this.storage, this.clock, path, snapshot.source, root));
					workspaceCanonicalSourceCache.set(path, snapshot.source);
					break;
				}
			}
		} catch (error) {
			return { status: 'failed', snapshot, error };
		}
		model.completeSave(snapshot);
		const application = model.mode === 'aem'
			? await applyAemSourceRevision(this.sources, this.luaTooling, this.runtime, this.runtimeTasks, resource, snapshot.source)
			: { status: 'not-requested' } as const;
		return { status: 'saved', snapshot, persistence, application };
	}
}
