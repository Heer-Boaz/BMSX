import type { EditorTextModel } from '../../editor/model/text_model';
import { DisposableStore, type IDisposable } from '../../common/lifecycle';
import type { ResourceIdentity } from '../../common/resource';

export type ResourceEditorIdentity = {
	readonly resource: ResourceIdentity;
	readonly editorId: string;
};

/** Retained workbench input identity and presentation shared by every editor kind. */
export abstract class AbstractEditorInput<
	TId extends string,
	TKind extends string,
> implements IDisposable {
	protected readonly disposables = new DisposableStore();
	private readonly disposeListeners = new Set<() => void>();
	private readonly labelListeners = new Set<() => void>();
	private inputTitle: string;
	private inputDescription = '';

	/** Only inputs with a registered resource opener can outlive closing their tab. */
	public toResourceEditor?(): ResourceEditorIdentity;
	public onDidChangeDirty?(listener: () => void): () => void;

	public get title(): string { return this.inputTitle; }
	public set title(value: string) { this.setLabel(value, this.inputDescription); }
	public get description(): string { return this.inputDescription; }

	public setLabel(title: string, description: string): void {
		if (title === this.inputTitle && description === this.inputDescription) return;
		this.inputTitle = title;
		this.inputDescription = description;
		for (const listener of this.labelListeners) listener();
	}

	public onDidChangeLabel(listener: () => void): () => void {
		this.labelListeners.add(listener);
		return () => this.labelListeners.delete(listener);
	}

	public onWillDispose(listener: () => void): () => void {
		this.disposeListeners.add(listener);
		return () => this.disposeListeners.delete(listener);
	}

	public constructor(
		public readonly id: TId,
		public readonly kind: TKind,
		title: string,
		public readonly closable: boolean,
	) {
		this.inputTitle = title;
	}

	public abstract isDirty(): boolean;

	/** Input resources end at close, not when its reusable pane is detached. */
	public dispose(): void {
		for (const listener of this.disposeListeners) listener();
		this.disposeListeners.clear();
		this.labelListeners.clear();
		this.disposables.dispose();
	}
}

/** Input class for projections that never own editable working-copy state. */
export abstract class ReadonlyEditorInput<
	TId extends string,
	TKind extends string,
> extends AbstractEditorInput<TId, TKind> {
	public isDirty(): boolean {
		return false;
	}
}

/** Input class shared by views of a retained resource-owned text model. */
export abstract class WorkingCopyEditorInput<
	TId extends string,
	TKind extends string,
> extends AbstractEditorInput<TId, TKind> {
	public abstract get workingCopy(): EditorTextModel;

	public override onDidChangeDirty(listener: () => void): () => void {
		return this.workingCopy.onDidChangeDirty(listener);
	}

	public isDirty(): boolean {
		return this.workingCopy.dirty;
	}
}
