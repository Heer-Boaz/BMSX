import type { EditorTextModelGeneration, EditorTextSelection } from './text_selection';

/** A caret in one canonical text generation, not a resource path to resolve again. */
export type EditorSourceLocation = EditorTextModelGeneration & {
	readonly selection?: EditorTextSelection;
};
