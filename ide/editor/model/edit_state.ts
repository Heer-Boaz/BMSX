/** Inert identity of an editing control; never retains that control or its input. */
export type EditorEditSource = symbol;

/**
 * Typed, input-independent state attached to a document edit, like CodeMirror's
 * typed effects. The text history retains values, never panes or restore callbacks.
 */
export class EditorEditStateType<T> {
	public of(value: T, source?: EditorEditSource): EditorEditState<T> {
		return new EditorEditState(this, value, source);
	}
}

export class EditorEditState<T = unknown> {
	public constructor(public readonly type: EditorEditStateType<T>, public readonly value: T, public readonly source?: EditorEditSource) {}

	public is<U>(type: EditorEditStateType<U>): this is EditorEditState<U> {
		return (this.type as EditorEditStateType<unknown>) === type;
	}
}
