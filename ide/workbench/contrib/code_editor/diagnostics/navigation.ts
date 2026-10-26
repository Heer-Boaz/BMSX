import type { EditorDiagnostic } from '../../../../common/models';
import { CodeEditorInput } from '../editor_input';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { EditorGroupView } from '../../../services/editor/editor_group';

export function gotoDiagnostic(editorGroup: EditorGroupView, diagnostic: EditorDiagnostic): void {
	const model = diagnostic.model;
	if (editorTextModelService.get(model.identity) !== model || model.version !== diagnostic.version) return;
	editorGroup.openEditor(new CodeEditorInput(model), {
		selection: { row: diagnostic.row, startColumn: diagnostic.startColumn, endColumn: diagnostic.startColumn },
	});
}
