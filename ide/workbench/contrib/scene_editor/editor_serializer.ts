import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { luaSourceRangeMatchesTextRange } from '../../../language/lua/source_edits';
import type { SceneEditorController } from './controller';
import { SceneEditorInput, UnavailableSceneEditorInput } from './editor_input';
import type { SceneAuthoredSubject, SceneAuthoredSubjectReference } from './authoring_context';
import { captureSceneEditorView, restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';

export type SerializedSceneEditorInput = { readonly source: TextFileModelSnapshot;
	readonly subject?: SceneAuthoredSubjectReference['subject']; readonly title: string; readonly description: string;
	readonly shortDescription: string; readonly view: SceneEditorViewSnapshot };

export class SceneEditorInputSerializer implements EditorInputSerializer<SceneEditorInput | UnavailableSceneEditorInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog,
		private readonly controller: SceneEditorController) {}

	public serialize(input: SceneEditorInput | UnavailableSceneEditorInput): string {
		if (input instanceof UnavailableSceneEditorInput) return JSON.stringify(input.snapshot);
		const reference = input.view.authoring.captureSourceReference();
		const state: SerializedSceneEditorInput = { source: reference.source, subject: reference.subject,
			title: input.title, description: input.description, shortDescription: input.shortDescription, view: captureSceneEditorView(input.view, reference) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<SceneEditorInput | UnavailableSceneEditorInput> {
		const state: SerializedSceneEditorInput = JSON.parse(value);
		if (this.catalog.resolveResource(state.source.resource) === undefined) {
			return new UnavailableSceneEditorInput(state);
		}
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		const savedSubject = state.subject;
		let subject: SceneAuthoredSubject | undefined, suspended = false;
		if (sameSource && savedSubject?.availability === 'available') {
			const sourceVersion = model.version, document = this.controller.documents.get(model);
			const scene = document.scenes.find(scene => luaSourceRangeMatchesTextRange(model.buffer, scene.range, savedSubject.range));
			if (scene !== undefined && model.version === sourceVersion) subject = { document, sourceVersion, scene };
			else if (savedSubject.range.start !== savedSubject.range.end && model.version === sourceVersion) suspended = true;
		}
		const reference = savedSubject === undefined ? undefined : { source: state.source,
			subject: subject !== undefined || suspended ? savedSubject : { ...savedSubject, availability: 'unavailable' as const } };
		const input = new SceneEditorInput(model, this.controller.documents, this.catalog, this.controller.createView, subject, reference);
		if (reference !== undefined && subject === undefined && !suspended) input.setLabel(state.title, state.description, state.shortDescription);
		if (sameSource) restoreSceneEditorView(input.view, state.view);
		else input.view.authoring.restoreSelection(undefined);
		return input;
	}
}
