import * as constants from '../../constants';
import { ide_state } from '../../ide_state';
import { setFieldText } from '../../browser/inline_text_field';
import { getActiveCodeTabContext } from '../../browser/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { focusEditorFromSearch } from '../find/editor_search';
import { focusEditorFromLineJump } from '../find/line_jump';
import { listResources } from '../../../workspace';

export function openCreateResourcePrompt(): void {
	if (ide_state.createResourceWorking) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	ide_state.renameController.cancel();
	let defaultPath = ide_state.createResourcePath.length === 0
		? determineCreateResourceDefaultPath()
		: ide_state.createResourcePath;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	ide_state.createResourceVisible = true;
	ide_state.createResourceActive = true;
	ide_state.createResourceError = null;
	ide_state.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	ide_state.createResourceWorking = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	resetBlink();
}

export function determineCreateResourceDefaultPath(): string {
	const lastDirectory = ide_state.lastCreateResourceDirectory;
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
	ide_state.createResourcePath = value;
	setFieldText(ide_state.createResourceField, value, moveCursorToEnd);
}
