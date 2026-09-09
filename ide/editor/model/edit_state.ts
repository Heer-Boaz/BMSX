/**
 * Typed, input-independent state attached to a document edit, like CodeMirror's
 * typed effects. The text history retains values, never panes or restore callbacks.
 */
export class EditorEditStateType<T> {
	public of(value: T): EditorEditState<T> {
		return new EditorEditState(this, value);
	}
}

export class EditorEditState<T = unknown> {
	public constructor(public readonly type: EditorEditStateType<T>, public readonly value: T) {}

	public is<U>(type: EditorEditStateType<U>): this is EditorEditState<U> {
		return (this.type as EditorEditStateType<unknown>) === type;
	}
}
