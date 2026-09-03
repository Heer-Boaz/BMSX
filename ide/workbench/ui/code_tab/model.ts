import type { RuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/model';
import type { CodeEditorInputId } from '../../../common/editor_context';
import type {
	CodeEditorDocumentMode,
	EditorTextModel,
} from '../../../editor/model/text_model';
import type { CodeEditorViewState } from '../../../editor/ui/code_editor_state';

export type CodeTabContext = {
	id: CodeEditorInputId;
	title: string;
	model: EditorTextModel<CodeEditorDocumentMode>;
	view: CodeEditorViewState;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};
