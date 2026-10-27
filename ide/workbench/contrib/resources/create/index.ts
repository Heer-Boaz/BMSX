import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { collectAnimationDefinitions } from '../../animation/definitions';
import type { CartEditor } from '../../../../cart_editor';
import type { HostClock } from '../../../../../hosts/common/clock';
import { structuredTextAssetFromPath } from '../../../../../toolchain/ts/rompack/assets';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { createTextResource } from '../../../../workspace/workspace';
import { openLuaCodeTab } from '../../../ui/code_tab/io';
import { NEW_AEM_SOURCE, newLuaSource, type NewSourceKind } from './source_templates';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';

export function openCreateResourcePrompt(
	editor: CartEditor,
	catalog: WorkspaceSourceCatalog,
	clock: HostClock,
	kind: NewSourceKind = 'empty',
): void {
	const identity = editor.editorGroup.model.activeTab?.resource;
	if (identity !== undefined) {
		const resource = catalog.resolveResource(identity)!;
		if (resource.location.kind === 'project') {
			const path = resource.location.path;
			showNewSourceInput(editor, catalog, clock, resource.contextId, path.slice(0, path.lastIndexOf('/') + 1), kind);
			return;
		}
	}
	// Shared/generated sources and non-resource panes have no implicit project owner. Choose a workspace folder,
	// not the socket currently executing (which may be BIOS supervisor code).
	const projects: Array<QuickPickItem & { contextId: string }> = [];
	for (const context of catalog.contexts.values()) {
		projects.push({ contextId: context.id, label: context.projectRootPath, description: context.programDomain, detail: '' });
	}
	editor.quickInput.pick(kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE', 'Choose project folder', () => new TextQuickPickProvider(projects),
		project => showNewSourceInput(editor, catalog, clock, project.contextId, '', kind));
}

function showNewSourceInput(
	editor: CartEditor, catalog: WorkspaceSourceCatalog, clock: HostClock,
	contextId: string, directory: string, kind: NewSourceKind,
): void {
	const root = catalog.getContext(contextId).projectRootPath;
	editor.quickInput.input(`${kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE'} - ${root}`, 'Project-relative path',
		kind === 'aem' ? 'res/data/events.aem.yaml' : directory,
		async relativePath => {
			let contents: string;
			if (kind === 'aem') {
				const asset = structuredTextAssetFromPath(relativePath);
				if (asset?.type !== 'aem') throw new Error('Use .aem.yaml or .aem.json.');
				contents = NEW_AEM_SOURCE[asset.format];
			} else contents = newLuaSource(kind, relativePath);
			return createTextResource(clock, catalog, { contextId, relativePath, contents });
		},
		created => {
			editor.resourcePanel.queuePendingSelection(created);
			if (editor.resourcePanel.isVisible()) editor.resourcePanel.refresh();
			if (kind === 'action_effect') editor.behaviorLens.openDefinition(editor.behaviorLens.documents.registrations
				.getRegistrations(created.contextId).find(registration => registration.resource.path === created.path && registration.behaviorKind === 'action_effect')!);
			else if (kind === 'animation') editor.animations.openResource(created);
			else if (kind === 'sprite_animation') {
				const project = getOrCreateSemanticProject(editorTextModelService, created.contextId);
				project.synchronizeSources(catalog);
				editor.animations.openDefinition(created.contextId, collectAnimationDefinitions(created, project.getSnapshot())[0]);
			}
			else if (kind === 'progression' || kind === 'input') editor.luaPrograms.openResource(created, kind);
			else if (kind === 'aem') void editor.navigation.openResource(created);
			else openLuaCodeTab(editor.editorGroup, catalog, created);
		});
}
