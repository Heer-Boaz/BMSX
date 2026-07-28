import type { BreakpointController } from '../../workbench/contrib/debugger/controller';
import { consumeIdeKey, isKeyJustPressed } from './key_input';
import type { PlayerInput } from '../../../machine/ts/input/player';

export function handleEditorBreakpointInput(playerInput: PlayerInput, breakpoints: BreakpointController): boolean {
	if (!isKeyJustPressed('F9', playerInput)) {
		return false;
	}
	consumeIdeKey('F9', playerInput);
	breakpoints.toggleBreakpointForEditorRow();
	return true;
}
