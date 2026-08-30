import type { Decl, FileSemanticData, Ref } from './model';
import { findOrderedSourceRangeEntryAtPosition } from './source_range';

export type LuaSemanticOccurrence =
	| { readonly kind: 'declaration'; readonly declaration: Decl }
	| { readonly kind: 'reference'; readonly reference: Ref };

export function findLuaSemanticOccurrenceAt(
	source: FileSemanticData,
	line: number,
	column: number,
): LuaSemanticOccurrence | null {
	const declaration = findOrderedSourceRangeEntryAtPosition(source.decls, line, column);
	if (declaration !== undefined) {
		return { kind: 'declaration', declaration };
	}
	const reference = findOrderedSourceRangeEntryAtPosition(source.refs, line, column);
	return reference === undefined ? null : { kind: 'reference', reference };
}
