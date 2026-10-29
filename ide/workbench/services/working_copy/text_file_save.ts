import type { HostClock } from '../../../../hosts/common/clock';
import type { EditorTextModel, EditorTextModelSnapshot } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { persistWorkspaceSourceFile } from '../../../workspace/files';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import type { WorkspaceRecordPersistence } from '../../../workspace/records';

export type TextFileSaveResult = { readonly snapshot: EditorTextModelSnapshot } & (
	| { readonly status: 'saved'; readonly persistence: WorkspaceRecordPersistence;
		readonly application: { readonly status: 'not-requested' } }
	| { readonly status: 'failed'; readonly error: unknown }
);

export type TextFileSaveOperation = {
	readonly id: number;
	readonly snapshot: EditorTextModelSnapshot;
	readonly completion: Promise<TextFileSaveResult>;
	readonly result: TextFileSaveResult | undefined;
};

/** Owns canonical source writes; installing a saved revision is a separate target operation. */
export class TextFileSaveService {
	private readonly pending = new Map<EditorTextModel, TextFileSaveOperation>();
	private readonly latest = new WeakMap<EditorTextModel, TextFileSaveOperation>();
	private serial = 0;
	private closing = false;

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly clock: HostClock,
		private readonly catalog: WorkspaceSourceCatalog,
	) {}

	public get acceptingSaves(): boolean { return !this.closing; }
	/** Live persistence admission, independent of dirty state or an attached control's draft. */
	public canSave(model: EditorTextModel): boolean {
		return this.acceptingSaves && this.models.get(model.identity) === model && !model.readOnly;
	}
	/** Historical acknowledgement of this model's latest Save, never inferred from connectivity. */
	public latestOperation(model: EditorTextModel): TextFileSaveOperation | undefined { return this.latest.get(model); }

	public save(model: EditorTextModel): TextFileSaveOperation {
		if (this.closing) throw new Error('Cannot save after workbench shutdown has started.');
		if (this.models.get(model.identity) !== model) throw new Error(`Source '${model.resource.path}' no longer belongs to this workspace.`);
		if (model.readOnly) throw new Error(`Source '${model.resource.path}' is read-only.`);
		const previous = this.pending.get(model);
		if (previous?.snapshot.version === model.version) return previous;
		const snapshot = model.createSnapshot();
		const sourceFilePath = model.resource.sourceFilePath;
		// Admission captures the text now, not after the preceding write finishes.
		const completion = (previous === undefined ? this.performSave(model, snapshot, sourceFilePath)
			: previous.completion.then(() => this.performSave(model, snapshot, sourceFilePath))).then(result => {
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

	private async performSave(model: EditorTextModel, snapshot: EditorTextModelSnapshot, sourceFilePath: string | undefined): Promise<TextFileSaveResult> {
		const resource = model.resource;
		let persistence: WorkspaceRecordPersistence;
		try {
			switch (model.mode) {
				case 'lua':
					({ persistence } = await saveLuaResourceSource(this.clock, this.catalog, resource, snapshot.source, model.persistedBaseline));
					break;
				case 'yaml':
				case 'aem': {
					({ persistence } = await persistWorkspaceSourceFile(this.clock, sourceFilePath!, snapshot.source, model.persistedBaseline));
					break;
				}
			}
		} catch (error) {
			return { status: 'failed', snapshot, error };
		}
		model.completeSave(snapshot);
		return { status: 'saved', snapshot, persistence, application: { status: 'not-requested' } };
	}
}
