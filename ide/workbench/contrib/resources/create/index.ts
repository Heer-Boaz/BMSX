import type { CartEditor } from '../../../../cart_editor';
import type { HostClock } from '../../../../../hosts/common/clock';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../../runtime/sources';
import { createLuaResource } from '../../../../workspace/workspace';
import { stripProjectRootPrefix } from '../../../../workspace/path';
import { getActiveTab } from '../../../ui/tabs';
import { openLuaCodeTab } from '../../../ui/code_tab/io';
import { newLuaSource, type NewLuaSourceKind } from './source_templates';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../../common/resource';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export function openCreateResourcePrompt(
	editor: CartEditor,
	sources: RuntimeSourceState,
	clock: HostClock,
	kind: NewLuaSourceKind = 'empty',
): void {
	const resource = getActiveTab()?.resource;
	if (resource) {
		const root = runtimeSourceProjectRootPath(sources, resource.domain);
		const path = stripProjectRootPrefix(resource.path, root);
		showNewLuaFileInput(editor, sources, clock, resource.domain, path.slice(0, path.lastIndexOf('/') + 1), kind);
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
		project => showNewLuaFileInput(editor, sources, clock, project.domain, '', kind));
}

function showNewLuaFileInput(
	editor: CartEditor, sources: RuntimeSourceState, clock: HostClock,
	domain: ResourceDomain, directory: string, kind: NewLuaSourceKind,
): void {
	const root = runtimeSourceProjectRootPath(sources, domain);
	editor.quickInput.input(`NEW LUA FILE - ${root}`, 'Path relative to project folder', directory,
		relativePath => createLuaResource(clock, sources, {
			domain, relativePath, contents: newLuaSource(kind, relativePath),
		}),
		created => {
			editor.resourcePanel.queuePendingSelection(created);
			if (editor.resourcePanel.isVisible()) editor.resourcePanel.refresh();
			if (kind === 'action_effect') editor.behaviorLens.openDefinition(editor.behaviorLens.documents.registrations
				.getRegistrations(created.domain).find(registration => registration.resource.path === created.path && registration.behaviorKind === 'action_effect')!);
			else if (kind === 'progression' || kind === 'input') editor.luaPrograms.openResource(created, kind);
			else openLuaCodeTab(editor.editorPanes, sources, created);
		});
}
