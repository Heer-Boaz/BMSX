import * as constants from '../../core/constants';
import { resourcePanel } from './resource_panel_controller';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { resetBlink } from '../../render/render_caret';
import { refreshResourcePanelContents } from '../../ui/editor_view';
import { openLuaCodeTab } from '../../ui/editor_tabs';
import { createLuaResource } from '../../../emulator/workspace';
import { extractErrorMessage } from '../../../lua/luavalue';
import { applyCreateResourceFieldText, closeCreateResourcePrompt, ensureDirectorySuffix } from './create_resource';
import { editorSessionState } from '../../ui/editor_session_state';
import { editorFeatureState } from '../../core/editor_feature_state';

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (editorFeatureState.createResource.working) {
		return;
	}
	let resourcePath: string;
	let directory: string;
	try {
		const result = parseCreateResourceRequest(editorFeatureState.createResource.path);
		resourcePath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(resourcePath, true);
		editorFeatureState.createResource.error = null;
	} catch (error) {
		const message = extractErrorMessage(error);
		editorFeatureState.createResource.error = message;
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	editorFeatureState.createResource.working = true;
	resetBlink();
	const contents = constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	try {
		const descriptor = await createLuaResource({ path: resourcePath, contents });
		editorFeatureState.createResource.lastDirectory = directory;
		editorSessionState.pendingResourceSelectionAssetId = descriptor.asset_id;
		if (resourcePanel.isVisible()) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		showEditorMessage(`Created ${descriptor.path} (asset ${descriptor.asset_id})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = extractErrorMessage(error);
		const simplified = message.replace(/^\[Runtime\]\s*/, '');
		editorFeatureState.createResource.error = simplified;
		showEditorMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		editorFeatureState.createResource.working = false;
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
