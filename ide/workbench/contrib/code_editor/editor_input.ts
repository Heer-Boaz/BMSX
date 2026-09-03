import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { CodeEditorTabId } from '../../ui/tab/id';
import type { CodeTabContext } from '../../ui/code_tab/model';

/** Text-editor view state for one retained resource-owned working copy. */
export class CodeEditorInput extends WorkingCopyEditorInput<CodeEditorTabId, 'code_editor'> {
	public constructor(public context: CodeTabContext) {
		super(context.id, 'code_editor', context.title, true);
	}

	public get workingCopy(): EditorTextModel {
		return this.context.model;
	}
}
