import type { CartEditor } from '../cart_editor';
import type { InputFocusTarget } from '../input/focus';
import type { EditorInput } from '../workbench/common/editor_inputs';
import { findEditorGroup, type EditorGroupView } from '../workbench/services/editor/editor_group';

/** A command's document subject, never its prospective opening destination. */
export type EditorCommandDocument = { readonly group: EditorGroupView; readonly input: EditorInput | null };

/** Main clients own their own subjects; only ordinary document chrome inherits the active document. */
export function resolveEditorCommandGroup(editor: CartEditor, target: InputFocusTarget | null,
	input?: EditorInput): EditorGroupView | null | undefined {
	const owner = findEditorGroup(target), part = editor.editorParts.partForTarget(target);
	if (owner === null || part === null) return null;
	if (input !== undefined) return editor.editorParts.findGroup(input);
	return owner ?? (editor.mainWorkspace.isPrimaryTarget(target) || editor.mainWorkspace.isActivityTarget(target)
		? undefined : part?.activeGroup ?? editor.editorParts.activeGroup);
}
