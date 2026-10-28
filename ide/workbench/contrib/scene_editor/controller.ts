import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resourceIdentityEquals, type ResourceIdentity } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { RuntimeResource } from '../../../common/resource';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import type { PreparedEditorInput } from '../../services/editor/editor_opening';
import { luaSourceLocation } from '../../../language/lua/source_location';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { SceneEditorInput } from './editor_input';
import type { SceneSourceDocuments } from './source_documents';
import { installSceneOutline } from './outline';
import { captureSceneEditorView, restoreSceneEditorView } from './view_snapshot';
import { SceneEditorNavigationSelection } from './navigation_selection';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, public readonly documents: SceneSourceDocuments) {}

	public readonly createView = (source: SceneEditorInput): SceneEditorInput => {
		this.refresh(source);
		const view = captureSceneEditorView(source);
		const input = new SceneEditorInput(source.workingCopy, this.documents, this.createView);
		this.refresh(input);
		restoreSceneEditorView(input, view);
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
		this.refresh(input);
		const root = input.outline.roots.find(node => node.element.span.start === range.start && node.element.span.end === range.end);
		if (root === undefined) {
			if (retained === undefined) input.dispose();
			return;
		}
		const selected = input.outline.rows[input.outline.selectionIndex];
		if (selected !== undefined && (selected.parent ?? selected) === root) return { input };
		const view = captureSceneEditorView(input);
		const selection = new SceneEditorNavigationSelection(input, {
			...view,
			section: 'outline',
			selected: { kind: 'scene', span: { ...root.element.span }, root: { ...root.element.span } },
			outlineScroll: input.outline.rows.indexOf(root),
			detailsScroll: 0,
		});
		return { input, options: { navigationSelection: selection }, dispose: () => selection.dispose() };
	}

	public getSourceLocation(input: SceneEditorInput): EditorSourceLocation | undefined {
		this.refresh(input);
		const selection = input.authoring.selection, document = input.authoring.document!;
		const range = selection?.kind === 'scene' ? selection.scene.range : selection === undefined ? undefined
			: document.analysis.chunk.locations.range(selection.entry.field.span);
		const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.contextId);
		return luaSourceLocation(project, input.workingCopy, document.analysis, range);
	}

	public canRemoveSelectedMember(input: SceneEditorInput): boolean {
		return input.authoring.canRemoveSelectedMember();
	}

	public removeSelectedMember(input: SceneEditorInput): void {
		// Command admission may have accepted a property draft. Use its new source generation.
		if (input.authoring.removeSelectedMember()) {
			this.refresh(input);
		}
	}

	public canMoveSelectedMember(input: SceneEditorInput, direction: -1 | 1): boolean {
		return input.authoring.canMoveSelectedMember(direction);
	}

	public moveSelectedMember(input: SceneEditorInput, direction: -1 | 1): void {
		if (!input.authoring.moveSelectedMember(direction)) return;
		this.refresh(input);
		revealWorkbenchListSelection(input.outline);
	}

	public refresh(input: SceneEditorInput): void {
		input.authoring.refresh();
		if (input.outlineDocument === input.authoring.document && input.outlineRevision === input.authoring.revision) return;
		installSceneOutline(input);
	}
}
