import { ensureVisualLines } from '../../../editor/common/text/layout';
import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { CodeEditorInput } from './editor_input';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../editor/render/caret';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';

import { captureCodeEditorView, mapCodeEditorView, restoreCodeEditorView, type CodeEditorLocation } from './view_snapshot';

/** A live text location, not an undo snapshot or a reference to a mutable view. */
export class CodeEditorNavigationSelection extends EditorPaneSelection {
	public readonly snapshot: CodeEditorLocation;

	public constructor(input: CodeEditorInput) {
		super();
		this.snapshot = captureCodeEditorView(input);
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => mapCodeEditorView(this.snapshot, event.changes)) });
	}

	public matches(other: CodeEditorNavigationSelection): boolean {
		return this.snapshot.cursor === other.snapshot.cursor && this.snapshot.anchor === other.snapshot.anchor;
	}

	public restore(input: CodeEditorInput): void {
		restoreCodeEditorView(input, this.snapshot);
		ensureVisualLines();
		clearEditorPointerSelectionState();
		updateDesiredColumn();
		resetBlink();
		activeCodeEditor.emitCursorMoved();
	}
}
