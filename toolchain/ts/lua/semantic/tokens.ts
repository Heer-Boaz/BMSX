import type { SemanticSymbolKind } from './symbols';
import type { FileSemanticData } from './model';
import type { LuaSyntaxSpan } from '../syntax/source_locations';

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

/** Binder facts retain written occurrences, not rows in an editor generation. */
export type SemanticTokenFact = {
	readonly span: LuaSyntaxSpan;
	readonly width: number;
	readonly kind: SemanticSymbolKind;
	readonly role: SemanticRole;
};

const annotationsByFile = new WeakMap<FileSemanticData, SemanticAnnotations>();

/** Materialize highlighting only at the generation-owned presentation boundary. */
export function getLuaSemanticAnnotations(file: FileSemanticData): SemanticAnnotations {
	let annotations = annotationsByFile.get(file);
	if (annotations !== undefined) return annotations;
	const locations = file.chunk.locations;
	const eof = file.chunk.tokens.get(file.chunk.tokens.length - 1);
	annotations = new Array(locations.position(eof.unit, eof.end).line);
	for (const fact of file.annotationFacts) {
		const position = locations.position(fact.span.unit, fact.span.start);
		const row = position.line - 1;
		let tokens = annotations[row];
		if (tokens === undefined) annotations[row] = tokens = [];
		const start = position.column - 1;
		tokens.push({ start, end: start + fact.width, kind: fact.kind, role: fact.role });
	}
	for (const tokens of annotations) if (tokens !== undefined) tokens.sort((left, right) => left.start - right.start);
	annotationsByFile.set(file, annotations);
	return annotations;
}
