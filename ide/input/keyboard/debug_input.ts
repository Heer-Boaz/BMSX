import type { CodeEditorControl } from '../../editor/ui/code_editor_control';
import type { BreakpointController } from '../../workbench/contrib/debugger/controller';
import { consumeIdeKey, isKeyJustPressed } from './key_input';
import type { KeyInputEvent } from '../../../hosts/common/input/text';

export function handleEditorBreakpointInput(code: CodeEditorControl, playerInput: KeyInputEvent, breakpoints: BreakpointController): boolean {
	if (!isKeyJustPressed('F9', playerInput)) {
		return false;
	}
	consumeIdeKey('F9', playerInput);
	breakpoints.toggleBreakpointForEditorRow(code);
	return true;
}
