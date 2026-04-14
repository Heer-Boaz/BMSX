import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { setFieldText } from '../../ui/inline_text_field';
import { getActiveCodeTabContext } from '../../ui/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { focusEditorFromSearch } from '../find/editor_search';
import { focusEditorFromLineJump } from '../find/line_jump';
import { listResources } from '../../../emulator/workspace';
import { editorCaretState } from '../../ui/caret_state';

export function openCreateResourcePrompt(): void {
	if (ide_state.createResource.working) {
		return;
	}
	ide_state.resourcePanel.setFocused(false);
	ide_state.renameController.cancel();
	let defaultPath = ide_state.createResource.path.length === 0
		? determineCreateResourceDefaultPath()
		: ide_state.createResource.path;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	ide_state.createResource.visible = true;
	ide_state.createResource.active = true;
	ide_state.createResource.error = null;
	editorCaretState.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	ide_state.createResource.active = false;
	ide_state.createResource.visible = false;
	ide_state.createResource.working = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	ide_state.createResource.error = null;
	resetBlink();
}

export function determineCreateResourceDefaultPath(): string {
	const lastDirectory = ide_state.createResource.lastDirectory;
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
	ide_state.createResource.path = value;
	setFieldText(ide_state.createResource.field, value, moveCursorToEnd);
}
