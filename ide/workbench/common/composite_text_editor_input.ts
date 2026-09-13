import type { EditorTextModel } from '../../editor/model/text_model';
import { TextEditorInput } from './editor_input';

/**
 * A source projection can present several real documents. Membership is supplied
 * by the projection, not inferred from all language-query dependencies. Models
 * and history outlive this input in the workspace's model service.
 */
export abstract class CompositeTextEditorInput<TId extends string, TKind extends string> extends TextEditorInput<TId, TKind> {
	private models: readonly EditorTextModel[] = [];
	private readonly subscriptions = new Map<EditorTextModel, () => void>();
	private readonly dirtyListeners = new Set<() => void>();
	private dirty = false;

	public getWorkingCopies(): readonly EditorTextModel[] { return this.models; }
	public isDirty(): boolean { return this.dirty; }
	public get readOnly(): boolean {
		for (const model of this.models) if (!model.readOnly) return false;
		return true;
	}

	protected setWorkingCopies(models: ReadonlySet<EditorTextModel>): void {
		for (const [model, unsubscribe] of this.subscriptions) {
			if (!models.has(model)) { unsubscribe(); this.subscriptions.delete(model); }
		}
		for (const model of models) {
			if (!this.subscriptions.has(model)) this.subscriptions.set(model, model.onDidChangeDirty(() => this.updateDirty()));
		}
		this.models = [...models];
		this.updateDirty();
	}

	private updateDirty(): void {
		let dirty = false;
		for (const model of this.models) if (model.dirty) { dirty = true; break; }
		if (this.dirty === dirty) return;
		this.dirty = dirty;
		for (const listener of this.dirtyListeners) listener();
	}

	public override onDidChangeDirty(listener: () => void): () => void {
		this.dirtyListeners.add(listener);
		return () => this.dirtyListeners.delete(listener);
	}

	public override dispose(): void {
		for (const unsubscribe of this.subscriptions.values()) unsubscribe();
		this.subscriptions.clear();
		this.dirtyListeners.clear();
		super.dispose();
	}
}
