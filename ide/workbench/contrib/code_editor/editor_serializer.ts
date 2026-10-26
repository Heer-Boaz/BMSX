import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { CodeEditorInput } from './editor_input';
import { captureCodeEditorView, type CodeEditorLocation } from './view_snapshot';

export type SerializedCodeEditorInput = { readonly version: 1; readonly source: TextFileModelSnapshot; readonly view: CodeEditorLocation };

type LegacySerializedCodeEditorInput = {
	readonly source: TextFileModelSnapshot;
	readonly view: Omit<CodeEditorLocation, 'scrollLeft'> & { readonly scrollColumn: number };
};

export class CodeEditorInputSerializer implements EditorInputSerializer<CodeEditorInput> {
	public constructor(private readonly sources: RuntimeSourceState) {}

	public serialize(input: CodeEditorInput): string {
		const state: SerializedCodeEditorInput = { version: 1, source: captureTextFileModel(input.workingCopy), view: captureCodeEditorView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<CodeEditorInput> {
		const state: SerializedCodeEditorInput | LegacySerializedCodeEditorInput = JSON.parse(value);
		if ('version' in state && state.version !== 1) throw new Error(`Unsupported code editor view version '${state.version}'.`);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, state.source);
		const input = new CodeEditorInput(model);
		if (sameSource) {
			// Unversioned glyph columns lack the historical layout needed for an exact pixel origin.
			const view = 'version' in state ? state.view : { cursor: state.view.cursor, anchor: state.view.anchor,
				scrollRow: state.view.scrollRow, scrollLeft: 0 };
			input.initializeViewState(view);
		} else input.initializeViewState();
		return input;
	}
}
