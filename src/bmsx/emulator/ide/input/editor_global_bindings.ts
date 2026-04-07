import { executeEditorCommand } from './editor_commands';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { handleEscapeKey } from './editor_modal_input';
import { ESCAPE_KEY } from '../constants';
import { runEditorKeyHandlers, type EditorKeyHandler } from './editor_binding_utils';

function handleEscapeBinding(): boolean {
	if (!isKeyJustPressed(ESCAPE_KEY) || !handleEscapeKey()) {
		return false;
	}
	consumeIdeKey(ESCAPE_KEY);
	return true;
}

function handleHotResumeBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || !isKeyJustPressed('KeyS')) {
		return false;
	}
	consumeIdeKey('KeyS');
	executeEditorCommand('hot-resume');
	return true;
}

function handleRebootBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || !isKeyJustPressed('KeyR')) {
		return false;
	}
	consumeIdeKey('KeyR');
	executeEditorCommand('reboot');
	return true;
}

function handleThemeToggleBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isAltDown() || !isKeyJustPressed('KeyT')) {
		return false;
	}
	consumeIdeKey('KeyT');
	executeEditorCommand('theme-toggle');
	return true;
}

function handleSymbolSearchBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || !isKeyJustPressed('KeyO')) {
		return false;
	}
	consumeIdeKey('KeyO');
	executeEditorCommand('symbolSearch');
	return true;
}

function handleResourceFilterBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || !isKeyJustPressed('KeyL')) {
		return false;
	}
	consumeIdeKey('KeyL');
	executeEditorCommand('filter');
	return true;
}

function handleOpenResourceSearchBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isAltDown() || !isKeyJustPressed('Comma')) {
		return false;
	}
	consumeIdeKey('Comma');
	executeEditorCommand('resourceSearch');
	return true;
}

function handleFocusRuntimeErrorBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isAltDown() || isShiftDown() || !isKeyJustPressed('KeyE')) {
		return false;
	}
	consumeIdeKey('KeyE');
	executeEditorCommand('runtimeErrorFocus');
	return true;
}

function handleCtrlAltSymbolSearchBinding(): boolean {
	if (!isCtrlDown() || !isAltDown() || !isKeyJustPressed('Comma')) {
		return false;
	}
	consumeIdeKey('Comma');
	executeEditorCommand('symbolSearch');
	return true;
}

function handleToggleResourcePanelBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyB')) {
		return false;
	}
	consumeIdeKey('KeyB');
	executeEditorCommand('resources');
	return true;
}

function handleToggleProblemsBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || !isKeyJustPressed('KeyM')) {
		return false;
	}
	consumeIdeKey('KeyM');
	executeEditorCommand('problems');
	return true;
}

function handleOpenGlobalSymbolSearchBinding(): boolean {
	if (isCtrlDown() || isMetaDown() || !isAltDown() || !isKeyJustPressed('Comma')) {
		return false;
	}
	consumeIdeKey('Comma');
	executeEditorCommand('symbolSearchGlobal');
	return true;
}

const editorGlobalKeyHandlers: readonly EditorKeyHandler[] = [
	handleEscapeBinding,
	handleHotResumeBinding,
	handleRebootBinding,
	handleThemeToggleBinding,
	handleSymbolSearchBinding,
	handleResourceFilterBinding,
	handleOpenResourceSearchBinding,
	handleFocusRuntimeErrorBinding,
	handleCtrlAltSymbolSearchBinding,
	handleToggleResourcePanelBinding,
	handleToggleProblemsBinding,
	handleOpenGlobalSymbolSearchBinding,
];

export function handleEditorGlobalBindings(): boolean {
	return runEditorKeyHandlers(editorGlobalKeyHandlers);
}
