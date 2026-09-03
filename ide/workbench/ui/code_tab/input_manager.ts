import type { CodeEditorInputId } from '../../../common/editor_context';
import type { CodeTabContext } from './model';

/** Retained code-editor inputs and their per-view state. */
export class CodeEditorInputManager {
	private readonly inputsById = new Map<CodeEditorInputId, CodeTabContext>();

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
		this.inputsById.set(input.id, input);
	}

	public clear(): void {
		this.inputsById.clear();
	}
}

export const codeEditorInputManager = new CodeEditorInputManager();
