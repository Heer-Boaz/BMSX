import { prepareDebuggerStepOverlay, RuntimeDebuggerCommandExecutor, toggleBreakpointForEditorRow } from '../../../workbench/contrib/debugger/ide_debugger';
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
	const executor = RuntimeDebuggerCommandExecutor.instance;
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const shiftDown = isShiftDown();
	const altDown = isAltDown();
	if (!executor || !executor.suspended) {
		return false;
	}
	if (ctrlDown || altDown || metaDown) {
		return false;
	}
	if (isKeyJustPressed('F5')) {
		consumeIdeKey('F5');
		if (shiftDown) {
			return executor.issueDebuggerCommand('ignore_exception');
		}
		return executor.issueDebuggerCommand('continue');
	}
	if (isKeyJustPressed('F10')) {
		consumeIdeKey('F10');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out_exception');
		}
		return executor.issueDebuggerCommand('step_over');
	}
	if (isKeyJustPressed('F11')) {
		consumeIdeKey('F11');
		if (shiftDown) {
			return executor.issueDebuggerCommand('step_out');
		}
		return executor.issueDebuggerCommand('step_into');
	}
	return false;
}
