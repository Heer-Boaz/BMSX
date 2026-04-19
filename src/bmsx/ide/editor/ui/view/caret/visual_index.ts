import { editorDocumentState } from '../../../editing/document_state';
import { editorViewState } from '../state';
import { caretNavigation } from './state';

export function resolveCursorVisualIndex(): number {
	const override = caretNavigation.lookup(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
	if (override) {
		return override.visualIndex;
	}
	return editorViewState.layout.positionToVisualIndex(editorDocumentState.cursorRow, editorDocumentState.cursorColumn);
}
