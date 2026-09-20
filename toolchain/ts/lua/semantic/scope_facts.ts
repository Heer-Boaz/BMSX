import type { LuaSyntaxPoint } from '../syntax/source_locations';
import type { Decl } from './model';
import type { OwnedSemanticValueSource } from './value_graph';

/** Lexical occurrence identity, independent of file-wide traversal slots. */
export type ScopeID = string & { readonly __luaScopeId: unique symbol };
export type ScopeKind = 'path' | 'function' | 'method' | 'block' | 'loop';

/** Parent attachment belongs to file composition, not to a retained body. */
export type SemanticScope = {
	readonly id: ScopeID;
	readonly kind: ScopeKind;
	readonly startInclusive: LuaSyntaxPoint;
	readonly endExclusive: LuaSyntaxPoint;
	readonly declarations: readonly Decl[];
	/** The receiver declared by this method scope, not an inherited value. */
	readonly implicitSelfValue?: OwnedSemanticValueSource;
};

export function createScopeId(file: string, start: LuaSyntaxPoint, kind: ScopeKind): ScopeID {
	return `${file}|${start.unit}|${start.offset}|${kind}` as ScopeID;
}
