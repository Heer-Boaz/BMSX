import { cycleTab } from '../../ui/tabs';
import { isCodeTabActive } from '../../ui/code_tab/contexts';
import { selectAllSingleCursor } from '../../../editor/editing/cursor/state';
import { revealCursor, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../editor/render/caret';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import { isInlineWidgetFocused } from '../../../quick_input/inline_widget';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

function handleCreateResourceBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyN')) {
		return false;
	}
	consumeIdeKey('KeyN');
	runtime.editor.commands.execute('createResource');
	return true;
}

function handleGlobalFindBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	runtime.editor.commands.execute('findGlobal');
	return true;
}

function handleLocalFindBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	runtime.editor.commands.execute('findLocal');
	return true;
}

function handleCycleTabBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('Tab')) {
		return false;
	}
	consumeIdeKey('Tab');
	cycleTab(isShiftDown() ? -1 : 1);
	return true;
}

function handleDefinitionAndReferenceBinding(runtime: Runtime): boolean {
	if (isInlineWidgetFocused() || !isKeyJustPressed('F12')) {
		return false;
	}
	consumeIdeKey('F12');
	if (isShiftDown()) {
		runtime.editor.commands.execute('referenceSearch');
		return true;
	}
	runtime.editor.commands.execute('goToDefinition');
	return true;
}

function handleRenameBinding(runtime: Runtime): boolean {
	if (isInlineWidgetFocused() || !isCodeTabActive() || !isKeyJustPressed('F2')) {
		return false;
	}
	consumeIdeKey('F2');
	runtime.editor.commands.execute('rename');
	return true;
}

function handleSelectAllBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isInlineWidgetFocused() || !isCodeTabActive() || !isKeyJustPressed('KeyA')) {
		return false;
	}
	if (runtime.editor.resourcePanel.isFocused()) {
		return false;
	}
	consumeIdeKey('KeyA');
	const lastRowIndex = editorDocumentState.buffer.getLineCount() - 1;
	const lastColumn = editorDocumentState.buffer.getLineEndOffset(lastRowIndex) - editorDocumentState.buffer.getLineStartOffset(lastRowIndex);
	selectAllSingleCursor(editorDocumentState, lastRowIndex, lastColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	return true;
}

function handleLineJumpBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyL')) {
		return false;
	}
	consumeIdeKey('KeyL');
	runtime.editor.commands.execute('lineJump');
	return true;
}

export function handleEditorPromptBindings(runtime: Runtime): boolean {
	return handleCreateResourceBinding(runtime)
		|| handleGlobalFindBinding(runtime)
		|| handleLocalFindBinding(runtime)
		|| handleCycleTabBinding()
		|| handleDefinitionAndReferenceBinding(runtime)
		|| handleRenameBinding(runtime)
		|| handleSelectAllBinding(runtime)
		|| handleLineJumpBinding(runtime);
}
