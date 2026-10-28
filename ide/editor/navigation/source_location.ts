import type { EditorTextModelGeneration, EditorTextSelection } from './text_selection';

/** A caret in one canonical text generation, not a resource path to resolve again. */
export type EditorSourceLocation = EditorTextModelGeneration & {
	readonly selection?: EditorTextSelection;
};

export type EditorSourceLocationReader = () => EditorSourceLocation | undefined | Promise<EditorSourceLocation | undefined>;

/** Passive semantic-intent receipt; capturing it admits no source and publishes no selection. */
export type EditorSourceLocationRequest = {
	readonly readLocation: EditorSourceLocationReader;
	isCurrent?(): boolean;
};
