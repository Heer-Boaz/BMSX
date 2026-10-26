import type { CodeEditorControl } from '../../editor/ui/code_editor_control';

export function resetPointerClickTracking(code: CodeEditorControl): void {
	code.pointer.lastPointerClickTimeMs = 0;
	code.pointer.lastPointerClickRow = -1;
	code.pointer.lastPointerClickColumn = -1;
}

export function clearEditorPointerSelectionState(code: CodeEditorControl): void {
	code.pointer.pointerSelecting = false;
	code.pointer.lastPointerRowResolution = null;
	resetPointerClickTracking(code);
}
