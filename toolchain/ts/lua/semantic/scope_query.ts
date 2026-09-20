import type { Decl, FileSemanticData } from './model';
import type { SemanticValueSource } from './value_graph';

export function findInnermostScopeIndex(
	source: FileSemanticData,
	line: number,
	column: number,
): number {
	return findInnermostScopeIndexAtOffset(source, source.chunk.locations.offsetAt({ line, column }));
}

function findInnermostScopeIndexAtOffset(source: FileSemanticData, offset: number): number {
	const locations = source.chunk.locations;
	const scopes = source.scopes;
	let low = 0;
	let high = scopes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const start = scopes[middle].startInclusive;
		if (locations.offset(start.unit, start.offset) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	let scopeIndex = low - 1;
	while (scopeIndex >= 0) {
		const scope = scopes[scopeIndex];
		const end = scope.endExclusive;
		if (offset < locations.offset(end.unit, end.offset)) {
			return scopeIndex;
		}
		scopeIndex = scope.parentIndex;
	}
	return -1;
}

export type LuaLexicalBinding =
	| { readonly kind: 'declaration'; readonly declaration: Decl }
	| { readonly kind: 'receiver'; readonly scopeIndex: number }
	| { readonly kind: 'global'; readonly name: string };

/** Lexical storage identity, not a declaration's inferred value or receiver class. */
export function findLuaLexicalBindingAt(
	source: FileSemanticData,
	name: string,
	line: number,
	column: number,
): LuaLexicalBinding {
	const locations = source.chunk.locations;
	const offset = locations.offsetAt({ line, column });
	let scopeIndex = findInnermostScopeIndexAtOffset(source, offset);
	while (scopeIndex >= 0) {
		const scope = source.scopes[scopeIndex];
		const indices = scope.declarationIndices;
		for (let index = indices.length - 1; index >= 0; index -= 1) {
			const declaration = source.decls[indices[index]];
			if (declaration.name === name
				&& offset > locations.offset(declaration.visibleFrom.unit, declaration.visibleFrom.offset)) {
				return { kind: 'declaration', declaration };
			}
		}
		if (name === 'self' && scope.kind === 'method') return { kind: 'receiver', scopeIndex };
		scopeIndex = scope.parentIndex;
	}
	return { kind: 'global', name };
}

/** Varargs belong to the nearest function, never to an enclosing variadic one. */
export function findLuaFunctionScopeIndexAt(source: FileSemanticData, line: number, column: number): number {
	let scopeIndex = findInnermostScopeIndex(source, line, column);
	while (source.scopes[scopeIndex].kind === 'block' || source.scopes[scopeIndex].kind === 'loop') {
		scopeIndex = source.scopes[scopeIndex].parentIndex;
	}
	return scopeIndex;
}

export function findImplicitSelfValueAt(
	source: FileSemanticData,
	line: number,
	column: number,
): SemanticValueSource | undefined {
	const binding = findLuaLexicalBindingAt(source, 'self', line, column);
	return binding.kind === 'receiver' ? source.scopes[binding.scopeIndex].implicitSelfValue : undefined;
}

export function collectVisibleDeclarationsAt(
	source: FileSemanticData,
	line: number,
	column: number,
): readonly Decl[] {
	const locations = source.chunk.locations;
	const offset = locations.offsetAt({ line, column });
	let scopeIndex = findInnermostScopeIndexAtOffset(source, offset);
	if (scopeIndex < 0) {
		return [];
	}
	const declarations: Decl[] = [];
	const names = new Set<string>();
	while (scopeIndex >= 0) {
		const scope = source.scopes[scopeIndex];
		const indices = scope.declarationIndices;
		for (let index = indices.length - 1; index >= 0; index -= 1) {
			const declaration = source.decls[indices[index]];
			if (names.has(declaration.name)
				|| offset <= locations.offset(declaration.visibleFrom.unit, declaration.visibleFrom.offset)) {
				continue;
			}
			names.add(declaration.name);
			declarations.push(declaration);
		}
		if (scope.kind === 'method') names.add('self');
		scopeIndex = scope.parentIndex;
	}
	return declarations;
}
