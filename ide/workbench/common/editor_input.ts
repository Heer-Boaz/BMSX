import type { EditorTextModel } from '../../editor/model/text_model';

/** Retained workbench input identity and presentation shared by every editor kind. */
export abstract class AbstractEditorInput<
	TId extends string,
	TKind extends string,
> {
	public constructor(
		public readonly id: TId,
		public readonly kind: TKind,
		public title: string,
		public readonly closable: boolean,
	) {
	}

	public abstract isDirty(): boolean;
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

	public isDirty(): boolean {
		return this.workingCopy.dirty;
	}
}
