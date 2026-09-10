import type { Decl, FileSemanticData } from './model';
import type { SemanticValueSource } from './value_graph';
import { compareSourcePosition } from './source_range';

export function findInnermostScopeIndex(
	source: FileSemanticData,
	line: number,
	column: number,
): number {
	const scopes = source.scopes;
	let low = 0;
	let high = scopes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const start = scopes[middle].startInclusive;
		if (compareSourcePosition(start.line, start.column, line, column) <= 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	let scopeIndex = low - 1;
	while (scopeIndex >= 0) {
		const scope = scopes[scopeIndex];
		const end = scope.endExclusive;
		if (compareSourcePosition(line, column, end.line, end.column) < 0) {
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
	let scopeIndex = findInnermostScopeIndex(source, line, column);
	while (scopeIndex >= 0) {
		const scope = source.scopes[scopeIndex];
		const indices = scope.declarationIndices;
		for (let index = indices.length - 1; index >= 0; index -= 1) {
			const declaration = source.decls[indices[index]];
			if (declaration.name === name
				&& compareSourcePosition(
					line,
					column,
					declaration.visibleFrom.line,
					declaration.visibleFrom.column,
				) > 0) {
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
	let scopeIndex = findInnermostScopeIndex(source, line, column);
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
				|| compareSourcePosition(
					line,
					column,
					declaration.visibleFrom.line,
					declaration.visibleFrom.column,
				) <= 0) {
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
