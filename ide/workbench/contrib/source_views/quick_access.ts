import { editorTextModelService } from '../../../editor/model/model_service';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { TextEditorInput } from '../../common/editor_input';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import { WorkspaceSourceContext } from '../../services/working_copy/source_context';
import { buildResourceQuickPickItems } from '../resources/quick_access';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';

export type SourceViewContribution = {
	readonly title: string;
	readonly accepts: (resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot) => boolean;
	readonly openResource: (resource: RuntimeResource, options: EditorTabOpenOptions) => void;
};

/**
 * Workbench admission for source projections. Recognition belongs to each view;
 * documents and unsaved text belong to the source/model owners, not code panes.
 * Catalog work occurs on invocation only, using retained semantic file data.
 */
export function openSourceView(
	group: EditorGroupView,
	catalog: WorkspaceSourceCatalog,
	picker: QuickInputController,
	view: SourceViewContribution,
): void {
	const snapshots = new Map<string, LuaSemanticWorkspaceSnapshot>();
	const snapshotFor = (contextId: string): LuaSemanticWorkspaceSnapshot => {
		let snapshot = snapshots.get(contextId);
		if (snapshot === undefined) {
			const project = getOrCreateSemanticProject(editorTextModelService, contextId);
			project.synchronizeSources(catalog);
			snapshot = project.getSnapshot();
			snapshots.set(contextId, snapshot);
		}
		return snapshot;
	};
	const active = group.model.activeTab;
	if (active instanceof TextEditorInput && active.workingCopy.mode === 'lua') {
		const resource = active.workingCopy.resource;
		if (view.accepts(resource, snapshotFor(resource.contextId))) {
			view.openResource(resource, {});
			return;
		}
	}
	picker.pick(view.title, 'Choose a source document', (_origin, lifetime) => {
		lifetime.add({ dispose: editorTextModelService.onDidChangeContent(() => picker.hide()) });
		lifetime.add({ dispose: editorTextModelService.onWillClear(() => picker.hide()) });
		lifetime.add({ dispose: catalog.onDidChange(() => picker.hide()) });
		snapshots.clear();
		const resources: RuntimeResource[] = [];
		for (const resource of catalog.luaResources) {
			if (view.accepts(resource, snapshotFor(resource.contextId))) resources.push(resource);
		}
		return new FileQuickPickProvider(buildResourceQuickPickItems(resources));
	}, (item, _modifiers, preserveFocus) => {
		const resource = item.resource, source = new WorkspaceSourceContext(editorTextModelService, catalog);
		try {
			view.openResource(resource, { preserveFocus,
				isCurrent: () => source.reason === undefined && catalog.resolveResource(resource) === resource });
		} finally { source.dispose(); }
	}, lifetime => lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) }));
}
