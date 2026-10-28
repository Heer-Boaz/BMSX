import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { RuntimeResource } from '../../../common/resource';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import type { PreparedEditorInput } from '../../services/editor/editor_opening';
import { SceneEditorInput } from './editor_input';
import type { SceneSourceDocuments } from './source_documents';
import { captureSceneEditorView, restoreSceneEditorView } from './view_snapshot';
import { SceneEditorNavigationSelection } from './navigation_selection';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, public readonly documents: SceneSourceDocuments) {}

	public readonly createView = (source: SceneEditorInput): SceneEditorInput => {
		source.view.refresh();
		const view = captureSceneEditorView(source.view);
		const input = new SceneEditorInput(source.workingCopy, this.documents, this.createView);
		input.view.refresh();
		restoreSceneEditorView(input.view, view);
		return input;
	};

	public findResource(group: EditorGroupView, resource: ResourceIdentity): SceneEditorInput | undefined {
		return group.model.tabs.find((input): input is SceneEditorInput => input.kind === 'scene_editor' && resourceIdentityEquals(input.workingCopy.resource, resource));
	}

	public openResource(group: EditorGroupView, resource: RuntimeResource, options: EditorTabOpenOptions = {}): void {
		group.openProducedEditor(() => {
			const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			return this.findResource(group, resource) ?? new SceneEditorInput(model, this.documents, this.createView);
		}, options);
	}

	/** The occurrence owner tracks this table extent through canonical source edits. */
	public openDefinition(group: EditorGroupView, resource: RuntimeResource, range: Readonly<TrackedTextRange>): boolean {
		const generation = group.panes.openGeneration;
		if (!group.commitPendingEdit() || group.panes.openGeneration !== generation) return false;
		return group.openPreparedEditor(() => {
			const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			return this.prepareDefinition(group, model, range);
		}) !== undefined;
	}

	public prepareDefinition(group: EditorGroupView, model: EditorTextModel, range: Readonly<TrackedTextRange>,
		isCurrent?: () => boolean): PreparedEditorInput<SceneEditorInput> | undefined {
		// Read after admission: accepting the attached draft may move or retire it.
		if (range.start === range.end) return;
		if (isCurrent?.() === false) return;
		const retained = this.findResource(group, model.resource);
		const input = retained ?? new SceneEditorInput(model, this.documents, this.createView);
		input.view.refresh();
		const root = input.view.outline.roots.find(node => node.element.span.start === range.start && node.element.span.end === range.end);
		if (root === undefined) {
			if (retained === undefined) input.dispose();
			return;
		}
		const selected = input.view.outline.rows[input.view.outline.selectionIndex];
		if (selected !== undefined && (selected.parent ?? selected) === root) return { input };
		const view = captureSceneEditorView(input.view);
		const selection = new SceneEditorNavigationSelection(input.view, {
			...view,
			section: 'outline',
			selected: { kind: 'scene', span: { ...root.element.span }, root: { ...root.element.span } },
			outlineScroll: input.view.outline.rows.indexOf(root),
			detailsScroll: 0,
		});
		return { input, options: { navigationSelection: selection }, dispose: () => selection.dispose() };
	}

}
