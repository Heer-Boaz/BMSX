import * as constants from '../../../../common/constants';
import { resourcePanel } from '../panel/controller';
import { setFieldText } from '../../../../editor/ui/inline/text_field';
import { getActiveCodeTabContext } from '../../../ui/code_tab/contexts';
import { resetBlink } from '../../../../editor/render/caret';
import { focusEditorFromSearch } from '../../../../editor/contrib/find/search';
import { focusEditorFromLineJump } from '../../../../editor/contrib/find/line_jump';
import { listResources } from '../../../../workspace/workspace';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { renameController } from '../../../../editor/contrib/rename/controller';
import { createResourceState } from '../widget_state';

export function openCreateResourcePrompt(): void {
	if (createResourceState.working) {
		return;
	}
	resourcePanel.setFocused(false);
	renameController.cancel();
	let defaultPath = createResourceState.path.length === 0
		? determineCreateResourceDefaultPath()
		: createResourceState.path;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	createResourceState.visible = true;
	createResourceState.active = true;
	createResourceState.error = null;
	editorCaretState.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	createResourceState.active = false;
	createResourceState.visible = false;
	createResourceState.working = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	createResourceState.error = null;
	resetBlink();
}

export function determineCreateResourceDefaultPath(): string {
	const lastDirectory = createResourceState.lastDirectory;
	if (lastDirectory.length > 0) {
		return lastDirectory;
	}
	const activeContext = getActiveCodeTabContext();
	const activePath = activeContext.descriptor.path;
	if (activePath.length > 0) {
		return ensureDirectorySuffix(activePath);
	}
	const descriptors = listResources();
	const firstEditableLua = descriptors.find(entry => entry.type === 'lua' && entry.readOnly !== true && entry.path.length > 0);
	if (firstEditableLua) {
		return ensureDirectorySuffix(firstEditableLua.path);
	}
	const firstLua = descriptors.find(entry => entry.type === 'lua' && entry.path.length > 0);
	if (firstLua) {
		return ensureDirectorySuffix(firstLua.path);
	}
	return './';
}

export function ensureDirectorySuffix(path: string): string {
	const slashIndex = path.lastIndexOf('/');
	if (slashIndex === -1) {
		return '';
	}
	return path.slice(0, slashIndex + 1);
}

export function applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
	createResourceState.path = value;
	setFieldText(createResourceState.field, value, moveCursorToEnd);
}
