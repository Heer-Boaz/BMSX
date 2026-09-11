/** Display fields; providers retain their actual resource/symbol/command in T. */
export type QuickPickItem = {
	readonly label: string;
	readonly description: string;
	readonly detail: string;
};

/** Admission identity and the original display item, not a copied/decoded payload. */
export type QuickPickMatch = { readonly itemIndex: number; readonly item: QuickPickItem };

export type QuickPickProjection = {
	readonly matches: readonly QuickPickMatch[];
	readonly selectionIndex: number;
};

/** One admitted catalog. Only its provider decides matching, order and initial selection. */
export interface QuickPickProvider<T extends QuickPickItem = QuickPickItem> {
	readonly items: readonly T[];
	getPicks(query: string): QuickPickProjection;
}
