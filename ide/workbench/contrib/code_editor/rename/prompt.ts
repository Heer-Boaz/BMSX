import type { RenameController } from './controller';
import type { EditorGroupView } from '../../../services/editor/editor_group';
import { notifyReadOnlyEdit } from '../../../../editor/ui/view/view';

/** Resolve this control's rename request; the pane arranges and focuses the actual field. */
export function openRenamePrompt(rename: RenameController, reviewGroup?: EditorGroupView): boolean {
	const code = rename.code;
	if (code.model.readOnly) { notifyReadOnlyEdit(); return false; }
	if (code.model.mode !== 'lua') return false;
	return rename.begin({ buffer: code.model.buffer, cursorRow: code.view.cursorRow,
		cursorColumn: code.view.cursorColumn, identity: code.model.resource }, reviewGroup);
}
