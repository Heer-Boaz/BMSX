import * as constants from '../../../common/constants';
import { resourcePanel } from './panel/controller';
import { showEditorMessage } from '../../../common/feedback_state';
import { resetBlink } from '../../../editor/render/caret';
import { refreshResourcePanelContents } from '../../../editor/ui/view/view';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import { createLuaResource } from '../../../workspace/workspace';
import { extractErrorMessage } from '../../../../lua/value';
import { applyCreateResourceFieldText, closeCreateResourcePrompt, ensureDirectorySuffix } from './create';
import { createResourceState } from './widget_state';

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (createResourceState.working) {
		return;
	}
	let resourcePath: string;
	let directory: string;
	try {
		const result = parseCreateResourceRequest(createResourceState.path);
		resourcePath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(resourcePath, true);
		createResourceState.error = null;
	} catch (error) {
		const message = extractErrorMessage(error);
		createResourceState.error = message;
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	createResourceState.working = true;
	resetBlink();
	const contents = constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	try {
		const descriptor = await createLuaResource({ path: resourcePath, contents });
		createResourceState.lastDirectory = directory;
		resourcePanel.queuePendingSelection(descriptor.asset_id);
		if (resourcePanel.isVisible()) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		showEditorMessage(`Created ${descriptor.path} (asset ${descriptor.asset_id})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = extractErrorMessage(error);
		const simplified = message.replace(/^\[Runtime\]\s*/, '');
		createResourceState.error = simplified;
		showEditorMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		createResourceState.working = false;
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
