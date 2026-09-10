import type { CodeEditorInputId } from '../../../common/editor_context';
import type { CodeTabContext } from './model';
import { CodeEditorViewBinding } from '../../../editor/ui/code_editor_view_binding';

/** Retained code-editor inputs and their per-view state. */
export class CodeEditorInputManager {
	private readonly inputsById = new Map<CodeEditorInputId, CodeTabContext>();
	private readonly viewBindings = new Map<CodeEditorInputId, CodeEditorViewBinding>();

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
		const previous = this.viewBindings.get(input.id);
		if (previous !== undefined) previous.dispose();
		this.inputsById.set(input.id, input);
		this.viewBindings.set(input.id, new CodeEditorViewBinding(input.model, input.view));
	}

	public clear(): void {
		for (const binding of this.viewBindings.values()) binding.dispose();
		this.viewBindings.clear();
		this.inputsById.clear();
	}
}

export const codeEditorInputManager = new CodeEditorInputManager();
