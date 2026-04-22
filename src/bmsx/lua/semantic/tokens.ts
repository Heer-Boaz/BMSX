import type { SemanticSymbolKind } from './symbols';

export type SemanticRole = 'definition' | 'usage';

export type TokenAnnotation = {
	start: number;
	end: number;
	kind: SemanticSymbolKind;
	role: SemanticRole;
};

export type SemanticAnnotations = Array<TokenAnnotation[]>;
