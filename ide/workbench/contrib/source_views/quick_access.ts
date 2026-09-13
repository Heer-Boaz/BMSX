import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceDomain, ResourceIdentity, RuntimeResource } from '../../../common/resource';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { TextEditorInput } from '../../common/editor_input';
import type { QuickInputController } from '../../services/quick_input/controller';
import { getActiveTab } from '../../ui/tabs';
import { buildResourceQuickPickItems } from '../resources/quick_access';
import { FileQuickPickProvider } from '../resources/quick_pick_provider';

export type SourceViewContribution = {
	readonly title: string;
	readonly accepts: (resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot) => boolean;
	readonly openResource: (resource: RuntimeResource) => void;
};

/**
 * Workbench admission for source projections. Recognition belongs to each view;
 * documents and unsaved text belong to the source/model owners, not code panes.
 * Catalog work occurs on invocation only, using retained semantic file data.
 */
export function openSourceView(
	sources: RuntimeSourceState,
	picker: QuickInputController,
	view: SourceViewContribution,
): void {
	const snapshots = new Map<ResourceDomain, LuaSemanticWorkspaceSnapshot>();
	const snapshotFor = (domain: ResourceDomain): LuaSemanticWorkspaceSnapshot => {
		let snapshot = snapshots.get(domain);
		if (snapshot === undefined) {
			const project = getOrCreateSemanticProject(domain);
			project.synchronizeRuntimeSources(sources);
			snapshot = project.getSnapshot();
			snapshots.set(domain, snapshot);
		}
		return snapshot;
	};
	const active = getActiveTab();
	if (active instanceof TextEditorInput && active.workingCopy.mode === 'lua') {
		const resource = active.workingCopy.resource;
		if (view.accepts(resource, snapshotFor(resource.domain))) {
			view.openResource(resource);
			return;
		}
	}
	const resources: RuntimeResource[] = [];
	for (const resource of sources.luaResources) {
		if (view.accepts(resource, snapshotFor(resource.domain))) resources.push(resource);
	}
	picker.pick(view.title, 'Choose a source document', () => new FileQuickPickProvider(buildResourceQuickPickItems(resources)),
		item => view.openResource(item.resource));
}
