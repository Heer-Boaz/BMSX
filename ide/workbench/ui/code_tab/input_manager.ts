import type { CodeEditorInputId } from '../../../common/editor_context';
import type { CodeTabContext } from './model';
import { applyCodeEditorViewSnapshot, codeEditorEditState } from '../../../editor/ui/code_editor_state';

/** Retained code-editor inputs and their per-view state. */
export class CodeEditorInputManager {
	private readonly inputsById = new Map<CodeEditorInputId, CodeTabContext>();
	private readonly contentSubscriptions = new Map<CodeEditorInputId, () => void>();

	public get inputs(): IterableIterator<CodeTabContext> {
		return this.inputsById.values();
	}

	public get(inputId: CodeEditorInputId): CodeTabContext | undefined {
		return this.inputsById.get(inputId);
	}

	public has(inputId: CodeEditorInputId): boolean {
		return this.inputsById.has(inputId);
	}

	public register(input: CodeTabContext): void {
		const previous = this.contentSubscriptions.get(input.id);
		if (previous !== undefined) previous();
		this.inputsById.set(input.id, input);
		this.contentSubscriptions.set(input.id, input.model.onDidChangeContent(event => {
			const state = event.editState;
			if (state !== null && state.is(codeEditorEditState)) applyCodeEditorViewSnapshot(input.view, state.value);
		}));
	}

	public clear(): void {
		for (const unsubscribe of this.contentSubscriptions.values()) unsubscribe();
		this.contentSubscriptions.clear();
		this.inputsById.clear();
	}
}

export const codeEditorInputManager = new CodeEditorInputManager();
