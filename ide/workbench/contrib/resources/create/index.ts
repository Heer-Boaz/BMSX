import type { QuickInputController } from '../../../services/quick_input/controller';
import type { EditorGroupView } from '../../../services/editor/editor_group';
import { getOrCreateSemanticProject } from '../../../../editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { collectAnimationDefinitions } from '../../animation/definitions';
import type { CartEditor } from '../../../../cart_editor';
import type { HostClock } from '../../../../../hosts/common/clock';
import { structuredTextAssetFromPath } from '../../../../../toolchain/ts/rompack/assets';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { createPreparedTextResource, prepareTextResourceCreation } from '../../../../workspace/workspace';
import { openLuaCodeTab } from '../../../ui/code_tab/io';
import { NEW_AEM_SOURCE, newLuaSource, newSourceInitialName, type NewSourceKind } from './source_templates';
import { TextQuickPickProvider } from '../../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../../services/quick_input/provider';
import type { ResourceIdentity } from '../../../../common/resource';
import type { WorkspaceDirectoryReference } from '../../../../workspace/directory_model';

export function openCreateResourcePrompt(
	editor: CartEditor,
	group: EditorGroupView,
	catalog: WorkspaceSourceCatalog,
	clock: HostClock,
	source: ResourceIdentity | undefined,
	kind: NewSourceKind = 'empty',
	folder?: WorkspaceDirectoryReference,
): void {
	const quickInput = editor.editorParts.partForGroup(group).quickInput;
	if (folder !== undefined) {
		showNewSourceInput(editor, quickInput, group, catalog, clock, folder.root.contextId, newSourceInitialName(kind, folder.path), kind, folder);
		return;
	}
	if (source !== undefined) {
		const resource = catalog.resolveResource(source)!;
		if (resource.location.kind === 'project') {
			const path = resource.location.path;
			const initialName = kind === 'aem' ? newSourceInitialName(kind, '') : path.slice(0, path.lastIndexOf('/') + 1);
			showNewSourceInput(editor, quickInput, group, catalog, clock, resource.contextId, initialName, kind);
			return;
		}
	}
	// Shared/generated sources and non-resource panes have no implicit project owner. Choose a workspace folder,
	// not the socket currently executing (which may be BIOS supervisor code).
	const projects: Array<QuickPickItem & { contextId: string }> = [];
	for (const context of catalog.contexts.values()) {
		projects.push({ contextId: context.id, label: context.projectRootPath, description: context.programDomain, detail: '' });
	}
	quickInput.pick(kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE', 'Choose project folder', () => new TextQuickPickProvider(projects),
		project => showNewSourceInput(editor, quickInput, group, catalog, clock, project.contextId, newSourceInitialName(kind, ''), kind),
		lifetime => lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) }));
}

function showNewSourceInput(
	editor: CartEditor, quickInput: QuickInputController, group: EditorGroupView, catalog: WorkspaceSourceCatalog, clock: HostClock,
	contextId: string, initialName: string, kind: NewSourceKind, folder?: WorkspaceDirectoryReference,
): void {
	const root = catalog.getContext(contextId).projectRootPath;
	const namespace = folder === undefined ? undefined : editor.directories!;
	quickInput.input(`${kind === 'aem' ? 'NEW AUDIO EVENT MAP' : 'NEW LUA FILE'} - ${folder === undefined ? root : folder.workspacePath}`,
		folder === undefined ? 'Project-relative path' : 'File name relative to the selected folder',
		initialName,
		async relativePath => {
			if (folder !== undefined && (!namespace!.acceptingRequests || !namespace!.isCurrent(folder.root))) throw new Error('The project folder owner is closed.');
			const request = prepareTextResourceCreation({ contextId, directory: folder?.path, relativePath, contents: '' });
			let contents: string;
			if (kind === 'aem') {
				const asset = structuredTextAssetFromPath(request.path);
				if (asset?.type !== 'aem') throw new Error('Use .aem.yaml or .aem.json.');
				contents = NEW_AEM_SOURCE[asset.format];
			} else contents = newLuaSource(kind, request.path);
			return createPreparedTextResource(clock, catalog, { ...request, contents });
		},
		(created, preserveFocus) => {
			editor.resourcePanel.queuePendingSelection(created);
			const destination = editor.editorParts.editorDestination(group);
			if (kind === 'action_effect') editor.behaviorLens.openDefinition(destination, editor.behaviorLens.documents.registrations
				.getRegistrations(created.contextId).find(registration => registration.resource.path === created.path && registration.behaviorKind === 'action_effect')!, { preserveFocus });
			else if (kind === 'animation') editor.animations.openResource(destination, created, { preserveFocus });
			else if (kind === 'sprite_animation') {
				const project = getOrCreateSemanticProject(editorTextModelService, created.contextId);
				project.synchronizeSources(catalog);
				editor.animations.openDefinition(destination, created.contextId, collectAnimationDefinitions(created, project.getSnapshot())[0], { preserveFocus });
			}
			else if (kind === 'progression' || kind === 'input') editor.luaPrograms.openResource(destination, created, kind, { preserveFocus });
			else if (kind === 'aem') void editor.navigation.openResource(destination, created, { preserveFocus });
			else openLuaCodeTab(destination, catalog, created, undefined, preserveFocus);
		}, lifetime => {
			lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			if (folder !== undefined) {
				lifetime.add({ dispose: namespace!.onDidChange(() => { if (!namespace!.isCurrent(folder.root)) quickInput.hide(false); }) });
				if (!namespace!.isCurrent(folder.root)) quickInput.hide(false);
			}
		});
}
