import type { BreakpointController } from '../../workbench/contrib/debugger/controller';
import { consumeIdeKey, isKeyJustPressed } from './key_input';

export function handleEditorBreakpointInput(breakpoints: BreakpointController): boolean {
	if (!isKeyJustPressed('F9')) {
		return false;
	}
	consumeIdeKey('F9');
	breakpoints.toggleBreakpointForEditorRow();
	return true;
}
