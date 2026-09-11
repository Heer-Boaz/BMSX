import type { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';

/** Display fields; providers retain their actual resource/symbol/command in T. */
export type QuickPickItem = {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
};

export type QuickPickField = 'label' | 'description' | 'detail';
export type QuickPickHighlight = { field: QuickPickField; start: number; end: number };

/** Admission identity, original item, and ordered spans in this projection's buffer. */
export type QuickPickMatch = {
	readonly itemIndex: number;
	readonly item: QuickPickItem;
	readonly highlightStart: number;
	readonly highlightEnd: number;
};

export type QuickPickProjection = {
	readonly matches: readonly QuickPickMatch[];
	readonly selectionIndex: number;
	readonly highlights: ScratchBuffer<QuickPickHighlight>;
};

/** One admitted catalog. Only its provider decides matching, order and initial selection. */
export interface QuickPickProvider<T extends QuickPickItem = QuickPickItem> {
	readonly items: readonly T[];
	getPicks(query: string): QuickPickProjection;
}
