import type { CartEditor } from '../../../../cart_editor';
import type { HostClock } from '../../../../../hosts/common/clock';
import type { KeyValueStorage } from '../../../../workspace/key_value_storage';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../../runtime/sources';
import { createLuaResource } from '../../../../workspace/workspace';
import { stripProjectRootPrefix } from '../../../../workspace/path';
import { getActiveTab } from '../../../ui/tabs';
import { openLuaCodeTab } from '../../../ui/code_tab/io';
import { DEFAULT_NEW_LUA_RESOURCE_CONTENT } from '../../../../common/constants';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../../common/resource';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export function openCreateResourcePrompt(
	editor: CartEditor,
	sources: RuntimeSourceState,
	storage: KeyValueStorage,
	clock: HostClock,
): void {
	const resource = getActiveTab()?.resource;
	if (resource) {
		const root = runtimeSourceProjectRootPath(sources, resource.domain);
		const path = stripProjectRootPrefix(resource.path, root);
		showNewLuaFileInput(editor, sources, storage, clock, resource.domain, path.slice(0, path.lastIndexOf('/') + 1));
		return;
	}
	// Non-resource panes have no implicit file owner. Choose a workspace folder,
	// not the socket currently executing (which may be BIOS supervisor code).
	const projects: Array<QuickPickItem & { domain: ResourceDomain }> = [];
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
		const cartridge = sources.cartridgeSlots[domain];
		if (cartridge) projects.push({ domain, label: cartridge.projectRootPath, description: `CART ${domain}`, detail: '' });
	}
	projects.push({ domain: SYSTEM_RESOURCE_DOMAIN, label: sources.systemProjectRootPath, description: 'SYSTEM', detail: '' });
	editor.quickInput.pick('NEW LUA FILE', 'Choose project folder', () => new TextQuickPickProvider(projects),
		project => showNewLuaFileInput(editor, sources, storage, clock, project.domain, ''));
}

function showNewLuaFileInput(
	editor: CartEditor, sources: RuntimeSourceState, storage: KeyValueStorage, clock: HostClock,
	domain: ResourceDomain, directory: string,
): void {
	const root = runtimeSourceProjectRootPath(sources, domain);
	editor.quickInput.input(`NEW LUA FILE - ${root}`, 'Path relative to project folder', directory,
		relativePath => createLuaResource(storage, clock, sources, {
			domain, relativePath, contents: DEFAULT_NEW_LUA_RESOURCE_CONTENT,
		}),
		created => {
			editor.resourcePanel.queuePendingSelection(created);
			if (editor.resourcePanel.isVisible()) editor.resourcePanel.refresh();
			openLuaCodeTab(editor.editorPanes, sources, created);
		});
}
