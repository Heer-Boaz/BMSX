import type { LuaSyntaxSpan } from '../syntax/source_locations';

/** Declaration occurrence identity; source presentation belongs to its generation. */
export type SymbolID = string;

export function createSymbolId(file: string, span: LuaSyntaxSpan, kind: SemanticSymbolKind, namePath: readonly string[]): SymbolID {
	return `${file}|${span.unit}|${span.start}|${kind}|${namePath.join('.')}`;
}

export type SemanticSymbolKind =
	| 'parameter'
	| 'local'
	| 'constant'
	| 'function'
	| 'global'
	| 'bss'
	| 'data'
	| 'rodata'
	| 'property'
	| 'module'
	| 'type'
	| 'label'
	| 'keyword';
