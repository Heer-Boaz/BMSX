import type { EditorInput } from '../../ui/tab/model';

export type PersistentEditorInput = Exclude<EditorInput, { kind: 'workspace_edit_review' | 'assistant' }>;

/** Each contribution owns its serialized representation and reconstruction. */
export interface EditorInputSerializer<TInput extends EditorInput> {
	serialize(input: TInput): string;
	deserialize(value: string): TInput | Promise<TInput>;
}

export type EditorInputSerializers = {
	[TKind in PersistentEditorInput['kind']]: EditorInputSerializer<Extract<PersistentEditorInput, { kind: TKind }>>;
};

export type SerializedEditorInput = {
	readonly kind: PersistentEditorInput['kind'];
	readonly value: string;
};

export type SerializedEditorGroup = {
	readonly inputs: readonly SerializedEditorInput[];
	readonly active: number | null;
	readonly preview: number | null;
};
