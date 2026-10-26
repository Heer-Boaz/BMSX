import type { RuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/model';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { CodeEditorViewState } from '../../../editor/ui/code_editor_state';

export type CodeTabContext = {
	readonly model: EditorTextModel;
	readonly view: CodeEditorViewState;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};
