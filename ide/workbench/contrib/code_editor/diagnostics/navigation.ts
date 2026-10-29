import type { EditorDiagnostic } from '../../../../common/models';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../editor_input';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { EditorSourceLocation } from '../../../../editor/navigation/source_location';
import type { EditorParts } from '../../../services/editor/editor_parts';

/** A marker is an observation of one canonical source generation, never a remapped later caret. */
export function getDiagnosticSourceLocation(diagnostic: EditorDiagnostic): EditorSourceLocation | undefined {
	const model = diagnostic.model;
	if (editorTextModelService.get(model.identity) !== model || model.version !== diagnostic.version) return;
	return { model, modelVersion: diagnostic.version,
		selection: { row: diagnostic.row, startColumn: diagnostic.startColumn, endColumn: diagnostic.startColumn } };
}

export function gotoDiagnostic(parts: EditorParts, diagnostic: EditorDiagnostic): void {
	const location = getDiagnosticSourceLocation(diagnostic);
	if (location === undefined) return;
	const group = parts.editorDestination(parts.activeGroup, { resource: location.model.resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
	group.openEditor(new CodeEditorInput(location.model), {
		selection: { ...location.selection!, generation: location },
	});
}
