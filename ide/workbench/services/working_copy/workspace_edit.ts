import { DisposableStore } from '../../../common/lifecycle';
import type { EditorModelEdit, EditorTextModel } from '../../../editor/model/text_model';
import { EditorWorkspaceEditConflict } from '../../../editor/model/undo_redo_service';
import { createTextEditPreview, type TextEditPreviewHunk } from '../../../editor/text/edit_preview';
import type { WorkspaceSourceContext } from './source_context';
import type { HostClock } from '../../../../hosts/common/clock';
import type { LuaResourceCreationRequest, ResourceIdentity } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { createLuaResource } from '../../../workspace/workspace';
import { resolveTextFileModel } from './text_file_model';

export type WorkspaceEditProposalState = 'pending' | 'applying' | 'applied' | 'discarded' | 'stale' | 'failed';
export type WorkspaceEditPlan =
	| { readonly kind: 'edit'; readonly edits: ReadonlyMap<EditorTextModel, EditorModelEdit> }
	| { readonly kind: 'create'; readonly request: LuaResourceCreationRequest; readonly sources: RuntimeSourceState; readonly clock: HostClock };
export type WorkspaceEditPreviewFile = { readonly identity: ResourceIdentity; readonly hunks: readonly TextEditPreviewHunk[] } & ({
	readonly kind: 'edit';
	readonly model: EditorTextModel;
	readonly version: number;
} | { readonly kind: 'create' });

/** A one-shot source proposal, not a working copy, file writer or independent history. */
export class WorkspaceEditProposal {
	public readonly lifetime = new DisposableStore();
	public readonly files: readonly WorkspaceEditPreviewFile[];
	public readonly kind: WorkspaceEditPlan['kind'];
	private readonly edits = new Map<EditorTextModel, EditorModelEdit>();
	private stateValue: WorkspaceEditProposalState = 'pending';
	private reasonValue = '';
	private readonly settlementListeners = new Set<() => void>();
	private creation: Extract<WorkspaceEditPlan, { kind: 'create' }> | undefined;

	/** The caller transfers its captured context on successful construction. */
	public constructor(public readonly title: string, private readonly context: WorkspaceSourceContext,
		plan: WorkspaceEditPlan) {
		context.assertCurrent();
		this.kind = plan.kind;
		if (plan.kind === 'create') {
			this.creation = { ...plan, request: { ...plan.request } };
			this.files = [{ kind: 'create', identity: { domain: plan.request.domain, path: plan.request.relativePath },
				hunks: [{ offset: 0, line: 1, before: '', after: plan.request.contents }] }];
		} else {
			for (const [model, edit] of plan.edits) {
				if (edit.edits.length === 0) continue;
				const captured = context.read(model);
				if (captured.version !== edit.version || model.readOnly) throw new EditorWorkspaceEditConflict(model);
				this.edits.set(model, { ...edit, edits: edit.edits.map(operation => ({ ...operation })) });
			}
			this.files = [...this.edits].map(([model, edit]) => ({ kind: 'edit', identity: model.identity, model,
				version: edit.version, hunks: createTextEditPreview(model.buffer, edit.edits) }));
		}
		this.lifetime.add({ dispose: context.onDidInvalidate(() => this.invalidate(context.reason!)) });
		this.lifetime.add(context);
	}

	public get state(): WorkspaceEditProposalState { return this.stateValue; }
	public get reason(): string { return this.reasonValue; }

	/** One terminal outcome, after source/history admission and authority retirement. */
	public onDidSettle(listener: () => void): () => void {
		if (this.stateValue === 'pending' || this.stateValue === 'applying') this.settlementListeners.add(listener);
		return () => this.settlementListeners.delete(listener);
	}

	private publishSettlement(): void {
		this.edits.clear(); // Retain the review preview, not executable edit payloads.
		this.creation = undefined;
		for (const listener of this.settlementListeners) listener();
		this.settlementListeners.clear();
	}

	public invalidate(reason: string): void {
		if (this.stateValue !== 'pending') return;
		this.reasonValue = reason;
		this.stateValue = 'stale';
		this.lifetime.dispose();
		this.publishSettlement();
	}

	public apply(): readonly EditorTextModel[] | Promise<readonly EditorTextModel[]> {
		if (this.stateValue !== 'pending') throw new Error(`Source proposal is ${this.stateValue}.`);
		this.context.assertCurrent();
		// Stop observing before our own joint history operation publishes content.
		this.lifetime.dispose();
		this.stateValue = 'applying';
		if (this.creation !== undefined) {
			const { clock, sources, request } = this.creation;
			// Exclusive creation uses the same workspace owner as File: New Lua File.
			// No empty working copy, catalog entry or filesystem write exists before approval.
			return createLuaResource(clock, sources, request).then(async resource => {
				const model = await resolveTextFileModel(this.context.models, sources, resource);
				this.stateValue = 'applied';
				return [model];
			}).catch(error => {
				this.stateValue = 'failed';
				this.reasonValue = error instanceof Error ? error.message : String(error);
				throw error;
			}).finally(() => this.publishSettlement());
		}
		try {
			this.context.models.history.applyEdits(this.edits);
			this.stateValue = 'applied';
			return [...this.edits.keys()];
		} catch (error) {
			this.stateValue = error instanceof EditorWorkspaceEditConflict ? 'stale' : 'failed';
			this.reasonValue = error instanceof Error ? error.message : String(error);
			throw error;
		} finally { this.publishSettlement(); }
	}

	public dispose(): void {
		if (this.stateValue === 'pending') {
			this.stateValue = 'discarded';
			this.lifetime.dispose();
			this.publishSettlement();
		} else this.lifetime.dispose();
	}
}
