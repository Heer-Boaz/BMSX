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
import type { SceneSelectionRequest } from './authoring_context';

/** Source projection admission; no world reads or runtime scene ownership. */
export class SceneEditorController {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, public readonly documents: SceneSourceDocuments) {}

	public readonly createView = (source: SceneEditorInput): SceneEditorInput => {
		const context = source.view.authoring;
		context.refresh();
		const view = captureSceneEditorView(source.view);
		const reference = context.captureSourceReference(), scene = context.subject;
		const subject = scene === undefined ? undefined : { document: context.document!, sourceVersion: source.workingCopy.version, scene };
		const input = new SceneEditorInput(source.workingCopy, this.documents, this.catalog, this.createView, subject,
			reference.subject === undefined ? undefined : { source: reference.source, subject: reference.subject });
		if (reference.subject !== undefined && subject === undefined) input.setLabel(source.title, source.description, source.shortDescription);
		restoreSceneEditorView(input.view, view);
		return input;
	};

	public findResource(group: EditorGroupView, resource: ResourceIdentity): SceneEditorInput | undefined {
		return group.model.tabs.find((input): input is SceneEditorInput => input instanceof SceneEditorInput
			&& input.view.authoring.subjectSpan === undefined && resourceIdentityEquals(input.workingCopy.resource, resource));
	}

	public openResource(group: EditorGroupView, resource: RuntimeResource, options: EditorTabOpenOptions = {}): void {
		group.openProducedEditor(() => {
			const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			return this.findResource(group, resource) ?? new SceneEditorInput(model, this.documents, this.catalog, this.createView);
		}, options);
	}

	/** The occurrence owner tracks this table extent through canonical source edits. */
	public openDefinition(group: EditorGroupView, resource: RuntimeResource, range: Readonly<TrackedTextRange>): boolean {
		// Draft settlement and departure capture can both admit source before production begins.
		const active = group.model.activeTab;
		const request = active instanceof SceneEditorInput && resourceIdentityEquals(active.workingCopy.resource, resource)
			? active.view.authoring.captureSelectionRequest() : undefined;
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
		const sourceVersion = model.version, document = this.documents.get(model);
		if (isCurrent?.() === false || selectionRequest?.isCurrent() === false || model.version !== sourceVersion) return;
		const scene = document.scenes.find(candidate => luaSourceRangeMatchesTextRange(model.buffer, candidate.range, range));
		if (scene === undefined) return;
		const retained = group.model.tabs.find((input): input is SceneEditorInput => {
			if (!(input instanceof SceneEditorInput) || input.workingCopy !== model) return false;
			const span = input.view.authoring.subjectSpan;
			return span !== undefined && span.start !== span.end && span.start === range.start && span.end === range.end;
		});
		return { input: retained ?? new SceneEditorInput(model, this.documents, this.catalog, this.createView, { document, sourceVersion, scene }) };
	}

}
