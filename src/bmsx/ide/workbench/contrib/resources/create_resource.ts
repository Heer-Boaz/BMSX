import * as constants from '../../../common/constants';
import { resourcePanel } from './resource_panel_controller';
import { setFieldText } from '../../../editor/ui/inline_text_field';
import { getActiveCodeTabContext } from '../../ui/tabs';
import { resetBlink } from '../../../editor/render/render_caret';
import { focusEditorFromSearch } from '../../../editor/contrib/find/editor_search';
import { focusEditorFromLineJump } from '../../../editor/contrib/find/line_jump';
import { listResources } from '../../../../emulator/workspace';
import { editorCaretState } from '../../../editor/ui/caret_state';
import { editorFeatureState } from '../../../editor/common/editor_feature_state';
import { renameController } from '../../../editor/contrib/rename/rename_controller';

export function openCreateResourcePrompt(): void {
	if (editorFeatureState.createResource.working) {
		return;
	}
	resourcePanel.setFocused(false);
	renameController.cancel();
	let defaultPath = editorFeatureState.createResource.path.length === 0
		? determineCreateResourceDefaultPath()
		: editorFeatureState.createResource.path;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	editorFeatureState.createResource.visible = true;
	editorFeatureState.createResource.active = true;
	editorFeatureState.createResource.error = null;
	editorCaretState.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	editorFeatureState.createResource.active = false;
	editorFeatureState.createResource.visible = false;
	editorFeatureState.createResource.working = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	editorFeatureState.createResource.error = null;
	resetBlink();
}

export function determineCreateResourceDefaultPath(): string {
	const lastDirectory = editorFeatureState.createResource.lastDirectory;
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
	editorFeatureState.createResource.path = value;
	setFieldText(editorFeatureState.createResource.field, value, moveCursorToEnd);
}
