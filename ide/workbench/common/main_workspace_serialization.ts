/** Contributions persist their authored subject and reading state, never live control authority. */
export type SerializedPrimaryClient = { readonly kind: 'scene'; readonly value: string };

/** Main's primary work is separate from the document-part topology and source recovery. */
export type SerializedMainWorkspace = {
	readonly primary: SerializedPrimaryClient | null;
	readonly splitRatio: number;
	readonly scrollX: number;
	readonly activeClient: 'primary' | 'documents';
};
