import * as constants from './constants';
import { ide_state } from './ide_state';
import { isKeyJustPressed, consumeIdeKey } from './input/key_input';
import { applyInlineFieldEditing } from './inline_text_field';
import { setFieldText } from './inline_text_field';
import { getActiveCodeTabContext } from './editor_tabs';
import { resetBlink } from './render/render_caret';
import { textFromLines } from './text/source_text';
import { focusEditorFromSearch } from './editor_search';
import { focusEditorFromLineJump } from './search_bars';
import { refreshResourcePanelContents } from './editor_view';
import { openLuaCodeTab } from './editor_tabs';
import { createLuaResource, listResources } from '../workspace';
import { extractErrorMessage } from '../../lua/luavalue';

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!ide_state.createResourceWorking && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (ide_state.createResourceWorking) {
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.createResourceField, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		ide_state.createResourceError = null;
		resetBlink();
	}
	ide_state.createResourcePath = textFromLines(ide_state.createResourceField.lines);
}

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

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (ide_state.createResourceWorking) {
		return;
	}
	let resourcePath: string;
	let directory: string;
	try {
		const result = parseCreateResourceRequest(ide_state.createResourcePath);
		resourcePath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(resourcePath, true);
		ide_state.createResourceError = null;
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.createResourceError = message;
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	ide_state.createResourceWorking = true;
	resetBlink();
	const contents = constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	try {
		const descriptor = await createLuaResource({ path: resourcePath, contents });
		ide_state.lastCreateResourceDirectory = directory;
		ide_state.pendingResourceSelectionAssetId = descriptor.asset_id;
		if (ide_state.resourcePanelVisible) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		ide_state.showMessage(`Created ${descriptor.path} (asset ${descriptor.asset_id})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = extractErrorMessage(error);
		const simplified = message.replace(/^\[Runtime\]\s*/, '');
		ide_state.createResourceError = simplified;
		ide_state.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		ide_state.createResourceWorking = false;
		resetBlink();
	}
}

export function isValidCreateResourceCharacter(value: string): boolean {
	if (value.length !== 1) {
		return false;
	}
	const code = value.charCodeAt(0);
	if (code >= 48 && code <= 57) {
		return true;
	}
	if (code >= 65 && code <= 90) {
		return true;
	}
	if (code >= 97 && code <= 122) {
		return true;
	}
	return value === '_' || value === '-' || value === '.' || value === '/';
}

export function parseCreateResourceRequest(rawPath: string): { path: string; asset_id: string; directory: string } {
	const candidate = rawPath;
	const slashIndex = candidate.lastIndexOf('/');
	const directory = slashIndex === -1 ? '' : candidate.slice(0, slashIndex + 1);
	const fileName = slashIndex === -1 ? candidate : candidate.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	return { path: candidate, asset_id: baseName, directory: ensureDirectorySuffix(directory) };
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
