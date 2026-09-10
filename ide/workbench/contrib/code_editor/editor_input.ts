import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { CodeEditorTabId } from '../../ui/tab/id';
import type { CodeTabContext } from '../../ui/code_tab/model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import { sourceTabDescription } from '../../ui/tab/titles';

export const WORKBENCH_TEXT_EDITOR_ID = 'workbench.editor.text';

/** Text-editor view state for one retained resource-owned working copy. */
export class CodeEditorInput extends WorkingCopyEditorInput<CodeEditorTabId, 'code_editor'> {
	public constructor(public context: CodeTabContext) {
		super(context.id, 'code_editor', context.title, true);
		this.setLabel(context.title, sourceTabDescription(context.model.resource));
	}

	public get workingCopy(): EditorTextModel {
		return this.context.model;
	}

	public override toResourceEditor(): ResourceEditorIdentity {
		return { resource: this.workingCopy.resource, editorId: WORKBENCH_TEXT_EDITOR_ID };
	}
}
