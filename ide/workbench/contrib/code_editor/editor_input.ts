import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import { buildCodeTabId, type CodeEditorTabId } from '../../ui/tab/id';
import type { CodeTabContext } from '../../ui/code_tab/model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import { createCodeEditorViewState } from '../../../editor/ui/code_editor_state';
import { CodeEditorViewBinding } from '../../../editor/ui/code_editor_view_binding';
import { captureCodeEditorView, restoreCodeEditorView, type CodeEditorLocation } from './view_snapshot';

export const WORKBENCH_TEXT_EDITOR_ID = 'workbench.editor.text';

/** Text-editor view state for one retained resource-owned working copy. */
export class CodeEditorInput extends WorkingCopyEditorInput<CodeEditorTabId, 'code_editor'> {
	public readonly context: CodeTabContext;
	private initialized = false;
	public override canMove(): boolean { return true; }

	public constructor(model: EditorTextModel) {
		const id = buildCodeTabId(model.resource), title = computeResourceTabTitle(model.resource);
		super(id, 'code_editor', title, true);
		const view = createCodeEditorViewState();
		this.context = { model, view, runtimeErrorOverlay: null, executionStopRow: null };
		this.disposables.add(new CodeEditorViewBinding(model, view));
		this.setLabel(title, sourceTabDescription(model.resource), 'Source');
	}

	/** First attachment supplies a group memento; deserialization admits its own initial state earlier. */
	public initializeViewState(snapshot?: CodeEditorLocation): void {
		if (this.initialized) return;
		this.initialized = true;
		if (snapshot !== undefined) restoreCodeEditorView(this, snapshot);
	}

	public get workingCopy(): EditorTextModel {
		return this.context.model;
	}

	public createView(): CodeEditorInput {
		const input = new CodeEditorInput(this.workingCopy);
		input.initializeViewState(captureCodeEditorView(this));
		return input;
	}

	public override toResourceEditor(): ResourceEditorIdentity {
		return { resource: this.workingCopy.resource, editorId: WORKBENCH_TEXT_EDITOR_ID };
	}
}
