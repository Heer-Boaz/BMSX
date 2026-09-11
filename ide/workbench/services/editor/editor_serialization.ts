import type { EditorInput, EditorInputKind } from '../../ui/tab/model';

/** Each contribution owns its serialized representation and reconstruction. */
export interface EditorInputSerializer<TInput extends EditorInput> {
	serialize(input: TInput): string;
	deserialize(value: string): TInput | Promise<TInput>;
}

export type EditorInputSerializers = {
	[TKind in EditorInputKind]: EditorInputSerializer<Extract<EditorInput, { kind: TKind }>>;
};

export type SerializedEditorInput = {
	readonly kind: EditorInputKind;
	readonly value: string;
};

export type SerializedEditorGroup = {
	readonly inputs: readonly SerializedEditorInput[];
	readonly active: number | null;
	readonly preview: number | null;
};
