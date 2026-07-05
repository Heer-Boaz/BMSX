import { machineManager } from '../../../core/machine_manager';
import { prepareDebuggerStepOverlay, toggleBreakpointForEditorRow } from '../../workbench/contrib/debugger/controller';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';

export function handleEditorDebuggerInput(): boolean {
	if (handleDebuggerShortcuts()) {
		return true;
	}
	if (!isKeyJustPressed('F9')) {
		return false;
	}
	consumeIdeKey('F9');
	toggleBreakpointForEditorRow();
	return true;
}

function handleDebuggerShortcuts(): boolean {
	const handled = evaluateDebuggerShortcuts();
	if (handled) {
		prepareDebuggerStepOverlay();
	}
	return handled;
}

function evaluateDebuggerShortcuts(): boolean {
	const debuggerUi = machineManager.ideState.editor.debugger;
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();
	const altDown = isAltDown();
	if (!debuggerUi.suspended) {
		return false;
	}
	if (ctrlDown || altDown || metaDown) {
		return false;
	}
	if (isKeyJustPressed('F5')) {
		consumeIdeKey('F5');
		if (shiftDown) {
			return debuggerUi.issueDebuggerCommand('ignore_exception');
		}
		return debuggerUi.issueDebuggerCommand('continue');
	}
	if (isKeyJustPressed('F10')) {
		consumeIdeKey('F10');
		if (shiftDown) {
			return debuggerUi.issueDebuggerCommand('step_out_exception');
		}
		return debuggerUi.issueDebuggerCommand('step_over');
	}
	if (isKeyJustPressed('F11')) {
		consumeIdeKey('F11');
		if (shiftDown) {
			return debuggerUi.issueDebuggerCommand('step_out');
		}
		return debuggerUi.issueDebuggerCommand('step_into');
	}
	return false;
}
