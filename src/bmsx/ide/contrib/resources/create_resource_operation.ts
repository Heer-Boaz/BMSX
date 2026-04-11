import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { resetBlink } from '../../render/render_caret';
import { refreshResourcePanelContents } from '../../ui/editor_view';
import { openLuaCodeTab } from '../../ui/editor_tabs';
import { createLuaResource } from '../../../emulator/workspace';
import { extractErrorMessage } from '../../../lua/luavalue';
import { applyCreateResourceFieldText, closeCreateResourcePrompt, ensureDirectorySuffix } from './create_resource';

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (ide_state.createResource.working) {
		return;
	}
	let resourcePath: string;
	let directory: string;
	try {
		const result = parseCreateResourceRequest(ide_state.createResource.path);
		resourcePath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(resourcePath, true);
		ide_state.createResource.error = null;
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.createResource.error = message;
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	ide_state.createResource.working = true;
	resetBlink();
	const contents = constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	try {
		const descriptor = await createLuaResource({ path: resourcePath, contents });
		ide_state.createResource.lastDirectory = directory;
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
		ide_state.createResource.error = simplified;
		ide_state.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		ide_state.createResource.working = false;
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
