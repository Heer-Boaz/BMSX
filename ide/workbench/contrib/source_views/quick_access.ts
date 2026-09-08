import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { QuickInputController } from '../../services/quick_input/controller';
import { getActiveTab } from '../../ui/tabs';
import { buildResourceQuickPickItems } from '../resources/quick_access';

export type SourceViewContribution = {
	readonly title: string;
	readonly accepts: (analysis: FileSemanticData) => boolean;
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
	const active = getActiveTab();
	if (active instanceof WorkingCopyEditorInput && active.workingCopy.mode === 'lua') {
		const resource = active.workingCopy.resource;
		if (view.accepts(sourceAnalysis(sources, resource))) {
			view.openResource(resource);
			return;
		}
	}
	const resources: RuntimeResource[] = [];
	for (const resource of sources.luaResources) {
		if (view.accepts(sourceAnalysis(sources, resource))) resources.push(resource);
	}
	picker.pick(view.title, 'Choose a source document', buildResourceQuickPickItems(resources),
		item => view.openResource(item.resource));
}

function sourceAnalysis(sources: RuntimeSourceState, resource: RuntimeResource): FileSemanticData {
	const project = getOrCreateSemanticProject(resource.domain);
	project.synchronizeRuntimeSources(sources);
	const model = editorTextModelService.get(resource);
	return model === undefined
		? project.getFileData(resource.path)!
		: project.updateDocument(resource.path, getTextSnapshot(model.buffer));
}
