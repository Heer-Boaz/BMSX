import { DisposableStore } from '../../../common/lifecycle';
import type { EditorModelEdit, EditorTextModel } from '../../../editor/model/text_model';
import { EditorWorkspaceEditConflict } from '../../../editor/model/undo_redo_service';
import { createTextEditPreview, type TextEditPreviewHunk } from '../../../editor/text/edit_preview';
import type { WorkspaceSourceContext } from './source_context';

export type WorkspaceEditProposalState = 'pending' | 'applying' | 'applied' | 'discarded' | 'stale' | 'failed';
export type WorkspaceEditPreviewFile = {
	readonly model: EditorTextModel;
	readonly version: number;
	readonly hunks: readonly TextEditPreviewHunk[];
};

/** A one-shot source proposal, not a working copy, file writer or independent history. */
export class WorkspaceEditProposal {
	public readonly lifetime = new DisposableStore();
	public readonly files: readonly WorkspaceEditPreviewFile[];
	private readonly edits = new Map<EditorTextModel, EditorModelEdit>();
	private stateValue: WorkspaceEditProposalState = 'pending';
	private reasonValue = '';

	/** The caller transfers its captured context on successful construction. */
	public constructor(public readonly title: string, private readonly context: WorkspaceSourceContext,
		edits: ReadonlyMap<EditorTextModel, EditorModelEdit>) {
		context.assertCurrent();
		for (const [model, edit] of edits) {
			if (edit.edits.length === 0) continue;
			const captured = context.read(model);
			if (captured.version !== edit.version || model.readOnly) throw new EditorWorkspaceEditConflict(model);
			this.edits.set(model, { ...edit, edits: edit.edits.map(operation => ({ ...operation })) });
		}
		this.files = [...this.edits].map(([model, edit]) => ({ model, version: edit.version, hunks: createTextEditPreview(model.buffer, edit.edits) }));
		this.lifetime.add({ dispose: context.onDidInvalidate(() => this.invalidate(context.reason!)) });
		this.lifetime.add(context);
	}

	public get state(): WorkspaceEditProposalState { return this.stateValue; }
	public get reason(): string { return this.reasonValue; }

	public invalidate(reason: string): void {
		if (this.stateValue !== 'pending') return;
		this.reasonValue = reason;
		this.stateValue = 'stale';
		this.lifetime.dispose();
	}

	public apply(): void {
		if (this.stateValue !== 'pending') throw new Error(`Source proposal is ${this.stateValue}.`);
		this.context.assertCurrent();
		// Stop observing before our own joint history operation publishes content.
		this.lifetime.dispose();
		this.stateValue = 'applying';
		try {
			this.context.models.history.applyEdits(this.edits);
			this.stateValue = 'applied';
		} catch (error) {
			this.stateValue = error instanceof EditorWorkspaceEditConflict ? 'stale' : 'failed';
			this.reasonValue = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	public dispose(): void {
		if (this.stateValue === 'pending') this.stateValue = 'discarded';
		this.lifetime.dispose();
	}
}
