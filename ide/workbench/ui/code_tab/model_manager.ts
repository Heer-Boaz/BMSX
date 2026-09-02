import type { EditorDocumentContextId } from '../../../common/editor_context';
import type { CodeTabContext } from './model';

/**
 * Retained text models keyed by canonical resource identity. Open editor inputs
 * live in the editor group; this manager also owns dirty/background models used
 * by autosave, diagnostics and workspace-wide edits.
 */
export class CodeEditorModelManager {
	private readonly modelsById = new Map<EditorDocumentContextId, CodeTabContext>();

	public get models(): IterableIterator<CodeTabContext> {
		return this.modelsById.values();
	}

	public get(contextId: EditorDocumentContextId): CodeTabContext | undefined {
		return this.modelsById.get(contextId);
	}

	public has(contextId: EditorDocumentContextId): boolean {
		return this.modelsById.has(contextId);
	}

	public register(context: CodeTabContext): void {
		this.modelsById.set(context.id, context);
	}

	public clear(): void {
		this.modelsById.clear();
	}
}

export const codeEditorModelManager = new CodeEditorModelManager();
