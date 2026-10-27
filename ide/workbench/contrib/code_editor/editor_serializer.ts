import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { CodeEditorInput } from './editor_input';
import { captureCodeEditorView, type CodeEditorLocation } from './view_snapshot';

export type SerializedCodeEditorInput = { readonly version: 2; readonly source: TextFileModelSnapshot; readonly view: CodeEditorLocation };

export class CodeEditorInputSerializer implements EditorInputSerializer<CodeEditorInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}

	public serialize(input: CodeEditorInput): string {
		const state: SerializedCodeEditorInput = { version: 2, source: captureTextFileModel(input.workingCopy), view: captureCodeEditorView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<CodeEditorInput> {
		const state: SerializedCodeEditorInput = JSON.parse(value);
		if (state.version !== 2) throw new Error(`Unsupported code editor view version '${state.version}'.`);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		const input = new CodeEditorInput(model);
		if (sameSource) input.initializeViewState(state.view);
		else input.initializeViewState();
		return input;
	}
}
