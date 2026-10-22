import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { collectAnimationDefinitions } from '../../animation/definitions';
import type { CartEditor } from '../../../../cart_editor';
import type { HostClock } from '../../../../../hosts/common/clock';
import { structuredTextAssetFromPath } from '../../../../../toolchain/ts/rompack/assets';
import { runtimeSourceProjectRootPath, type RuntimeSourceState } from '../../../../runtime/sources';
import { createTextResource } from '../../../../workspace/workspace';
import { stripProjectRootPrefix } from '../../../../workspace/path';
import { getActiveTab } from '../../../ui/tabs';
import { openLuaCodeTab } from '../../../ui/code_tab/io';
import { NEW_AEM_SOURCE, newLuaSource, type NewSourceKind } from './source_templates';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../../common/resource';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export function openCreateResourcePrompt(
	editor: CartEditor,
	sources: RuntimeSourceState,
	clock: HostClock,
	kind: NewSourceKind = 'empty',
): void {
	const resource = getActiveTab()?.resource;
	if (resource) {
		const root = runtimeSourceProjectRootPath(sources, resource.domain);
		const path = stripProjectRootPrefix(resource.path, root);
		showNewSourceInput(editor, sources, clock, resource.domain, path.slice(0, path.lastIndexOf('/') + 1), kind);
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
	editor.quickInput.pick(kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE', 'Choose project folder', () => new TextQuickPickProvider(projects),
		project => showNewSourceInput(editor, sources, clock, project.domain, '', kind));
}

function showNewSourceInput(
	editor: CartEditor, sources: RuntimeSourceState, clock: HostClock,
	domain: ResourceDomain, directory: string, kind: NewSourceKind,
): void {
	const root = runtimeSourceProjectRootPath(sources, domain);
	editor.quickInput.input(`${kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE'} - ${root}`, 'Project-relative path',
		kind === 'aem' ? 'res/data/events.aem.yaml' : directory,
		async relativePath => {
			let contents: string;
			if (kind === 'aem') {
				const asset = structuredTextAssetFromPath(relativePath);
				if (asset?.type !== 'aem') throw new Error('Use .aem.yaml or .aem.json.');
				contents = NEW_AEM_SOURCE[asset.format];
			} else contents = newLuaSource(kind, relativePath);
			return createTextResource(clock, sources, { domain, relativePath, contents });
		},
		created => {
			editor.resourcePanel.queuePendingSelection(created);
			if (editor.resourcePanel.isVisible()) editor.resourcePanel.refresh();
			if (kind === 'action_effect') editor.behaviorLens.openDefinition(editor.behaviorLens.documents.registrations
				.getRegistrations(created.domain).find(registration => registration.resource.path === created.path && registration.behaviorKind === 'action_effect')!);
			else if (kind === 'animation') editor.animations.openResource(created);
			else if (kind === 'sprite_animation') {
				const project = getOrCreateSemanticProject(editorTextModelService, created.domain);
				project.synchronizeRuntimeSources(sources);
				editor.animations.openDefinition(created.domain, collectAnimationDefinitions(created, project.getSnapshot())[0]);
			}
			else if (kind === 'progression' || kind === 'input') editor.luaPrograms.openResource(created, kind);
			else if (kind === 'aem') void editor.navigation.openResource(created);
			else openLuaCodeTab(editor.editorPanes, sources, created);
		});
}
