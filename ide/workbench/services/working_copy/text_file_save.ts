import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { HostClock } from '../../../../hosts/common/clock';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { EditorTextModel, EditorTextModelSnapshot } from '../../../editor/model/text_model';
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

type PendingSave = { readonly version: number; readonly result: Promise<TextFileSaveResult> };

/** Owns accepted Save operations until persistence and format-specific application finish. */
export class TextFileSaveService {
	private readonly pending = new Map<EditorTextModel, PendingSave>();
	private closing = false;

	public constructor(
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly sources: RuntimeSourceState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly runtime: Runtime,
		private readonly runtimeTasks: RuntimeTaskQueue,
	) {}

	public get acceptingSaves(): boolean { return !this.closing; }

	public save(model: EditorTextModel): Promise<TextFileSaveResult> {
		if (this.closing) throw new Error('Cannot save after workbench shutdown has started.');
		if (model.readOnly) throw new Error(`Source '${model.resource.path}' is read-only.`);
		const previous = this.pending.get(model);
		if (previous?.version === model.version) return previous.result;
		const snapshot = model.createSnapshot();
		// Admission captures the text now, not after the preceding write finishes.
		const result = (previous === undefined ? this.performSave(model, snapshot)
			: previous.result.then(() => this.performSave(model, snapshot))).finally(() => {
			if (this.pending.get(model) === operation) this.pending.delete(model);
		});
		const operation = { version: snapshot.version, result };
		this.pending.set(model, operation);
		return result;
	}

	/** Drain source writes before recovery checkpoints, model disposal or workspace replacement. */
	public async shutdown(): Promise<void> {
		this.closing = true;
		await Promise.all(Array.from(this.pending.values(), operation => operation.result));
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
