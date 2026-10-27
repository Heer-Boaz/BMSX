import type { EditorTextModel } from '../model/text_model';

/** Coordinates produced from a particular canonical text generation. */
export type EditorTextModelGeneration = {
	readonly model: EditorTextModel;
	readonly modelVersion: number;
};

/** Zero-based text range requested while opening an editor input. */
export type EditorTextSelection = {
	row: number;
	startColumn: number;
	endColumn: number;
	readonly generation?: EditorTextModelGeneration;
};
