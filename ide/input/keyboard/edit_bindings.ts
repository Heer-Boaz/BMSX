import type { CodeEditorControl } from '../../editor/ui/code_editor_control';
import type { EditorSearchController } from '../../workbench/contrib/code_editor/find/search';
import { notifyReadOnlyEdit } from '../../editor/ui/view/view';
import { toggleLineComments } from '../../editor/editing/line_comments';
import { applyDocumentFormatting, indentSelectionOrLine, unindentSelectionOrLine } from '../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import type { KeyInputEvent } from '../../../hosts/common/input/text';

export function handleSearchNavigationKeybinding(find: EditorSearchController, input: KeyInputEvent): boolean {
	if (find.state.query.length === 0 || !isKeyJustPressed('F3', input)) return false;
	consumeIdeKey('F3', input);
	if (isShiftDown(input)) find.jumpToPreviousMatch();
	else find.jumpToNextMatch();
	return true;
}

export function handleCodeFormattingKeybinding(code: CodeEditorControl, input: KeyInputEvent): boolean {
	if (!isAltDown(input) || !isShiftDown(input) || isCtrlDown(input) || isMetaDown(input) || !isKeyJustPressed('KeyF', input)) return false;
	consumeIdeKey('KeyF', input);
	applyDocumentFormatting(code);
	return true;
}

export function handleEditorEditingBindings(code: CodeEditorControl, input: KeyInputEvent): boolean {
	let key: string;
	let edit: (control: CodeEditorControl) => void;
	if ((isCtrlDown(input) || isMetaDown(input)) && !isAltDown(input)
		&& (isKeyJustPressed('Slash', input) || isKeyJustPressed('NumpadDivide', input))) {
		key = isKeyJustPressed('Slash', input) ? 'Slash' : 'NumpadDivide';
		edit = toggleLineComments;
	} else if (isCtrlDown(input) && isKeyJustPressed('BracketRight', input)) {
		key = 'BracketRight'; edit = indentSelectionOrLine;
	} else if (isCtrlDown(input) && isKeyJustPressed('BracketLeft', input)) {
		key = 'BracketLeft'; edit = unindentSelectionOrLine;
	} else return false;
	consumeIdeKey(key, input);
	if (code.model.readOnly) notifyReadOnlyEdit();
	else edit(code);
	return true;
}
