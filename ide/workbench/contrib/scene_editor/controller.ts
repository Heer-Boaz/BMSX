import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeMatchesTextRange } from '../../../language/lua/source_edits';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { RuntimeResource } from '../../../common/resource';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import type { PreparedEditorInput } from '../../services/editor/editor_opening';
import { SceneEditorInput } from './editor_input';
import type { SceneSourceDocuments } from './source_documents';
import { captureSceneEditorView, restoreSceneEditorView } from './view_snapshot';
import { SceneEditorNavigationSelection } from './navigation_selection';
import type { SceneSelectionRequest } from './authoring_context';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, public readonly documents: SceneSourceDocuments) {}

	public readonly createView = (source: SceneEditorInput): SceneEditorInput => {
		source.view.authoring.refresh();
		const view = captureSceneEditorView(source.view);
		const input = new SceneEditorInput(source.workingCopy, this.documents, this.createView);
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
		// Draft settlement and departure capture can both admit source before production begins.
		const request = this.findResource(group, resource)?.view.authoring.captureSelectionRequest();
		const generation = group.panes.openGeneration;
		if (!group.commitPendingEdit() || group.panes.openGeneration !== generation || request?.isCurrent() === false) return false;
		return group.openPreparedEditor(() => {
			const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			return this.prepareDefinition(group, model, range, undefined, request);
		}) !== undefined;
	}

	public prepareDefinition(group: EditorGroupView, model: EditorTextModel, range: Readonly<TrackedTextRange>,
		isCurrent?: () => boolean, selectionRequest?: SceneSelectionRequest): PreparedEditorInput<SceneEditorInput> | undefined {
		// Read after admission: accepting the attached draft may move or retire it.
		if (range.start === range.end) return;
		if (isCurrent?.() === false || selectionRequest?.isCurrent() === false) return;
		const retained = this.findResource(group, model.resource);
		const input = retained ?? new SceneEditorInput(model, this.documents, this.createView);
		const context = input.view.authoring;
		const request = selectionRequest ?? context.captureSelectionRequest();
		let admitted = false;
		try {
			// The semantic selection getter admits source; its callbacks may replace this request.
			const selected = context.selection;
			if (isCurrent?.() === false || !request.isCurrent()) return;
			const scene = context.scenes.find(candidate => luaSourceRangeMatchesTextRange(model.buffer, candidate.range, range));
			if (scene === undefined) return;
			if (selected?.scene === scene) { admitted = true; return { input }; }
			const view = captureSceneEditorView(input.view);
			const tree = input.view.hierarchy.outline, root = tree.roots.find(node => node.element.scene === scene);
			const row = root === undefined ? -1 : tree.rows.indexOf(root);
			const selection = new SceneEditorNavigationSelection(input.view, {
				...view,
				section: 'outline',
				selected: { kind: 'scene', span: { ...range }, root: { ...range } },
				outlineScroll: row === -1 ? view.outlineScroll : row,
				detailsScroll: 0,
			}, request);
			admitted = true;
			return { input, options: { navigationSelection: selection }, dispose: () => selection.dispose() };
		} finally {
			if (!admitted && retained === undefined) input.dispose();
		}
	}

}
