import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import { resolveCodeEditorInput, retainModelCodeTabContext } from '../../ui/code_tab/contexts';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { CodeEditorInput } from './editor_input';
import { captureCodeEditorView, restoreCodeEditorView, type CodeEditorLocation } from './view_snapshot';

export type SerializedCodeEditorInput = { readonly source: TextFileModelSnapshot; readonly view: CodeEditorLocation };

export class CodeEditorInputSerializer implements EditorInputSerializer<CodeEditorInput> {
	public constructor(private readonly storage: KeyValueStorage, private readonly sources: RuntimeSourceState) {}

	public serialize(input: CodeEditorInput): string {
		const state: SerializedCodeEditorInput = { source: captureTextFileModel(input.workingCopy), view: captureCodeEditorView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<CodeEditorInput> {
		const state: SerializedCodeEditorInput = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(this.storage, this.sources, state.source);
		const input = resolveCodeEditorInput(retainModelCodeTabContext(model));
		if (sameSource) restoreCodeEditorView(input, state.view);
		return input;
	}
}
