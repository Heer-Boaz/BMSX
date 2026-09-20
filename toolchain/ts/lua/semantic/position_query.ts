import type { Decl, FileSemanticData, Ref } from './model';
import { findOrderedSourceSpanEntryAtPosition } from './source_range';

export type LuaSemanticOccurrence =
	| { readonly kind: 'declaration'; readonly declaration: Decl }
	| { readonly kind: 'reference'; readonly reference: Ref };

export function findLuaSemanticOccurrenceAt(
	source: FileSemanticData,
	line: number,
	column: number,
): LuaSemanticOccurrence | null {
	const declaration = findOrderedSourceSpanEntryAtPosition(source.decls, source.chunk.locations, line, column);
	if (declaration !== undefined) {
		return { kind: 'declaration', declaration };
	}
	const reference = findOrderedSourceSpanEntryAtPosition(source.refs, source.chunk.locations, line, column);
	return reference === undefined ? null : { kind: 'reference', reference };
}
