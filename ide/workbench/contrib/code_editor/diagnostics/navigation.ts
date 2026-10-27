import type { EditorDiagnostic } from '../../../../common/models';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../editor_input';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { EditorParts } from '../../../services/editor/editor_parts';

export function gotoDiagnostic(parts: EditorParts, diagnostic: EditorDiagnostic): void {
	const model = diagnostic.model;
	if (editorTextModelService.get(model.identity) !== model || model.version !== diagnostic.version) return;
	const group = parts.editorDestination(parts.activeGroup, { resource: model.resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
	group.openEditor(new CodeEditorInput(model), {
		selection: { row: diagnostic.row, startColumn: diagnostic.startColumn, endColumn: diagnostic.startColumn },
	});
}
