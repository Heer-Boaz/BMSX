import type { SemanticSymbolKind } from './symbols';

export type SemanticRole = 'definition' | 'usage';

/** Identifier spelling, in zero-based, end-exclusive source columns.
 * String keys can bind properties without becoming identifier tokens.
 */
export type TokenAnnotation = {
	start: number;
	end: number;
	kind: SemanticSymbolKind;
	role: SemanticRole;
};

export type SemanticAnnotations = Array<TokenAnnotation[]>;
