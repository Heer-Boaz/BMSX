import type { BreakpointController } from '../../workbench/contrib/debugger/controller';
import { consumeIdeKey, isKeyJustPressed } from './key_input';
import type { KeyInputEvent } from '../../../hosts/common/input/text';

export function handleEditorBreakpointInput(playerInput: KeyInputEvent, breakpoints: BreakpointController): boolean {
	if (!isKeyJustPressed('F9', playerInput)) {
		return false;
	}
	consumeIdeKey('F9', playerInput);
	breakpoints.toggleBreakpointForEditorRow();
	return true;
}
